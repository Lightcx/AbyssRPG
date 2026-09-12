/* ============================================================
 *  暗影深渊 · loot.js
 *  物品生成 / 词缀掷取 / 掉落表 / 命名 / 估价 / 评分
 * ============================================================ */
(function (root) {
  'use strict';
  const G = root.G;
  const D = G.DATA;
  const L = (G.Loot = {});

  const RARE_WORDS_A = ['腐化', '嗜血', '暗影', '破晓', '绝望', '雷霆', '枯骨', '猩红', '幽夜', '寒霜', '炽炎', '虚空', '荒古', '碎星', '孪生', '咆哮', '沉寂', '荆棘', '游魂', '天罚'];
  const RARE_WORDS_B = ['之怒', '低语', '终焉', '回响', '誓约', '之牙', '印痕', '悲鸣', '之握', '裁决', '残响', '之泪', '牢笼', '之歌', '之影', '之刃', '冠冕', '之翼'];

  const SLOT_WEIGHT = { weapon: 16, chest: 11, helm: 10, gloves: 9, boots: 9, belt: 8, offhand: 8, ring: 10, amulet: 7 };

  /* ---------------- 词缀数值掷取 ---------------- */
  // 按属性类型取整（百分比 / 暴击 / 速度等保留 1 位小数）
  L.roundStat = function (stat, v) {
    const def = D.STATS[stat] || {};
    if (def.kind === 'pct' || /Pct$|crit|resist|Speed|cdr|dmg|Dmg/.test(stat)) v = Math.round(v * 10) / 10;
    else v = Math.round(v);
    if (stat === 'allSkills' || /^skill:/.test(stat)) v = Math.round(v);
    return v;
  };

  /* ---------------- 双手武器：按「单手 + 副手」的总预算给数值 ----------------
   * 双手武器一次占掉主手与副手两个位置，因此：
   *   · 基底数值 ≈ 单手的 2 倍（写死在基底表里）
   *   · 词缀数值 = 单手的 2 倍
   *   · 孔位上限 = 单手武器上限 + 副手上限
   */
  L.isTwoHand = (item) => !!(item && item.slot === 'weapon' && item.two);
  L.affixMult = (item) => (L.isTwoHand(item) ? (D.TWO_HAND_MULT || 2) : 1);
  // 掉落时的孔位上限：普通装备随物品等级 2 / 3 / 4，双手武器翻倍
  L.socketCap = function (item, ilvl) {
    const lv = ilvl != null ? ilvl : ((item && item.ilvl) || 1);
    const base = lv > 55 ? 4 : lv > 30 ? 3 : 2;
    return L.isTwoHand(item) ? base * (D.TWO_HAND_MULT || 2) : base;
  };
  // 钻孔石的硬上限：单手装备 4 孔，双手武器 8 孔（= 单手武器 4 + 副手 4）
  L.socketMax = (item) => (L.isTwoHand(item) ? 4 * (D.TWO_HAND_MULT || 2) : 4);

  /* 词缀在指定物品等级下的档位与数值范围（做装与提示框共用）
   * idx  内部 0 基下标：0 = 最低档（物品等级 1），越大越强
   * tier 对外显示的档位：T1 最好（物品等级最高），T8 最差 —— 与流放之路一致
   * mult 数值倍率（双手武器为 2）
   */
  L.affixRange = function (a, ilvl) {
    const tiers = a.tiers;
    let idx = 0;
    for (let i = 0; i < tiers.length; i++) if (tiers[i].ilvl <= ilvl) idx = i;
    const cur = tiers[idx];
    const next = tiers[Math.min(idx + 1, tiers.length - 1)];
    let t = 0;
    if (next !== cur) t = G.clamp((ilvl - cur.ilvl) / (next.ilvl - cur.ilvl), 0, 1);
    return {
      idx,
      tier: tiers.length - idx,   // 反转：ilvl 越高，T 数字越小（越强）
      maxTier: tiers.length,
      lo: G.lerp(cur.min, next.min, t * 0.78),
      hi: G.lerp(cur.max, next.max, t * 0.78),
    };
  };

  // 内部数据里保存的仍是 0 基下标（0 = 最低档），显示时统一用 affixRange/entryRange 换算
  // mult：词缀数值倍率（双手武器 2 倍）
  L.affixValue = function (a, ilvl, rng, mult) {
    const r = L.affixRange(a, ilvl);
    const k = mult || 1;
    return { value: L.roundStat(a.stat, rng.range(r.lo, r.hi) * k), tier: r.idx };
  };

  // 某条已生成词缀在物品上的档位 / 范围信息（unique 类词缀返回 null）
  L.entryRange = function (entry, ilvl, mult) {
    if (!entry) return null;
    if (entry.kind === 'unique' || /^u_/.test(entry.id)) return null;
    const def = D.affixById[entry.id];
    if (!def || !def.tiers) return null;
    const r = L.affixRange(def, ilvl);
    const k = mult || 1;
    return { lo: L.roundStat(entry.stat, r.lo * k), hi: L.roundStat(entry.stat, r.hi * k), tier: r.tier, maxTier: r.maxTier };
  };

  /* ---------------- 稀有度 ---------------- */
  L.rollRarity = function (rng, opts) {
    const mf = opts.mf || 0;
    const ilvl = opts.ilvl || 1;
    const mfMul = 1 + mf / 100;
    const w = {
      common: 100,
      magic: (26 + ilvl * 0.55) * mfMul,
      rare: (5 + ilvl * 0.40) * mfMul,
      unique: (0.9 + ilvl * 0.075) * mfMul,
    };
    if (opts.rarityBonus) { w.magic *= opts.rarityBonus; w.rare *= opts.rarityBonus; w.unique *= opts.rarityBonus; }
    if (opts.noCommon) w.common = 0;
    return rng.weighted(['common', 'magic', 'rare', 'unique'], (k) => w[k]);
  };

  L.rarityAffixCount = function (rng, rarity, ilvl) {
    switch (rarity) {
      case 'magic': return rng.int(1, 2);                                        // 上限 1 前缀 + 1 后缀
      case 'rare': return G.clamp(rng.int(3, 4) + (ilvl > 45 && rng.chance(0.4) ? 1 : 0), 3, 6);  // 上限 3 + 3
      default: return 0;
    }
  };

  /* ---------------- 前缀 / 后缀数量上限 ---------------- */
  L.affixCap = (rarity) => (D.AFFIX_CAP[rarity] || D.AFFIX_CAP.common);
  L.countAffixes = function (item, kind) {
    let n = 0;
    (item.affixes || []).forEach((a) => { if (a.kind === kind) n++; });
    return n;
  };
  L.maxPerKind = function (item, kind) {
    const cap = L.affixCap(item.rarity);
    return kind === 'suffix' ? cap.suffix : cap.prefix;
  };
  L.canAddKind = (item, kind) => L.countAffixes(item, kind) < L.maxPerKind(item, kind);
  /* 还能再追加词缀吗（两类都没满） */
  L.canAddAny = (item) => L.canAddKind(item, 'prefix') || L.canAddKind(item, 'suffix');

  L.rollSockets = function (rng, rarity, slot, ilvl, two) {
    if (['ring', 'amulet', 'belt', 'gloves', 'boots'].indexOf(slot) >= 0 && rng.chance(0.75)) return 0;
    const max = L.socketCap({ slot: slot, two: !!two, ilvl: ilvl }, ilvl);
    let p = 0;
    if (rarity === 'common') p = 0.05;
    else if (rarity === 'magic') p = 0.18;
    else if (rarity === 'rare') p = 0.42;
    else p = 0.7;
    if (!rng.chance(p)) return 0;
    // 单手装备沿用 1-4 的权重表（保持随机数序列不变），双手武器扩展到 1-8
    const opts = max > 4 ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4];
    const n = rng.weighted(opts, (k) => (k > max ? 0 : 1 / k));
    return n;
  };

  /* ---------------- 基底数值：按物品等级在等级段之间平滑插值 ----------------
   * 避免“跨档”时伤害突然翻倍导致刷怪手感忽快忽慢
   */
  L.applyBase = function (item, base, ilvl) {
    item.base = base.id; item.type = base.type; item.kind = base.kind; item.two = !!base.two;
    item.min = base.min; item.max = base.max; item.aps = base.aps; item.armor = base.armor;
    item.implicit = (base.implicit || []).map((s) => ({ stat: s.stat, value: s.value }));
    item.req = Object.assign({}, base.req);
    const tiers = D.TIER_ILVL;
    const ti = tiers.indexOf(base.ilvl);
    const nextIlvl = ti >= 0 ? tiers[ti + 1] : null;
    if (nextIlvl != null && ilvl > base.ilvl) {
      const nxt = D.BASES.filter((b) => b.slot === base.slot && b.type === base.type && b.ilvl === nextIlvl)[0];
      if (nxt) {
        const t = G.clamp((ilvl - base.ilvl) / (nextIlvl - base.ilvl), 0, 1) * 0.8;
        if (base.min > 0 && nxt.min > base.min) {
          const k = Math.pow(nxt.min / base.min, t);
          item.min = Math.max(1, Math.round(item.min * k));
          item.max = Math.max(item.min + 1, Math.round(item.max * k));
        }
        if (base.armor > 0 && nxt.armor > base.armor) {
          item.armor = Math.round(item.armor * Math.pow(nxt.armor / base.armor, t));
        }
      }
    }
    // 基础数值区间：下限 = 生成值 ÷1.28，上限 = 生成值 ×1.28（点金石可达的上限）
    item.baseCap = {
      min: Math.max(item.min + 1, Math.round(item.min * 1.28)),
      max: Math.max(item.max + 2, Math.round(item.max * 1.28)),
      armor: Math.round((item.armor || 0) * 1.28),
    };
    item.baseFloor = {
      min: Math.max(1, Math.round(item.min / 1.28)),
      max: Math.max(1, Math.round(item.max / 1.28)),
      armor: Math.round((item.armor || 0) / 1.28),
    };
  };

  // 该装备基础数值的可能区间（旧物品没有记录时按 ±28% 现算）
  L.baseFloor = function (item) {
    if (item.baseFloor) return item.baseFloor;
    item.baseFloor = {
      min: Math.max(1, Math.round(item.min / 1.28)),
      max: Math.max(1, Math.round(item.max / 1.28)),
      armor: Math.round((item.armor || 0) / 1.28),
    };
    return item.baseFloor;
  };

  // 兼容旧存档：补齐缺失的数值上限
  L.ensureCaps = function (item) {
    if (!item || item.cat !== 'equip') return item;
    if (!item.baseCap) {
      item.baseCap = {
        min: Math.max(item.min + 1, Math.round(item.min * 1.28)),
        max: Math.max(item.max + 2, Math.round(item.max * 1.28)),
        armor: Math.round((item.armor || 0) * 1.28),
      };
    }
    L.baseFloor(item);
    return item;
  };

  // 提示框展示的基础数值区间
  //   浮动值基底（武器伤害）：{ lo: [a,b], hi: [c,d] }，两段永不相交
  //   单值基底（护甲）：{ lo: n, hi: m }
  L.baseRange = function (item, bonus) {
    L.ensureCaps(item);
    const f = L.baseFloor(item), c = item.baseCap, k = bonus > 0 ? bonus : 1;
    const sc = (v) => Math.max(1, Math.round(v * k));
    if (item.slot === 'weapon' && c.max > 0) {
      const lo = [sc(f.min), sc(f.max)];
      const hi = [sc(c.min), sc(c.max)];
      if (lo[1] >= hi[0]) {                       // 低段不得越过高段起点
        lo[1] = hi[0] - 1;
        if (lo[1] <= lo[0]) lo[0] = Math.max(1, lo[1] - 1);
      }
      if (hi[1] <= hi[0]) hi[1] = hi[0] + 1;
      return { lo: lo, hi: hi };
    }
    const a = sc(f.armor);
    return { lo: a, hi: Math.max(a + 1, sc(c.armor)) };
  };
  // "17-27 - 28-46" / "278 - 456"
  L.baseRangeText = function (item, bonus) {
    const r = L.baseRange(item, bonus);
    const p = (v) => (v instanceof Array ? v[0] + '-' + v[1] : String(v));
    return p(r.lo) + ' - ' + p(r.hi);
  };

  /* ---------------- 词缀掷取（生成 / 做装共用） ---------------- */
  L.usedGroups = function (item) {
    const used = {};
    (item.affixes || []).forEach((a) => {
      const def = D.affixById[a.id];
      used[def ? def.group : ('__' + a.id)] = true;
    });
    return used;
  };

  L.affixPool = function (item, kind, rng) {
    return D.affixesForSlot(item.slot, kind).filter((a) => {
      if (a.rare && rng && !rng.chance(a.rare)) return false;
      return true;
    });
  };

  L.maxAffixes = (item) => {
    const cap = L.affixCap(item.rarity);
    return cap.prefix + cap.suffix;
  };

  // 给装备追加一条随机词缀；成功返回该词缀条目
  L.addRandomAffix = function (rng, item, opts) {
    opts = opts || {};
    const ilvl = opts.ilvl != null ? opts.ilvl : item.ilvl;
    const used = L.usedGroups(item);
    const ent = item.affixes;
    const countOf = (k) => ent.filter((x) => x.kind === k).length;
    const auto = countOf('prefix') <= countOf('suffix') && rng.chance(0.55) ? 'prefix' : 'suffix';
    const order = opts.kind ? [opts.kind] : [auto, auto === 'prefix' ? 'suffix' : 'prefix'];
    for (let oi = 0; oi < order.length; oi++) {
      const kind = order[oi];
      if (countOf(kind) >= L.maxPerKind(item, kind)) continue;
      const pool = L.affixPool(item, kind, rng);
      for (let attempt = 0; attempt < 14; attempt++) {
        const a = rng.pick(pool);
        if (!a || used[a.group]) continue;
        let stat = a.stat;
        if (a.dynamic === 'skill') {
          const cls = opts.cls;
          const cd = cls ? D.classById(cls) : null;
          if (!cd) continue;
          const list = D.activeSkills(cls).concat(cd.skills[0]);
          stat = 'skill:' + rng.pick(list);
        }
        const r = L.affixValue(a, ilvl, rng, L.affixMult(item));
        used[a.group] = true;
        const entry = { id: a.id, stat, value: r.value, tier: r.tier, kind: a.kind, name: a.name };
        item.affixes.push(entry);
        return entry;
      }
    }
    return null;
  };

  /* 掉落生成专用的词缀掷取。
   * 词缀池在生成装备时一次性过滤（保持与旧版一致的随机序列），
   * 但额外强制「前缀 / 后缀」数量上限：蓝装 1+1，黄装 3+3。 */
  L.rollAffixesForDrop = function (rng, item, count, opts) {
    opts = opts || {};
    const used = {};
    const mult = L.affixMult(item);          // 双手武器词缀数值 ×2
    const pre = D.affixesForSlot(item.slot, 'prefix').filter((a) => !a.rare || rng.chance(a.rare));
    const suf = D.affixesForSlot(item.slot, 'suffix').filter((a) => !a.rare || rng.chance(a.rare));
    const tryAdd = (pool) => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const a = rng.pick(pool);
        if (!a || used[a.group]) continue;
        let stat = a.stat;
        if (a.dynamic === 'skill') {
          const cls = opts.cls;
          const cd = cls ? D.classById(cls) : null;
          if (!cd) return false;
          const list = D.activeSkills(cls).concat(cd.skills[0]);
          stat = 'skill:' + rng.pick(list);
        }
        const r = L.affixValue(a, item.ilvl, rng, mult);
        used[a.group] = true;
        item.affixes.push({ id: a.id, stat, value: r.value, tier: r.tier, kind: a.kind, name: a.name });
        return true;
      }
      return false;
    };
    let n = count;
    let guard = 0;
    while (n > 0 && guard++ < 20) {
      const nPre = L.countAffixes(item, 'prefix');
      const nSuf = L.countAffixes(item, 'suffix');
      const canPre = nPre < L.maxPerKind(item, 'prefix');
      const canSuf = nSuf < L.maxPerKind(item, 'suffix');
      if (!canPre && !canSuf) break;
      // 两类都还能加时沿用旧版 55% 偏好，否则只能加到没满的那一类
      const usePre = !canSuf ? true : (!canPre ? false : (nPre <= nSuf && rng.chance(0.55)));
      if (tryAdd(usePre ? pre : suf)) n--;
    }
  };

  /* ---------------- 生成物品 ---------------- */
  L.makeItem = function (rng, opts) {
    const ilvl = Math.max(1, Math.round(opts.ilvl || 1));
    let slot = opts.slot;
    if (!slot) slot = rng.weighted(Object.keys(SLOT_WEIGHT), (s) => SLOT_WEIGHT[s]);
    let base = opts.baseId ? D.baseById(opts.baseId) : null;
    if (!base) {
      let pool = D.basesForSlot(slot, ilvl);
      // 偏向 ilvl 接近的基底
      base = rng.weighted(pool, (b) => 1 / (1 + Math.abs(b.ilvl - ilvl) * 0.35));
    }
    const rarity = opts.rarity || L.rollRarity(rng, { mf: opts.mf, ilvl, rarityBonus: opts.rarityBonus, noCommon: opts.noCommon });
    const item = {
      uid: G.uid(), cat: 'equip', base: base.id, slot: base.slot, type: base.type, kind: base.kind, two: !!base.two,
      ilvl, rarity, min: 0, max: 0, aps: base.aps, armor: 0,
      implicit: [], affixes: [], sockets: 0, gems: [], unique: null, name: null, req: {},
    };
    L.applyBase(item, base, ilvl);
    item.sockets = L.rollSockets(rng, rarity, base.slot, ilvl, base.two);
    item.gems = new Array(item.sockets).fill(null);

    if (rarity === 'unique' && !opts.noUnique) {
      const pool = D.UNIQUES.filter((u) => u.slot === base.slot && u.ilvl <= ilvl + 8);
      if (pool.length) {
        const u = rng.pick(pool);
        item.unique = u.id;
        item.name = u.name;
        // 暗金使用自己指定的基底类型
        const typePool = D.BASES.filter((b) => b.slot === u.slot && b.type === u.type && b.ilvl <= ilvl + 6);
        if (typePool.length) L.applyBase(item, typePool[typePool.length - 1], ilvl);
        u.mods.forEach((m) => item.affixes.push({ id: 'u_' + u.id, stat: m.stat, value: m.value, tier: 9, kind: 'unique' }));
        if (item.sockets === 0 && u.slot !== 'ring' && u.slot !== 'amulet') { item.sockets = rng.int(1, 2); item.gems = new Array(item.sockets).fill(null); }
      } else {
        item.rarity = 'rare';
      }
    }

    if (item.rarity === 'magic' || item.rarity === 'rare') {
      const count = L.rarityAffixCount(rng, item.rarity, ilvl);
      L.rollAffixesForDrop(rng, item, count, { cls: opts.cls });
    }
    if (item.rarity === 'rare') item.name = rng.pick(RARE_WORDS_A) + rng.pick(RARE_WORDS_B);
    // 需求随稀有度略增
    if (item.req && item.req.level != null) item.req.level = Math.max(1, Math.round(item.req.level + (item.rarity === 'unique' ? 2 : 0)));
    return item;
  };

  L.makeGem = function (rng, ilvl) {
    const keys = Object.keys(D.GEM_TYPES);
    const kind = rng.pick(keys);
    let tier = 0;
    const roll = rng.next() * 100;
    const base = G.clamp(Math.floor(ilvl / 18), 0, 4);
    tier = G.clamp(base + (roll < 18 ? -1 : roll > 88 ? 1 : 0), 0, 4);
    return L.makeGemOf(kind, tier, 1);
  };

  // 指定种类 / 品质 / 数量的宝石（可堆叠）
  L.makeGemOf = function (gem, tier, count) {
    const t = D.GEM_TYPES[gem];
    tier = G.clamp(tier | 0, 0, 4);
    return {
      uid: G.uid(), cat: 'gem', gem, tier, count: Math.max(1, count || 1),
      name: D.gemName(gem, tier), color: t.color,
    };
  };

  L.makePotion = function (kind, tier) {
    const p = D.POTIONS[kind];
    return { uid: G.uid(), cat: 'potion', potion: kind, tier, name: p.name + ' Lv' + (tier + 1), color: p.color };
  };

  L.makeGold = function (amount) { return { uid: G.uid(), cat: 'gold', amount: Math.max(1, Math.round(amount)) }; };
  // 深渊残晶掉落物（拾取后直接进残晶池，和金币一样不占背包）
  L.makeShard = function (amount) {
    const n = Math.max(1, Math.round(amount));
    return { uid: G.uid(), cat: 'shard', amount: n, name: D.MATERIAL.name, icon: D.MATERIAL.icon, color: D.MATERIAL.color };
  };

  L.potionTierFor = (mlvl) => G.clamp(Math.floor(mlvl / 24), 0, 3);
  L.gemIlvlFor = (mlvl) => Math.max(1, mlvl);

  /* ---------------- 通货石（做装） ---------------- */
  L.orbItem = function (orbId, count) {
    const o = D.orbById[orbId];
    if (!o) return null;
    return { uid: G.uid(), cat: 'orb', orb: orbId, count: Math.max(1, count || 1), name: o.name, color: o.color };
  };
  L.makeOrb = function (rng, mlvl, orbId) {
    if (orbId) return L.orbItem(orbId, 1);
    const pool = D.ORBS.filter((o) => o.minMlvl <= (mlvl || 1));
    const o = rng.weighted(pool, (x) => x.weight);
    return L.orbItem(o.id, 1);
  };
  L.orbUnitPrice = (orb) => (D.orbById[orb] ? D.orbById[orb].price : 100);

  // 能否对这件装备使用该通货
  L.canUseOrb = function (item, orbId) {
    if (!item || item.cat !== 'equip') return { ok: false, why: '只能对装备使用' };
    const r = item.rarity;
    const normalAffixes = (item.affixes || []).filter((a) => a.kind !== 'unique');
    const n = normalAffixes.length;
    switch (orbId) {
      case 'ascend': return r === 'common' ? { ok: true } : { ok: false, why: '只能用于普通（白色）装备' };
      case 'augment':
        if (r !== 'magic' && r !== 'rare') return { ok: false, why: '只能用于魔法或稀有装备' };
        if (!L.canAddAny(item)) {
          const c = L.affixCap(r);
          return { ok: false, why: '该装备的词缀已满（前缀 ' + c.prefix + ' + 后缀 ' + c.suffix + '）' };
        }
        return { ok: true };
      case 'refine': return r === 'magic' ? { ok: true } : { ok: false, why: '只能用于魔法（蓝色）装备' };
      case 'purify': return (r === 'magic' || r === 'rare') ? { ok: true } : { ok: false, why: '只能用于魔法或稀有装备' };
      case 'chaos': return (r === 'magic' || r === 'rare') ? { ok: true } : { ok: false, why: '只能用于魔法或稀有装备' };
      case 'fracture':
        if (r !== 'magic' && r !== 'rare') return { ok: false, why: '只能用于魔法或稀有装备' };
        if (n <= 0) return { ok: false, why: '该装备没有可移除的词缀' };
        return { ok: true };
      case 'whetstone': return { ok: true };
      case 'drill': {
        const cap = L.socketMax(item);
        return (item.sockets | 0) >= cap ? { ok: false, why: '孔位已达上限（' + cap + ' 孔）' } : { ok: true };
      }
      case 'legend': return r === 'rare' ? { ok: true } : { ok: false, why: '只能用于稀有（黄色）装备' };
      default: return { ok: false, why: '未知通货' };
    }
  };

  /* 使用通货石改造装备。
   * 返回 { ok, msg, lines[] }：lines 为可读的数值变化描述。
   */
  L.applyOrb = function (rng, item, orbId, opts) {
    opts = opts || {};
    const chk = L.canUseOrb(item, orbId);
    if (!chk.ok) return { ok: false, msg: chk.why, lines: [] };
    L.ensureCaps(item);
    const lines = [];
    const addLine = (e) => { if (e) lines.push('新增：' + D.statText(e.stat, e.value)); };
    item.craftCount = (item.craftCount || 0) + 1;

    switch (orbId) {
      case 'ascend': {
        item.rarity = 'magic';
        item.name = null;
        const n = rng.int(1, 2);
        for (let i = 0; i < n; i++) addLine(L.addRandomAffix(rng, item, { cls: opts.cls }));
        break;
      }
      case 'augment': {
        const e = L.addRandomAffix(rng, item, { cls: opts.cls });
        if (!e) { item.craftCount--; return { ok: false, msg: '没有可用的词缀组合了', lines: [] }; }
        addLine(e);
        break;
      }
      case 'refine': {
        item.rarity = 'rare';
        if (!item.name) item.name = rng.pick(RARE_WORDS_A) + rng.pick(RARE_WORDS_B);
        const target = L.rarityAffixCount(rng, 'rare', item.ilvl);
        let guard = 0;
        while (item.affixes.filter((a) => a.kind !== 'unique').length < target && guard++ < 20) {
          const e = L.addRandomAffix(rng, item, { cls: opts.cls });
          if (!e) break;
          addLine(e);
        }
        break;
      }
      case 'purify': {
        const removed = item.affixes.filter((a) => a.kind !== 'unique').length;
        item.affixes = item.affixes.filter((a) => a.kind === 'unique');
        item.rarity = item.affixes.length ? 'unique' : 'common';
        item.name = null;
        lines.push('移除了 ' + removed + ' 条词缀');
        break;
      }
      case 'chaos': {
        const count = item.affixes.filter((a) => a.kind !== 'unique').length;
        item.affixes = item.affixes.filter((a) => a.kind === 'unique');
        lines.push('重掷了 ' + count + ' 条词缀');
        for (let i = 0; i < count; i++) addLine(L.addRandomAffix(rng, item, { cls: opts.cls }));
        if (item.rarity === 'rare' && !item.name) item.name = rng.pick(RARE_WORDS_A) + rng.pick(RARE_WORDS_B);
        break;
      }
      case 'fracture': {
        const idxs = [];
        item.affixes.forEach((a, i) => { if (a.kind !== 'unique') idxs.push(i); });
        const i = idxs[rng.int(0, idxs.length - 1)];
        const gone = item.affixes[i];
        item.affixes.splice(i, 1);
        lines.push('裂解：「' + D.statText(gone.stat, gone.value) + '」已被剥离');
        break;
      }
      case 'whetstone': {
        /* 词缀数值向档位上限推进 */
        item.affixes.forEach((a) => {
          const rg = L.entryRange(a, item.ilvl, L.affixMult(item));
          if (!rg || a.value >= rg.hi - 0.001) return;
          const nv = L.roundStat(a.stat, a.value + (rg.hi - a.value) * rng.range(0.45, 1.0));
          const capped = Math.min(rg.hi, Math.max(a.value, nv));
          if (capped > a.value) {
            lines.push(D.statText(a.stat, a.value) + ' → ' + D.statText(a.stat, capped));
            a.value = capped;
          }
        });
        /* 基础数值向 item.baseCap 推进 */
        const cap = item.baseCap;
        const raise = (cur, top, minStep) => {
          if (!(top > cur)) return cur;
          const nv = Math.round(cur + (top - cur) * rng.range(0.45, 1.0));
          return Math.min(top, Math.max(cur + (minStep || 1), nv));
        };
        if (item.slot === 'weapon' && cap) {
          const om = item.min, ox = item.max;
          item.min = raise(item.min, cap.min, 1);
          item.max = Math.max(item.min + 1, raise(item.max, cap.max, 1));
          if (item.min !== om || item.max !== ox) lines.push('伤害 ' + om + '–' + ox + ' → ' + item.min + '–' + item.max);
        } else if (item.armor > 0 && cap) {
          const oa = item.armor;
          item.armor = Math.max(item.armor + 1, raise(item.armor, cap.armor, 1));
          if (item.armor !== oa) lines.push('护甲 ' + oa + ' → ' + item.armor);
        }
        if (!lines.length) { item.craftCount--; return { ok: false, msg: '数值已接近上限，无法再提升', lines: [] }; }
        break;
      }
      case 'drill': {
        item.sockets = (item.sockets | 0) + 1;
        item.gems = item.gems || [];
        while (item.gems.length < item.sockets) item.gems.push(null);
        lines.push('孔位 → ' + item.sockets + ' 孔');
        break;
      }
      case 'legend': {
        const used = {};
        if (item.power) used[item.power] = true;
        const pool = Object.keys(D.POWER_NAME).filter((p) => !used[p]);
        const pw = rng.pick(pool);
        item.power = pw;
        item.rarity = 'unique';
        lines.push('获得暗金特效：【' + D.POWER_NAME[pw] + '】' + D.POWER_TEXT[pw]);
        break;
      }
      default: return { ok: false, msg: '未知通货', lines: [] };
    }
    item.craftCount = item.craftCount || 1;
    return { ok: true, msg: D.orbById[orbId].name + ' 生效', lines };
  };

  /* ---------------- 分解 ---------------- */
  L.salvageYield = function (item) {
    if (!item || item.cat !== 'equip') return 0;
    const rar = { common: 1, magic: 2.4, rare: 5.5, unique: 14 }[item.rarity] || 1;
    const socketBonus = 1 + (item.sockets | 0) * 0.12;
    return Math.max(1, Math.round((0.7 + item.ilvl * 0.12) * rar * socketBonus));
  };

  /* ---------------- 词缀品质（0-100，越高越接近满数值） ---------------- */
  L.affixQuality = function (item) {
    if (!item || item.cat !== 'equip') return null;
    let sum = 0, n = 0;
    const mult = L.affixMult(item);
    (item.affixes || []).forEach((a) => {
      const rg = L.entryRange(a, item.ilvl, mult);
      if (!rg || !(rg.hi > rg.lo)) return;
      sum += G.clamp((a.value - rg.lo) / (rg.hi - rg.lo), 0, 1);
      n++;
    });
    if (!n) return null;
    return Math.round(sum / n * 100);
  };

  /* ---------------- 掉落表 ---------------- */
  // 掉落物品等级：以怪物等级为上限，但不会远超玩家等级太多（避免打到穿不上的装备）
  L.dropIlvl = function (mlvl, plvl) {
    if (!plvl) return mlvl;
    return Math.max(1, Math.max(plvl + 2, Math.min(mlvl, plvl + 6)));
  };

  L.rollDrops = function (rng, o) {
    const mlvl = o.mlvl || 1;
    const mult = o.mult == null ? 1 : o.mult;
    const mf = o.mf || 0, gf = o.gf || 0;
    const ilvl = L.dropIlvl(mlvl, o.plvl);
    const out = [];
    const goldChance = o.kind === 'boss' ? 1 : o.kind === 'elite' ? 1 : 0.62;
    if (rng.chance(goldChance * Math.min(1, mult))) {
      let amt = G.BALANCE.goldBase * (1 + mlvl * 0.55) * mult * (0.7 + rng.next() * 0.7);
      amt *= 1 + gf / 100;
      out.push(L.makeGold(amt));
    }
    const dropQty = o.kind === 'boss' ? rng.int(4, 7) : o.kind === 'elite' ? rng.int(1, 2) : rng.chance(G.BALANCE.dropBase * mult) ? 1 : 0;
    for (let i = 0; i < dropQty; i++) {
      out.push(L.makeItem(rng, {
        ilvl, mf: mf * (o.kind === 'boss' ? 1.6 : o.kind === 'elite' ? 1.25 : 1),
        rarityBonus: o.kind === 'boss' ? 2.2 : o.kind === 'elite' ? 1.4 : 1,
        noCommon: o.kind === 'boss' && rng.chance(0.7), cls: o.cls,
      }));
    }
    const potionChance = o.kind === 'boss' ? 1 : o.kind === 'elite' ? 0.5 : 0.16;
    if (rng.chance(potionChance * mult)) out.push(L.makePotion(rng.chance(0.6) ? 'life' : 'mana', L.potionTierFor(mlvl)));
    const gemChance = (o.kind === 'boss' ? 0.85 : o.kind === 'elite' ? 0.26 : 0.035) * mult;
    if (rng.chance(gemChance)) out.push(L.makeGem(rng, L.gemIlvlFor(mlvl)));
    if (o.kind === 'boss' && rng.chance(0.5)) out.push(L.makeGem(rng, L.gemIlvlFor(mlvl) + 20));
    /* 做装通货：普通怪偶尔掉，精英/BOSS 稳定掉 */
    const orbBonus = o.orbBonus || 1;
    const orbBase = o.kind === 'boss' ? 0.9 : o.kind === 'elite' ? 0.2 : 0.028;
    if (rng.chance(Math.min(0.98, orbBase * mult * orbBonus))) out.push(L.makeOrb(rng, mlvl));
    if (o.kind === 'boss' && rng.chance(0.45 * orbBonus)) out.push(L.makeOrb(rng, mlvl + 8));
    /* 深渊残晶：小概率掉落，和金币 / 通货石一样直接吸进残晶池（秘法工坊提升掉落率） */
    const shardBonus = o.shardBonus || 1;
    const shardBase = o.kind === 'boss' ? 0.75 : o.kind === 'elite' ? 0.22 : 0.05;
    if (rng.chance(Math.min(0.95, shardBase * mult * shardBonus))) {
      const per = o.kind === 'boss' ? 14 : o.kind === 'elite' ? 5 : 2.2;
      out.push(L.makeShard(per * (1 + mlvl * 0.14) * (0.7 + rng.next() * 0.8) * Math.min(1.6, mult)));
    }
    return out;
  };

  /* ---------------- 命名 ---------------- */
  L.displayName = function (item) {
    if (!item) return '';
    if (item.name) return item.name;
    if (item.cat !== 'equip') return item.name || '';
    const base = D.baseById(item.base);
    const bn = base ? base.name : '物品';
    if (item.rarity === 'magic') {
      const pre = item.affixes.filter((a) => a.kind === 'prefix')[0];
      const suf = item.affixes.filter((a) => a.kind === 'suffix')[0];
      let n = '';
      if (pre) n += pre.name;
      n += bn;
      if (suf) n += ' ' + (suf.name || '');
      return n;
    }
    return bn;
  };
  L.typeName = function (item) {
    if (item.cat === 'gem') return '宝石';
    if (item.cat === 'potion') return '药水';
    if (item.cat === 'gold') return '金币';
    const base = D.baseById(item.base);
    const wt = D.WEAPON_TYPES[item.type];
    const two = item.two ? '双手 ' : '';
    const ti = base ? D.TIER_ILVL.indexOf(base.ilvl) : -1;
    const tierTxt = ti >= 0 && D.TIER_NAMES[ti] ? ' · ' + D.TIER_NAMES[ti] : '';
    if (item.slot === 'weapon') return two + (wt ? wt.label : '武器') + tierTxt;
    if (item.slot === 'offhand') return (item.type === 'shield' ? '盾牌' : item.type === 'orb' ? '法器' : '箭袋') + tierTxt;
    const s = D.SLOT_BY_ID[item.slot];
    return (s ? s.name : '装备') + tierTxt;
  };

  /* ---------------- 数值工具 ---------------- */
  L.weaponDps = function (item, stats) {
    if (!item || item.slot !== 'weapon') return 0;
    const avg = (item.min + item.max) / 2;
    const aps = item.aps * (1 + ((stats && stats.aps) || 0) / 100);
    return avg * aps;
  };

  const SCORE_W = {
    str: 1, dex: 1, int: 1, vit: 1.2, life: 0.32, lifePct: 6, mana: 0.1, manaPct: 1.2,
    armor: 0.14, armorPct: 1.6, allResist: 3.2, fireResist: 1.2, coldResist: 1.2, lightResist: 1.2, poisonResist: 1.2,
    crit: 7, critDmg: 1.5, aps: 5, moveSpeed: 3, dmgPct: 7, physDmg: 3.4, fireDmg: 3.4, coldDmg: 3.4, lightDmg: 3.4, poisonDmg: 3.4,
    addFire: 0.9, addCold: 0.9, addLight: 0.9, addPoison: 0.9, lifeRegen: 1.6, manaRegen: 0.6, lifeOnHit: 0.7, lifeSteal: 12, manaSteal: 9,
    mf: 1.2, gf: 0.3, cdr: 5, areaDmg: 2.2, thorns: 0.2, pickup: 0.2, xpBonus: 0.8, dmgReduce: 9,
    allSkills: 30, dodge: 4,
  };
  L.score = function (item, stats) {
    if (!item || item.cat !== 'equip') return 0;
    let s = 0;
    const all = G.Stats.itemStats(item);
    for (const k in all) {
      if (/^skill:/.test(k)) s += all[k] * 22;
      else s += (SCORE_W[k] || 0.5) * all[k];
    }
    if (item.slot === 'weapon') {
      const aps = item.aps * (1 + ((stats && stats.aps) || 0) / 100);
      const bonus = 1 + (all.dmgPct || 0) / 100 + (all.physDmg || 0) / 100;
      s += (item.min + item.max) / 2 * aps * bonus * 6;
    }
    s += (item.armor || 0) * 0.14 * (1 + (all.armorPct || 0) / 100);
    return Math.round(s);
  };

  L.price = function (item) {
    if (!item) return 0;
    if (item.cat === 'gold') return item.amount;
    if (item.cat === 'potion') return 25 * (item.tier + 1);
    if (item.cat === 'gem') return Math.round(40 * Math.pow(2.4, item.tier) * (item.count || 1));
    if (item.cat === 'orb') return L.orbUnitPrice(item.orb) * (item.count || 1);
    const rar = { common: 1, magic: 3.2, rare: 8.5, unique: 26 }[item.rarity] || 1;
    const affixBonus = 1 + item.affixes.length * 0.18;
    const socketBonus = 1 + item.sockets * 0.25;
    return Math.max(5, Math.round((6 + item.ilvl * item.ilvl * 0.22) * rar * affixBonus * socketBonus));
  };
  L.buyPrice = (item) => Math.round(L.price(item) * 3.4);

  /* ---------------- 玩家对比 ---------------- */
  L.equippedFor = function (player, item) {
    if (!player || !player.gear) return null;
    if (item.slot === 'ring') return player.gear.ring1 || player.gear.ring2;
    return player.gear[item.slot] || null;
  };

  /* 装上这件装备会带来哪些槽位变化
   *  —— 双手武器与副手互斥：装双手会顶掉副手，装副手会顶掉双手武器，
   *     被顶掉的装备同样要计入评分变化，否则会出现「评分提升」的假提示 */
  L.equipDisplaced = function (player, item, slot) {
    const out = [];
    const gear = (player && player.gear) || {};
    if (!item) return out;
    if (item.slot === 'weapon' && item.two && slot !== 'offhand' && gear.offhand) {
      out.push({ slot: 'offhand', item: gear.offhand, why: '双手武器会顶掉副手' });
    }
    if (item.slot === 'offhand' && gear.weapon && gear.weapon.two && slot !== 'weapon') {
      out.push({ slot: 'weapon', item: gear.weapon, why: '副手会顶掉双手武器' });
    }
    return out;
  };

  /* 某个槽位的评分对比：cur = 现有装备（含被顶掉的）评分，next = 新装备评分 */
  L.compareSlot = function (player, item, slot) {
    const cur = (player.gear && player.gear[slot]) || null;
    const displaced = L.equipDisplaced(player, item, slot);
    let curScore = cur ? L.score(cur, player.stats) : 0;
    displaced.forEach((d) => { curScore += L.score(d.item, player.stats); });
    const next = L.score(item, player.stats);
    return {
      slot: slot, cur: curScore, next: next, delta: next - curScore,
      empty: !cur && !displaced.length, item: cur, displaced: displaced,
    };
  };

  L.compare = function (player, item) {
    if (!player || !item || item.cat !== 'equip' || !player.gear) return null;
    if (item.slot === 'ring') {
      const list = L.compareAll(player, item);
      let best = null;
      list.forEach((r) => { if (!best || r.delta > best.delta) best = r; });
      return best;
    }
    const cmp = L.compareSlot(player, item, item.slot);
    return cmp.empty ? null : cmp;
  };

  /* 逐槽位对比：戒指会返回两个槽位各自的评分变化，其余装备只返回一条 */
  L.compareAll = function (player, item) {
    if (!player || !item || item.cat !== 'equip' || !player.gear) return [];
    if (item.slot === 'ring') {
      return ['ring1', 'ring2'].map((s) => {
        const r = L.compareSlot(player, item, s);
        r.label = D.SLOT_BY_ID[s] ? D.SLOT_BY_ID[s].name : s;
        return r;
      });
    }
    const r = L.compareSlot(player, item, item.slot);
    r.label = '';
    return [r];
  };

  /* ---------------- 工具提示 ---------------- */
  /* 词缀档位配色（T1 最好 → T8 最差）
   *   T1        红   —— 顶级词缀
   *   T2        粉
   *   T3 – T4   青
   *   T5 – T6   绿
   *   T7 – T8   灰   —— 最低两档
   */
  L.tierClass = function (tier) {
    if (!tier) return 't5';
    if (tier <= 1) return 't1';
    if (tier === 2) return 't2';
    if (tier <= 4) return 't3';
    if (tier <= 6) return 't4';
    return 't5';
  };

  // 单条词缀的 HTML（含前缀/后缀标识、档位、数值范围、填充条）
  L.affixHTML = function (item, a) {
    const txt = D.statText(a.stat, a.value);
    if (a.kind === 'unique') return '<div class="tstat unique-line">◆ ' + txt + '</div>';
    const kindTag = '<span class="akind ' + (a.kind === 'prefix' ? 'pre' : 'suf') + '">' +
      (a.kind === 'prefix' ? '前' : '后') + '</span>';
    const rg = L.entryRange(a, item.ilvl, L.affixMult(item));
    if (!rg) return '<div class="tstat affix">' + kindTag + '<span class="av">' + txt + '</span></div>';
    const span = rg.hi - rg.lo;
    const pct = span > 1e-6 ? G.clamp((a.value - rg.lo) / span, 0, 1) : 1;
    const perfect = a.value >= rg.hi - 1e-6;
    return '<div class="tstat affix' + (perfect ? ' perfect' : '') + '">' +
      kindTag +
      '<span class="av">' + txt + '</span>' +
      '<span class="atier ' + L.tierClass(rg.tier) + '">T' + rg.tier + '</span>' +
      '<span class="arng">' + rg.lo + '–' + rg.hi + '</span>' +
      '<span class="abar"><i style="width:' + Math.round(pct * 100) + '%"></i></span>' +
      '</div>';
  };

  // 词缀展示顺序：前缀 → 后缀 → 暗金固定词缀
  L.sortedAffixes = function (item) {
    const rank = { prefix: 0, suffix: 1, unique: 2 };
    return (item.affixes || []).slice().sort((a, b) => {
      const ra = rank[a.kind] == null ? 3 : rank[a.kind];
      const rb = rank[b.kind] == null ? 3 : rank[b.kind];
      return ra - rb;
    });
  };

  L.tooltipHTML = function (item, player, opts) {
    opts = opts || {};
    if (!item) return '';
    const col = G.RARITY_COLOR[item.rarity] || '#d6d2cc';
    let h = '';
    if (item.cat === 'orb') {
      const o = D.orbById[item.orb];
      if (!o) return '';
      h += '<div class="tname" style="color:' + o.color + '">' + o.icon + ' ' + o.name + (item.count > 1 ? ' ×' + item.count : '') + '</div>';
      h += '<div class="ttype">做装通货　<span class="orb-use">' + o.use + '</span></div><div class="tsep"></div>';
      h += '<div class="tflavor">' + o.desc + '</div>';
      h += '<div class="tsep"></div><div class="tsock">在城镇【秘法工坊】中对装备使用（快捷键 G）。</div>';
      h += '<div class="tprice">售价 ' + L.price(item) + ' 金币</div>';
      return h;
    }
    if (item.cat === 'gem') {
      const st = D.gemStat(item.gem, item.tier);
      h += '<div class="tname" style="color:' + item.color + '">' + item.name + '</div>';
      h += '<div class="ttype">宝石　' + (item.tier + 1) + ' / 5 级</div><div class="tsep"></div>';
      h += '<div class="tsock">镶嵌于带孔装备：</div>';
      h += '<div class="tstat">' + D.statText(st.stat, st.value) + '</div>';
      h += '<div class="tsep"></div><div class="tflavor">右键选中，再左键点击带孔装备即可镶嵌。</div>';
      h += '<div class="tprice">售价 ' + L.price(item) + ' 金币</div>';
      return h;
    }
    if (item.cat === 'potion') {
      const p = D.POTIONS[item.potion];
      h += '<div class="tname" style="color:' + p.color + '">' + item.name + '</div>';
      h += '<div class="ttype">药水</div><div class="tsep"></div>';
      h += '<div class="tstat good">立即恢复 ' + p.vals[item.tier] + ' 点' + (item.potion === 'life' ? '生命' : '法力') + '</div>';
      h += '<div class="tprice">售价 ' + L.price(item) + ' 金币</div>';
      return h;
    }
    if (item.cat === 'gold') return '<div class="tname" style="color:#ffe9a8">' + item.amount + ' 金币</div>';

    L.ensureCaps(item);
    const cap = item.baseCap;
    h += '<div class="tname" style="color:' + col + '">' + L.displayName(item) + '</div>';
    h += '<div class="ttype">' + L.typeName(item) + '　<span style="color:' + col + '">' + G.RARITY_NAME[item.rarity] + '</span>　物品等级 ' + item.ilvl + '</div>';
    // 武器伤害
    if (item.slot === 'weapon') {
      const all = G.Stats.itemStats(item);
      const bonus = 1 + (all.dmgPct || 0) / 100 + (all.physDmg || 0) / 100;
      const mn = item.min * bonus, mx = item.max * bonus;
      const aps = item.aps;
      let elems = '';
      [['addFire', 'fire', '火焰'], ['addCold', 'cold', '冰冷'], ['addLight', 'lightning', '闪电'], ['addPoison', 'poison', '毒素']].forEach((e) => {
        const v = all[e[0]] | 0;
        if (v > 0) elems += '<div class="tstat" style="color:' + G.ELEM_COLOR[e[1]] + '">+' + Math.round(v * 0.8) + '–' + Math.round(v * 1.2) + ' ' + e[2] + '伤害</div>';
      });
      h += '<div class="tsep"></div>';
      // 有浮动值的基底：显示「最低段 - 最高段」，例如 7-9 - 10-12
      h += '<div class="tstat base"><span class="av">' + Math.round(mn) + '–' + Math.round(mx) + ' 伤害</span>' +
        (cap ? '<span class="arng" title="该基底在此物品等级可能出现的伤害区间">' +
          L.baseRangeText(item, bonus) + '</span>' : '') + '</div>';
      h += '<div class="tstat dim">' + aps.toFixed(2) + ' 攻击/秒　每秒伤害 ' + Math.round((mn + mx) / 2 * aps) + '</div>';
      h += elems;
      if (item.two) {
        h += '<div class="tstat dim">双手武器：占主手 + 副手两个位置，基底与词缀数值为单手的 ' +
          (D.TWO_HAND_MULT || 2) + ' 倍，孔位上限 ' + L.socketMax(item) + '</div>';
      }
    } else if (item.armor > 0) {
      h += '<div class="tsep"></div><div class="tstat base"><span class="av">' + Math.round(item.armor) + ' 护甲</span>' +
        (cap && cap.armor ? '<span class="arng" title="该基底在此物品等级可能出现的数值范围">' +
          L.baseRangeText(item) + '</span>' : '') + '</div>';
    }
    // 固有属性
    if (item.implicit && item.implicit.length) {
      h += '<div class="tsep"></div><div class="thd">固有属性</div>';
      item.implicit.forEach((s) => { h += '<div class="timplicit">' + D.statText(s.stat, s.value) + '</div>'; });
    }
    // 词缀
    if (item.affixes.length) {
      const q = L.affixQuality(item);
      const cap = L.affixCap(item.rarity);
      const nPre = L.countAffixes(item, 'prefix');
      const nSuf = L.countAffixes(item, 'suffix');
      const nUni = L.countAffixes(item, 'unique');
      let cnt;
      if (cap.prefix + cap.suffix > 0) {
        cnt = '前缀 <b class="' + (nPre >= cap.prefix ? 'good' : '') + '">' + nPre + ' / ' + cap.prefix + '</b>' +
          '　后缀 <b class="' + (nSuf >= cap.suffix ? 'good' : '') + '">' + nSuf + ' / ' + cap.suffix + '</b>' +
          (nUni ? '　暗金 ' + nUni : '');
      } else {
        cnt = nUni + ' 条固定词缀';
      }
      h += '<div class="tsep"></div><div class="thd">词缀 <span class="dim">' + cnt +
        (q != null ? '　数值品质 <b class="' + (q >= 80 ? 'good' : q >= 50 ? '' : 'bad') + '">' + q + '%</b>' : '') + '</span></div>';
      L.sortedAffixes(item).forEach((a) => { h += L.affixHTML(item, a); });
    }
    // 宝石
    if (item.sockets > 0) {
      h += '<div class="tsep"></div><div class="thd">孔位 <span class="dim">' + item.gems.filter(Boolean).length + ' / ' + item.sockets + '</span></div>';
      item.gems.forEach((g) => {
        if (g) {
          const st = D.gemStat(g.gem, g.tier);
          h += '<div class="tsock">◆ ' + D.gemName(g.gem, g.tier) + '：<span class="tstat good">' + D.statText(st.stat, st.value) + '</span></div>';
        } else h += '<div class="tsock">◇ 空孔位</div>';
      });
    }
    // 暗金 / 传奇特效
    const power = item.power || (item.unique && D.uniqueById[item.unique] ? D.uniqueById[item.unique].power : null);
    if (power) {
      const u = item.unique ? D.uniqueById[item.unique] : null;
      h += '<div class="tsep"></div>';
      h += '<div class="tunique">【' + (D.POWER_NAME[power] || '特殊') + '】' + (D.POWER_TEXT[power] || '') + '</div>';
      if (u && u.flavor) h += '<div class="tflavor">“' + u.flavor + '”</div>';
    }
    // 需求
    if (item.req) {
      const bad = [];
      if (player) {
        if (item.req.level && player.level < item.req.level) bad.push('等级 ' + item.req.level);
        ['str', 'dex', 'int'].forEach((k) => { if (item.req[k] && player.attrs && player.attrs[k] < item.req[k]) bad.push(D.STATS[k].name + ' ' + item.req[k]); });
      }
      const parts = [];
      if (item.req.level) parts.push('等级 ' + item.req.level);
      ['str', 'dex', 'int'].forEach((k) => { if (item.req[k]) parts.push(D.STATS[k].name + ' ' + item.req[k]); });
      if (parts.length) {
        h += '<div class="tsep"></div><div class="treq' + (bad.length ? ' bad' : '') + '">需求：' + parts.join('　') + (bad.length ? '（不满足）' : '') + '</div>';
      }
    }
    // 对比
    if (opts.compare && player && item.cat === 'equip') {
      if (item.slot === 'ring') {
        // 戒指：分别给出装到两个槽位后的评分变化
        L.compareAll(player, item).forEach((r) => {
          const cls = r.empty || r.delta >= 0 ? 'up' : 'down';
          h += '<div class="tcmp ' + cls + '">' + r.label + '：' +
            (r.empty ? '空槽位 → ' + r.next : r.cur + ' → ' + r.next) +
            '　' + (r.empty ? '（可直接装备）' : (r.delta >= 0 ? '▲ +' + r.delta : '▼ ' + r.delta)) + '</div>';
        });
        h += '<div class="tcmp dim small">右键点击可选择装备到戒指 I 或 II。</div>';
      } else {
        const cmp = L.compare(player, item);
        if (cmp) {
          const cls = cmp.delta >= 0 ? 'up' : 'down';
          h += '<div class="tcmp ' + cls + '">' + (cmp.delta >= 0 ? '▲ 评分提升 ' : '▼ 评分降低 ') + Math.abs(cmp.delta) + '（' + cmp.cur + ' → ' + cmp.next + '）</div>';
        } else {
          h += '<div class="tcmp dim small">（该部位当前为空）</div>';
        }
      }
    }
    if (item.craftCount) h += '<div class="tcraft dim small">已做装 ' + item.craftCount + ' 次</div>';
    h += '<div class="tprice">售价 ' + L.price(item) + ' 金币</div>';
    return h;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
