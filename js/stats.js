/* ============================================================
 *  暗影深渊 · stats.js
 *  属性聚合（等级 / 装备 / 宝石 / 被动）与派生数值
 * ============================================================ */
(function (root) {
  'use strict';
  const G = root.G;
  const D = G.DATA;
  const S = (G.Stats = {});

  S.empty = function () {
    const o = {};
    for (const k in D.STATS) o[k] = 0;
    return o;
  };
  S.addStat = function (dst, key, v) {
    if (key == null || !isFinite(v)) return;
    if (dst[key] == null) dst[key] = 0;
    dst[key] += v;
  };

  /* ---------------- 单件装备的属性总和 ---------------- */
  S.itemStats = function (item, out) {
    out = out || S.empty();
    if (!item || item.cat !== 'equip') return out;
    (item.implicit || []).forEach((s) => S.addStat(out, s.stat, s.value));
    (item.affixes || []).forEach((a) => S.addStat(out, a.stat, a.value));
    (item.gems || []).forEach((g) => {
      if (!g) return;
      const st = D.gemStat(g.gem, g.tier);
      S.addStat(out, st.stat, st.value);
    });
    return out;
  };

  S.gearStats = function (gear) {
    const out = S.empty();
    if (!gear) return out;
    D.gearSlots().forEach((slot) => { if (gear[slot]) S.itemStats(gear[slot], out); });
    return out;
  };

  S.passiveStats = function (player) {
    const out = {};
    if (!player || !player.passives) return out;
    for (const id in player.passives) {
      const lv = player.passives[id] | 0;
      if (lv <= 0) continue;
      const p = D.passiveById[id];
      if (!p) continue;
      const st = p.stats(Math.min(lv, p.max));
      for (const k in st) S.addStat(out, k, st[k]);
    }
    return out;
  };

  /* ---------------- 城镇建筑加成 ---------------- */
  S.buildingLevel = function (player, id) {
    if (!player || !player.town || !player.town.buildings) return 1;
    const lv = player.town.buildings[id];
    return Math.max(1, lv | 0);
  };

  S.townStats = function (player) {
    const out = {};
    if (!player || !player.town) return out;
    D.BUILDINGS.forEach((b) => {
      if (!b.stats) return;
      const lv = S.buildingLevel(player, b.id);
      const st = b.stats(Math.min(lv, b.max));
      for (const k in st) S.addStat(out, k, st[k]);
    });
    return out;
  };

  /* ---------------- 技能等级 ---------------- */
  S.skillLevel = function (player, skillId) {
    let lv = (player.skills && player.skills[skillId]) | 0;
    const raw = player._raw;
    if (raw) {
      lv += raw.allSkills | 0;
      lv += (raw['skill:' + skillId] | 0);
    }
    return Math.max(0, lv);
  };

  /* ---------------- 技能强化分支 ----------------
   * 解锁与生效都看「实际技能等级」（手动投入 + 装备 / 宝石 / 天赋加成）：
   *   · 装备把技能等级顶过档位需求 → 可以正常分配，效果也正常生效
   *   · 脱下装备后等级掉回需求以下 → 选择保留，但强化暂时失效
   */
  S.chosenBranch = function (player, skillId, tier) {
    const sel = player && player.skillBranches && player.skillBranches[skillId];
    return (sel && sel[tier]) || null;
  };
  // 该档位当前是否开放（技能实际等级达到档位需求）
  S.branchTierOpen = function (player, skillId, tier) {
    return S.skillLevel(player, skillId) >= tier;
  };
  // 已选择的分支对象；等级不足时返回 null（= 不生效）
  S.branchActive = function (player, skillId, tier) {
    const id = S.chosenBranch(player, skillId, tier);
    if (!id) return null;
    if (!S.branchTierOpen(player, skillId, tier)) return null;
    return D.branchById(skillId, id);
  };
  // 已选择但当前失效（被脱装备顶掉了等级）
  S.branchDormant = function (player, skillId, tier) {
    const id = S.chosenBranch(player, skillId, tier);
    if (!id) return null;
    if (S.branchTierOpen(player, skillId, tier)) return null;
    return D.branchById(skillId, id);
  };
  // 汇总某个技能当前「生效中」的分支修饰符
  S.skillMods = function (player, skillId) {
    const out = {};
    if (!player || !skillId || !D.skillBranches(skillId)) return out;
    D.SKILL_TIERS.forEach((tier) => {
      const b = S.branchActive(player, skillId, tier);
      if (!b) return;
      const mods = b.mods || {};
      for (const k in mods) {
        const v = mods[k];
        if (k === 'elem') {
          out.elem = out.elem || {};
          for (const e in v) out.elem[e] = (out.elem[e] || 0) + v[e];
        } else if (k === 'execute') {
          if (!out.execute || v.dmg > out.execute.dmg) out.execute = { hp: v.hp, dmg: v.dmg };
        } else {
          out[k] = (out[k] || 0) + v;
        }
      }
    });
    return out;
  };
  /* ---------------- 闪避充能 ----------------
   * 基础闪避 1 格充能、2 秒回满一格。
   * 「闪避充能次数」词缀加格数；「闪避恢复时间」词缀按百分比缩短回充时间。
   * 选了 25 级「替换基础闪避」分支后，闪避键改为释放该位移技能，回充时间改用技能冷却。
   */
  S.DODGE_BASE_CD = 2;
  S.MOVE_SKILL = { barb: 'barb_leap', sorc: 'sorc_teleport', rogue: 'rogue_shadow' };

  // 当前生效的「替换基础闪避」位移技能 id（没选 / 技能等级不足 → null）
  S.dodgeSwapSkill = function (player) {
    const id = S.MOVE_SKILL[player && player.cls];
    if (!id || !D.SKILLS[id]) return null;
    if (S.skillLevel(player, id) <= 0) return null;
    const b = S.branchActive(player, id, D.BRANCH_STRONG_TIER);
    return (b && b.mods && b.mods.swapDodge) ? id : null;
  };
  // 闪避充能格数上限（至少 1 格）
  S.dodgeMax = function (player) {
    const raw = player && player._raw;
    const extra = raw ? Math.round(Number(raw.dodgeCharges) || 0) : 0;
    return Math.max(1, 1 + Math.max(0, extra));
  };
  // 回复速度系数（「闪避恢复时间」词缀，最多缩短 60%）
  S.dodgeRechargeMul = function (player) {
    const raw = player && player._raw;
    const cut = raw ? G.clamp(Number(raw.dodgeRecharge) || 0, 0, 60) : 0;
    return 1 - cut / 100;
  };
  // 回满一格充能所需秒数
  S.dodgeRechargeTime = function (player) {
    const st = (player && player.stats) || {};
    let base = S.DODGE_BASE_CD;
    const swap = S.dodgeSwapSkill(player);
    if (swap) {
      const shape = S.skillShape(player, D.SKILLS[swap]);
      base = Math.max(0.5, (shape && shape.cd) || S.DODGE_BASE_CD);
      base *= 1 - G.clamp(st.cdr || 0, 0, 90) / 100;
    }
    const mul = (st.dodgeRechargeMul != null) ? st.dodgeRechargeMul : S.dodgeRechargeMul(player);
    return Math.max(0.4, base * mul);
  };
  // 当前格数（读玩家身上的实时值，缺省视为满格）
  S.dodgeCharges = function (player) {
    const max = (player.stats && player.stats.dodgeMax) || S.dodgeMax(player);
    const cur = (player.dodgeCharge == null) ? max : player.dodgeCharge;
    return G.clamp(cur, 0, max);
  };

  // 把分支修饰符套用到技能定义上，得到本次施放使用的技能形态
  S.skillShape = function (player, sk) {
    if (!sk) return sk;
    const mods = S.skillMods(player, sk.id);
    const s = Object.assign({}, sk);
    s.mods = mods;
    if (mods.radius) {
      if (sk.type === 'chain' || sk.type === 'dash' || sk.type === 'leap' || sk.type === 'teleport') {
        if (sk.range) s.range = sk.range * (1 + mods.radius / 100);
      } else if (sk.type === 'fan') {
        if (sk.spread) s.spread = sk.spread * (1 + mods.radius / 100);
      } else if (sk.radius) {
        s.radius = sk.radius * (1 + mods.radius / 100);
      }
      if (sk.novaOnLand) s.novaOnLand = Object.assign({}, sk.novaOnLand, { radius: sk.novaOnLand.radius * (1 + mods.radius / 100) });
    }
    if (mods.count && sk.count != null) s.count = sk.count + mods.count;
    if (sk.proj && (mods.speed || mods.size || mods.explode)) {
      s.proj = Object.assign({}, sk.proj);
      if (mods.speed) s.proj.speed = sk.proj.speed * (1 + mods.speed / 100);
      if (mods.size) s.proj.size = sk.proj.size * (1 + mods.size / 100);
      if (mods.explode && sk.proj.explode) s.proj.explode = sk.proj.explode * (1 + mods.explode / 100);
    }
    if (mods.pierce) s.pierce = (sk.pierce || 0) + mods.pierce;
    if (mods.dur) {
      // 地面 / 持续类技能用 sk.dur；战吼这类增益技能的时长在 sk.buff.dur 里
      if (sk.dur) s.dur = sk.dur + mods.dur;
      if (sk.buff && sk.buff.dur) s.buff = Object.assign({}, sk.buff, { dur: sk.buff.dur + mods.dur });
    }
    if (mods.dot) {
      if (sk.dot) s.dot = Object.assign({}, sk.dot, { mult: sk.dot.mult * (1 + mods.dot / 100) });
      if (sk.ignite) s.ignite = Object.assign({}, sk.ignite, { mult: sk.ignite.mult * (1 + mods.dot / 100) });
    }
    if (mods.stun) s.stun = (sk.stun || 0) + mods.stun;
    if (mods.slow) s.slow = Math.min(0.9, (sk.slow || 0) + mods.slow / 100);
    if (mods.cost) s.cost = Math.max(0, Math.round((sk.cost || 0) * (1 + mods.cost / 100)));
    if (mods.cd && sk.cd) s.cd = Math.max(0.2, sk.cd * (1 + mods.cd / 100));
    if (mods.buff && sk.buff) {
      const k = 1 + mods.buff / 100;
      s.buff = Object.assign({}, sk.buff, {
        dmg: (sk.buff.dmg || 0) * k, perDmg: (sk.buff.perDmg || 0) * k,
        armor: (sk.buff.armor || 0) * k, perArmor: (sk.buff.perArmor || 0) * k,
      });
    }
    return s;
  };
  // 已投入点数（不含装备）—— 洗点费用与被洗掉的点数都只看这个
  S.investedPoints = (player, skillId) => ((player && player.skills && player.skills[skillId]) | 0) || 0;

  /* ---------------- 汇总原始属性 ---------------- */
  S.collect = function (player) {
    const cls = D.classById(player.cls);
    const raw = S.empty();
    // 等级成长
    raw.str = cls.base.str + cls.perLevel.str * (player.level - 1);
    raw.dex = cls.base.dex + cls.perLevel.dex * (player.level - 1);
    raw.int = cls.base.int + cls.perLevel.int * (player.level - 1);
    raw.vit = cls.base.vit + cls.perLevel.vit * (player.level - 1);
    // 手动分配
    const al = player.alloc || {};
    raw.str += al.str | 0; raw.dex += al.dex | 0; raw.int += al.int | 0; raw.vit += al.vit | 0;
    // 被动
    const ps = S.passiveStats(player);
    for (const k in ps) S.addStat(raw, k, ps[k]);
    // 城镇建筑
    const ts = S.townStats(player);
    for (const k in ts) S.addStat(raw, k, ts[k]);
    // 装备（含宝石）
    const gs = S.gearStats(player.gear);
    for (const k in gs) S.addStat(raw, k, gs[k]);
    // buff 中的属性类加成
    if (player.buffs) {
      player.buffs.forEach((b) => {
        if (b.stats) for (const k in b.stats) S.addStat(raw, k, b.stats[k]);
      });
    }
    // 取整显示属性
    ['str', 'dex', 'int', 'vit'].forEach((k) => { raw[k] = Math.floor(raw[k]); });
    player._raw = raw;
    return raw;
  };

  const RES_KEYS = ['fire', 'cold', 'lightning', 'poison'];
  const RES_STAT = { fire: 'fireResist', cold: 'coldResist', lightning: 'lightResist', poison: 'poisonResist' };

  /* ---------------- 派生最终数值 ---------------- */
  S.derive = function (player) {
    const cls = D.classById(player.cls);
    const raw = S.collect(player);
    const diff = D.diffOf(player.diffIdx | 0);
    const a = { str: raw.str, dex: raw.dex, int: raw.int, vit: raw.vit };
    player.attrs = a;

    const st = {
      maxLife: Math.max(1, Math.round((cls.lifeBase + cls.lifePerLevel * (player.level - 1) + a.vit * cls.lifePerVit + raw.life) * (1 + raw.lifePct / 100))),
      maxMana: Math.max(1, Math.round((cls.manaBase + 2.4 * (player.level - 1) + a.int * cls.manaPerInt + raw.mana) * (1 + raw.manaPct / 100))),
      armor: Math.max(0, Math.round((raw.armor + a.dex * 1.4 + a.str * 1.0) * (1 + raw.armorPct / 100))),
      crit: G.clamp(5 + a.dex * 0.12 + raw.crit, 0, 80),
      critDmg: 150 + raw.critDmg,
      apsMul: 1 + raw.aps / 100,
      moveSpeed: G.BALANCE.playerBaseSpeed * (1 + raw.moveSpeed / 100),
      cdr: G.clamp(raw.cdr, 0, 60),
      mf: raw.mf, gf: raw.gf, xpBonus: raw.xpBonus,
      lifeSteal: raw.lifeSteal, manaSteal: raw.manaSteal, lifeOnHit: raw.lifeOnHit,
      lifeRegen: raw.lifeRegen + a.vit * 0.12 + 1,
      manaRegen: raw.manaRegen + a.int * 0.1 + 1.2,
      thorns: raw.thorns,
      areaDmg: raw.areaDmg,
      dmgReduce: G.clamp(raw.dmgReduce, 0, 65),
      pickup: 46 + raw.pickup,
      dodge: G.clamp(raw.dodge, 0, 60),
      dmgMult: (1 + raw.dmgPct / 100) * (1 + (a[cls.primary] || 0) * 0.009),
      elemBonus: {
        fire: raw.fireDmg / 100, cold: raw.coldDmg / 100,
        lightning: raw.lightDmg / 100, poison: raw.poisonDmg / 100, physical: raw.physDmg / 100,
      },
      added: { fire: raw.addFire, cold: raw.addCold, lightning: raw.addLight, poison: raw.addPoison },
      allSkills: raw.allSkills | 0,
      res: {}, raw: raw,
    };
    RES_KEYS.forEach((k) => {
      const val = (raw[RES_STAT[k]] || 0) + raw.allResist - diff.resistPen;
      // 只保留下限（负抗 = 多挨打），上限不夹：堆得多高就减多少，曲线本身会递减
      st.res[k] = Math.max(-100, isFinite(val) ? val : 0);
    });    // 武器
    const w = player.gear && player.gear.weapon;
    if (w) {
      const bonus = 1 + (raw.dmgPct || 0) / 100 + (raw.physDmg || 0) / 100;
      st.weaponMin = Math.max(1, w.min * bonus);
      st.weaponMax = Math.max(st.weaponMin + 1, w.max * bonus);
      st.attackSpeed = w.aps * st.apsMul;
      st.weaponAps = w.aps;              // 武器自身攻速（技能伤害按它归一）
      st.weaponKind = w.kind;
    } else {
      st.weaponMin = 4; st.weaponMax = 9; st.attackSpeed = 1.25 * st.apsMul; st.weaponAps = 1.25; st.weaponKind = 'melee';
    }
    /* 秒伤 = （武器物理均值 + 装备附加的元素伤害折算） × 攻速
     * 附加元素按 attackComponents 里同一套折算：×0.9 再乘元素加成 */
    let addedAvg = 0;
    for (const k in st.added) addedAvg += (st.added[k] || 0) * 0.9 * (1 + (st.elemBonus[k] || 0));
    st.addedAvg = addedAvg;
    st.weaponDps = ((st.weaponMin + st.weaponMax) / 2 + addedAvg) * st.attackSpeed;
    st.attackInterval = 1 / Math.max(0.2, st.attackSpeed);

    /* ---- 暗金特效带来的被动加成 ---- */
    const powers = (G.Combat && G.Combat.powers) ? G.Combat.powers(player) : null;
    st.powers = powers || new Set();
    if (powers) {
      if (powers.has('sage')) st.xpBonus += 50;
      if (powers.has('vampiric')) st.lifeSteal += 5;
      if (powers.has('greed')) st.gf *= 2;
      if (powers.has('juggernaut')) st.dmgMult *= 1 + Math.floor(st.armor / 200) * 0.03;
    }

    // 生命/法力上限变化时保持比例
    player.stats = st;
    /* ---- 闪避充能 ---- */
    st.dodgeMax = S.dodgeMax(player);
    st.dodgeRechargeMul = S.dodgeRechargeMul(player);
    if (player.life == null) player.life = st.maxLife;
    if (player.mana == null) player.mana = st.maxMana;
    player.life = Math.min(player.life, st.maxLife);
    player.mana = Math.min(player.mana, st.maxMana);
    if (player.recalcFull) { player.life = st.maxLife; player.mana = st.maxMana; player.recalcFull = false; }
    return st;
  };

  // 普通攻击的出手间隔（含普通攻击技能「攻击速度」分支的加成）
  S.basicAttackInterval = function (player) {
    if (!player || !player.stats) return 0.8;
    const base = player.stats.attackInterval;
    const mods = S.skillMods(player, player.cls + '_basic');
    return mods.aps ? base / (1 + mods.aps / 100) : base;
  };

  /* ---------------- 抗性与护甲减伤 ----------------
   * 元素减伤 = res / (res + 150)，递减曲线，硬上限 99%
   * （75% 需要 450 点、90% 需要 1350 点、95% 需要 2850 点 —— 越高越吃投入）
   * 负抗性 = 额外受伤，最多多挨 66.7%（数值下限 -100） */
  S.resistMitigation = (resVal) => {
    const r = Math.max(-100, resVal);
    if (r >= 0) return Math.min(0.99, r / (r + 150));
    return -Math.min(1.5, -r / 150); // 负抗性 = 额外受伤
  };
  S.armorMitigation = (armor, attackerLevel) => {
    const a = Math.max(0, armor);
    return a / (a + 55 + 15 * (attackerLevel || 1));
  };

  /* ---------------- 坚韧 ----------------
   * 定义：满血时平均能承受的「减伤前」伤害量。
   *   对某一类伤害 = 生命 ÷ (1 − 该系减伤) ÷ (1 − 闪避) ÷ (1 − 受到伤害降低)
   *   例：1000 生命 / 0 护甲 / 50% 毒抗 / 50% 闪避 → 物理与毒素各算一遍，毒素 = 1000÷50%÷50% = 4000
   * 总坚韧 = 五类伤害（物理 + 火冰电毒）坚韧的平均值。
   */
  S.TOUGH_TYPES = ['physical', 'fire', 'cold', 'lightning', 'poison'];
  S.TOUGH_NAME = { physical: '物理', fire: '火焰', cold: '冰冷', lightning: '闪电', poison: '毒素' };
  S.toughness = function (player, mlvl) {
    const st = player && player.stats;
    if (!st) return { total: 0, byType: {}, life: 0 };
    const lvl = mlvl || (G.GAME && G.GAME.mlvl) || player.level || 1;
    const life = st.maxLife;
    const dodge = G.clamp(st.dodge || 0, 0, 90) / 100;
    const reduce = G.clamp(st.dmgReduce || 0, 0, 90) / 100;
    const armorMit = S.armorMitigation(st.armor, lvl);
    const byType = {};
    let sum = 0;
    S.TOUGH_TYPES.forEach((k) => {
      const mit = k === 'physical' ? armorMit : S.resistMitigation(st.res[k] || 0);
      const t = life / Math.max(0.01, 1 - mit) / Math.max(0.05, 1 - dodge) / Math.max(0.05, 1 - reduce);
      byType[k] = t;
      sum += t;
    });
    return {
      total: sum / S.TOUGH_TYPES.length, byType: byType, life: life,
      armor: st.armor, armorMit: armorMit, res: st.res, dodge: st.dodge || 0,
      dmgReduce: st.dmgReduce || 0, mlvl: lvl,
    };
  };

  /* 换上某件装备之后的坚韧（用于装备对比）。会临时换装 → 重算 → 原样还原。 */
  S.toughnessWith = function (player, item, slot, mlvl) {
    if (!player || !item || !slot || !player.gear) return null;
    const gear = player.gear;
    const prevItem = gear[slot], prevW = gear.weapon, prevOff = gear.offhand;
    const life0 = player.life, mana0 = player.mana;
    gear[slot] = item;
    if (item.two && slot !== 'offhand') gear.offhand = null;                       // 双手武器顶掉副手
    if (slot === 'offhand' && gear.weapon && gear.weapon.two) gear.weapon = null;  // 副手顶掉双手武器
    S.derive(player);
    const out = S.toughness(player, mlvl);
    gear[slot] = prevItem; gear.weapon = prevW; gear.offhand = prevOff;
    S.derive(player);
    if (life0 != null) player.life = Math.min(life0, player.stats.maxLife);
    if (mana0 != null) player.mana = Math.min(mana0, player.stats.maxMana);
    return out;
  };

  /* ---------------- 伤害组件 ---------------- */
  // 返回 { physical, fire, cold, lightning, poison } 的伤害范围（未暴击、未减伤）
  S.attackComponents = function (player, skill, level) {
    const st = player.stats;
    const s = skill || {};
    const lv = Math.max(1, level || 1);
    const scaleLv = D.skillScaleLevel(lv);      // 25 级后成长衰减
    const skillMult = (s.base != null ? (s.base + (s.per || 0) * (scaleLv - 1)) / 100 : 1);
    const wm = s.weaponMult == null ? 1 : s.weaponMult;
    const wAvg = (st.weaponMin + st.weaponMax) / 2;
    /* 技能伤害按「武器秒伤」归一：均伤 × (实际攻速 / 基准攻速)。
     * 否则慢速高单伤的武器（尤其是双手）会在技能上白赚一份伤害。
     * 普通攻击不归一 —— 它本来就按攻速一下一下打，单发低、频率高是等价交换。 */
    const refAps = (G.BALANCE && G.BALANCE.skillRefAps) || 1.16;
    const apsF = (s.type === 'basic') ? 1 : ((st.attackSpeed || refAps) / refAps);
    const base = wAvg * apsF * wm * skillMult * st.dmgMult;
    const main = s.elem || 'physical';
    const out = { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0 };
    out[main] += base * (1 + (st.elemBonus[main] || 0));
    // 装备附加元素伤害（同样按攻速归一）
    for (const k in st.added) {
      const v = st.added[k];
      if (v > 0) out[k] += v * 0.9 * (1 + (st.elemBonus[k] || 0)) * (0.6 + 0.4 * wm) * apsF;
    }
    return out;
  };

  S.xpToNext = (level) => G.BALANCE.xpCurve(level);
})(typeof globalThis !== 'undefined' ? globalThis : this);
