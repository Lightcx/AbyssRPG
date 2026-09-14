/* ============================================================
 *  暗影深渊 · ui.js
 *  HUD / 背包 / 装备 / 角色 / 商店 / 提示框 / 日志 / 菜单
 * ============================================================ */
(function (root) {
  'use strict';
  const G = root.G;
  const D = G.DATA;
  const L = G.Loot;
  const S = G.Stats;
  const C = G.Combat;
  const UI = (G.UI = {});
  const el = G.el;

  UI.game = null;
  UI.open = null;
  UI.dirty = { inv: true, char: true, vendor: true, craft: true, stash: true, bs: true, town: true, jeweler: true, rift: true, skill: true };
  UI.slotRefs = [];
  UI.buffSig = '';
  UI.logEls = [];
  UI.craftUid = null;
  UI.craftLines = [];
  UI.riftFloor = 1;
  UI.startSlot = null;
  UI.skillWin = null;     // 技能强化窗口当前展示的技能 id
  UI.capture = null;      // 正在改键的动作 id
  UI.anchor = null;       // { x, y, r, name } —— 距离过远自动关闭的面板锚点
  UI.ready = function () { return !!(UI.game && UI.game.player); };

  // 需要身处城镇才能使用的服务
  UI.TOWN_ONLY = ['panel-craft', 'panel-stash', 'panel-blacksmith', 'panel-town', 'panel-jeweler', 'panel-rift', 'panel-respec', 'panel-training'];
  // 选了职业 / 读档之后调用：重建所有依赖玩家的界面
  UI.onNewPlayer = function () {
    UI.craftUid = null;
    UI.craftLines = [];
    UI.riftFloor = UI.game.player.maxFloor || 1;
    UI.buildSkillbar();
    UI.dirty.inv = true; UI.dirty.char = true; UI.dirty.vendor = true;
    UI.dirty.craft = true; UI.dirty.stash = true; UI.dirty.bs = true;
    UI.dirty.town = true; UI.dirty.jeweler = true; UI.dirty.rift = true; UI.dirty.skill = true;
    UI.refreshInventory();
    UI.renderCharacter();
    UI.rollVendorStock();
    UI.renderVendor();
    UI.updateHUD();
  };

  UI.needTown = function (id) {
    return UI.TOWN_ONLY.indexOf(id) >= 0 && UI.game && UI.game.area !== 'town';
  };

  /* 玩家走远后自动关闭 NPC / 深渊之门的交互窗口 */
  UI.checkAnchor = function (game) {
    if (!UI.anchor || !UI.open) { if (!UI.open) UI.anchor = null; return; }
    const p = game && game.player;
    if (!p) return;
    if (G.dist(p.x, p.y, UI.anchor.x, UI.anchor.y) > UI.anchor.r) {
      const name = UI.anchor.name || '对方';
      UI.anchor = null;
      UI.togglePanel(UI.open, false);
      G.log('你离开了「' + name + '」，窗口已自动关闭。', 'dim');
    }
  };

  /* ============================================================
   *  初始化
   * ============================================================ */
  UI.init = function (game) {
    UI.game = game;
    UI.buildEquipDoll();
    UI.buildInventory();
    UI.buildSkillbar();
    UI.bindUtility();
    UI.refreshKeyHints();
    UI.bindPanels();
    UI.bindMouse();
    UI.renderCharacter();
    UI.renderVendor();
    UI.refreshInventory();
    UI.bindCraft();
    UI.bindStash();
    UI.bindBlacksmith();
    UI.bindTown();
    UI.bindJeweler();
    UI.bindRift();
    UI.bindRespec();
    UI.bindSkillWindow();
    UI.bindFilter();
    UI.bindSettings();
    UI.buildTraining();
    if (root.document) {
      root.document.addEventListener('mousedown', (e) => {
        const menu = el('ctxmenu');
        if (menu && !menu.hidden && !menu.contains(e.target)) UI.hideCtx();
      });
      // 光标上跟随的「拿起」宝石
      root.document.addEventListener('mousemove', (e) => {
        UI.mousePos = { x: e.clientX, y: e.clientY };
        if (UI.heldGem) UI.updateHeldGemCursor(e);
        if (UI.heldOrb) UI.updateHeldOrbCursor(e);
      });
      root.document.addEventListener('wheel', (e) => {
        if (e.target && e.target.id === 'minimap') {
          e.preventDefault();
          UI.toggleBigMap();
        }
      }, { passive: false });
    }
  };

  /* ============================================================
   *  提示框
   * ============================================================ */
  UI.tooltip = function (item, ev, opts) {
    const tp = el('tooltip');
    if (!tp || !item) return;
    opts = opts || { compare: true };
    const p = UI.game && UI.game.player;
    const compare = opts.compare !== false;
    const partners = (compare && p && item.cat === 'equip') ? UI.equipPartners(item) : [];
    if (partners.length) {
      /* 左右并列、各自独立成窗（高度互不拉伸）：
       * 左「已穿戴装备」/ 右「新装备」，评分结论固定放在右窗底部 */
      const vs = UI.compareVersus(p, item, partners);
      let h = '<div class="twin">';
      partners.forEach((e) => {
        const side = vs.byItem[e.item.uid];
        h += '<div class="tcol old"><div class="tcol-hd">已穿戴装备' + (e.label ? ' · ' + e.label : '') + '</div>' +
          '<div class="tcol-body">' + L.tooltipHTML(e.item, p, { compare: false, versus: side, tough: side && side.tough }) + '</div></div>';
      });
      const newSide = vs.byItem[item.uid];
      h += '<div class="tcol new"><div class="tcol-hd">新装备</div>' +
        '<div class="tcol-body">' + L.tooltipHTML(item, p, { compare: false, versus: newSide, tough: newSide && newSide.tough }) + '</div>' +
        UI.compareFooterHTML(p, item) + '</div>';
      h += '</div>';
      tp.innerHTML = h;
      tp.className = 'wide';
    } else {
      const solo = UI.compareVersus(p, item, null);
      const side = solo.byItem[item.uid];
      tp.innerHTML = L.tooltipHTML(item, p, Object.assign({}, opts, { versus: side, tough: side && side.tough }));
      tp.className = '';
    }
    tp.hidden = false;
    const w = tp.offsetWidth || 300, h2 = tp.offsetHeight || 200;
    const vw = root.innerWidth || 1280, vh = root.innerHeight || 720;
    let x = (ev ? ev.clientX : vw / 2) + 18;
    let y = (ev ? ev.clientY : vh / 2) + 12;
    if (x + w > vw - 8) x = Math.max(8, (ev ? ev.clientX : vw / 2) - w - 14);
    if (y + h2 > vh - 8) y = Math.max(8, vh - h2 - 10);
    tp.style.left = x + 'px';
    tp.style.top = y + 'px';
  };

  /* ============================================================
   *  装备对比：秒伤 / 坚韧 的差值计算
   *  ------------------------------------------------------------
   *  返回 { mlvl, cur: {dps, tough}, byItem: { [uid]: { dps, tough } } }
   *  每个窗口拿到「这件装备自己的数值」与「相对另一件的差值」。
   * ============================================================ */
  UI.compareVersus = function (p, item, partners) {
    const out = { mlvl: 1, byItem: {} };
    if (!p || !item || item.cat !== 'equip') return out;
    const mlvl = (UI.game && UI.game.mlvl) || p.level || 1;
    out.mlvl = mlvl;
    const other = (partners && partners[0]) ? partners[0].item : null;
    const otherSlot = (partners && partners[0]) ? partners[0].slot : null;

    /* --- 武器：秒伤（含附加元素伤害） --- */
    if (item.slot === 'weapon' || (other && other.slot === 'weapon')) {
      const dpsNew = L.itemDps(item.slot === 'weapon' ? item : null);
      const dpsOld = L.itemDps(other && other.slot === 'weapon' ? other : null);
      if (item.slot === 'weapon' && other && other.slot === 'weapon') {
        out.byItem[item.uid] = { dps: dpsNew - dpsOld };
        out.byItem[other.uid] = { dps: dpsOld - dpsNew };
      } else if (item.slot === 'weapon') {
        out.byItem[item.uid] = { dps: null };            // 没有对照武器时不显示差值
      }
    }

    /* --- 非武器：坚韧（换上之后 vs 当前） --- */
    if (item.slot !== 'weapon') {
      const cur = S.toughness(p, mlvl).total;
      // 戒指有两个槽位：先看它是不是已经戴在身上，否则优先和戒指 I 比
      let slot = item.slot;
      if (item.slot === 'ring') {
        if (p.gear.ring1 && p.gear.ring1.uid === item.uid) slot = 'ring1';
        else if (p.gear.ring2 && p.gear.ring2.uid === item.uid) slot = 'ring2';
        else slot = p.gear.ring1 ? 'ring1' : 'ring2';
      }
      // 悬停的就是身上穿着的那件时，别显示「和它自己比」的差值
      const eq = (item.slot === 'ring' ? p.gear[slot] : p.gear[item.slot]);
      const isSelf = !!(eq && eq.uid === item.uid);
      const tNew = S.toughnessWith(p, item, slot, mlvl);
      const newTotal = tNew ? tNew.total : cur;
      out.byItem[item.uid] = Object.assign(out.byItem[item.uid] || {}, {
        tough: { value: newTotal, delta: isSelf ? null : newTotal - cur, cur: cur, detail: tNew, self: isSelf },
      });
      if (other && other.slot !== 'weapon') {
        const tOld = S.toughnessWith(p, other, otherSlot, mlvl);
        const oldTotal = tOld ? tOld.total : cur;
        out.byItem[other.uid] = Object.assign(out.byItem[other.uid] || {}, {
          tough: { value: oldTotal, delta: oldTotal - newTotal, cur: newTotal, detail: tOld },
        });
      }
    }
    return out;
  };

  /* 坚韧明细（角色面板悬停「坚韧」时展开）：总坚韧 + 五系分项 + 计算输入 */
  UI.toughnessHTML = function (t) {
    if (!t || !t.byType) return '';
    const pc = (v) => Math.round((v || 0) * 100) + '%';
    let h = '<div class="tname">坚韧</div>' +
      '<div class="ttype">满血时能承受的「减伤前」伤害，五系平均</div>' +
      '<div class="tstat base"><span class="av">坚韧总计</span><b>' + Math.round(t.total) + '</b></div>' +
      '<div class="tsep"></div><div class="thd">按伤害类型</div>';
    S.TOUGH_TYPES.forEach((k) => {
      const mit = k === 'physical' ? t.armorMit : S.resistMitigation((t.res && t.res[k]) || 0);
      h += '<div class="tstat base"><span class="av">' + S.TOUGH_NAME[k] + '</span>' +
        '<b>' + Math.round(t.byType[k] || 0) + '</b>' +
        '<span class="dim small">减伤 ' + pc(mit) + '</span></div>';
    });
    h += '<div class="tsep"></div><div class="thd">计算输入</div>' +
      '<div class="tstat base"><span class="av">生命上限</span><b>' + Math.round(t.life) + '</b></div>' +
      '<div class="tstat base"><span class="av">护甲</span><b>' + Math.round(t.armor || 0) + '</b>' +
      '<span class="dim small">减伤 ' + pc(t.armorMit) + '</span></div>' +
      '<div class="tstat base"><span class="av">闪避</span><b>' + Math.round(t.dodge || 0) + '%</b></div>' +
      '<div class="tstat base"><span class="av">受到伤害降低</span><b>' + Math.round(t.dmgReduce || 0) + '%</b></div>' +
      '<div class="tstat dim">按怪物等级 ' + Math.round(t.mlvl || 1) + ' 计算　各层乘法叠加</div>';
    return h;
  };

  /* 该装备对应的「已穿戴」对照物（戒指会返回两个槽位；
   * 双手武器 / 副手互斥时，会把「将被顶掉」的那件也列出来对照） */
  UI.equipPartners = function (item) {
    const p = UI.game && UI.game.player;
    const out = [];
    if (!p || !item || item.cat !== 'equip' || !p.gear) return out;
    const slots = item.slot === 'ring' ? ['ring1', 'ring2'] : [item.slot];
    slots.forEach((s) => {
      const eq = p.gear[s];
      if (!eq || eq === item) return;
      out.push({ slot: s, label: D.SLOT_BY_ID[s] ? D.SLOT_BY_ID[s].name : s, item: eq });
    });
    L.equipDisplaced(p, item, item.slot).forEach((d) => {
      if (out.some((o) => o.item === d.item)) return;
      const nm = D.SLOT_BY_ID[d.slot] ? D.SLOT_BY_ID[d.slot].name : d.slot;
      out.push({ slot: d.slot, label: nm + ' · 将被顶掉', item: d.item });
    });
    return out;
  };

  /* 两窗口下方的评分对比结论 */
  UI.compareFooterHTML = function (p, item) {
    if (!p || !item || item.cat !== 'equip') return '';
    if (item.slot === 'ring') {
      let h = '';
      L.compareAll(p, item).forEach((r) => {
        const cls = r.empty || r.delta >= 0 ? 'up' : 'down';
        h += '<div class="' + cls + '">' + r.label + '：' +
          (r.empty ? '空槽位 → ' + r.next : r.cur + ' → ' + r.next) + '　' +
          (r.empty ? '（可直接装备）' : (r.delta >= 0 ? '▲ +' + r.delta : '▼ ' + r.delta)) + '</div>';
      });
      h += '<div class="dim small">右键点击可选择装备到戒指 I 或 II。</div>';
      return '<div class="tcmp-foot">' + h + '</div>';
    }
    const cmp = L.compare(p, item);
    if (!cmp) return '<div class="tcmp-foot dim">（该部位当前为空）</div>';
    const cls = cmp.delta >= 0 ? 'up' : 'down';
    const lost = (cmp.displaced && cmp.displaced.length)
      ? '<div class="dim small">会顶掉：' + cmp.displaced.map((d) => L.displayName(d.item)).join('、') + '</div>'
      : '';
    return '<div class="tcmp-foot ' + cls + '">' + (cmp.delta >= 0 ? '▲ 评分提升 ' : '▼ 评分降低 ') +
      Math.abs(cmp.delta) + '（' + cmp.cur + ' → ' + cmp.next + '）' + lost + '</div>';
  };
  UI.hideTooltip = function () { const tp = el('tooltip'); if (tp) tp.hidden = true; };

  // 直接显示一段自定义 HTML（技能 / 天赋说明用）
  UI.showTooltip = function (html, ev, above) {
    const tp = el('tooltip');
    if (!tp || !html) return;
    /* 装备对比用的是 #tooltip.wide（外框透明，暗色底在内层 .tcol 上）。
     * 这里必须把类清掉，否则看过一次装备对比之后，技能 / 天赋 / 宝石这些
     * 普通提示框会继承 wide，暗色底、边框、阴影一起消失（看起来像透明了）。 */
    if (tp.className) tp.className = '';
    tp.innerHTML = html;
    tp.hidden = false;
    const w = tp.offsetWidth || 330, h = tp.offsetHeight || 240;
    const vw = root.innerWidth || 1280, vh = root.innerHeight || 720;
    const cx = ev ? ev.clientX : vw / 2, cy = ev ? ev.clientY : vh / 2;
    let x = cx + 18;
    let y = above ? cy - h - 12 : cy + 14;
    if (y < 8) y = cy + 18;
    if (x + w > vw - 8) x = cx - w - 14;
    if (y + h > vh - 8) y = Math.max(8, vh - h - 10);
    tp.style.left = x + 'px';
    tp.style.top = y + 'px';
  };

  /* ---------------- 技能 / 天赋说明（含加点收益） ---------------- */
  const ELEM_CN = { physical: '物理', fire: '火焰', cold: '冰冷', lightning: '闪电', poison: '毒素' };

  UI.skillDetailHTML = function (id) {
    const sk = D.SKILLS[id];
    const p = UI.game && UI.game.player;
    if (!sk || !p) return '';
    const own = p.skills[id] | 0;             // 手动投入的点数
    const eff = S.skillLevel(p, id);          // 含装备加成后的实际等级
    const gearBonus = eff - own;
    const unlocked = p.level >= (sk.reqLevel || 0);
    const maxed = own >= sk.maxLevel;
    const elemName = ELEM_CN[sk.elem] || '物理';

    let h = '<div class="tname" style="color:#ffe9a8">' + sk.icon + ' ' + sk.name +
      ' <span class="lvbadge">Lv.' + eff + ' / ' + sk.maxLevel + '</span></div>';
    h += '<div class="ttype">' + (sk.type === 'basic' ? '普通攻击' : '主动技能') +
      '　已投入 ' + own + ' 点' + (gearBonus > 0 ? '　<span class="good">装备 +' + gearBonus + '</span>' : '') + '</div>';
    h += '<div class="tsep"></div><div class="tflavor">' + sk.desc + '</div><div class="tsep"></div>';

    if (eff > 0) {
      h += '<div class="tstat">基础伤害 <b>' + Math.round(UI.skillDamageAt(p, sk, eff)) + '</b>　<span class="dim">（' + elemName + '）</span></div>';
      h += '<div class="tstat dim">伤害倍率 ' + Math.round(UI.skillMultAt(sk, eff)) + '% 武器伤害</div>';
    } else {
      h += '<div class="tstat bad">尚未学习</div>';
    }
    const shape = S.skillShape(p, sk);
    if (shape.cost) h += '<div class="tstat dim">法力消耗 ' + shape.cost + '</div>';
    if (shape.cd) h += '<div class="tstat dim">冷却 ' + shape.cd.toFixed(1) + ' 秒（实际 ' + (shape.cd * (1 - p.stats.cdr / 100)).toFixed(2) + ' 秒）</div>';
    if (shape.slow) h += '<div class="tstat good">减速 ' + Math.round(shape.slow * 100) + '% / ' + (shape.slowDur || 2) + ' 秒</div>';
    if (shape.stun) h += '<div class="tstat good">眩晕 ' + shape.stun.toFixed(1) + ' 秒</div>';
    if (shape.count) h += '<div class="tstat good">最多命中 ' + shape.count + ' 个目标</div>';
    if (shape.pierce) h += '<div class="tstat good">穿透 +' + (shape.pierce >= 99 ? '∞' : shape.pierce) + '</div>';
    if (shape.dot) h += '<div class="tstat good">持续流血 ' + shape.dot.dur + ' 秒</div>';
    if (shape.ignite) h += '<div class="tstat good">点燃 ' + shape.ignite.dur + ' 秒</div>';
    if (shape.dur) h += '<div class="tstat dim">持续时间 ' + shape.dur + ' 秒（每 ' + (sk.tick || 0.5) + ' 秒结算一次）</div>';
    if (shape.range) h += '<div class="tstat dim">施法距离 ' + Math.round(shape.range) + '</div>';
    if (shape.radius && sk.type !== 'basic') h += '<div class="tstat dim">作用半径 ' + Math.round(shape.radius * (1 + p.stats.areaDmg / 100)) + '</div>';
    if (sk.type === 'buff' && shape.buff) {
      const b = shape.buff;
      const bl = D.skillScaleLevel(Math.max(1, eff));
      const dv = (b.dmg || 0) + (b.perDmg || 0) * (bl - 1);
      const av = (b.armor || 0) + (b.perArmor || 0) * (bl - 1);
      h += '<div class="tstat">伤害 +' + dv.toFixed(1) + '%　护甲 +' + av.toFixed(1) + '　持续 ' + b.dur + ' 秒</div>';
    }

    /* ---- 强化分支 ---- */
    if (D.skillBranches(id)) {
      const picked = UI.branchSummary(p, id);
      h += '<div class="tsep"></div><div class="thd">强化分支 <span class="dim">' + picked + ' / ' + D.SKILL_TIERS.length +
        '（点击技能打开强化窗口）</span></div>';
      D.SKILL_TIERS.forEach((tier) => {
        const list = D.skillBranches(id)[tier];
        const chosen = S.chosenBranch(p, id, tier);
        const b = chosen ? D.branchById(id, chosen) : null;
        const dormant = !!S.branchDormant(p, id, tier);
        const open = S.branchTierOpen(p, id, tier);
        h += '<div class="tstat tbranch' + (b ? (dormant ? ' dormant' : ' on') : (open ? ' open' : ' locked')) + '">' +
          '<span class="btier">' + tier + '</span>' +
          (b
            ? '<span class="bname">' + b.icon + ' ' + b.name + (dormant ? '　<span class="c-boss">失效（等级不足）</span>' : '') + '</span>'
            : '<span class="bname dim">' + (open ? '可选的 ' + D.BRANCH_TIER_NAME[tier] + '分支' : '未解锁') + '</span>') +
          '</div>';
      });
    }

    /* ---- 加点收益 ---- */
    h += '<div class="tsep"></div>';
    if (!unlocked) {
      h += '<div class="tstat bad">需要角色等级 ' + sk.reqLevel + ' 才能学习</div>';
    } else if (maxed) {
      h += '<div class="tstat good">已满级（' + sk.maxLevel + ' 点）' +
        (eff > sk.maxLevel ? '　装备加成后 ' + eff + ' 级（26 级起每级数值递减）' : '') + '</div>';
    } else {
      h += '<div class="thd">投入下一点（' + own + ' → ' + (own + 1) + ' 点）的收益</div>';
      if (eff > 0) {
        const a = UI.skillDamageAt(p, sk, eff), b2 = UI.skillDamageAt(p, sk, eff + 1);
        const d = b2 - a;
        const pct = a > 0 ? '（+' + (d / a * 100).toFixed(1) + '%）' : '';
        h += '<div class="tstat">基础伤害 ' + Math.round(a) + ' → <b class="good">' + Math.round(b2) + '</b>' +
          '　<span class="dim">+' + Math.round(d) + pct + '</span></div>';
        h += '<div class="tstat dim">伤害倍率 ' + Math.round(UI.skillMultAt(sk, eff)) + '% → ' + Math.round(UI.skillMultAt(sk, eff + 1)) + '%</div>';
      } else {
        h += '<div class="tstat good">解锁该技能</div>';
      }
      if (sk.type === 'buff' && sk.buff) {
        const b = sk.buff;
        const l0 = D.skillScaleLevel(Math.max(1, eff)), l1 = D.skillScaleLevel(Math.max(1, eff) + 1);
        const d0 = (b.dmg || 0) + (b.perDmg || 0) * (l0 - 1);
        const d1 = (b.dmg || 0) + (b.perDmg || 0) * (l1 - 1);
        const a0 = (b.armor || 0) + (b.perArmor || 0) * (l0 - 1);
        const a1 = (b.armor || 0) + (b.perArmor || 0) * (l1 - 1);
        h += '<div class="tstat">伤害 +' + d0.toFixed(0) + '% → <b class="good">+' + d1.toFixed(0) + '%</b>　护甲 +' + a0.toFixed(0) + ' → <b class="good">+' + a1.toFixed(0) + '</b></div>';
      }
      if (sk.per) h += '<div class="tstat dim">每点成长：+' + sk.per + '% 技能基础值</div>';
      h += '<div class="tcmp dim small">技能点剩余 ' + p.skillPoints + '　（技能上限 ' + sk.maxLevel + ' 点，装备加成可突破）</div>';
    }
    return h;
  };

  /* 技能伤害预览（含已生效的强化分支） */
  UI.skillDamageAt = function (p, sk, lv) {
    const c = C.attackComponents(p, Object.assign({}, sk, { mods: S.skillMods(p, sk.id) }), Math.max(1, lv));
    let t = 0; for (const k in c) t += c[k];
    return t;
  };
  UI.skillMultAt = function (sk, lv) {
    const base = (sk.base != null ? (sk.base + (sk.per || 0) * (D.skillScaleLevel(Math.max(1, lv)) - 1)) / 100 : 1);
    return (sk.weaponMult == null ? 1 : sk.weaponMult) * base * 100;
  };

  UI.passiveDetailHTML = function (id) {
    const ps = D.passiveById[id];
    const p = UI.game && UI.game.player;
    if (!ps || !p) return '';
    const lv = (p.passives && p.passives[id]) | 0;
    const maxed = lv >= ps.max;
    let h = '<div class="tname" style="color:#ffe9a8">✦ ' + ps.name + ' <span class="lvbadge">' + lv + ' / ' + ps.max + '</span></div>';
    h += '<div class="ttype">被动天赋　（每 5 级获得 1 点）</div><div class="tsep"></div>';
    if (lv > 0) h += '<div class="tstat">当前效果：' + ps.text(lv) + '</div>';
    if (maxed) {
      h += '<div class="tstat good">已满级</div>';
    } else {
      h += '<div class="thd">投入下一点的收益</div>';
      h += '<div class="tstat">' + (lv > 0 ? ps.text(lv) + ' → ' : '') + '<b class="good">' + ps.text(lv + 1) + '</b></div>';
      const a = lv > 0 ? ps.stats(lv) : {};
      const b = ps.stats(lv + 1);
      const diffs = [];
      for (const k in b) {
        const dv = b[k] - (a[k] || 0);
        if (dv) diffs.push((D.STATS[k] ? D.STATS[k].name : k) + ' +' + (Math.round(dv * 10) / 10));
      }
      if (diffs.length) h += '<div class="tstat dim">本次提升：' + diffs.join('　') + '</div>';
      h += '<div class="tcmp dim small">天赋点剩余 ' + (p.passivePoints || 0) + '</div>';
    }
    return h;
  };

  /* ============================================================
   *  右键菜单
   * ============================================================ */
  UI.ctx = function (ev, entries) {
    const menu = el('ctxmenu');
    if (!menu) return;
    menu.innerHTML = '';
    entries.forEach((en) => {
      const d = root.document.createElement('div');
      d.textContent = en.label;
      if (en.disabled) d.className = 'dis';
      else d.addEventListener('click', () => { UI.hideCtx(); en.action(); });
      menu.appendChild(d);
    });
    menu.hidden = false;
    const w = menu.offsetWidth || 130, h = menu.offsetHeight || 80;
    const vw = root.innerWidth || 1280, vh = root.innerHeight || 720;
    menu.style.left = Math.min(ev.clientX, vw - w - 6) + 'px';
    menu.style.top = Math.min(ev.clientY, vh - h - 6) + 'px';
  };
  UI.hideCtx = function () { const menu = el('ctxmenu'); if (menu) menu.hidden = true; };

  /* ============================================================
   *  日志
   * ============================================================ */
  UI.log = function (msg, cls) {
    const box = el('log');
    if (!box) return;
    const d = root.document.createElement('div');
    d.innerHTML = '<span class="' + (cls || '') + '">' + msg + '</span>';
    box.appendChild(d);
    UI.logEls.push(d);
    while (UI.logEls.length > 9) {
      const old = UI.logEls.shift();
      if (old.parentNode) old.parentNode.removeChild(old);
    }
    setTimeout(() => { d.className = 'fade'; }, 4200);
  };

  /* ============================================================
   *  装备栏
   * ============================================================ */
  UI.buildEquipDoll = function () {
    const doll = el('equip-doll');
    if (!doll) return;
    doll.innerHTML = '';
    D.SLOTS.forEach((slot) => {
      const d = root.document.createElement('div');
      d.className = 'slot-equip';
      d.dataset.slot = slot.id;
      d.innerHTML = '<span class="g">' + slot.glyph + '</span><span class="nm">' + slot.name + '</span>';
      d.addEventListener('mouseenter', (ev) => {
        const it = UI.game.player.gear[slot.id];
        if (it) UI.tooltip(it, ev, { compare: false });
      });
      d.addEventListener('mousemove', (ev) => {
        const it = UI.game.player.gear[slot.id];
        if (it) UI.tooltip(it, ev, { compare: false });
      });
      d.addEventListener('mouseleave', UI.hideTooltip);
      d.addEventListener('click', () => {
        const it = UI.game.player.gear[slot.id];
        if (UI.heldGem) { if (it) UI.socketHeldGem(it); else G.log('该槽位没有装备。', 'dim'); return; }
        if (it) UI.unequip(slot.id);
      });
      d.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const it = UI.game.player.gear[slot.id];
        if (!it) return;
        UI.ctx(ev, [
          { label: '卸下', action: () => UI.unequip(slot.id) },
          { label: '镶嵌宝石（第一个孔位）', disabled: !it.sockets, action: () => UI.insertGemInto(it) },
          { label: '出售（' + L.price(it) + ' 金币）', action: () => UI.sellEquipped(slot.id) },
        ]);
      });
      doll.appendChild(d);
    });
  };

  UI.refreshEquipDoll = function () {
    const doll = el('equip-doll');
    if (!doll || !UI.ready()) return;
    const p = UI.game.player;
    Array.prototype.forEach.call(doll.children, (d) => {
      const slot = d.dataset.slot;
      const it = p.gear[slot];
      const s = D.SLOT_BY_ID[slot];
      d.classList.remove('r-common', 'r-magic', 'r-rare', 'r-unique');
      let name, color = '';
      if (it) {
        d.classList.add('r-' + it.rarity);
        name = L.displayName(it);
        color = G.RARITY_COLOR[it.rarity];
      } else {
        // 空槽位显示「部位 · 空」
        name = (s ? s.name : slot) + ' · 空';
      }
      d.classList.toggle('empty', !it);
      d.title = it ? name : (name + '　（点击可装备/卸下）');
      d.innerHTML = '<span class="g">' + (s ? s.glyph : '▪') + '</span>' +
        '<span class="nm"' + (color ? ' style="color:' + color + '"' : '') + '>' + name + '</span>' +
        UI.socketsHTML(it);
    });
    UI.renderMiniStats();
  };

  UI.renderMiniStats = function () {
    const box = el('mini-stats');
    if (!box || !UI.ready()) return;
    const p = UI.game.player;
    const st = p.stats;
    const rows = [
      ['生命', Math.round(p.life) + ' / ' + st.maxLife],
      ['法力', Math.round(p.mana) + ' / ' + st.maxMana],
      ['护甲', st.armor],
      ['坚韧', Math.round(S.toughness(p, UI.game.mlvl || 1).total)],
      ['伤害', Math.round(st.weaponMin) + '-' + Math.round(st.weaponMax) + ' × ' + st.attackSpeed.toFixed(2)],
      ['每秒伤害', Math.round(st.weaponDps * 100) / 100],
      ['暴击', st.crit.toFixed(1) + '% / ' + Math.round(st.critDmg) + '%'],
      ['抗性', '火' + Math.round(st.res.fire) + ' 冰' + Math.round(st.res.cold) + ' 电' + Math.round(st.res.lightning) + ' 毒' + Math.round(st.res.poison)],
      ['魔法装备', '+' + Math.round(st.mf) + '%'],
      ['金币掉落', '+' + Math.round(st.gf) + '%'],
    ];
    box.innerHTML = rows.map((r) => '<div class="row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('');
  };

  /* ============================================================
   *  背包
   * ============================================================ */
  /* 背包格数会随仓库等级变化：按需增删格子（已有格子保留绑定，只动尾部） */
  UI.syncInvCells = function (grid, cap) {
    if (!grid) return;
    while (grid.children.length > cap) grid.removeChild(grid.children[grid.children.length - 1]);
    for (let i = grid.children.length; i < cap; i++) {
      const c = root.document.createElement('div');
      c.className = 'cell empty';
      c.dataset.idx = i;
      UI.bindCellEvents(c, () => UI.game.player.inventory[i], {
        onLeft: (ev) => UI.cellLeftClick(i),
        onRight: (ev) => UI.cellRightClick(i, ev),
        onShift: () => UI.quickSellInv(i),
      });
      grid.appendChild(c);
    }
  };

  UI.buildInventory = function () {
    const grid = el('inv-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const inv = (UI.game && UI.game.player && UI.game.player.inventory) || null;
    UI.syncInvCells(grid, (inv && inv.length) || 60);
    const btnSort = el('btn-sort');
    if (btnSort) btnSort.addEventListener('click', () => UI.sortInventory());
  };

  UI.bindCellEvents = function (cell, getItem, handlers) {
    cell.addEventListener('mouseenter', (ev) => {
      const it = getItem();
      if (it) UI.tooltip(it, ev, { compare: it.cat === 'equip' });
    });
    cell.addEventListener('mousemove', (ev) => {
      const it = getItem();
      if (it) UI.tooltip(it, ev, { compare: it.cat === 'equip' });
      else UI.hideTooltip();
    });
    cell.addEventListener('mouseleave', UI.hideTooltip);
    cell.addEventListener('click', (ev) => {
      const it = getItem();
      if (!it) return;
      if (ev.shiftKey) handlers.onShift();
      else handlers.onLeft(ev);
      UI.hideTooltip();
    });
    cell.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const it = getItem();
      if (!it) return;
      handlers.onRight(ev);
      UI.hideTooltip();
    });
  };

  function itemGlyph(it) {
    if (it.cat === 'gem') return D.gemGlyph(it.tier || 0);
    if (it.cat === 'potion') return '🧪';
    if (it.cat === 'gold') return '🪙';
    if (it.cat === 'shard') return D.MATERIAL.icon || '❖';
    if (it.cat === 'orb') return (D.orbById[it.orb] || {}).icon || '◈';
    if (it.slot === 'weapon') return it.two ? '⚔' : '🗡';
    if (it.slot === 'offhand') return it.type === 'shield' ? '🛡' : '📖';
    const s = D.SLOT_BY_ID[it.slot];
    return s ? s.glyph : '▪';
  }
  UI.itemGlyph = itemGlyph;

  UI.itemColor = function (it) {
    if (!it) return '#ffe9a8';
    if (it.cat === 'equip') return G.RARITY_COLOR[it.rarity];
    if (it.cat === 'gem') return it.color || '#cfe8ff';
    if (it.cat === 'orb') return (D.orbById[it.orb] || {}).color || '#8fd6ff';
    return it.color || '#ffe9a8';
  };

  /* 装备后评分会提升？
   * 等级 / 属性暂时不够也照样算——评分是装备本身的价值，绿箭头提示「将来换上更值」，
   * 穿不穿得上由红框单独表示。结果按「装备方案 + 等级 + 攻速」缓存，避免每次刷新背包都重复评分。 */
  UI._upCache = { sig: '', map: {} };
  function upgradeSig(p) {
    let s = p.level + '|' + (p.stats ? (p.stats.aps | 0) : 0) + '|';
    D.gearSlots().forEach((k) => { const it = p.gear[k]; s += (it ? it.uid : '-') + ','; });
    return s;
  }
  UI.isUpgradeRaw = function (it, p) {
    // 有空戒指位 → 直接可提升
    if (it.slot === 'ring' && (!p.gear.ring1 || !p.gear.ring2)) return true;
    // L.compare 已经算上了「双手武器 ⇄ 副手」互斥导致的损失；
    // 戒指取两个槽位里最好的那个，该部位为空时返回 null = 直接可提升
    const cmp = L.compare(p, it);
    if (!cmp) return true;
    return cmp.delta > 0;
  };
  UI.isUpgrade = function (it) {
    const p = UI.game && UI.game.player;
    if (!it || it.cat !== 'equip' || !p) return false;
    const sig = upgradeSig(p);
    if (UI._upCache.sig !== sig) UI._upCache = { sig, map: {} };
    if (UI._upCache.map[it.uid] === undefined) UI._upCache.map[it.uid] = UI.isUpgradeRaw(it, p) ? 1 : 0;
    return UI._upCache.map[it.uid] === 1;
  };

  /* 因为等级 / 属性不足而无法穿戴 */
  UI.cantEquip = function (it) {
    return !!(it && it.cat === 'equip' && UI.canEquip(it));
  };

  /* 孔位标识：一个孔一颗菱形，已镶嵌的按宝石颜色显示；无孔返回空串
   * from / to 可以只取一段（双手武器分成上下两排） */
  UI.socketsInner = function (it, from, to) {
    if (!it || !(it.sockets > 0)) return '';
    const a = Math.max(0, from | 0), b = to == null ? it.sockets : Math.min(it.sockets, to | 0);
    let h = '';
    for (let k = a; k < b; k++) {
      const g = it.gems && it.gems[k];
      const col = g && D.GEM_TYPES[g.gem] ? D.GEM_TYPES[g.gem].color : '';
      h += '<i class="' + (g ? 'filled' : '') + '"' +
        (col ? ' style="background:' + col + ';border-color:#fff"' : '') + '></i>';
    }
    return h;
  };

  // 孔位上限最多 4（双手武器），一排就够显示
  UI.socketsHTML = function (it) {
    if (!it || !(it.sockets > 0)) return '';
    const filled = (it.gems || []).filter(Boolean).length;
    const tip = '孔位 ' + filled + ' / ' + it.sockets;
    return '<span class="sockets" title="' + tip + '">' + UI.socketsInner(it) + '</span>';
  };

  /* ---------------- 装备过滤器接入 ----------------
   * 「隐藏」不再把格子画成叉：背包 / 仓库里照常显示，只在外圈加一道暗色边框；
   * 地面上的隐藏掉落默认既不画也不捡，只有长按「显示全部装备」键时才看得见、点得到。
   * 高亮的物品描一圈绿边，方便一眼挑出来。 */
  UI.filterStateOf = function (it) {
    if (!it || it.cat !== 'equip' || !G.Filter) return { state: 'normal', index: -1 };
    const p = UI.game && UI.game.player;
    if (!p) return { state: 'normal', index: -1 };      // 还没有角色时一律正常显示
    const ctx = {
      stats: p.stats || null,
      canEquip: !UI.canEquip(it),
    };
    return G.Filter.decide(it, ctx);
  };

  /* 这东西是不是被过滤器判为「隐藏」——只看规则，不看长按状态 */
  UI.filterHidden = function (it) {
    return UI.filterStateOf(it).state === 'hide';
  };

  /* 是否正长按着「显示全部装备」键（默认 X，可在设置里改键）。
   * 按住期间：地面上的隐藏掉落照常画出来，也能用鼠标点它们；
   * 松手立刻恢复。注意 F / 走近自动吸取不看这个状态——它们永远只捡没被过滤器隐藏的装备。 */
  UI.revealHeld = function () {
    return !!(G.Settings && G.Settings.down('revealFilter'));
  };

  /* ============================================================
   *  装备过滤器面板
   * ============================================================ */
  UI.bindFilter = function () {
    const btn = el('btn-filter');
    if (btn) btn.addEventListener('click', () => UI.togglePanel('panel-filter', true));
    const en = el('filter-enabled');
    if (en) en.addEventListener('change', () => {
      G.Filter.data.enabled = !!en.checked;
      G.Filter.save();
      UI.refreshFilterViews();
      UI.renderFilter();
    });
    const add = el('btn-filter-add');
    if (add) add.addEventListener('click', () => {
      // 新规则插到最前面：刚写的规则立刻生效
      if (!G.Filter.insertRule()) {
        UI.filterMsg('最多只能有 ' + G.Filter.MAX_RULES + ' 条规则。', true);
        return;
      }
      G.Filter.save();
      UI.refreshFilterViews();
      UI.renderFilter();
      UI.filterMsg('新规则已放在第 1 条（越靠前越优先）。');
    });
    const clr = el('btn-filter-clear');
    if (clr) clr.addEventListener('click', () => {
      G.Filter.clear();
      G.Filter.save();
      UI.refreshFilterViews();
      UI.renderFilter();
      UI.filterMsg('已清空全部规则。');
    });
    const exp = el('btn-filter-export');
    if (exp) exp.addEventListener('click', () => UI.openFilterIO('export'));
    const imp = el('btn-filter-import');
    if (imp) imp.addEventListener('click', () => UI.openFilterIO('import'));
    const iook = el('btn-filter-io-ok');
    if (iook) iook.addEventListener('click', () => UI.filterIOConfirm());
    const iocl = el('btn-filter-io-close');
    if (iocl) iocl.addEventListener('click', () => UI.closeFilterIO());
    // 点小窗外的灰底也能关掉
    const iowrap = el('filter-io');
    if (iowrap) iowrap.addEventListener('click', (ev) => { if (ev.target === iowrap) UI.closeFilterIO(); });
    /* ---- 词缀勾选面板 ---- */
    const hideC = el('affix-hide-conflict');
    if (hideC) hideC.addEventListener('change', () => {
      G.Filter.data.hideConflict = !!hideC.checked;
      G.Filter.save();
      UI.renderAffixPick();
    });
    const afxOk = el('btn-affix-ok');
    if (afxOk) afxOk.addEventListener('click', () => UI.confirmAffixPick());
    const afxNo = el('btn-affix-close');
    if (afxNo) afxNo.addEventListener('click', () => UI.closeAffixPick());
    const afxNone = el('btn-affix-none');
    if (afxNone) afxNone.addEventListener('click', () => { UI.affixSel = []; UI.renderAffixPick(); });
    const afxWrap = el('affix-pick');
    if (afxWrap) afxWrap.addEventListener('click', (ev) => { if (ev.target === afxWrap) UI.closeAffixPick(); });
    const afxList = el('affix-list');
    if (afxList) {
      afxList.addEventListener('change', (ev) => {
        const t2 = ev && ev.target;
        if (t2 && t2.dataset && t2.dataset.afx) UI.toggleAffix(t2.dataset.afx, !!t2.checked);
      });
    }
    // 细则里的输入控件：事件委托，避免每次重建都重新绑定
    const rules = el('filter-rules');
    if (rules) {
      rules.addEventListener('change', (ev) => UI.filterEdit(ev));
      rules.addEventListener('click', (ev) => UI.filterClick(ev));
      rules.addEventListener('input', (ev) => UI.filterEdit(ev, true));
    }
  };

  UI.filterMsg = function (txt, bad) {
    ['filter-msg', 'filter-io-msg'].forEach((id) => {
      const m = el(id);
      if (m) {
        m.textContent = txt || '';
        m.style.color = bad ? '#ff8f8f' : '#8ce07a';
      }
    });
  };

  /* ---------------- 导入 / 导出小窗（点按钮才弹出） ---------------- */
  UI.filterIOMode = null;

  UI.openFilterIO = function (mode) {
    const box = el('filter-io'), ta = el('filter-json');
    if (!box || !ta) return;
    UI.filterIOMode = mode === 'import' ? 'import' : 'export';
    const imp = UI.filterIOMode === 'import';
    G.text('filter-io-title', imp ? '导入过滤器' : '导出过滤器');
    G.text('filter-io-hint', imp
      ? '把过滤器文本粘贴到下面的框里，再点「导入」——会覆盖当前的启用状态与全部规则。'
      : '下面就是当前过滤器的文本，点「复制」拿走备份即可。');
    ta.value = imp ? '' : G.Filter.exportText();
    ta.placeholder = imp ? '在这里粘贴过滤器文本（Ctrl + V）' : '';
    const ok = el('btn-filter-io-ok');
    if (ok) ok.textContent = imp ? '导入' : '复制';
    UI.filterMsg('');
    box.hidden = false;
    if (ta.focus) ta.focus();
    if (!imp && ta.select) ta.select();     // 导出时直接全选，Ctrl+C 即可拿走
  };

  UI.closeFilterIO = function () {
    const box = el('filter-io');
    if (!box || box.hidden) return false;
    box.hidden = true;
    UI.filterIOMode = null;
    UI.filterMsg('');
    return true;
  };

  /* ---------------- 词缀勾选面板（盖在过滤器面板上） ---------------- */
  UI.affixSel = [];
  UI.affixTarget = null;

  UI.openAffixPick = function (ri, ci) {
    const rule = G.Filter.data.rules[ri];
    const cond = rule && rule.conds[ci];
    if (!cond) return;
    UI.affixTarget = { ri: ri, ci: ci };
    UI.affixSel = G.Filter.affixIds(cond).slice();
    const box = el('affix-pick');
    if (!box) return;
    UI.renderAffixPick();
    box.hidden = false;
  };

  UI.closeAffixPick = function () {
    const box = el('affix-pick');
    if (!box || box.hidden) { UI.affixTarget = null; return false; }
    UI.affixTarget = null;
    box.hidden = true;
    return true;
  };

  UI.toggleAffix = function (id, on) {
    const i = UI.affixSel.indexOf(id);
    if (on && i < 0) UI.affixSel.push(id);
    if (!on && i >= 0) UI.affixSel.splice(i, 1);
    UI.renderAffixPick();
  };

  UI.renderAffixPick = function () {
    const F = G.Filter;
    const hideC = el('affix-hide-conflict');
    if (hideC) hideC.checked = F.data.hideConflict !== false;
    const tgt = UI.affixTarget;
    const rule = tgt ? F.data.rules[tgt.ri] : null;
    const conds = rule ? rule.conds : [];
    const pool = F.affixPool(conds, F.data.hideConflict !== false);
    const count = el('affix-pick-count');
    if (count) count.textContent = '已选 ' + UI.affixSel.length + ' 条 / 可选 ' + pool.length + ' 条';
    const hint = el('affix-pick-hint');
    if (hint) {
      const slots = F.allowedSlots(conds);
      hint.textContent = (F.data.hideConflict !== false && slots && slots.length)
        ? '这条规则限定了部位 / 类型，只列出会出现在这些部位的词缀；关掉上面的开关可以看全部词缀。'
        : '勾选想要的词缀（可多选），再配合前面的「至少包含 N 条」使用。';
    }
    const list = el('affix-list');
    if (!list) return;
    list.innerHTML = '';
    const groups = [['prefix', '前缀'], ['suffix', '后缀']];
    let total = 0;
    groups.forEach((grp) => {
      const items = pool.filter((a) => a.kind === grp[0]);
      if (!items.length) return;
      total += items.length;
      const h = root.document.createElement('div');
      h.className = 'afx-group';
      h.textContent = grp[1] + '（' + items.length + '）';
      list.appendChild(h);
      const wrap = root.document.createElement('div');
      wrap.className = 'afx-items';
      items.forEach((a) => {
        const on = UI.affixSel.indexOf(a.id) >= 0;
        const lb = root.document.createElement('label');
        lb.className = 'afx-item' + (on ? ' on' : '');
        lb.innerHTML = '<input type="checkbox" data-afx="' + a.id + '"' + (on ? ' checked' : '') + '>' +
          '<span class="an">' + a.name + '</span>' +
          '<span class="as">' + F.affixLabel(a) + '</span>';
        wrap.appendChild(lb);
      });
      list.appendChild(wrap);
    });
    if (!total) {
      const d = root.document.createElement('div');
      d.className = 'hint dim';
      d.textContent = '没有符合当前条件的词缀。';
      list.appendChild(d);
    }
  };

  UI.confirmAffixPick = function () {
    const tgt = UI.affixTarget;
    const rule = tgt ? G.Filter.data.rules[tgt.ri] : null;
    const cond = rule && rule.conds[tgt.ci];
    if (cond) {
      cond.affixIds = UI.affixSel.slice(0, 60);
      if (G.Filter.affixMin(cond) < 1) cond.value = 1;
    }
    G.Filter.save();
    UI.refreshFilterViews();
    UI.closeAffixPick();
    UI.renderFilter();
    UI.filterMsg('已选择 ' + UI.affixSel.length + ' 条词缀。');
  };

  UI.filterIOConfirm = function () {
    const ta = el('filter-json');
    const txt = ta ? ta.value : '';
    if (UI.filterIOMode === 'import') {
      const r = G.Filter.importText(txt);
      if (!r.ok) { UI.filterMsg('导入失败：' + r.why, true); return false; }
      UI.refreshFilterViews();
      UI.renderFilter();
      UI.closeFilterIO();
      UI.filterMsg('导入成功，共 ' + r.rules + ' 条规则。');
      return true;
    }
    try {
      const w = root.navigator && root.navigator.clipboard ? root.navigator.clipboard.writeText(txt) : null;
      if (w && w.catch) w.catch(() => { });            // 没权限时不要抛未处理的 Promise
      UI.filterMsg('已复制到剪贴板。');
    } catch (e) { UI.filterMsg('请手动复制文本框里的内容。', true); }
    return true;
  };

  // 面板里任何控件改动都会带 data-rule / data-cond 等标记，统一在这里落到数据上
  UI.filterEdit = function (ev, live) {
    const t = ev && ev.target;
    if (!t || !t.dataset) return;
    const ri = t.dataset.rule | 0;
    const ci = t.dataset.cond == null ? -1 : (t.dataset.cond | 0);
    const rule = G.Filter.data.rules[ri];
    if (!rule) return;
    if (ci < 0) {
      if (t.dataset.field === 'action') rule.action = t.value;
      else if (t.dataset.field === 'enabled') rule.enabled = !!t.checked;
    } else {
      const cond = rule.conds[ci];
      if (!cond) return;
      if (t.dataset.field === 'type') {
        cond.type = t.value;
        const nt = G.Filter.condType(cond.type);
        cond.op = nt.ops[0].id;
        // 数值细则默认 0（不再给 20 这种拍脑袋的默认值）
        cond.value = nt.value === 'number' ? G.Filter.NUM_DEFAULT : nt.value === 'rarity' ? 'rare' : nt.value === 'slot' ? 'weapon'
          : nt.value === 'bool' ? 'true' : nt.value === 'affixPick' ? 1 : '';
        if (nt.attrPick) cond.attr = 'any';
        if (nt.value === 'affixPick') {
          cond.affixIds = [];
          UI.openAffixPick(ri, ci);
        }
      } else if (t.dataset.field === 'op') cond.op = t.value;
      else if (t.dataset.field === 'attr') cond.attr = G.Filter.attrOf({ attr: t.value });
      else if (t.dataset.field === 'value') {
        const tv = G.Filter.condType(cond.type).value;
        // 数值细则写入前 clamp 到该细则的取值范围（输入框本身也带 min / max）
        if (tv === 'affixPick') cond.value = G.clamp(Math.round(Number(t.value) || 1), 1, 12);
        else if (tv === 'number' && !live) cond.value = G.Filter.clampValue(cond.type, t.value);
        else cond.value = t.value;
        if (live) return;                       // 输入过程中不重绘，避免打断打字
      }
    }
    G.Filter.save();
    UI.refreshFilterViews();
    UI.renderFilter();
  };

  UI.filterClick = function (ev) {
    const t = ev && ev.target;
    if (!t || !t.dataset) return;
    const ri = t.dataset.rule | 0;
    const ci = t.dataset.cond == null ? -1 : (t.dataset.cond | 0);
    const act = t.dataset.act;
    if (!act) return;
    if (act === 'del') G.Filter.removeRule(ri);
    else if (act === 'up') G.Filter.moveRule(ri, -1);
    else if (act === 'down') G.Filter.moveRule(ri, 1);
    else if (act === 'pickAffix') { UI.openAffixPick(ri, ci); return; }   // 面板自己处理，不用重绘规则列表
    else if (act === 'addCond') {
      const rule = G.Filter.data.rules[ri];
      if (rule) rule.conds.push({ type: 'ilvl', op: '>=', value: G.Filter.NUM_DEFAULT });
    } else if (act === 'delCond') {
      const rule = G.Filter.data.rules[ri];
      if (rule) {
        rule.conds.splice(ci, 1);
        if (!rule.conds.length) rule.conds.push({ type: 'rarity', op: 'is', value: 'common' });
      }
    } else return;
    G.Filter.save();
    UI.refreshFilterViews();
    UI.renderFilter();
  };

  UI.renderFilter = function () {
    const F = G.Filter;
    if (!F) return;
    const en = el('filter-enabled');
    if (en) en.checked = !!F.data.enabled;
    G.text('filter-count', F.data.rules.length + ' / ' + F.MAX_RULES + ' 条规则');
    const box = el('filter-rules');
    if (box) {
      box.innerHTML = '';
      if (!F.data.rules.length) {
        const d = root.document.createElement('div');
        d.className = 'hint dim';
        d.textContent = '还没有规则。点下面的「新增规则」开始，例如：稀有度不是 稀有 → 隐藏。';
        box.appendChild(d);
      }
      F.data.rules.forEach((rule, ri) => {
        const card = root.document.createElement('div');
        card.className = 'frule' + (rule.action === 'hide' ? ' hide' : rule.action === 'show' ? ' show' : '');
        card.dataset.rule = ri;
        let h = '<div class="fr-hd">' +
          '<span class="fr-idx" title="按住可拖动排序">' + (ri + 1) + '</span>' +
          '<label class="flt-toggle"><input type="checkbox" data-rule="' + ri + '" data-field="enabled"' +
          (rule.enabled === false ? '' : ' checked') + '> 启用</label>' +
          '<span class="fr-act">动作</span>' +
          '<select data-rule="' + ri + '" data-field="action">' +
          F.ACTIONS.map((a) => '<option value="' + a.id + '"' + (a.id === rule.action ? ' selected' : '') + '>' + a.name + '</option>').join('') +
          '</select>' +
          '<span class="fr-sum">' + F.ruleText(rule) + '</span>' +
          '<button class="btn tiny" data-rule="' + ri + '" data-act="up" title="上移（越靠前越优先）">↑</button>' +
          '<button class="btn tiny" data-rule="' + ri + '" data-act="down" title="下移">↓</button>' +
          '<button class="btn tiny danger" data-rule="' + ri + '" data-act="del">删除</button>' +
          '</div>';
        h += '<div class="fr-conds">';
        (rule.conds || []).forEach((cond, ci) => {
          const t = F.condType(cond.type);
          h += '<div class="fcond">' +
            '<select data-rule="' + ri + '" data-cond="' + ci + '" data-field="type">' +
            F.COND_TYPES.map((x) => '<option value="' + x.id + '"' + (x.id === cond.type ? ' selected' : '') + '>' + x.name + '</option>').join('') +
            '</select>' +
            // 只有一种判定方式的细则（装备类型 / 是否双手 / 当前可穿戴 / 包含词缀）不显示这个下拉
            (t.ops.length > 1
              ? ('<select data-rule="' + ri + '" data-cond="' + ci + '" data-field="op">' +
                t.ops.map((o) => '<option value="' + o.id + '"' + (o.id === cond.op ? ' selected' : '') + '>' + o.name + '</option>').join('') +
                '</select>')
              : '') +
            UI.filterValueInput(ri, ci, cond, t) +
            '<button class="btn tiny danger" data-rule="' + ri + '" data-cond="' + ci + '" data-act="delCond">✕</button>' +
            '</div>';
        });
        h += '<button class="btn tiny" data-rule="' + ri + '" data-act="addCond">+ 添加细则</button></div>';
        card.innerHTML = h;
        /* 拖拽排序（↑↓ 保留，两种都能用） */
        card.draggable = true;
        card.addEventListener('dragstart', (ev) => {
          UI._dragRule = ri;
          if (ev && ev.dataTransfer) {
            try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(ri)); } catch (e) { }
          }
          card.className += ' dragging';
        });
        card.addEventListener('dragend', () => { UI._dragRule = null; UI.renderFilter(); });
        card.addEventListener('dragover', (ev) => {
          if (UI._dragRule == null) return;
          if (ev && ev.preventDefault) ev.preventDefault();
          if (card.className.indexOf('drag-over') < 0) card.className += ' drag-over';
        });
        card.addEventListener('dragleave', () => { card.className = card.className.replace(/ drag-over/g, ''); });
        card.addEventListener('drop', (ev) => {
          if (ev && ev.preventDefault) ev.preventDefault();
          const from = UI._dragRule;
          UI._dragRule = null;
          if (from != null && from !== ri && G.Filter.moveRuleTo(from, ri)) {
            G.Filter.save();
            UI.refreshFilterViews();
            UI.filterMsg('规则顺序已更新：第 ' + (from + 1) + ' 条 → 第 ' + (ri + 1) + ' 条。');
          }
          UI.renderFilter();
        });
        box.appendChild(card);
      });
    }
    const hint = el('filter-hint');
    if (hint) {
      hint.innerHTML = '说明：装备一旦命中某条规则就按该规则处理，<b>不再看后面的规则</b>，所以「想把某类留下」的规则要放在前面。' +
        '规则可以直接<b>拖拽排序</b>（也可以用每条右侧的 ↑ ↓），新增的规则默认放在第 1 条。' +
        '被判定为「隐藏」的装备<b>不会被捡起来</b>（走近自动吸取、F 拾取都不行），地面掉落平时也不显示，' +
        '背包与仓库里照常显示，只在格子外圈加一道暗色边框表示它不符合过滤器。过滤器对所有存档通用。';
    }
  };

  UI.filterValueInput = function (ri, ci, cond, t) {
    const attr = 'data-rule="' + ri + '" data-cond="' + ci + '" data-field="value"';
    const v = cond.value == null ? '' : cond.value;
    if (t.value === 'rarity') {
      return '<select ' + attr + '>' + G.Filter.rarities.map((r) =>
        '<option value="' + r.id + '"' + (r.id === v ? ' selected' : '') + '>' + r.name + '</option>').join('') + '</select>';
    }
    if (t.value === 'slot') {
      return '<select ' + attr + '>' + G.Filter.slots.map((r) =>
        '<option value="' + r.id + '"' + (r.id === v ? ' selected' : '') + '>' + r.name + '</option>').join('') + '</select>';
    }
    if (t.value === 'type') {
      // 武器 / 副手 / 护甲三张表；任何一张缺失也不能把整个面板带崩
      let opts = '';
      [D.WEAPON_TYPES, D.OFFHAND_TYPES, D.ARMOR_TYPES].forEach((tb) => {
        Object.keys(tb || {}).forEach((k) => {
          opts += '<option value="' + k + '"' + (k === v ? ' selected' : '') + '>' +
            ((tb[k] && tb[k].label) || k) + '</option>';
        });
      });
      return '<select ' + attr + '>' + opts + '</select>';
    }
    if (t.value === 'bool') {
      return '<select ' + attr + '><option value="true"' + (v === true || v === 'true' ? ' selected' : '') + '>是</option>' +
        '<option value="false"' + (v === false || v === 'false' ? ' selected' : '') + '>否</option></select>';
    }
    if (t.value === 'affixPick') {
      const ids = G.Filter.affixIds(cond);
      return '<button class="btn tiny pick" data-rule="' + ri + '" data-cond="' + ci + '" data-act="pickAffix">' +
        (ids.length ? '已选 ' + ids.length + ' 条词缀' : '选择词缀…') + '</button>' +
        '<span class="pick-min">至少包含</span>' +
        '<input type="number" class="flt-num" ' + attr + ' min="1" max="12" step="1" value="' + G.Filter.affixMin(cond) + '">' +
        '<span class="pick-min">条</span>';
    }
    if (t.value === 'number') {
      // 带上取值范围：输入框会拦住越界值，写入前还会再 clamp 一次
      const num = '<input type="number" class="flt-num" ' + attr + ' min="' + (t.min == null ? 0 : t.min) +
        '" max="' + (t.max == null ? 99999 : t.max) + '" step="1" value="' + v + '">';
      // 「需求属性」多一个下拉：选力量 / 敏捷 / 智力 / 任意（取三项最高）
      if (!t.attrPick) return num;
      const attrSel = 'data-rule="' + ri + '" data-cond="' + ci + '" data-field="attr"';
      const cur = G.Filter.attrOf(cond);
      return '<select ' + attrSel + '>' + G.Filter.ATTR_OPTIONS.map((a) =>
        '<option value="' + a.id + '"' + (a.id === cur ? ' selected' : '') + '>' + a.name + '</option>').join('') +
        '</select>' + num;
    }
    return '<input type="text" class="flt-txt" ' + attr + ' value="' + String(v) + '" placeholder="例如：暴击 / 生命 / 抗性">';
  };

  /* 背包 / 仓库格子的统一内容（图标 + 孔位菱形 + 数量 + 提升标识）
   * 被过滤器隐藏的装备照常显示，只在格子外圈加一道暗色边框（见 .flt-hide） */
  UI.cellInner = function (it) {
    if (!it) return '';
    const fs = UI.filterStateOf(it);
    let html = '<span style="color:' + UI.itemColor(it) + '">' + itemGlyph(it) + '</span>';
    html += UI.socketsHTML(it);
    if (it.cat === 'potion') html += '<span class="cnt">' + (D.POTIONS[it.potion].vals[it.tier]) + '</span>';
    if ((it.cat === 'orb' || it.cat === 'gem') && (it.count || 1) > 1) html += '<span class="cnt">' + it.count + '</span>';
    if (it.cat === 'equip' && UI.isUpgrade(it)) html += '<span class="up-mark" title="装备后评分提升">▲</span>';
    if (fs.state === 'show') html += '<span class="flt-mark" title="过滤器高亮（规则 ' + (fs.index + 1) + '）">◆</span>';
    return html;
  };

  /* 格子 CSS 类：稀有度 + 通货/宝石 + 无法穿戴的红色边框 + 过滤器状态
   * 「无法穿戴」和「可提升」可以同时存在：红框照旧，绿箭也照常显示 */
  UI.cellClass = function (it) {
    if (!it) return 'cell empty';
    let c = 'cell r-' + it.rarity;
    if (it.cat === 'orb') c += ' orb-cat';
    else if (it.cat === 'gem') c += ' gem-cat gem-t' + (it.tier | 0);
    if (UI.cantEquip(it)) c += ' cant-equip';
    if (it.cat === 'equip' && UI.isUpgrade(it)) c += ' upgrade';
    const fs = UI.filterStateOf(it);
    if (fs.state === 'hide') c += ' flt-hide';
    else if (fs.state === 'show') c += ' flt-show';
    return c;
  };

  UI.refreshFilterViews = function () {
    UI.dirty.inv = true;
    UI.refreshInventory();
    UI.renderStash();
    if (UI.open === 'panel-vendor') { UI.dirty.vendor = true; UI.renderVendor(); }
  };

  UI.refreshInventory = function () {
    const grid = el('inv-grid');
    if (!grid || !UI.ready()) return;
    const inv = UI.game.player.inventory;
    UI.syncInvCells(grid, inv.length);
    Array.prototype.forEach.call(grid.children, (c, i) => {
      const it = inv[i];
      c.className = UI.cellClass(it);
      c.innerHTML = UI.cellInner(it);
    });
    const gold = el('inv-gold');
    if (gold) gold.textContent = UI.game.player.gold;
    const cap = el('inv-cap');
    if (cap) cap.textContent = '背包 ' + inv.length + ' 格';
    UI.refreshEquipDoll();
    UI.dirty.vendor = true;
    UI.dirty.inv = false;
  };

  UI.cellLeftClick = function (i) {
    const it = UI.game.player.inventory[i];
    if (!it) { UI.releaseGem(); return; }
    G.audio.play('ui');
    if (it.cat === 'equip') {
      // 手上有宝石 → 镶嵌；否则正常穿戴
      if (UI.heldGem) { UI.socketHeldGem(it); return; }
      UI.equipFromInv(i);
    }
    else if (it.cat === 'potion') UI.drinkFromInv(i);
    else if (it.cat === 'gem') UI.pickUpGem(i);
    else if (it.cat === 'orb') {
      if (UI.open === 'panel-craft') { UI.craftUid = UI.craftUid === it.uid ? null : it.uid; UI.dirty.craft = true; UI.renderCraft(); }
      else { UI.togglePanel('panel-craft'); }
    }
  };

  /* ============================================================
   *  宝石「拿起 / 镶嵌」
   * ============================================================ */
  UI.heldGem = null;

  UI.pickUpGem = function (i) {
    const it = UI.game.player.inventory[i];
    if (!it || it.cat !== 'gem') return;
    if (UI.heldGem && UI.heldGem.uid === it.uid) { UI.releaseGem(); return; }
    UI.heldGem = { uid: it.uid, gem: it.gem, tier: it.tier, name: it.name, color: it.color };
    G.audio.play('ui');
    G.log('拿起 ' + it.name + ' —— 点击有孔位的装备即可镶嵌（右键 / Esc 取消）', 'c-magic');
    UI.refreshInventory();
  };

  UI.releaseGem = function (silent) {
    if (!UI.heldGem) return;
    UI.heldGem = null;
    UI.updateHeldGemCursor();
    UI.refreshInventory();
    if (!silent) G.audio.play('ui');
  };

  // 光标上跟随的宝石图标
  UI.updateHeldGemCursor = function (ev) {
    const node = el('held-gem');
    if (!node) return;
    const g = UI.heldGem;
    if (!g) { node.hidden = true; return; }
    node.hidden = false;
    node.innerHTML = '<span style="color:' + (g.color || '#cfe8ff') + '">' + D.gemGlyph(g.tier) + '</span>';
    const m = ev || UI.mousePos;
    if (m) { node.style.left = (m.clientX != null ? m.clientX : m.x) + 12 + 'px'; node.style.top = (m.clientY != null ? m.clientY : m.y) + 12 + 'px'; }
  };

  // 把「手上」的宝石镶进装备
  UI.socketHeldGem = function (gearItem) {
    const g = UI.heldGem;
    if (!g) return false;
    if (!gearItem || gearItem.cat !== 'equip') return false;
    if (!gearItem.sockets) { G.log('该装备没有孔位。', 'dim'); G.audio.play('noskill'); return false; }
    const idx = gearItem.gems.indexOf(null);
    if (idx < 0) { G.log('该装备的孔位已经满了。', 'dim'); G.audio.play('noskill'); return false; }
    const p = UI.game.player;
    const slotIdx = p.inventory.findIndex((x) => x && x.uid === g.uid);
    if (slotIdx < 0) { UI.releaseGem(true); G.log('宝石已经不在背包里了。', 'dim'); return false; }
    gearItem.gems[idx] = { gem: g.gem, tier: g.tier };
    UI.takeFromInv(slotIdx, 1);       // 只消耗 1 颗
    UI.releaseGem(true);
    S.derive(p);
    UI.dirty.inv = true; UI.dirty.char = true; UI.dirty.stash = true;
    G.audio.play('loot');
    G.log('镶嵌了 ' + D.gemName(g.gem, g.tier) + ' → ' + L.displayName(gearItem), 'c-magic');
    UI.refreshInventory();
    UI.renderStash();
    return true;
  };

  UI.cellRightClick = function (i, ev) {
    const it = UI.game.player.inventory[i];
    if (!it) return;
    const entries = [];
    if (it.cat === 'equip') {
      if (it.slot === 'ring') {
        // 戒指：可以指定戴到哪个手指
        L.compareAll(UI.game.player, it).forEach((r) => {
          entries.push({
            label: '装备到' + r.label + (r.empty ? '（空）' : '（' + (r.delta >= 0 ? '▲ +' : '▼ ') + r.delta + '）'),
            action: () => UI.equipFromInv(i, r.slot),
          });
        });
      } else {
        entries.push({ label: '装备', action: () => UI.equipFromInv(i) });
      }
      if (it.sockets) entries.push({ label: '镶嵌宝石（第一个孔位）', action: () => UI.insertGemInto(it) });
      entries.push({ label: '在工坊中改造 [' + G.Settings.actionLabel('craft', 'G') + ']', action: () => { UI.craftUid = it.uid; UI.togglePanel('panel-craft', true); } });
      entries.push({ label: '出售（' + L.price(it) + ' 金币）', action: () => UI.sellInv(i) });
    } else if (it.cat === 'gem') {
      entries.push({ label: '拿起宝石（点击有孔装备镶嵌）', action: () => UI.pickUpGem(i) });
      entries.push({ label: '自动镶嵌到第一件有孔装备', action: () => UI.insertGemFromInv(i) });
      entries.push({ label: '存入共享仓库', action: () => UI.depositToShared(i) });
      if ((it.count || 1) > 1) entries.push({ label: '出售 1 颗（' + Math.round(L.price(it) / it.count) + ' 金币）', action: () => UI.sellOne(i) });
      entries.push({ label: '全部出售（' + L.price(it) + ' 金币）', action: () => UI.sellInv(i) });
    } else if (it.cat === 'orb') {
      entries.push({ label: '在工坊中使用 [' + G.Settings.actionLabel('craft', 'G') + ']', action: () => { UI.togglePanel('panel-craft', true); } });
      entries.push({ label: '存入共享仓库', action: () => UI.depositToShared(i) });
      if ((it.count || 1) > 1) entries.push({ label: '出售 1 个（' + L.orbUnitPrice(it.orb) + ' 金币）', action: () => UI.sellOne(i) });
      entries.push({ label: '全部出售（' + L.price(it) + ' 金币）', action: () => UI.sellInv(i) });
    } else {
      entries.push({ label: it.cat === 'potion' ? '饮用' : '出售（' + L.price(it) + ' 金币）', action: () => (it.cat === 'potion' ? UI.drinkFromInv(i) : UI.sellInv(i)) });
    }
    entries.push({ label: '丢弃', action: () => { UI.game.player.inventory[i] = null; UI.dirty.inv = true; UI.refreshInventory(); } });
    UI.ctx(ev, entries);
  };

  // 卖 1 个（通货 / 宝石堆叠）
  UI.sellOne = function (i) {
    const p = UI.game.player;
    const it = p.inventory[i];
    if (!it) return;
    const unit = it.cat === 'orb' ? L.orbUnitPrice(it.orb) : Math.round(L.price(it) / (it.count || 1));
    p.gold += unit;
    UI.takeFromInv(i, 1);
    G.audio.play('gold');
    UI.dirty.inv = true; UI.dirty.craft = true; UI.dirty.jeweler = true;
    UI.refreshInventory();
    if (UI.open === 'panel-craft') UI.renderCraft();
    if (UI.open === 'panel-jeweler') UI.renderJeweler();
  };

  UI.quickSellInv = function (i) {
    const it = UI.game.player.inventory[i];
    if (!it) return;
    UI.sellInv(i);
  };

  /* ---------------- 背包装卸 ---------------- */
  UI.firstEmpty = function () {
    const inv = UI.game.player.inventory;
    for (let i = 0; i < inv.length; i++) if (!inv[i]) return i;
    return -1;
  };
  UI.addToInv = function (item) {
    const p = UI.game.player;
    // 通货石 / 宝石可以堆叠
    if (item.cat === 'orb' || item.cat === 'gem') {
      const same = p.inventory.filter((x) => x && x.cat === item.cat &&
        (item.cat === 'orb' ? x.orb === item.orb : (x.gem === item.gem && x.tier === item.tier)))[0];
      if (same) {
        same.count = (same.count || 1) + (item.count || 1);
        UI.dirty.inv = true; UI.dirty.craft = true; UI.dirty.jeweler = true;
        return true;
      }
    }
    const i = UI.firstEmpty();
    if (i < 0) { G.log('背包已满！', 'c-boss'); return false; }
    p.inventory[i] = item;
    UI.dirty.inv = true; UI.dirty.craft = true; UI.dirty.jeweler = true;
    return true;
  };

  /* 从背包格子扣除 n 个（堆叠物品），返回实际扣除数量 */
  UI.takeFromInv = function (i, n) {
    const p = UI.game.player;
    const it = p.inventory[i];
    if (!it) return 0;
    const take = Math.min(n || 1, it.count || 1);
    it.count = (it.count || 1) - take;
    if (it.count <= 0) p.inventory[i] = null;
    UI.dirty.inv = true;
    return take;
  };

  UI.canEquip = function (item) {
    const p = UI.game.player;
    if (item.req) {
      if (item.req.level && p.level < item.req.level) return '等级不足';
      for (const k of ['str', 'dex', 'int']) {
        if (item.req[k] && p.attrs[k] < item.req[k]) return D.STATS[k].name + '不足';
      }
    }
    return null;
  };

  /* 装备背包里的物品；戒指可以指定 slot（'ring1' / 'ring2'） */
  UI.equipFromInv = function (i, slotOverride) {
    const p = UI.game.player;
    const it = p.inventory[i];
    if (!it || it.cat !== 'equip') return;
    const bad = UI.canEquip(it);
    if (bad) { G.log('无法装备：' + bad, 'c-boss'); G.audio.play('noskill'); return; }
    let slot = slotOverride || it.slot;
    if (slot === 'ring') slot = !p.gear.ring1 ? 'ring1' : (!p.gear.ring2 ? 'ring2' : 'ring1');
    p.inventory[i] = null;
    const old = p.gear[slot];
    p.gear[slot] = it;
    if (old) p.inventory[i] = old;
    // 双手武器与副手互斥
    if (it.two && p.gear.offhand) { const o = p.gear.offhand; p.gear.offhand = null; if (!UI.addToInv(o)) p.gear.offhand = o; }
    if (slot === 'offhand' && p.gear.weapon && p.gear.weapon.two) {
      const w = p.gear.weapon; p.gear.weapon = null;
      if (!UI.addToInv(w)) p.gear.weapon = w;
    }
    if (slot !== 'weapon' && slot !== 'offhand' && p.gear.weapon && p.gear.weapon.two && p.gear.offhand) {
      const o = p.gear.offhand; p.gear.offhand = null; if (!UI.addToInv(o)) p.gear.offhand = o;
    }
    S.derive(p);
    UI.dirty.inv = true; UI.dirty.char = true;
    G.audio.play('ui');
    const slotName = (slot === 'ring1' || slot === 'ring2') ? '（' + D.SLOT_BY_ID[slot].name + '）' : '';
    G.log('装备了 ' + L.displayName(it) + slotName, 'c-' + it.rarity);
    UI.refreshInventory();
  };

  UI.unequip = function (slot) {
    const p = UI.game.player;
    const it = p.gear[slot];
    if (!it) return;
    if (!UI.addToInv(it)) return;
    p.gear[slot] = null;
    S.derive(p);
    UI.dirty.inv = true; UI.dirty.char = true;
    G.audio.play('ui');
    UI.refreshInventory();
  };

  UI.sellEquipped = function (slot) {
    const p = UI.game.player;
    const it = p.gear[slot];
    if (!it) return;
    UI.gemGuard(it, '出售', () => UI.sellEquippedRun(slot));
  };

  UI.sellEquippedRun = function (slot) {
    const p = UI.game.player;
    const it = p.gear[slot];
    if (!it) return;
    p.gear[slot] = null;
    p.gold += L.price(it);
    S.derive(p);
    G.log('出售 ' + L.displayName(it) + '，获得 ' + L.price(it) + ' 金币', 'c-rare');
    G.audio.play('gold');
    UI.dirty.inv = true; UI.dirty.char = true; UI.dirty.vendor = true;
    UI.refreshInventory();
  };

  UI.sellInv = function (i) {
    const p = UI.game.player;
    const it = p.inventory[i];
    if (!it) return;
    UI.gemGuard(it, '出售', () => UI.sellInvRun(i));
  };

  UI.sellInvRun = function (i) {
    const p = UI.game.player;
    const it = p.inventory[i];
    if (!it) return;
    p.inventory[i] = null;
    const price = L.price(it);
    p.gold += price;
    G.audio.play('gold');
    G.log('出售 ' + (it.cat === 'equip' ? L.displayName(it) : it.name) + '，获得 ' + price + ' 金币', 'dim');
    UI.dirty.inv = true; UI.dirty.vendor = true;
    UI.refreshInventory();
  };

  UI.sortInventory = function () {
    const p = UI.game.player;
    const order = { unique: 0, rare: 1, magic: 2, common: 3 };
    const catOrder = (it) => (it.cat === 'equip' ? 0 : it.cat === 'orb' ? 1 : it.cat === 'gem' ? 2 : it.cat === 'potion' ? 3 : 4);
    const items = p.inventory.filter(Boolean);
    // 提升标识只算一次，避免排序过程中重复评分
    const up = {};
    items.forEach((it) => { up[it.uid] = UI.isUpgrade(it) ? 1 : 0; });
    items.sort((a, b) => {
      const c = catOrder(a) - catOrder(b);
      if (c) return c;
      // 1) 稀有度优先（唯一 / 稀有 / 魔法 / 普通）
      const r = (order[a.rarity] == null ? 9 : order[a.rarity]) - (order[b.rarity] == null ? 9 : order[b.rarity]);
      if (r) return r;
      // 2) 同一稀有度内：装备后评分提升的排前面
      if (up[b.uid] !== up[a.uid]) return up[b.uid] - up[a.uid];
      // 3) 再按物品等级
      return (b.ilvl || 0) - (a.ilvl || 0);
    });
    /* 空位补到当前容量：容量由仓库等级决定（1 级 60 格，每级 +5），
     * 以前这里写死 60，整理一次就会把仓库升级换来的格子吃掉 */
    const cap = Math.max(p.inventory.length, (G.Town && G.Town.bagCap) ? G.Town.bagCap(p) : 60);
    p.inventory = items.concat(new Array(Math.max(0, cap - items.length)).fill(null));
    UI.dirty.inv = true;
    UI.refreshInventory();
    G.audio.play('ui');
  };

  UI.drinkFromInv = function (i) {
    const p = UI.game.player;
    const it = p.inventory[i];
    if (!it || it.cat !== 'potion') return;
    const cur = p.potions[it.potion];
    p.potions[it.potion] = { tier: Math.max(cur.tier, it.tier), count: (cur.count || 0) + 1 };
    p.inventory[i] = null;
    UI.dirty.inv = true;
    UI.refreshInventory();
    G.log('已存入药水袋：' + it.name, 'dim');
  };

  /* ---------------- 宝石 ---------------- */
  UI.insertGemInto = function (gearItem) {
    if (!gearItem || !gearItem.sockets) { G.log('该装备没有孔位', 'dim'); return false; }
    const idx = gearItem.gems.indexOf(null);
    if (idx < 0) { G.log('所有孔位都已镶嵌', 'dim'); return false; }
    let gem = null, gemIdx = -1;
    const inv = UI.game.player.inventory;
    // 优先使用「手上」拿着的宝石
    if (UI.heldGem) {
      gemIdx = inv.findIndex((x) => x && x.uid === UI.heldGem.uid);
      if (gemIdx >= 0) gem = inv[gemIdx];
      UI.releaseGem(true);
    }
    if (!gem) {
      gemIdx = inv.findIndex((x) => x && x.cat === 'gem');
      if (gemIdx >= 0) gem = inv[gemIdx];
    }
    if (!gem) { G.log('背包里没有宝石', 'dim'); return false; }
    gearItem.gems[idx] = { gem: gem.gem, tier: gem.tier };
    UI.takeFromInv(gemIdx, 1);      // 宝石可堆叠，只消耗 1 颗
    S.derive(UI.game.player);
    UI.dirty.inv = true; UI.dirty.char = true;
    G.audio.play('loot');
    G.log('镶嵌了 ' + D.gemName(gem.gem, gem.tier) + ' → ' + L.displayName(gearItem), 'c-magic');
    UI.refreshInventory();
    return true;
  };

  UI.insertGemFromInv = function (i) {
    const p = UI.game.player;
    const gem = p.inventory[i];
    if (!gem || gem.cat !== 'gem') return;
    const trySlots = (list) => {
      for (let k = 0; k < list.length; k++) {
        const it = list[k];
        if (!it || !it.sockets || it.gems.indexOf(null) < 0) continue;
        it.gems[it.gems.indexOf(null)] = { gem: gem.gem, tier: gem.tier };
        UI.takeFromInv(i, 1);       // 只消耗 1 颗
        S.derive(p);
        UI.dirty.inv = true; UI.dirty.char = true;
        G.audio.play('loot');
        G.log('镶嵌了 ' + D.gemName(gem.gem, gem.tier) + ' → ' + L.displayName(it), 'c-magic');
        UI.refreshInventory();
        return true;
      }
      return false;
    };
    // 优先已装备的有孔装备，其次背包里的装备
    const worn = D.gearSlots().map((s) => p.gear[s]).filter(Boolean);
    if (trySlots(worn)) return;
    if (trySlots(p.inventory.filter((x) => x && x.cat === 'equip'))) return;
    UI.pickUpGem(i);      // 没有可镶嵌的装备 → 改成「拿起」
    G.log('没有可镶嵌的装备：宝石已拿起，点击有孔装备进行镶嵌', 'c-magic');
  };

  /* ============================================================
   *  技能栏
   * ============================================================ */
  UI.buildSkillbar = function () {
    const bar = el('skillbar');
    if (!bar) return;
    bar.innerHTML = '';
    UI.slotRefs = [];
    if (!UI.ready()) return;
    const p = UI.game.player;
    const basicId = p.cls + '_basic';
    const actives = D.activeSkills(p.cls);
    const defs = [basicId].concat(actives);
    /* 技能栏按键提示直接读当前绑定（改键 / 换操作模式后自动跟着变） */
    const keyOf = (act) => G.Settings.actionLabel(act);
    const keys = [keyOf('attack'), keyOf('skill1'), keyOf('skill2'), keyOf('skill3'), keyOf('skill4')];
    defs.forEach((id, i) => {
      const sk = D.SKILLS[id];
      const slot = root.document.createElement('div');
      slot.className = 'slot';
      slot.innerHTML = '<span class="key">' + keys[i] + '</span><span class="ico">' + sk.icon + '</span>' +
        '<span class="lvl"></span><span class="cost">' + (sk.cost ? sk.cost : '') + '</span>' +
        '<div class="cd" hidden><i></i></div><div class="cdtxt"></div>';
      slot.addEventListener('mouseenter', (ev) => UI.skillTooltip(id, ev));
      slot.addEventListener('mousemove', (ev) => UI.skillTooltip(id, ev));
      slot.addEventListener('mouseleave', UI.hideTooltip);
      slot.addEventListener('click', () => {
        const aim = UI.game.aimWorld();
        const pl = UI.game.player;
        pl.facing = G.ang(pl.x, pl.y, aim.x, aim.y);
        G.Skills.cast(UI.game, pl, id, aim);
      });
      bar.appendChild(slot);
      UI.slotRefs.push({ slot, cd: slot.querySelector('.cd'), bar: slot.querySelector('.cd i'), txt: slot.querySelector('.cdtxt'), lvl: slot.querySelector('.lvl'), id, index: i });
    });
    // 法力药水按钮
    const util = el('utilitybar');
    if (util && !el('ubtn-mana')) {
      const b = root.document.createElement('button');
      b.className = 'ubtn';
      b.id = 'ubtn-mana';
      b.dataset.act = 'potionMana';
      b.dataset.label = '法力药水';
      b.innerHTML = '<span class="ico">🔷</span><span class="k"></span><span class="cnt" id="mana-count">0</span>';
      b.addEventListener('click', () => UI.game.usePotion('mana'));
      util.insertBefore(b, util.firstChild);
    }
    UI.refreshKeyHints();
  };

  /* ============================================================
   *  界面上的按键提示
   *  ------------------------------------------------------------
   *  所有「按 X 做某事」的提示都从当前绑定读出来，改键 / 换操作模式后
   *  调用一次 UI.refreshKeyHints() 就会全部更新。
   * ============================================================ */
  UI.KEY_HINTS = [
    ['potion', 'potionLife', '喝生命药水'],
    ['potionMana', 'potionMana', '喝法力药水'],
    ['inventory', 'inventory', '背包'],
    ['character', 'character', '角色'],
    ['vendor', 'vendor', '商人'],
    ['craft', 'craft', '做装工坊'],
    ['stash', 'stash', '仓库'],
    ['town', 'town', '城镇建设'],
    ['settings', 'settings', '设置'],
    ['help', 'help', '帮助'],
    ['map', 'map', '大地图'],
    ['recall', 'recall', '往返城镇 / 深渊'],
  ];
  UI.refreshKeyHints = function () {
    /* 1) 右下角功能按钮上的键位角标与悬浮提示 */
    const util = el('utilitybar');
    if (util) {
      Array.prototype.forEach.call(util.children, (btn) => {
        const act = btn.dataset ? btn.dataset.act : null;
        if (!act) return;
        const def = UI.KEY_HINTS.filter((h) => h[0] === act)[0];
        const label = (btn.dataset && btn.dataset.label) || (def ? def[2] : act);
        const key = G.Settings.actionLabel(act);
        const k = btn.querySelector ? btn.querySelector('.k') : null;
        if (k) k.textContent = key === '未绑定' ? '—' : key;
        btn.title = label + ' [' + key + ']（可在设置里改键）';
      });
    }
    /* 2) HTML 里带 data-key 的静态提示：<b data-key="craft"></b> */
    if (root.document && root.document.querySelectorAll) {
      Array.prototype.forEach.call(root.document.querySelectorAll('[data-key]'), (n) => {
        const act = n.getAttribute('data-key');
        if (!act || act === 'fixed') return;
        n.textContent = G.Settings.actionLabel(act);
      });
    }
    /* 3) 操作模式说明里的按键 */
    const md = el('mode-desc');
    if (md) {
      const mode = G.Settings.MODES.filter((m) => m.id === G.Settings.mode())[0];
      if (mode) md.textContent = UI.modeDesc(mode.id);
    }
    /* 4) 帮助面板里的操作模式两行 */
    const hm = el('help-mode-mouse'), hw = el('help-mode-wasd');
    if (hm) hm.innerHTML = '<b>鼠标模式</b>：鼠标左键移动（按住可持续走位）· ' + G.Settings.actionLabel('attack') +
      ' 普攻 · <b>' + G.Settings.actionLabel('skill1') + ' ' + G.Settings.actionLabel('skill2') + ' ' +
      G.Settings.actionLabel('skill3') + ' ' + G.Settings.actionLabel('skill4') + '</b> 释放技能';
    if (hw) hw.innerHTML = '<b>WASD 模式</b>：<b>' + G.Settings.actionLabel('moveUp') + ' ' + G.Settings.actionLabel('moveLeft') +
      ' ' + G.Settings.actionLabel('moveDown') + ' ' + G.Settings.actionLabel('moveRight') + '</b> 移动 · ' +
      G.Settings.actionLabel('attack') + ' 普攻（不移动）· ' + G.Settings.actionLabel('skill1') + ' 技能1 · <b>' +
      G.Settings.actionLabel('skill2') + ' ' + G.Settings.actionLabel('skill3') + ' ' + G.Settings.actionLabel('skill4') +
      '</b> 释放技能 2/3/4';
    /* 5) 其它按钮上的 [键] */
    const bsTown = el('btn-bs-town');
    if (bsTown) bsTown.textContent = '城镇建设 [' + G.Settings.actionLabel('town') + ']';
  };

  /* 操作模式说明（按键名动态取当前绑定） */
  UI.modeDesc = function (modeId) {
    const k = (a) => G.Settings.actionLabel(a, '未绑定');
    if (modeId === 'wasd') {
      return k('moveUp') + ' ' + k('moveLeft') + ' ' + k('moveDown') + ' ' + k('moveRight') +
        ' 移动，' + k('attack') + ' 普通攻击（不会自动移动），' + k('skill1') + ' 释放技能 1，' +
        k('skill2') + ' / ' + k('skill3') + ' / ' + k('skill4') + ' 释放技能 2 / 3 / 4。';
    }
    // 鼠标模式：移动固定是左键（不可改），其余读绑定
    return '鼠标左键移动（按住可持续走位），' + k('attack') + ' 普通攻击，' +
      k('skill1') + ' / ' + k('skill2') + ' / ' + k('skill3') + ' / ' + k('skill4') + ' 释放四个主动技能。';
  };

  UI.skillTooltip = function (id, ev) {
    UI.showTooltip(UI.skillDetailHTML(id), ev, true);
  };

  UI.updateSkillbar = function () {
    const p = UI.game && UI.game.player;
    if (!p) return;
    UI.slotRefs.forEach((ref) => {
      const sk = D.SKILLS[ref.id];
      const lv = S.skillLevel(p, ref.id);
      const locked = lv <= 0;
      ref.slot.classList.toggle('locked', locked);
      if (ref.lvl) ref.lvl.textContent = locked ? '' : lv;
      const cdMax = (sk.cd || 0) * (1 - p.stats.cdr / 100);
      const cd = p.cds[ref.id] || 0;
      if (cd > 0.01 && cdMax > 0) {
        ref.cd.hidden = false;
        ref.bar.style.height = (cd / cdMax * 100) + '%';
        ref.txt.textContent = cd > 1 ? cd.toFixed(0) : cd.toFixed(1);
      } else if (ref.cd && !ref.cd.hidden) {
        ref.cd.hidden = true;
        ref.txt.textContent = '';
      }
      ref.slot.classList.toggle('ready-glow', !locked && cd <= 0.01 && p.mana >= (sk.cost || 0));
    });
  };

  /* ============================================================
   *  角色面板
   * ============================================================ */
  UI.renderCharacter = function () {
    if (!UI.ready()) return;
    if (!UI.dirty.char && el('panel-character') && el('panel-character').hidden) return;
    const p = UI.game.player;
    const cls = D.classById(p.cls);
    const pts = el('pts-attr');
    if (pts) pts.textContent = p.attrPoints;
    const attrBox = el('attr-list');
    if (attrBox) {
      attrBox.innerHTML = '';
      [['str', '力量', '近战伤害 / 护甲'], ['dex', '敏捷', '暴击 / 远程伤害 / 闪避'], ['int', '智力', '法力 / 法术伤害'], ['vit', '体力', '生命上限']].forEach((a) => {
        const row = root.document.createElement('div');
        row.className = 'attr-row';
        row.innerHTML = '<span class="an">' + a[1] + '</span><span class="av">' + p.attrs[a[0]] + '</span>' +
          '<span class="ad">' + a[2] + '</span><button ' + (p.attrPoints > 0 ? '' : 'disabled') + '>+</button>';
        row.querySelector('button').addEventListener('click', () => {
          if (p.attrPoints <= 0) return;
          p.attrPoints--; p.alloc[a[0]] = (p.alloc[a[0]] || 0) + 1;
          S.derive(p);
          UI.dirty.char = true;
          UI.renderCharacter();
          UI.renderMiniStats();
          G.audio.play('ui');
        });
        attrBox.appendChild(row);
      });
    }
    const der = el('derived-list');
    if (der) {
      const st = p.stats;
      const tough = S.toughness(p, game_mlvl());
      const rows = [
        ['职业', cls.name + ' · ' + cls.title],
        ['等级', p.level + '（' + Math.floor(p.xp) + ' / ' + S.xpToNext(p.level) + '）'],
        ['生命上限', st.maxLife + '（回复 ' + st.lifeRegen.toFixed(1) + '/秒）'],
        ['法力上限', st.maxMana + '（回复 ' + st.manaRegen.toFixed(1) + '/秒）'],
        ['护甲', st.armor + '（减伤 ' + Math.round(S.armorMitigation(st.armor, game_mlvl()) * 100) + '%）'],
        ['抗性', '火 ' + Math.round(st.res.fire) + ' / 冰 ' + Math.round(st.res.cold) + ' / 电 ' + Math.round(st.res.lightning) + ' / 毒 ' + Math.round(st.res.poison)],
        ['<span class="tough">坚韧</span>', Math.round(tough.total) + ' <span class="dim small">（悬停看分项）</span>'],
        ['武器伤害', Math.round(st.weaponMin) + '-' + Math.round(st.weaponMax)],
        ['攻击速度', st.attackSpeed.toFixed(2) + ' 次/秒'],
        ['每秒伤害', Math.round(st.weaponDps)],
        ['暴击 / 暴伤', st.crit.toFixed(1) + '% / ' + Math.round(st.critDmg) + '%'],
        ['移动速度', Math.round(st.moveSpeed)],
        ['伤害加成', '+' + Math.round((st.dmgMult - 1) * 100) + '%'],
        ['范围伤害', '+' + Math.round(st.areaDmg) + '%'],
        ['冷却缩减', Math.round(st.cdr) + '%'],
        ['生命偷取', st.lifeSteal.toFixed(1) + '%'],
        ['法力偷取', (st.manaSteal || 0).toFixed(1) + '%'],
        ['伤害反弹', Math.round(st.thorns)],
        ['闪避', Math.round(st.dodge) + '%'],
        ['闪避充能', (st.dodgeMax || 1) + ' 格（' + S.dodgeRechargeTime(p).toFixed(1) + ' 秒 / 格）'],
        ['闪避键', S.dodgeSwapSkill(p) ? '改为释放「' + (D.SKILLS[S.dodgeSwapSkill(p)].name) + '」' : '翻滚闪避'],
        ['魔法装备掉落', '+' + Math.round(st.mf) + '%'],
        ['金币掉落', '+' + Math.round(st.gf) + '%'],
        ['经验获取', '+' + Math.round(st.xpBonus) + '%'],
        ['所有技能', '+' + st.allSkills],
      ];
      der.innerHTML = rows.map((r) => '<div class="row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('');
      // 悬停「坚韧」→ 展开各类伤害的坚韧明细
      const toughEl = der.querySelector ? der.querySelector('.tough') : null;
      if (toughEl) {
        const html = UI.toughnessHTML(tough);
        toughEl.style.cursor = 'help';
        toughEl.addEventListener('mouseenter', (ev) => UI.showTooltip(html, ev));
        toughEl.addEventListener('mousemove', (ev) => UI.showTooltip(html, ev));
        toughEl.addEventListener('mouseleave', UI.hideTooltip);
      }
    }
    function game_mlvl() { return UI.game.mlvl || 1; }

    /* 技能：点击整行打开该技能的强化窗口（加点与分支都在窗口里操作） */
    const sp = el('pts-skill');
    if (sp) sp.textContent = p.skillPoints;
    const list = el('skill-list');
    if (list) {
      list.innerHTML = '';
      D.classById(p.cls).skills.forEach((id) => {
        const sk = D.SKILLS[id];
        const lv = p.skills[id] | 0;
        const eff = S.skillLevel(p, id);
        const unlocked = p.level >= (sk.reqLevel || 0);
        const picked = UI.branchSummary(p, id);
        const dormant = UI.dormantCount(p, id);
        const row = root.document.createElement('div');
        row.className = 'skill-row clickable' + (unlocked ? '' : ' locked');
        const maxed = lv >= sk.maxLevel;
        row.innerHTML = '<div class="si">' + sk.icon + '</div><div class="sd">' +
          '<div class="sn">' + sk.name + '<span class="lv">' + (lv > 0 ? '已投入 ' + lv + ' / ' + sk.maxLevel + ' 点' : '未学习') + (eff !== lv ? '（装备 +' + (eff - lv) + '）' : '') + '</span></div>' +
          '<div class="sx">' + sk.desc + (sk.cost ? '　消耗 ' + sk.cost + ' 法力' : '') + (sk.cd ? '　冷却 ' + sk.cd + 's' : '') + '</div>' +
          (unlocked ? '' : '<div class="sx c-boss">需要等级 ' + sk.reqLevel + '</div>') +
          '</div><div class="sbr">强化 <b' + (picked ? ' class="good"' : '') + '>' + picked + ' / ' + D.SKILL_TIERS.length + '</b>' +
          (dormant ? '<span class="c-boss">（' + dormant + ' 项失效）</span>' : '') +
          '<span class="sgo">点击查看 ▸</span></div>';
        row.addEventListener('click', () => UI.openSkillWindow(id));
        // 悬浮显示技能说明与加点收益
        row.addEventListener('mouseenter', (ev) => UI.showTooltip(UI.skillDetailHTML(id), ev));
        row.addEventListener('mousemove', (ev) => UI.showTooltip(UI.skillDetailHTML(id), ev));
        row.addEventListener('mouseleave', UI.hideTooltip);
        list.appendChild(row);
      });
      /* 被动 */
      const h = root.document.createElement('h3');
      h.innerHTML = '被动天赋 <b>' + (p.passivePoints || 0) + '</b> 点（每 5 级 +1）';
      list.appendChild(h);
      D.PASSIVES.forEach((ps) => {
        const lv = (p.passives && p.passives[ps.id]) | 0;
        const row = root.document.createElement('div');
        row.className = 'skill-row';
        row.innerHTML = '<div class="si">✦</div><div class="sd"><div class="sn">' + ps.name +
          '<span class="lv">' + lv + ' / ' + ps.max + '</span></div><div class="sx">' + ps.text(Math.max(1, lv)) + '</div></div>' +
          '<button class="btn" ' + ((p.passivePoints || 0) > 0 && lv < ps.max ? '' : 'disabled') + '>+1 点</button>';
        row.querySelector('button').addEventListener('click', () => {
          if ((p.passivePoints || 0) <= 0 || lv >= ps.max) return;
          p.passivePoints--;
          p.passives[ps.id] = lv + 1;
          S.derive(p);
          UI.dirty.char = true;
          UI.renderCharacter();
          UI.renderMiniStats();
          G.audio.play('ui');
        });
        row.addEventListener('mouseenter', (ev) => UI.showTooltip(UI.passiveDetailHTML(ps.id), ev));
        row.addEventListener('mousemove', (ev) => UI.showTooltip(UI.passiveDetailHTML(ps.id), ev));
        row.addEventListener('mouseleave', UI.hideTooltip);
        list.appendChild(row);
      });
    }
    UI.dirty.char = false;
  };

  /* ============================================================
   *  技能强化窗口
   *  ------------------------------------------------------------
   *  点击角色面板里的技能即可打开：主线是技能等级，5/10/15/20 级各有上下
   *  两个互斥分支，25 级在右侧分出三个更强力的分支。
   * ============================================================ */
  const SK_LAYOUT = {
    w: 1000, h: 440,
    iconX: 88, iconY: 220, iconR: 62,
    barX1: 152, barX2: 712, barY: 220,
    tierX: { 5: 254, 10: 368, 15: 482, 20: 596, 25: 712 },
    upY: 112, downY: 328, nodeR: 36,
    strongX: 884, strongY: [104, 220, 336], strongR: 48,
  };
  UI.skLayout = SK_LAYOUT;

  /* 已选分支数 / 因技能等级不足而失效的分支数 */
  UI.branchSummary = function (p, id) {
    if (!p || !D.skillBranches(id)) return 0;
    let n = 0;
    D.SKILL_TIERS.forEach((t) => { if (S.chosenBranch(p, id, t)) n++; });
    return n;
  };
  UI.dormantCount = function (p, id) {
    if (!p || !D.skillBranches(id)) return 0;
    let n = 0;
    D.SKILL_TIERS.forEach((t) => { if (S.branchDormant(p, id, t)) n++; });
    return n;
  };

  /* 分支节点的状态：on（选中生效）/ dormant（选中但失效）/ open（可选）/
   * locked（等级不够）/ blocked（同档位已选别的） */
  UI.branchState = function (p, skillId, tier, index) {
    const tree = D.skillBranches(skillId);
    if (!tree || !tree[tier] || !tree[tier][index]) return 'locked';
    const b = tree[tier][index];
    if (S.chosenBranch(p, skillId, tier) === b.id) return S.branchTierOpen(p, skillId, tier) ? 'on' : 'dormant';
    if (!S.branchTierOpen(p, skillId, tier)) return 'locked';
    if (S.chosenBranch(p, skillId, tier)) return 'blocked';
    return 'open';
  };
  UI.branchStateText = {
    on: '已生效', dormant: '失效（技能等级不足）', open: '可选择',
    locked: '未解锁（技能等级不足）', blocked: '同档位已选择其它分支',
  };

  UI.openSkillWindow = function (id) {
    if (!UI.ready() || !D.SKILLS[id]) return;
    UI.skillWin = id;
    UI.dirty.skill = true;
    const p = UI.game.player;
    if (!p.skillBranches[id]) p.skillBranches[id] = {};
    UI.togglePanel('panel-skill', true);
  };

  /* 加一点技能点（窗口里的 +1 点） */
  UI.addSkillPoint = function (id) {
    const p = UI.game && UI.game.player;
    const sk = D.SKILLS[id];
    if (!p || !sk) return false;
    const lv = p.skills[id] | 0;
    if (p.level < (sk.reqLevel || 0)) { G.log('需要角色等级 ' + sk.reqLevel + ' 才能学习 ' + sk.name + '。', 'c-boss'); G.audio.play('noskill'); return false; }
    if (lv >= sk.maxLevel) { G.log(sk.name + ' 已满级（' + sk.maxLevel + ' 点）。', 'dim'); return false; }
    if (p.skillPoints <= 0) { G.log('没有可用的技能点。', 'c-boss'); G.audio.play('noskill'); return false; }
    p.skillPoints--;
    p.skills[id] = lv + 1;
    S.derive(p);
    UI.dirty.char = true; UI.dirty.skill = true;
    UI.renderCharacter();
    UI.renderSkillWindow();
    UI.updateSkillbar();
    G.audio.play('ui');
    const newly = D.SKILL_TIERS.filter((t) => p.skills[id] === t)[0];
    if (newly) G.log(sk.name + ' 达到 ' + newly + ' 级，解锁新的强化分支！', 'c-rare');
    return true;
  };

  /* 选择强化分支（同档位互斥） */
  UI.pickBranch = function (skillId, tier, index) {
    const p = UI.game && UI.game.player;
    const tree = D.skillBranches(skillId);
    if (!p || !tree || !tree[tier]) return false;
    const b = tree[tier][index];
    if (!b) return false;
    const st = UI.branchState(p, skillId, tier, index);
    if (st === 'on') return false;
    if (st === 'locked') {
      G.log('技能等级不足：' + tier + ' 级分支需要 ' + D.SKILLS[skillId].name + ' 达到 ' + tier + ' 级（装备加成也算）。', 'c-boss');
      G.audio.play('noskill');
      return false;
    }
    if (st === 'blocked') {
      G.log('同一档位只能选择一个分支，想更换请到【深渊向导 塞拉】处洗点。', 'c-boss');
      G.audio.play('noskill');
      return false;
    }
    p.skillBranches[skillId] = p.skillBranches[skillId] || {};
    p.skillBranches[skillId][tier] = b.id;
    S.derive(p);
    UI.dirty.char = true; UI.dirty.skill = true;
    UI.renderSkillWindow();
    UI.renderCharacter();
    G.log('【' + D.SKILLS[skillId].name + '】选择了 ' + tier + ' 级分支：' + b.name + '（' + b.text.join('，') + '）', 'c-rare');
    G.audio.play('levelup');
    return true;
  };

  /* 技能窗口里的「升级收益」：把角色面板提示框里那套数字直接搬进窗口 */
  UI.skillGainHTML = function (p, sk, eff, own) {
    if (own >= sk.maxLevel) {
      return '<div class="skgain maxed">已满级（' + sk.maxLevel + ' 点）' +
        (eff > sk.maxLevel ? '　装备加成后 ' + eff + ' 级（26 级起每级递减）' : '') + '</div>';
    }
    if (p.level < (sk.reqLevel || 0)) {
      return '<div class="skgain bad">需要角色等级 ' + sk.reqLevel + ' 才能学习</div>';
    }
    const next = eff + 1;
    const parts = [];
    if (sk.base != null && sk.base > 0) {
      const cur = eff > 0 ? UI.skillDamageAt(p, sk, eff) : 0;
      const nx = UI.skillDamageAt(p, sk, next);
      const d = nx - cur;
      if (eff > 0) {
        const pct = cur > 0 ? '（+' + (d / cur * 100).toFixed(1) + '%）' : '';
        parts.push('基础伤害 ' + Math.round(cur) + ' → <b>' + Math.round(nx) + '</b>' +
          '　<span class="dim">+' + Math.round(d) + pct + '</span>');
        parts.push('伤害倍率 ' + Math.round(UI.skillMultAt(sk, eff)) + '% → <b>' + Math.round(UI.skillMultAt(sk, next)) + '%</b>');
      } else {
        parts.push('<b class="good">解锁该技能</b>　基础伤害 ' + Math.round(nx));
      }
    }
    if (sk.type === 'buff' && sk.buff) {
      const b = sk.buff;
      const l0 = D.skillScaleLevel(Math.max(1, eff)), l1 = D.skillScaleLevel(Math.max(1, next));
      const d0 = (b.dmg || 0) + (b.perDmg || 0) * (l0 - 1), d1 = (b.dmg || 0) + (b.perDmg || 0) * (l1 - 1);
      const a0 = (b.armor || 0) + (b.perArmor || 0) * (l0 - 1), a1 = (b.armor || 0) + (b.perArmor || 0) * (l1 - 1);
      parts.push('增益伤害 +' + d0.toFixed(0) + '% → <b>+' + d1.toFixed(0) + '%</b>');
      parts.push('护甲 +' + a0.toFixed(0) + ' → <b>+' + a1.toFixed(0) + '</b>');
    }
    if (sk.per) parts.push('<span class="dim">每点成长 +' + sk.per + '% 技能基础值</span>');
    parts.push('<span class="dim">剩余技能点 ' + p.skillPoints + '</span>');
    return '<div class="skgain"><span class="hd">投入下一点（' + own + ' → ' + (own + 1) + '）：</span>' +
      parts.join('　') + '</div>';
  };

  UI.renderSkillWindow = function () {    if (!UI.ready()) return;
    const id = UI.skillWin;
    const sk = id ? D.SKILLS[id] : null;
    const tree = el('sk-tree');
    if (!sk || !tree) return;
    const p = UI.game.player;
    const own = p.skills[id] | 0;
    const eff = S.skillLevel(p, id);
    const gear = eff - own;
    const L = SK_LAYOUT;

    /* ---- 头部 ---- */
    G.text('sk-title', sk.icon + ' ' + sk.name + ' · 强化分支');
    const icon = el('sk-icon');
    if (icon) icon.textContent = sk.icon;
    const nameEl = el('sk-name');
    if (nameEl) {
      nameEl.innerHTML = sk.name + ' <span class="lvbadge">Lv.' + eff + ' / ' + sk.maxLevel + '</span>' +
        (eff > D.SKILL_SOFT_CAP ? ' <span class="softcap">已超 25 级：数值继续提升，但每级等比递减（26 级 95%、27 级 90%…），且不再有新分支</span>' : '');
    }
    const subEl = el('sk-sub');
    if (subEl) {
      const picked = UI.branchSummary(p, id);
      const dormant = UI.dormantCount(p, id);
      subEl.innerHTML = '已投入 <b>' + own + '</b> 点' +
        (gear > 0 ? '　<span class="good">装备 +' + gear + '</span>' : '') +
        '　强化分支 <b' + (picked ? ' class="good"' : '') + '>' + picked + ' / ' + D.SKILL_TIERS.length + '</b>' +
        (dormant ? '　<span class="c-boss">' + dormant + ' 项因等级不足失效</span>' : '') +
        '　<span class="dim">剩余技能点 ' + p.skillPoints + '</span>';
    }
    const descEl = el('sk-desc');
    if (descEl) descEl.textContent = sk.desc;
    const statEl = el('sk-hstats');
    if (statEl) {
      const rows = [];
      if (eff > 0 && sk.base != null && sk.base > 0) {
        const dmg = UI.skillDamageAt(p, sk, eff);
        rows.push('基础伤害 <b>' + Math.round(dmg) + '</b>');
        rows.push('伤害倍率 ' + Math.round(UI.skillMultAt(sk, eff)) + '%');
      }
      if (sk.cost) rows.push('法力 ' + (S.skillShape(p, sk).cost));
      if (sk.cd) rows.push('冷却 ' + (S.skillShape(p, sk).cd || 0).toFixed(1) + 's');
      const mods = S.skillMods(p, id);
      const modTxt = D.modText(mods);
      statEl.innerHTML = rows.join('　') +
        (modTxt.length ? '<div class="skmods">当前强化：' + modTxt.join('　') + '</div>' : '<div class="skmods dim">尚未选择任何强化分支</div>') +
        UI.skillGainHTML(p, sk, eff, own);
    }
    const addBtn = el('sk-add');
    if (addBtn) {
      const maxed = own >= sk.maxLevel;
      const can = p.level >= (sk.reqLevel || 0) && !maxed && p.skillPoints > 0;
      addBtn.disabled = !can;
      addBtn.textContent = maxed ? '已满级（' + sk.maxLevel + '）' : '+1 点（剩余 ' + p.skillPoints + '）';
    }

    /* ---- 连线 ---- */
    let svg = '<svg class="sklines" viewBox="0 0 ' + L.w + ' ' + L.h + '" width="' + L.w + '" height="' + L.h + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">';
    svg += '<line class="bar" x1="' + (L.iconX + L.iconR) + '" y1="' + L.barY + '" x2="' + L.barX2 + '" y2="' + L.barY + '"/>';
    D.SKILL_TIERS.forEach((tier) => {
      const x = L.tierX[tier];
      const on = eff >= tier ? ' on' : '';
      svg += '<line class="tick' + on + '" x1="' + x + '" y1="' + (L.barY - 9) + '" x2="' + x + '" y2="' + (L.barY + 9) + '"/>';
      if (tier !== D.BRANCH_STRONG_TIER) {
        svg += '<line class="link' + on + '" x1="' + x + '" y1="' + L.barY + '" x2="' + x + '" y2="' + (L.upY + L.nodeR) + '"/>';
        svg += '<line class="link' + on + '" x1="' + x + '" y1="' + L.barY + '" x2="' + x + '" y2="' + (L.downY - L.nodeR) + '"/>';
      }
    });
    L.strongY.forEach((y) => {
      svg += '<line class="link strong' + (eff >= D.BRANCH_STRONG_TIER ? ' on' : '') + '" x1="' + L.tierX[D.BRANCH_STRONG_TIER] +
        '" y1="' + L.barY + '" x2="' + (L.strongX - L.strongR) + '" y2="' + y + '"/>';
    });
    svg += '</svg>';
    tree.innerHTML = svg;

    /* ---- 技能本体图标 ---- */
    const bigIcon = root.document.createElement('div');
    bigIcon.className = 'skn skill-self' + (eff > 0 ? ' owned' : '');
    bigIcon.dataset.skill = id;
    bigIcon.style.cssText = nodeStyle(L.iconX, L.iconY, L.iconR);
    bigIcon.innerHTML = '<span class="ico">' + sk.icon + '</span><span class="cap">' + sk.name + '</span>';
    tree.appendChild(bigIcon);

    /* ---- 等级刻度 ---- */
    D.SKILL_TIERS.forEach((tier) => {
      const t = root.document.createElement('div');
      t.className = 'sktick' + (eff >= tier ? ' on' : '') + (tier === D.BRANCH_STRONG_TIER ? ' strong' : '');
      t.textContent = String(tier);
      t.style.cssText = 'left:' + (L.tierX[tier] - 16) + 'px;top:' + (L.barY - 11) + 'px;';
      tree.appendChild(t);
    });

    /* ---- 分支节点 ---- */
    D.SKILL_TIERS.forEach((tier) => {
      const list = D.skillBranches(id)[tier] || [];
      list.forEach((b, i) => {
        const strong = tier === D.BRANCH_STRONG_TIER;
        const x = strong ? L.strongX : L.tierX[tier];
        const y = strong ? L.strongY[i] : (i === 0 ? L.upY : L.downY);
        const r = strong ? L.strongR : L.nodeR;
        const st = UI.branchState(p, id, tier, i);
        const n = root.document.createElement('div');
        n.className = 'skn br ' + st + (strong ? ' strong' : '');
        n.dataset.branch = b.id;
        n.dataset.tier = tier;
        n.dataset.index = i;
        n.dataset.state = st;
        n.style.cssText = nodeStyle(x, y, r);
        n.innerHTML = '<span class="ico">' + b.icon + '</span>' +
          '<span class="cap">' + b.name + '</span>' +
          (strong ? '<span class="lvl">25</span>' : '<span class="lvl">' + tier + '</span>');
        n.addEventListener('mouseenter', () => UI.showBranchDetail(id, tier, i));
        n.addEventListener('click', () => UI.pickBranch(id, tier, i));
        tree.appendChild(n);
      });
    });

    /* ---- 默认详情 ---- */
    const cur = UI.skDetailPick;
    if (cur && cur.skill === id) UI.showBranchDetail(id, cur.tier, cur.index);
    else {
      const det = el('sk-detail');
      if (det) {
        const next = D.SKILL_TIERS.filter((t) => eff < t)[0];
        det.innerHTML = next
          ? '把技能点到 <b>' + next + '</b> 级即可解锁 ' + D.BRANCH_TIER_NAME[next] + '分支（' + next + ' 级）。把光标移到节点上查看效果。'
          : '所有档位的分支都已解锁。把光标移到节点上查看效果；想更换分支需要到【深渊向导 塞拉】处洗点。';
      }
    }
    UI.dirty.skill = false;
  };

  function nodeStyle(x, y, r) {
    return 'left:' + (x - r) + 'px;top:' + (y - r) + 'px;width:' + (r * 2) + 'px;height:' + (r * 2) + 'px;';
  }

  /* 分支详情（窗口底部） */
  UI.showBranchDetail = function (skillId, tier, index) {
    const tree = D.skillBranches(skillId);
    const b = tree && tree[tier] && tree[tier][index];
    const det = el('sk-detail');
    if (!b || !det) return;
    UI.skDetailPick = { skill: skillId, tier: tier, index: index };
    const p = UI.game.player;
    const st = UI.branchState(p, skillId, tier, index);
    const eff = S.skillLevel(p, skillId);
    const others = tree[tier].filter((x, i) => i !== index).map((x) => x.name).join(' / ');
    det.innerHTML = '<div class="skd-hd">' + b.icon + ' <b>' + b.name + '</b>' +
      '<span class="skd-tier' + (b.strong ? ' strong' : '') + '">' + tier + ' 级 · ' + D.BRANCH_TIER_NAME[tier] + '分支</span>' +
      '<span class="skd-state s-' + st + '">' + UI.branchStateText[st] + '</span></div>' +
      '<div class="skd-body">' + b.text.map((t) => '<span class="skd-mod">' + t + '</span>').join('') + '</div>' +
      '<div class="skd-note dim">同档位互斥：' + (others || '无') + '　·　当前 ' + D.SKILLS[skillId].name + ' 等级 ' + eff + ' / 需要 ' + tier +
      (st === 'dormant' ? '　·　<b class="c-boss">装备被取下导致等级不足，该强化暂时不生效</b>' : '') + '</div>';
  };

  UI.bindSkillWindow = function () {
    const add = el('sk-add');
    if (add) add.addEventListener('click', () => { if (UI.skillWin) UI.addSkillPoint(UI.skillWin); });
  };

  /* ============================================================
   *  商店
   * ============================================================ */
  UI.vendorStock = null;
  UI.rollVendorStock = function () {
    const g = UI.game;
    const p = g.player;
    const ilvl = Math.max(3, L.dropIlvl(g.mlvl, p.level));
    const stock = [];
    for (let t = 0; t < 4; t++) {
      const tier = t;
      stock.push({ kind: 'potion', potion: 'life', tier, price: Math.round(30 * Math.pow(3.2, tier)) });
      stock.push({ kind: 'potion', potion: 'mana', tier, price: Math.round(28 * Math.pow(3.2, tier)) });
    }
    for (let i = 0; i < 3; i++) {
      const it = L.makeItem(g.rng, { ilvl: ilvl + 2, rarity: g.rng.chance(0.35) ? 'rare' : 'magic', cls: p.cls, noCommon: true });
      stock.push({ kind: 'equip', item: it, price: L.buyPrice(it) });
    }
    const gemTier = G.clamp(Math.floor(ilvl / 20), 0, 4);
    const gemKey = g.rng.pick(Object.keys(D.GEM_TYPES));
    stock.push({ kind: 'gem', gem: gemKey, tier: gemTier, price: Math.round(120 * Math.pow(2.4, gemTier) )});
    // 通货石（做装材料）
    const orbPool = D.ORBS.filter((o) => o.minMlvl <= Math.max(3, g.mlvl));
    for (let i = 0; i < 2; i++) {
      const o = g.rng.weighted(orbPool, (x) => x.weight);
      stock.push({ kind: 'orb', orb: o.id, price: Math.round(o.price * 2.6), sold: false });
    }
    stock.push({ kind: 'gamble', price: Math.round(400 + ilvl * 90) });
    UI.vendorStock = stock;
    UI.dirty.vendor = true;
  };

  UI.renderVendor = function () {
    if (!UI.dirty.vendor || !UI.ready()) return;
    const box = el('vendor-list');
    if (!box) return;
    if (!UI.vendorStock) UI.rollVendorStock();
    const p = UI.game.player;
    box.innerHTML = '';
    // 出售区：显示背包
    const sellBox = el('vendor-inv');
    if (sellBox) {
      sellBox.innerHTML = '';
      p.inventory.forEach((it, i) => {
        const c = root.document.createElement('div');
        c.className = UI.cellClass(it);
        if (it) {
          c.innerHTML = UI.cellInner(it);
          UI.bindCellEvents(c, () => p.inventory[i], {
            onLeft: () => UI.sellInv(i),
            onRight: (ev) => UI.cellRightClick(i, ev),
            onShift: () => UI.sellInv(i),
          });
        }
        sellBox.appendChild(c);
      });
    }
    UI.vendorStock.forEach((s, idx) => {
      const row = root.document.createElement('div');
      row.className = 'vitem';
      let name = '', icon = '', desc = '';
      if (s.kind === 'potion') {
        name = D.POTIONS[s.potion].name + ' Lv' + (s.tier + 1);
        icon = '🧪';
        desc = '回复 ' + D.POTIONS[s.potion].vals[s.tier];
      } else if (s.kind === 'equip') {
        name = L.displayName(s.item);
        icon = UI.itemGlyph(s.item);
        desc = D.SLOT_BY_ID[s.item.slot] ? D.SLOT_BY_ID[s.item.slot].name : '';
      } else if (s.kind === 'gem') {
        name = D.gemName(s.gem, s.tier);
        icon = '◆';
        desc = D.statText(D.GEM_TYPES[s.gem].stat, D.GEM_TYPES[s.gem].vals[s.tier]);
      } else if (s.kind === 'orb') {
        const o = D.orbById[s.orb];
        name = o.name;
        icon = o.icon;
        desc = o.use + '　—　' + o.desc;
      } else {
        name = '赌一把（随机稀有装备）';
        icon = '🎲';
        desc = '物品等级 ' + Math.max(3, UI.game.mlvl) + '，可能出暗金';
      }
      const col = s.kind === 'equip' ? G.RARITY_COLOR[s.item.rarity] : s.kind === 'gem' ? D.GEM_TYPES[s.gem].color : s.kind === 'orb' ? D.orbById[s.orb].color : '#cbb894';
      row.innerHTML = '<span class="vi">' + icon + '</span><span class="vn" style="color:' + col + '">' + name +
        '<div class="hint">' + desc + '</div></span><span class="vp">' + s.price + ' 金</span>';
      if (p.gold < s.price) row.setAttribute('disabled', 'disabled');
      row.addEventListener('mouseenter', (ev) => {
        if (s.kind === 'equip') UI.tooltip(s.item, ev, { compare: true });
        else if (s.kind === 'orb') UI.tooltip(L.orbItem(s.orb, 1), ev, {});
      });
      row.addEventListener('mousemove', (ev) => {
        if (s.kind === 'equip') UI.tooltip(s.item, ev, { compare: true });
        else if (s.kind === 'orb') UI.tooltip(L.orbItem(s.orb, 1), ev, {});
      });
      row.addEventListener('mouseleave', UI.hideTooltip);
      row.addEventListener('click', () => UI.buy(idx));
      box.appendChild(row);
    });
    UI.dirty.vendor = false;
  };

  UI.buy = function (idx) {
    const g = UI.game, p = g.player;
    const s = UI.vendorStock[idx];
    if (!s) return;
    if (p.gold < s.price) { G.log('金币不足', 'c-boss'); G.audio.play('noskill'); return; }
    let item = null;
    if (s.kind === 'potion') item = L.makePotion(s.potion, s.tier);
    else if (s.kind === 'equip') item = s.item;
    else if (s.kind === 'gem') item = { uid: G.uid(), cat: 'gem', gem: s.gem, tier: s.tier, name: D.gemName(s.gem, s.tier), color: D.GEM_TYPES[s.gem].color };
    else if (s.kind === 'orb') item = L.orbItem(s.orb, 1);
    else {
      const gIlvl = Math.max(3, L.dropIlvl(g.mlvl + 3, p.level + 1));
      const it = L.makeItem(g.rng, { ilvl: gIlvl, rarity: 'rare', cls: p.cls, noCommon: true });
      if (g.rng.chance(0.12)) { const u = L.makeItem(g.rng, { ilvl: gIlvl, rarity: 'unique', cls: p.cls }); if (u.rarity === 'unique') item = u; }
      if (!item) item = it;
    }
    if (!UI.addToInv(item)) return;
    p.gold -= s.price;
    G.audio.play('gold');
    G.log('购买了 ' + (item.cat === 'equip' ? L.displayName(item) : item.name), 'c-' + (item.rarity || 'common'));
    if (s.kind === 'equip' || s.kind === 'gamble') {
      // 出售后从库存移除，或替换
      if (s.kind === 'equip') {
        const n = L.makeItem(g.rng, { ilvl: Math.max(3, g.mlvl) + 2, rarity: 'magic', cls: p.cls, noCommon: true });
        UI.vendorStock[idx] = { kind: 'equip', item: n, price: L.buyPrice(n) };
      }
    }
    UI.dirty.vendor = true; UI.dirty.inv = true;
    UI.refreshInventory();
    UI.renderVendor();
  };

  /* ============================================================
   *  HUD
   * ============================================================ */
  UI.updateHUD = function () {
    const g = UI.game;
    if (!UI.ready()) return;
    const p = g.player;
    const st = p.stats;
    const lifePct = G.clamp(p.life / st.maxLife, 0, 1) * 100;
    const manaPct = G.clamp(p.mana / st.maxMana, 0, 1) * 100;
    const lo = el('orb-life'), mo = el('orb-mana');
    if (lo) {
      lo.querySelector('.orb-fill').style.height = lifePct + '%';
      lo.querySelector('.v').textContent = Math.ceil(p.life);
      lo.querySelector('.m').textContent = st.maxLife;
    }
    if (mo) {
      mo.querySelector('.orb-fill').style.height = manaPct + '%';
      mo.querySelector('.v').textContent = Math.ceil(p.mana);
      mo.querySelector('.m').textContent = st.maxMana;
    }
    const xpf = el('xpfill');
    if (xpf) {
      const need = S.xpToNext(p.level);
      xpf.style.width = G.clamp(p.xp / need, 0, 1) * 100 + '%';
      G.text('xptext', p.level >= D.MAX_LEVEL ? ('Lv.' + p.level + '　已满级') : ('Lv.' + p.level + '　' + Math.floor(p.xp) + ' / ' + need));
    }
    const diff = D.diffOf(g.diffIdx);
    const dEl = el('hud-difficulty');
    if (dEl) { dEl.textContent = diff.name + ' ' + diff.roman; dEl.style.color = diff.color; dEl.style.borderColor = diff.color; }
    const inTown = g.area === 'town';
    const inTrain = g.area === 'training';
    const hud = el('hud');
    if (hud && hud.classList) hud.classList.toggle('hud-town', inTown);
    G.text('hud-floor', inTown ? '余烬营地 · 安全区'
      : inTrain ? ('训练场 · ' + ((D.trainingModeById(g.trainingMode) || {}).name || ''))
        : ('深渊 第 ' + g.floor + ' 层' + (g.map && g.map.isBoss ? ' · BOSS' : '')));
    G.text('hud-mlvl', inTown ? ('存档位 ' + (g.slot + 1)) : ('怪物等级 ' + g.mlvl));
    G.text('gold-val', Math.floor(p.gold));
    G.text('hud-killed', g.killed);
    G.text('hud-total', g.totalMonsters);
    const obj = el('objective');
    if (obj) {
      const K = (a) => '<b>' + G.Settings.actionLabel(a, '—') + '</b>';
      if (inTown) {
        const npc = G.Town.nearestNpc(g.map, p.x, p.y, 110);
        if (npc) obj.innerHTML = '与 <b class="c-rare">' + npc.name + '</b> 交谈：按 ' + K('pickup');
        else if (g.nearGate(110)) obj.innerHTML = '站上 <b class="c-unique">深渊之门</b> 按 ' + K('pickup') + ' 进入地牢';
        else obj.innerHTML = '营地内按 ' + K('town') + ' 建设 · ' + K('craft') + ' 做装 · ' + K('stash') + ' 仓库　南侧是深渊之门';
      } else if (inTrain) obj.innerHTML = '尽情输出吧 —— 假人不会还手也打不死；离开走 <b class="c-rare">传送门</b> 按 ' + K('pickup');
      else if (g.portalOpen) obj.innerHTML = '传送门已开启！前往 <b class="c-rare">紫色漩涡</b> 进入下一层（或按 ' + K('recall') + ' 回城）';
      else if (g.map && g.map.isBoss && g.bossAlive) obj.innerHTML = '击败 <b class="c-boss">BOSS</b> 以开启传送门　<b>' + g.killed + '/' + g.totalMonsters + '</b>';
      else obj.innerHTML = '清除怪物以开启传送门　<b>' + g.killed + '/' + g.totalMonsters + '</b>';
    }
    /* 训练场 DPS 面板：只在训练场显示 */
    const dbox = el('dps-box');
    if (dbox) {
      if (dbox.hidden === inTrain) dbox.hidden = !inTrain;
      if (inTrain) {
        const t = g.train || null;
        const now = g.trainDps ? g.trainDps(5) : 0;
        G.text('dps-now', Math.round(now));
        G.text('dps-peak', Math.round((t && t.peak) || 0));
        G.text('dps-total', Math.round((t && t.total) || 0));
        G.text('dps-detail', t ? (t.hits + ' 次命中' + (t.crits ? '　暴击 ' + t.crits : '')) : '—');
        const md = D.trainingModeById ? D.trainingModeById(g.trainingMode) : null;
        G.text('dps-mode', md ? md.name : '训练场');
      }
    }
    const pc = el('potion-count');
    if (pc) pc.textContent = p.potions.life.count || 0;
    const mc = el('mana-count');
    if (mc) mc.textContent = p.potions.mana.count || 0;

    /* buff */
    const sig = (p.buffs || []).map((b) => b.id + Math.ceil(b.remaining)).join(',') + '|' + (p.dots || []).length;
    if (sig !== UI.buffSig) {
      UI.buffSig = sig;
      const bb = el('buffbar');
      if (bb) {
        bb.innerHTML = '';
        (p.buffs || []).forEach((b) => {
          const d = root.document.createElement('div');
          d.className = 'buff';
          d.innerHTML = '<span>' + (b.icon || '✦') + ' ' + b.name + '</span><span class="t">' + b.remaining.toFixed(0) + 's</span>';
          bb.appendChild(d);
        });
        (p.dots || []).forEach((dot) => {
          const d = root.document.createElement('div');
          d.className = 'buff bad';
          d.innerHTML = '<span>☠ ' + (dot.elem === 'poison' ? '中毒' : dot.elem === 'fire' ? '燃烧' : '流血') + '</span><span class="t">' + dot.remaining.toFixed(0) + 's</span>';
          bb.appendChild(d);
        });
      }
    }
    UI.updateSkillbar();
  };

  /* ============================================================
   *  面板控制
   * ============================================================ */
  UI.bindPanels = function () {
    ['panel-inventory', 'panel-character', 'panel-vendor', 'panel-help',
      'panel-craft', 'panel-stash', 'panel-blacksmith', 'panel-town', 'panel-jeweler', 'panel-rift',
      'panel-respec', 'panel-skill', 'panel-filter', 'panel-confirm', 'panel-training'].forEach((id) => {
      const pnl = el(id);
      if (pnl) pnl.hidden = true;
    });
    Array.prototype.forEach.call(root.document.querySelectorAll ? root.document.querySelectorAll('[data-close]') : [], (b) => {
      b.addEventListener('click', () => UI.togglePanel(b.dataset.close, false));
    });
    /* 通用确认框的两个按钮 */
    const cok = el('btn-confirm-ok');
    if (cok) cok.addEventListener('click', () => UI.confirmResolve(true));
    const bio = el('bind-io');
    if (bio) bio.hidden = true;                 // 自定义按键小窗默认收起
    const cno = el('btn-confirm-cancel');
    if (cno) cno.addEventListener('click', () => UI.confirmResolve(false));
    /* 商人的一键卖出：全部 / 只白装 / 魔法及以下 */
    const sall = el('btn-sell-all');
    if (sall) sall.addEventListener('click', UI.sellAllEquip);
    const sjunk = el('btn-sell-junk');
    if (sjunk) sjunk.addEventListener('click', () => UI.sellJunkRarities(['common'], false));
    const smagic = el('btn-sell-magic');
    if (smagic) smagic.addEventListener('click', () => UI.sellJunkRarities(['common', 'magic'], true));
    const menu = el('panel-menu');
    if (menu) menu.hidden = true;
    const br = el('btn-resume');
    if (br) br.addEventListener('click', () => UI.setPaused(false));
    // 暂停界面 → 游戏设置（保持暂停，关闭设置后回到暂停菜单）
    const bset = el('btn-menu-settings');
    if (bset) bset.addEventListener('click', () => {
      const menu = el('panel-menu');
      if (menu) menu.hidden = true;
      UI.game.paused = true;
      UI._settingsFromMenu = true;
      UI.togglePanel('panel-settings', true);
    });
    const bs = el('btn-save');
    if (bs) bs.addEventListener('click', () => { UI.game.save(); G.log('进度已保存到存档位 ' + (UI.game.slot + 1) + '。', 'c-rare'); });
    const bslots = el('btn-slots');
    if (bslots) bslots.addEventListener('click', () => {
      UI.game.save();
      UI.setPaused(false);
      UI.game.player = null;
      UI.game.started = false;
      UI.showStart();
      UI.buildStart(UI.game);
    });
    const bback = el('btn-back-slots');
    if (bback) bback.addEventListener('click', () => { UI.closePickClass(); UI.buildStart(UI.game); });
    const breset = el('btn-reset');
    if (breset) breset.addEventListener('click', () => {
      const slot = UI.game.slot | 0;
      G.storage.clear(slot);
      UI.setPaused(false);
      UI.game.player = null;
      UI.game.started = false;
      G.log('存档位 ' + (slot + 1) + ' 已删除。', 'c-boss');
      UI.showStart();
      UI.buildStart(UI.game);
    });
  };

  UI.togglePanel = function (id, force, anchor) {
    const pnl = el(id);
    if (!pnl) return;
    const show = force == null ? pnl.hidden : force;
    if (show && UI.needTown(id)) {
      G.log('该服务只在【余烬营地】提供（按 ' + G.Settings.actionLabel('recall', 'T') + ' 回城）。', 'c-boss');
      G.audio.play('noskill');
      return;
    }
    ['panel-inventory', 'panel-character', 'panel-vendor', 'panel-help',
      'panel-craft', 'panel-stash', 'panel-blacksmith', 'panel-town', 'panel-jeweler', 'panel-rift',
      'panel-respec', 'panel-skill', 'panel-filter', 'panel-settings', 'panel-training'].forEach((x) => {
      const n = el(x);
      if (n && x !== id) n.hidden = true;
    });
    pnl.hidden = !show;
    UI.open = show ? id : null;
    // 关掉任何一个面板时顺手收起确认框（＝取消）；确认框自己不走 togglePanel
    if (!show) {
      UI.closeConfirm();
      if (id === 'panel-confirm') UI._confirmCb = null;   // 万一有人直接 toggle 它
    }
    // 过滤器面板一关，导入 / 导出小窗也跟着关
    if (id === 'panel-filter' && !show) { UI.closeFilterIO(); UI.closeAffixPick(); }
    // 设置面板一关，自定义按键小窗也跟着关
    if (id === 'panel-settings' && !show) UI.closeBindIO();
    // 锚点：只有从 NPC / 深渊之门打开的窗口才会因走远而自动关闭
    UI.anchor = show ? (anchor || null) : null;
    if (show) {
      if (id === 'panel-inventory') { UI.dirty.inv = true; UI.refreshInventory(); }
      if (id === 'panel-character') { UI.dirty.char = true; UI.renderCharacter(); }
      if (id === 'panel-vendor') { UI.dirty.vendor = true; UI.renderVendor(); }
      if (id === 'panel-craft') { UI.dirty.craft = true; UI.renderCraft(); }
      if (id === 'panel-stash') { UI.dirty.stash = true; UI.migrateSharedFromStash(); UI.renderStash(); }
      if (id === 'panel-blacksmith') { UI.dirty.bs = true; UI.renderBlacksmith(); }
      if (id === 'panel-town') { UI.dirty.town = true; UI.renderTown(); }
      if (id === 'panel-jeweler') { UI.dirty.jeweler = true; UI.renderJeweler(); }
      if (id === 'panel-rift') { UI.dirty.rift = true; UI.renderRift(); }
      if (id === 'panel-respec') { UI.dirty.rift = true; UI.renderRespec(); }
      if (id === 'panel-skill') { UI.dirty.skill = true; UI.renderSkillWindow(); }
      if (id === 'panel-filter') { UI.renderFilter(); }
      if (id === 'panel-settings') { UI.renderSettings(); }
      G.audio.play('ui');
    } else if (id === 'panel-settings' && UI._settingsFromMenu) {
      // 从暂停界面进来的设置：关闭后回到暂停菜单
      UI._settingsFromMenu = false;
      UI.setPaused(true);
    }
  };

  // 与 NPC 交谈
  UI.openNpcPanel = function (npc) {
    if (!npc) return;
    UI.townFocus = npc.building || null;
    G.audio.play('ui');
    G.log('【' + npc.name + '】' + (npc.title || ''), 'c-rare');
    // 第一次找深渊向导：她分几段讲清这里的规矩（每个存档只触发一次）
    if (npc.id === 'guide') {
      const p = UI.game && UI.game.player;
      const first = !(p && p.guideMet);
      if (p) p.guideMet = true;
      UI.guideIntro = first;
      UI.guidePage = 0;
      if (first) {
        UI.logGuidePage(0);
        if (UI.game && UI.game.save) UI.game.save();
      }
    }
    UI.togglePanel(npc.panel, true, { x: npc.x, y: npc.y, r: 120, name: npc.name });
  };

  // 深渊之门 / 向导
  UI.openRift = function (anchor) {
    if (!UI.ready()) return;
    if (UI.game.area !== 'town') { G.log('只有回到城镇才能使用深渊之门。', 'c-boss'); return; }
    UI.riftFloor = G.clamp(UI.riftFloor || 1, 1, UI.game.maxUnlockedFloor());
    UI.togglePanel('panel-rift', true, anchor || null);
  };

  UI.setPaused = function (on, title, sub) {
    const menu = el('panel-menu');
    if (!menu) return;
    menu.hidden = !on;
    UI.game.paused = on;
    if (!on) UI._settingsFromMenu = false;
    if (on) {
      G.text('menu-title', title || '暂停');
      const s = el('menu-sub');
      if (s) s.innerHTML = sub || '按 Esc 继续游戏';
      const rec = el('menu-record');
      if (rec) {
        const p = UI.game.player;
        const where = UI.game.area === 'town' ? '余烬营地' : '深渊第 ' + UI.game.floor + ' 层';
        rec.innerHTML = '存档位 ' + (UI.game.slot + 1) + '　·　' + D.classById(p.cls).name + ' Lv.' + p.level + '<br>' +
          '位置 ' + where + '　难度 ' + D.diffOf(UI.game.diffIdx).name + '<br>' +
          '击杀 ' + p.kills + '　金币 ' + Math.floor(p.gold) + '　残晶 ' + (p.shards || 0) + '<br>' +
          '游戏时长 ' + Math.floor(p.playTime / 60) + ' 分 ' + Math.floor(p.playTime % 60) + ' 秒';
      }
      G.text('menu-version', UI.versionText());
    } else {
      G.audio.play('ui');
    }
  };

  /* 版本号文案（起始界面 / 暂停界面共用） */
  UI.versionText = function () {
    const v = '暗影深渊 ' + (G.VERSION_TAG || 'v0.0.0');
    return G.HEADLESS ? v : v + '　·　变更记录见 CHANGELOG.md';
  };

  UI.bindUtility = function () {
    const util = el('utilitybar');
    if (!util) return;
    util.addEventListener('click', (ev) => {
      const btn = ev.target.closest ? ev.target.closest('.ubtn') : null;
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'potionLife' || act === 'potion') UI.game.usePotion('life');
      else if (act === 'potionMana') UI.game.usePotion('mana');
      else if (act === 'inventory') UI.togglePanel('panel-inventory');
      else if (act === 'character') UI.togglePanel('panel-character');
      else if (act === 'vendor') UI.togglePanel('panel-vendor');
      else if (act === 'help') UI.togglePanel('panel-help');
      else if (act === 'craft') UI.togglePanel('panel-craft');
      else if (act === 'stash') UI.togglePanel('panel-stash');
      else if (act === 'town') UI.togglePanel('panel-town');
      else if (act === 'map') UI.toggleBigMap();
      else if (act === 'settings') UI.togglePanel('panel-settings');
    });
  };

  UI.bindMouse = function () {
    if (!root.document) return;
    root.document.addEventListener('mouseover', (ev) => {
      const t = ev.target;
      if (t && t.closest) {
        const u = t.closest('.ubtn');
        if (u) u.classList.add('active');
      }
    });
    root.document.addEventListener('mouseout', (ev) => {
      const t = ev.target;
      if (t && t.closest) {
        const u = t.closest('.ubtn');
        if (u) u.classList.remove('active');
      }
    });
  };

  UI.toggleBigMap = function () {
    const mm = el('minimap');
    if (!mm) return;
    mm.classList.toggle('big');
    UI.bigMap = !UI.bigMap;
  };

  /* ============================================================
   *  升级提示 / 死亡
   * ============================================================ */
  UI.levelUpToast = function (level, sub) {
    const t = el('levelup-toast');
    if (!t) return;
    G.text('levelup-sub', sub || ('等级 ' + level + '　+3 属性点　+1 技能点' + (level % 5 === 0 ? '　+1 天赋点' : '')));
    t.hidden = true;
    // 触发重播动画
    void t.offsetWidth;
    t.hidden = false;
    clearTimeout(UI._lvlTimer);
    UI._lvlTimer = setTimeout(() => { t.hidden = true; }, 2200);
  };

  /* ============================================================
   *  起始界面 / 存档位
   * ============================================================ */
  const fmtTime = (sec) => {
    const m = Math.floor((sec || 0) / 60);
    if (m < 60) return m + ' 分钟';
    return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
  };

  UI.buildStart = function (game) {
    UI.startSlot = null;
    const box = el('class-pick');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    const back = el('btn-back-slots');
    if (back) back.hidden = true;
    const hint = el('ss-hint');
    if (hint) hint.textContent = '选择一个存档位。最多可以同时培养 ' + G.SAVE_SLOTS + ' 个角色。';
    UI.buildSlots(game);
  };

  UI.buildSlots = function (game) {
    const box = el('slot-list');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = '';
    let used = 0, firstFree = -1;
    G.storage.list().forEach((meta, i) => {
      if (!meta) {
        if (firstFree < 0) firstFree = i;
        return;                                  // 空位不单独占一行，最后统一给一个「+ 新存档」
      }
      used++;
      const card = root.document.createElement('div');
      card.className = 'slot-banner';
      const cls = D.classById(meta.cls) || { name: '未知', glyph: '?' };
      const diff = D.diffOf(meta.diffIdx);
      /* 显示这个角色到达过的最深渊层数（不是当前所在地） */
      const deep = Math.max(1, Math.round(meta.maxFloor || meta.floor || 1));
      const when = meta.ts ? new Date(meta.ts) : null;
      const no = (i + 1) + ' - ' + cls.name;      // 序号 - 人物名（用职业名，例：1 - 野蛮人）
      card.innerHTML =
        '<div class="sb-glyph">' + cls.glyph + '</div>' +
        '<div class="sb-lines">' +
        '<div class="sb-l1"><span class="sb-name">' + no + '</span>' +
        '<span class="sb-lv">等级 ' + meta.level + '</span>' +
        '<span class="sb-time">游戏时间 ' + fmtTime(meta.playTime) + '</span></div>' +
        '<div class="sb-l2"><span>深渊层数 ' + deep + '　' +
        '<span class="tag diff-tag" style="color:' + diff.color + ';border-color:' + diff.color + '">' + diff.name + '</span></span>' +
        '<span>金币 ' + meta.gold + '　残晶 ' + (meta.shards || 0) + '</span></div>' +
        (when ? '<div class="sb-save">最后保存 ' + when.toLocaleString() + '</div>' : '') +
        '</div>' +
        '<button class="btn danger sb-del" title="删除这个存档">✕</button>';
      card.addEventListener('click', () => UI.loadSlot(i, game));
      const db = card.querySelector ? card.querySelector('.sb-del') : null;
      if (db) db.addEventListener('click', (ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        G.storage.clear(i);
        G.audio.play('ui');
        UI.buildSlots(game);
      });
      box.appendChild(card);
    });
    /* 只有一个「+ 新存档」横幅：点了就用第一个空位 */
    if (firstFree >= 0) {
      const add = root.document.createElement('div');
      add.className = 'slot-banner add';
      add.innerHTML = '<div class="sb-plus">＋</div><div class="sb-lines"><div class="sb-l1"><span class="sb-name">新存档</span></div>' +
        '<div class="sb-l2"><span>点击创建新角色　（空闲存档位 ' + (G.SAVE_SLOTS - used) + ' / ' + G.SAVE_SLOTS + '）</span></div></div>';
      add.addEventListener('click', () => UI.pickClassFor(firstFree, game));
      box.appendChild(add);
    }
  };

  UI.pickClassFor = function (slot, game) {
    UI.startSlot = slot;
    /* 职业选择改成弹出的小窗：存档列表继续留在后面，按钮可以取消 */
    const back = el('btn-back-slots');
    if (back) back.hidden = false;
    const hint = el('ss-hint');
    if (hint) hint.textContent = '存档位 ' + (slot + 1) + '：选择职业，开始新的冒险。';
    const box = el('class-pick');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = '';
    const wrap = root.document.createElement('div');
    wrap.className = 'pick-box';
    const head = root.document.createElement('div');
    head.className = 'pick-hd';
    head.innerHTML = '<b>存档位 ' + (slot + 1) + '</b>　选择职业';
    wrap.appendChild(head);
    const row = root.document.createElement('div');
    row.className = 'pick-cards';
    D.CLASSES.forEach((c) => {
      const card = root.document.createElement('div');
      card.className = 'class-card';
      card.innerHTML = '<div class="glyph">' + c.glyph + '</div>' +
        '<div class="cn">' + c.name + '</div><div class="ct">' + c.title + '</div>' +
        '<div class="cd">' + c.desc + '</div>' +
        '<div class="cs">' + c.weaponHint + '</div>' +
        '<div class="cs">' + D.activeSkills(c.id).map((id) => D.SKILLS[id].icon + D.SKILLS[id].name).join('　') + '</div>';
      card.addEventListener('click', () => {
        G.audio.init();
        G.audio.play('portal');
        game.startClass(c.id, slot);
        UI.hideStart();
      });
      row.appendChild(card);
    });
    wrap.appendChild(row);
    const foot = root.document.createElement('div');
    foot.className = 'pick-foot';
    foot.innerHTML = '<button class="btn" id="btn-pick-cancel">取消</button>';
    wrap.appendChild(foot);
    box.appendChild(wrap);
    const cancel = el('btn-pick-cancel');
    if (cancel) cancel.addEventListener('click', () => UI.closePickClass());
  };

  UI.loadSlot = function (slot, game) {
    G.audio.init();
    if (game.load(slot)) UI.hideStart();
    else G.log('存档位 ' + (slot + 1) + ' 读取失败。', 'c-boss');
  };

  /* 关掉职业选择小窗（回到存档列表） */
  UI.closePickClass = function () {
    const box = el('class-pick');
    if (!box || box.hidden) return false;
    box.hidden = true;
    box.innerHTML = '';
    UI.startSlot = null;
    const back = el('btn-back-slots');
    if (back) back.hidden = true;
    const hint = el('ss-hint');
    if (hint) hint.textContent = '选择一个存档位。最多可以同时培养 ' + G.SAVE_SLOTS + ' 个角色。';
    return true;
  };

  UI.hideStart = function () {
    const s = el('start-screen');
    if (s) s.classList.add('gone');
  };
  UI.showStart = function () {
    const s = el('start-screen');
    if (s) s.classList.remove('gone');
    G.text('ss-version', UI.versionText());
  };

  /* ============================================================
   *  做装工坊（消耗通货石改造装备）
   * ============================================================ */
  UI.bindCraft = function () {
    // 内容全部动态生成
  };

  /* ============================================================
   *  做装工坊：左侧物品栏 / 装备栏，右侧工作台（装备居中 + 通货环绕）
   * ============================================================ */
  const BENCH = { w: 460, h: 470, cx: 230, cy: 224, rx: 172, ry: 178, node: 46 };
  UI.craftLayout = () => BENCH;

  /* 工作台上通货石的摆放顺序：从正上方开始顺时针一圈（按参考图排定）
   * 正上 净化石 → 右上 增幅石 → 右 晋升石 → 右下 炼化石 → 下右 点金石
   * → 下左 裂解石 → 左下 混沌石 → 左 传说石 → 左上 钻孔石
   * 只影响摆放位置，掉落权重等仍以 D.ORBS 为准。 */
  UI.BENCH_ORDER = ['purify', 'augment', 'ascend', 'refine', 'whetstone', 'fracture', 'chaos', 'legend', 'drill'];

  /* 按摆放顺序取出通货（缺项时自动补上，保证不会漏掉任何一种） */
  UI.benchOrbs = function () {
    const out = [];
    UI.BENCH_ORDER.forEach((id) => { if (D.orbById[id]) out.push(D.orbById[id]); });
    D.ORBS.forEach((o) => { if (out.indexOf(o) < 0) out.push(o); });
    return out;
  };

  UI.craftTarget = function () {
    const p = UI.game.player;
    if (!UI.craftUid) return null;
    for (let i = 0; i < p.inventory.length; i++) {
      const it = p.inventory[i];
      if (it && it.uid === UI.craftUid) return { item: it, where: 'inv', index: i };
    }
    const slots = D.gearSlots();
    for (let i = 0; i < slots.length; i++) {
      const it = p.gear[slots[i]];
      if (it && it.uid === UI.craftUid) return { item: it, where: 'gear', slot: slots[i] };
    }
    return null;
  };

  /* 通货数量 = 背包 + 个人仓库 + 跨存档共享仓库 */
  UI.orbStock = function () {
    const p = UI.game.player;
    const out = {};
    const add = (id, n, from) => {
      if (!id || !(n > 0)) return;
      const s = out[id] || (out[id] = { inv: 0, stash: 0, shared: 0, total: 0 });
      s[from] += n;
      s.total += n;
    };
    (p.inventory || []).forEach((it) => { if (it && it.cat === 'orb') add(it.orb, it.count || 1, 'inv'); });
    (p.stash || []).forEach((it) => { if (it && it.cat === 'orb') add(it.orb, it.count || 1, 'stash'); });
    if (G.Shared) {
      D.ORBS.forEach((o) => add(o.id, G.Shared.countOrb(o.id) | 0, 'shared'));
    }
    return out;
  };

  // 消耗 1 个通货：优先背包 → 其次共享仓库 → 最后个人仓库
  UI.takeOrbStock = function (orbId) {
    const p = UI.game.player;
    const inv = p.inventory.findIndex((x) => x && x.cat === 'orb' && x.orb === orbId);
    if (inv >= 0) { UI.takeFromInv(inv, 1); return 'inv'; }
    if (G.Shared && G.Shared.countOrb(orbId) > 0) { G.Shared.takeOrb(orbId, 1); G.Shared.flush(); return 'shared'; }
    const st = (p.stash || []).findIndex((x) => x && x.cat === 'orb' && x.orb === orbId);
    if (st >= 0) {
      const it = p.stash[st];
      it.count = (it.count || 1) - 1;
      if (it.count <= 0) p.stash[st] = null;
      UI.dirty.stash = true;
      return 'stash';
    }
    return null;
  };

  UI.orbStockText = function (s) {
    if (!s) return '没有存货';
    const parts = [];
    if (s.inv) parts.push('背包 ' + s.inv);
    if (s.stash) parts.push('仓库 ' + s.stash);
    if (s.shared) parts.push('共享仓库 ' + s.shared);
    return parts.length ? parts.join('　·　') : '没有存货';
  };

  UI.craftLog = function (msg, cls) {
    UI.craftLines.push({ msg, cls: cls || '' });
    if (UI.craftLines.length > 10) UI.craftLines.shift();
    const box = el('craft-log');
    if (box) box.innerHTML = UI.craftLines.map((l) => '<div class="' + l.cls + '">' + l.msg + '</div>').join('');
  };

  /* 把某件装备放上工作台 */
  UI.setCraftTarget = function (uid) {
    UI.craftUid = uid || null;
    UI.releaseOrb(true);
    UI.dirty.craft = true;
    UI.renderCraft();
  };

  /* 拿起 / 放下通货石 */
  UI.heldOrb = null;
  UI.pickUpOrb = function (orbId) {
    const o = D.orbById[orbId];
    if (!o) return false;
    if (UI.heldOrb && UI.heldOrb.orb === orbId) { UI.releaseOrb(); return false; }
    const stock = UI.orbStock()[orbId];
    if (!stock || stock.total <= 0) {
      UI.craftLog('✕ 没有' + o.name + '了（背包 / 仓库里都没有）。', 'bad');
      G.audio.play('noskill');
      return false;
    }
    UI.heldOrb = { orb: orbId, icon: o.icon, color: o.color, name: o.name };
    G.audio.play('ui');
    G.log('拿起 ' + o.name + ' —— 点击工作台上的装备即可使用（右键 / Esc 取消）', 'c-magic');
    UI.updateHeldOrbCursor();
    UI.renderCraft();
    return true;
  };
  UI.releaseOrb = function (silent) {
    if (!UI.heldOrb) return;
    UI.heldOrb = null;
    UI.updateHeldOrbCursor();
    if (!silent) { G.audio.play('ui'); UI.renderCraft(); }
  };
  UI.updateHeldOrbCursor = function (ev) {
    const node = el('held-orb');
    if (!node) return;
    const h = UI.heldOrb;
    if (!h) { node.hidden = true; return; }
    node.hidden = false;
    node.innerHTML = '<span style="color:' + h.color + '">' + h.icon + '</span>';
    const m = ev || UI.mousePos;
    if (m) { node.style.left = (m.clientX != null ? m.clientX : m.x) + 12 + 'px'; node.style.top = (m.clientY != null ? m.clientY : m.y) + 12 + 'px'; }
  };

  /* 对工作台上的装备使用「手上」的通货石 */
  UI.applyHeldOrb = function () {
    const h = UI.heldOrb;
    if (!h) return false;
    const t = UI.craftTarget();
    if (!t) { UI.craftLog('✕ 先把要改造的装备放上工作台。', 'bad'); G.audio.play('noskill'); return false; }
    return UI.useOrb(h.orb, true);
  };

  UI.renderCraft = function () {
    if (!UI.ready()) return;
    const p = UI.game.player;

    /* ---- 左：物品栏（只有装备可改造，通货/宝石/药水不列出） ---- */
    const invBox = el('craft-inv');
    if (invBox) {
      invBox.innerHTML = '';
      let n = 0;
      p.inventory.forEach((it, i) => {
        if (!it || it.cat !== 'equip') return;
        n++;
        const d = root.document.createElement('div');
        d.className = UI.cellClass(it) + (UI.craftUid === it.uid ? ' bench-on' : '');
        d.innerHTML = '<span style="color:' + G.RARITY_COLOR[it.rarity] + '">' + itemGlyph(it) + '</span>' + UI.socketsHTML(it);
        if (UI.isUpgrade(it)) d.innerHTML += '<span class="up-mark" title="装备后评分提升">▲</span>';
        else if (UI.cantEquip(it)) d.innerHTML += '<span class="cnt" style="color:#ff8f8f">✕</span>';
        UI.bindCellEvents(d, () => it, {
          onLeft: () => { UI.setCraftTarget(it.uid); G.audio.play('ui'); },
          onShift: () => UI.setCraftTarget(it.uid),
          onRight: (ev) => UI.ctx(ev, [
            { label: '放上工作台', action: () => UI.setCraftTarget(it.uid) },
            { label: '装备', action: () => UI.equipFromInv(i) },
          ]),
        });
        invBox.appendChild(d);
      });
      if (!n) {
        const none = root.document.createElement('div');
        none.className = 'hint dim';
        none.textContent = '背包里没有可改造的装备。';
        invBox.appendChild(none);
      }
    }

    /* ---- 左：装备栏 ---- */
    const gearBox = el('craft-gear');
    if (gearBox) {
      gearBox.innerHTML = '';
      D.gearSlots().forEach((s) => {
        const it = p.gear[s];
        const sl = D.SLOT_BY_ID[s];
        const cell = root.document.createElement('div');
        /* 与背包装备栏（UI.refreshEquipDoll）用同一套格子：方形 + 部位图标 + 装备名 */
        cell.className = 'slot-equip' + (it ? ' r-' + it.rarity : ' empty') +
          (it && UI.craftUid === it.uid ? ' bench-on' : '');
        cell.dataset.slot = s;                    // 与背包装备栏共用同一套排布
        const nm = it ? L.displayName(it) : ((sl ? sl.name : s) + ' · 空');
        cell.title = nm;
        cell.innerHTML = '<span class="g">' + (sl ? sl.glyph : '▪') + '</span>' +
          '<span class="nm"' + (it ? ' style="color:' + G.RARITY_COLOR[it.rarity] + '"' : '') + '>' + nm + '</span>' +
          UI.socketsHTML(it);
        if (it) {
          cell.addEventListener('mouseenter', (ev) => UI.tooltip(it, ev, {}));
          cell.addEventListener('mousemove', (ev) => UI.tooltip(it, ev, {}));
          cell.addEventListener('mouseleave', UI.hideTooltip);
          cell.addEventListener('click', () => { UI.setCraftTarget(it.uid); G.audio.play('ui'); });
        }
        gearBox.appendChild(cell);
      });
    }

    /* ---- 右：工作台 ---- */
    const bench = el('craft-bench');
    if (bench) {
      bench.innerHTML = '';
      bench.style.cssText = 'width:' + BENCH.w + 'px;height:' + BENCH.h + 'px;';
      const t = UI.craftTarget();

      // 中央装备
      const center = root.document.createElement('div');
      center.className = 'bench-item' + (t ? ' has' : '') + (UI.heldOrb && t ? ' armed' : '');
      center.style.cssText = 'left:' + (BENCH.cx - 62) + 'px;top:' + (BENCH.cy - 62) + 'px;';
      if (t) {
        const it = t.item;
        center.innerHTML = '<span class="bi-ico" style="color:' + G.RARITY_COLOR[it.rarity] + '">' + itemGlyph(it) + '</span>' +
          UI.socketsHTML(it) +
          '<span class="bi-name" style="color:' + G.RARITY_COLOR[it.rarity] + '">' + L.displayName(it) + '</span>' +
          '<span class="bi-sub dim">' + L.typeName(it) + '　' + L.countAffixes(it, 'prefix') + '前 / ' + L.countAffixes(it, 'suffix') + '后</span>' +
          (UI.heldOrb ? '<span class="bi-hint">点击使用' + UI.heldOrb.name + '</span>' : '');
        center.addEventListener('mouseenter', (ev) => UI.tooltip(it, ev, {}));
        center.addEventListener('mousemove', (ev) => UI.tooltip(it, ev, {}));
        center.addEventListener('mouseleave', UI.hideTooltip);
        center.addEventListener('click', () => UI.applyHeldOrb());
      } else {
        center.innerHTML = '<span class="bi-ico dim">◌</span><span class="bi-name dim">工作台是空的</span>' +
          '<span class="bi-sub dim">从左边点一件装备放上来</span>';
      }
      bench.appendChild(center);

      // 环绕的通货石（顺序见 UI.BENCH_ORDER）
      const stock = UI.orbStock();
      const ring = UI.benchOrbs();
      ring.forEach((o, i) => {
        const s = stock[o.id] || { inv: 0, stash: 0, shared: 0, total: 0 };
        const ang = -Math.PI / 2 + (i / ring.length) * Math.PI * 2;
        const x = BENCH.cx + Math.cos(ang) * BENCH.rx;
        const y = BENCH.cy + Math.sin(ang) * BENCH.ry;
        const n = root.document.createElement('div');
        const state = t ? L.canUseOrb(t.item, o.id) : { ok: false, why: '先选择装备' };
        const held = UI.heldOrb && UI.heldOrb.orb === o.id;
        n.className = 'orb-node' + (held ? ' held' : '') + (s.total > 0 ? '' : ' empty') + (t && !state.ok ? ' no' : '');
        n.dataset.orb = o.id;
        n.dataset.count = s.total;
        n.dataset.ok = (t && state.ok) ? '1' : '0';
        n.style.cssText = 'left:' + (x - BENCH.node / 2) + 'px;top:' + (y - BENCH.node / 2) + 'px;' +
          'width:' + BENCH.node + 'px;height:' + BENCH.node + 'px;border-color:' + o.color + ';color:' + o.color;
        n.innerHTML = '<span class="oc-ico">' + o.icon + '</span><span class="oc-n">' + s.total + '</span>' +
          '<span class="oc-name">' + o.name + '</span>';
        n.addEventListener('mouseenter', (ev) => UI.craftOrbTooltip(o, s, state, t, ev));
        n.addEventListener('mousemove', (ev) => UI.craftOrbTooltip(o, s, state, t, ev));
        n.addEventListener('mouseleave', UI.hideTooltip);
        n.addEventListener('click', () => UI.pickUpOrb(o.id));
        n.addEventListener('contextmenu', (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); UI.releaseOrb(); });
        bench.appendChild(n);
      });
    }

    const sh = el('craft-shards');
    if (sh) sh.textContent = '深渊残晶 ' + (p.shards || 0);
    UI.dirty.craft = false;
  };

  UI.craftOrbTooltip = function (o, s, state, t, ev) {
    let h = '<div class="tname" style="color:' + o.color + '">' + o.icon + ' ' + o.name + '</div>';
    h += '<div class="ttype">通货石　' + o.use + '</div><div class="tsep"></div>';
    h += '<div class="tflavor">' + o.desc + '</div><div class="tsep"></div>';
    h += '<div class="tstat">持有 <b>' + s.total + '</b> 个　<span class="dim">' + UI.orbStockText(s) + '</span></div>';
    if (s.total > 0) h += '<div class="tstat dim">消耗顺序：背包 → 共享仓库 → 个人仓库</div>';
    if (!t) h += '<div class="tstat dim">先把一件装备放上工作台</div>';
    else if (!state.ok) h += '<div class="tstat bad">✕ ' + state.why + '</div>';
    else h += '<div class="tstat good">点击拿起，再点工作台上的装备即可使用</div>';
    h += '<div class="tcmp dim small">拿起后也可以按 Esc / 右键放下</div>';
    UI.showTooltip(h, ev, true);
  };

  /* 使用通货石改造工作台上的装备 */
  UI.useOrb = function (orbId, fromHeld) {
    const p = UI.game.player;
    const t = UI.craftTarget();
    if (!t) { UI.craftLog('请先把一件装备放上工作台。', 'bad'); G.audio.play('noskill'); return false; }
    const chk = L.canUseOrb(t.item, orbId);
    if (!chk.ok) { UI.craftLog('✕ ' + chk.why, 'bad'); G.audio.play('noskill'); return false; }
    const src = UI.takeOrbStock(orbId);
    if (!src) {
      UI.craftLog('✕ 没有' + D.orbById[orbId].name + '了（背包 / 仓库里都没有）。', 'bad');
      G.audio.play('noskill');
      return false;
    }
    const before = L.score(t.item, p.stats);
    const res = L.applyOrb(UI.game.rng, t.item, orbId, { cls: p.cls });
    if (!res.ok) {                                    // 失败就把通货还回去
      UI.craftLog('✕ ' + res.msg, 'bad');
      G.audio.play('noskill');
      UI.giveOrbBack(orbId, src);
      return false;
    }
    if (fromHeld) UI.releaseOrb(true);
    S.derive(p);
    UI.dirty.inv = true; UI.dirty.char = true; UI.dirty.craft = true; UI.dirty.stash = true;
    const after = L.score(t.item, p.stats);
    const where = src === 'stash' ? '（仓库）' : src === 'shared' ? '（共享仓库）' : '';
    UI.craftLog('✔ ' + D.orbById[orbId].name + where + ' → ' + L.displayName(t.item) +
      '（评分 ' + before + ' → ' + after + '）', 'ok');
    res.lines.forEach((l) => UI.craftLog('　· ' + l, ''));
    G.audio.play('lootRare');
    G.log('【做装】' + D.orbById[orbId].name + '：' + L.displayName(t.item) + '（评分 ' + before + ' → ' + after + '）', 'c-' + t.item.rarity);
    UI.refreshInventory();
    UI.renderStash();
    UI.renderCraft();
    if (UI.game.save) UI.game.save();
    return true;
  };

  // 做装失败时把已经扣掉的通货放回原处
  UI.giveOrbBack = function (orbId, src) {
    const p = UI.game.player;
    if (src === 'shared') { G.Shared.addOrb(orbId, 1); G.Shared.flush(); return; }
    if (src === 'stash') { UI.addOrbTo(p.stash, orbId); UI.dirty.stash = true; return; }
    UI.addOrbTo(p.inventory, orbId);
    UI.dirty.inv = true;
  };

  UI.addOrbTo = function (list, orbId) {
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it && it.cat === 'orb' && it.orb === orbId && (it.count || 1) < 9999) { it.count = (it.count || 1) + 1; return true; }
    }
    for (let i = 0; i < list.length; i++) {
      if (!list[i]) { list[i] = L.orbItem(orbId, 1); return true; }
    }
    return false;
  };

  /* ============================================================
   *  通用确认框：用于「镶有宝石的装备」「一键卖 / 一键分解」这类不可逆操作
   * ============================================================ */
  UI.askConfirm = function (opts) {
    opts = opts || {};
    UI._confirmCb = opts.onOk || null;
    const t = el('confirm-title');
    if (t) t.textContent = opts.title || '确认';
    const x = el('confirm-text');
    if (x) x.textContent = opts.text || '';
    const ok = el('btn-confirm-ok');
    if (ok) ok.textContent = opts.okText || '确认';
    /* 直接盖在当前面板上：不走 togglePanel，所以原先打开的铁匠铺 / 商人界面会留着 */
    const box = el('panel-confirm');
    if (box) box.hidden = false;
  };

  // 关掉确认框＝取消；返回 true 表示确实关掉了（给 Esc 用）
  UI.closeConfirm = function () {
    const box = el('panel-confirm');
    if (!box || box.hidden) return false;
    box.hidden = true;
    UI._confirmCb = null;
    return true;
  };

  UI.confirmResolve = function (yes) {
    const cb = yes ? UI._confirmCb : null;
    UI._confirmCb = null;
    const box = el('panel-confirm');
    if (box) box.hidden = true;
    if (typeof cb === 'function') cb();
  };

  /* 镶着宝石的装备：一键卖 / 一键分解都会跳过；单独动它之前先问一次 */
  UI.hasGem = function (it) { return !!(it && it.gems && it.gems.some((g) => !!g)); };

  UI.gemGuard = function (it, verb, run) {
    if (typeof run !== 'function') return;
    if (!UI.hasGem(it)) { run(); return; }
    G.audio.play('noskill');
    UI.askConfirm({
      title: '装备上镶着宝石',
      text: '「' + L.displayName(it) + '」上还镶着宝石，' + verb + '会连宝石一起丢掉。确定要' + verb + '吗？',
      okText: '仍然' + verb,
      onOk: run,
    });
  };

  // 背包里的装备下标；skipGem = true 时把镶宝石的分到 gem 里
  function bagEquips(p, skipGem) {
    const list = [], gem = [];
    (p.inventory || []).forEach((it, i) => {
      if (!it || it.cat !== 'equip') return;
      if (skipGem && UI.hasGem(it)) gem.push(i);
      else list.push(i);
    });
    return { list: list, gem: gem };
  }

  /* ---------------- 一键卖出所有装备（商人） ---------------- */
  UI.sellAllEquip = function () {
    if (!UI.ready()) return;
    const p = UI.game.player;
    const s = bagEquips(p, true);
    if (!s.list.length) { G.log('背包里没有可以出售的装备。', 'dim'); return; }
    let gold = 0;
    s.list.forEach((i) => { gold += L.price(p.inventory[i]); });
    UI.askConfirm({
      title: '一键卖出所有装备',
      text: '卖出背包里的 ' + s.list.length + ' 件装备（含暗金 / 传奇），共 ' + gold + ' 金币。' +
        (s.gem.length ? '另有 ' + s.gem.length + ' 件镶着宝石，会跳过。' : '') +
        '宝石与通货石不会被卖出。',
      okText: '卖出 ' + s.list.length + ' 件',
      onOk: UI.sellAllEquipRun,
    });
  };

  /* 白装 / 魔法及以下的批量卖出（商人面板上的两个按钮）：
   * 跳过镶着宝石的；「魔法及以下」还会保留比身上更好的那件 */
  UI.sellJunkRarities = function (rarities, keepBetter) {
    const p = UI.game.player;
    let gold = 0, n = 0, gem = 0;
    p.inventory.forEach((it, i) => {
      if (!it || it.cat !== 'equip') return;
      if (rarities.indexOf(it.rarity) < 0) return;
      if (UI.hasGem(it)) { gem++; return; }
      if (keepBetter) {
        let slot = it.slot;
        if (slot === 'ring') slot = p.gear.ring1 ? 'ring1' : 'ring2';
        const cur = p.gear[slot];
        if (cur && L.score(it, p.stats) > L.score(cur, p.stats)) return;
      }
      gold += L.price(it);
      p.inventory[i] = null;
      n++;
    });
    p.gold += gold;
    if (n) {
      G.audio.play('gold');
      G.log('一键卖出 ' + n + ' 件装备，获得 ' + gold + ' 金币' + (gem ? '（跳过 ' + gem + ' 件镶着宝石的）' : '') + '。', 'dim');
    } else {
      G.log('没有可以出售的装备。', 'dim');
    }
    UI.dirty.inv = true; UI.dirty.vendor = true; UI.dirty.bs = true;
    UI.refreshInventory();
    if (UI.open === 'panel-vendor') UI.renderVendor();
  };

  UI.sellAllEquipRun = function () {
    const p = UI.game.player;
    const s = bagEquips(p, true);
    let gold = 0, n = 0;
    s.list.forEach((i) => {
      const it = p.inventory[i];
      if (!it) return;
      gold += L.price(it);
      p.inventory[i] = null;
      n++;
    });
    p.gold += gold;
    if (n) {
      G.audio.play('gold');
      G.log('一键卖出 ' + n + ' 件装备，获得 ' + gold + ' 金币' +
        (s.gem.length ? '（跳过 ' + s.gem.length + ' 件镶着宝石的）' : '') + '。', 'c-rare');
    } else {
      G.log('背包里没有可以出售的装备。', 'dim');
    }
    UI.dirty.inv = true; UI.dirty.vendor = true; UI.dirty.bs = true;
    UI.refreshInventory();
    if (UI.open === 'panel-vendor') UI.renderVendor();
  };

  /* ---------------- 一键分解所有装备（铁匠） ---------------- */
  function salvageGain(it) { return Math.max(1, Math.round(L.salvageYield(it) * UI.salvageBonus())); }

  UI.salvageAll = function () {
    if (!UI.ready()) return;
    const p = UI.game.player;
    const s = bagEquips(p, true);
    if (!s.list.length) { G.log('背包里没有可以分解的装备。', 'dim'); return; }
    let gain = 0;
    s.list.forEach((i) => { gain += salvageGain(p.inventory[i]); });
    UI.askConfirm({
      title: '一键分解所有装备',
      text: '分解背包里的 ' + s.list.length + ' 件装备（含暗金 / 传奇），共获得 ' + gain + ' 深渊残晶。' +
        (s.gem.length ? '另有 ' + s.gem.length + ' 件镶着宝石，会跳过。' : ''),
      okText: '分解 ' + s.list.length + ' 件',
      onOk: UI.salvageAllRun,
    });
  };

  UI.salvageAllRun = function () {
    const p = UI.game.player;
    const s = bagEquips(p, true);
    let gain = 0, n = 0;
    s.list.forEach((i) => {
      const it = p.inventory[i];
      if (!it) return;
      gain += salvageGain(it);
      p.inventory[i] = null;
      n++;
    });
    p.shards = (p.shards || 0) + gain;
    if (n) {
      G.audio.play('hit');
      G.log('一键分解 ' + n + ' 件装备，获得 ' + gain + ' 深渊残晶' +
        (s.gem.length ? '（跳过 ' + s.gem.length + ' 件镶着宝石的）' : '') + '。', 'c-magic');
    } else {
      G.log('背包里没有可以分解的装备。', 'dim');
    }
    UI.dirty.inv = true; UI.dirty.bs = true; UI.dirty.town = true;
    UI.refreshInventory();
    if (UI.open === 'panel-blacksmith') UI.renderBlacksmith();
  };

  /* ============================================================
   *  铁匠铺：分解装备
   * ============================================================ */
  UI.bindBlacksmith = function () {
    const j = el('btn-salvage-junk');
    if (j) j.addEventListener('click', () => UI.salvageBulk(['common']));
    const m = el('btn-salvage-magic');
    if (m) m.addEventListener('click', () => UI.salvageBulk(['common', 'magic']));
    const a = el('btn-salvage-all');
    if (a) a.addEventListener('click', UI.salvageAll);
    const t = el('btn-bs-town');
    if (t) t.addEventListener('click', () => UI.togglePanel('panel-town'));
  };

  UI.salvageBonus = function () { return G.Town.salvageBonus(UI.game.player); };

  /* 分解界面与商人 / 工坊统一：直接铺开背包格子，点一下就分解 */
  UI.renderBlacksmith = function () {
    if (!UI.ready()) return;
    const p = UI.game.player;
    G.text('bs-shards', p.shards || 0);
    const bonus = el('bs-bonus');
    if (bonus) bonus.textContent = '铁匠铺 ' + G.Town.level(p, 'forge') + ' 级：分解产出 ×' + UI.salvageBonus().toFixed(2);
    const grid = el('bs-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const inv = p.inventory;
    let count = 0, sum = 0, gemN = 0;
    for (let i = 0; i < inv.length; i++) {
      const it = inv[i];
      const c = root.document.createElement('div');
      c.className = UI.cellClass(it) + (it && it.cat !== 'equip' ? ' dim' : '');
      c.innerHTML = UI.cellInner(it);
      if (it && it.cat === 'equip') {
        const gain = salvageGain(it);
        count++; sum += gain;
        if (UI.hasGem(it)) gemN++;
        c.title = '分解可得 ' + gain + ' 深渊残晶';
        UI.bindCellEvents(c, () => UI.game.player.inventory[i], {
          onLeft: () => UI.salvageAt(i),
          onRight: () => UI.salvageAt(i),
        });
      } else {
        UI.bindCellEvents(c, () => UI.game.player.inventory[i], {
          onLeft: () => G.log('只有装备能分解成残晶。', 'dim'),
          onRight: () => G.log('只有装备能分解成残晶。', 'dim'),
        });
      }
      grid.appendChild(c);
    }
    const sumEl = el('bs-sum');
    if (sumEl) {
      sumEl.textContent = count
        ? ('可分解 ' + count + ' 件　合计 +' + sum + ' 残晶' + (gemN ? '　（' + gemN + ' 件镶宝石，单独分解会先询问）' : ''))
        : '背包里没有可以分解的装备。';
    }
    UI.dirty.bs = false;
  };

  UI.salvageAt = function (i) {
    const p = UI.game.player;
    const it = p.inventory[i];
    if (!it || it.cat !== 'equip') return;
    UI.gemGuard(it, '分解', () => UI.salvageAtRun(i));
  };

  UI.salvageAtRun = function (i) {
    const p = UI.game.player;
    const it = p.inventory[i];
    if (!it || it.cat !== 'equip') return;
    const gain = salvageGain(it);
    p.inventory[i] = null;
    p.shards = (p.shards || 0) + gain;
    G.audio.play('hit');
    G.log('分解 ' + L.displayName(it) + '，获得 ' + gain + ' 深渊残晶。', 'c-magic');
    if (UI.hasGem(it)) G.log('（这件装备上的宝石一起没了）', 'dim');
    UI.dirty.inv = true; UI.dirty.bs = true; UI.dirty.town = true;
    UI.refreshInventory();
    UI.renderBlacksmith();
  };

  UI.salvageBulk = function (rarities) {
    const p = UI.game.player;
    let n = 0, gain = 0, gem = 0;
    p.inventory.forEach((it, i) => {
      if (!it || it.cat !== 'equip') return;
      if (rarities.indexOf(it.rarity) < 0) return;
      // 镶着宝石的不动它
      if (UI.hasGem(it)) { gem++; return; }
      // 比已装备更好的留下
      const cur = L.equippedFor(p, it);
      if (cur && L.score(it, p.stats) > L.score(cur, p.stats)) return;
      gain += salvageGain(it);
      p.inventory[i] = null; n++;
    });
    p.shards = (p.shards || 0) + gain;
    G.log(n ? ('分解了 ' + n + ' 件装备，获得 ' + gain + ' 深渊残晶。' + (gem ? '（跳过 ' + gem + ' 件镶着宝石的）' : ''))
      : '没有可分解的装备。', n ? 'c-magic' : 'dim');
    UI.dirty.inv = true; UI.dirty.bs = true; UI.dirty.town = true;
    UI.refreshInventory();
    UI.renderBlacksmith();
  };

  /* ============================================================
   *  仓库
   * ============================================================ */
  UI.bindStash = function () {
    const tabs = root.document.querySelectorAll ? root.document.querySelectorAll('#panel-stash .tab') : [];
    Array.prototype.forEach.call(tabs, (b) => b.addEventListener('click', () => UI.setStashTab(b.dataset.tab)));
    const dep = el('btn-deposit-all');
    if (dep) dep.addEventListener('click', () => UI.depositAllShared());
  };

  UI.renderStash = function () {
    if (!UI.ready()) return;
    const p = UI.game.player;
    const cap = G.Town.stashCap(p);
    if (!Array.isArray(p.stash)) p.stash = [];
    if (p.stash.length !== cap) {
      const ns = p.stash.slice(0, cap);
      while (ns.length < cap) ns.push(null);
      p.stash = ns;
    }
    const capEl = el('stash-cap');
    if (capEl) capEl.textContent = '容量 ' + cap + ' 格　（升级仓库可扩容）';
    const invBox = el('stash-inv');
    if (invBox) {
      invBox.innerHTML = '';
      p.inventory.forEach((it, i) => {
        const c = root.document.createElement('div');
        c.className = UI.cellClass(it);
        if (it) {
          c.innerHTML = UI.cellInner(it);
          UI.bindCellEvents(c, () => it, {
            onLeft: () => UI.moveToStash(i),
            onShift: () => UI.moveAllToStash(),
            onRight: (ev) => UI.cellRightClick(i, ev),
          });
        }
        invBox.appendChild(c);
      });
    }
    const box = el('stash-grid');
    if (box) {
      box.innerHTML = '';
      p.stash.forEach((it, i) => {
        const c = root.document.createElement('div');
        c.className = UI.cellClass(it);
        if (it) {
          c.innerHTML = UI.cellInner(it);
          UI.bindCellEvents(c, () => it, {
            onLeft: () => UI.moveFromStash(i),
            onShift: () => UI.moveFromStash(i),
            onRight: (ev) => UI.ctx(ev, [{ label: '取出到背包', action: () => UI.moveFromStash(i) }]),
          });
        }
        box.appendChild(c);
      });
    }
    UI.renderShared();
    UI.setStashTabsUI();
    UI.dirty.stash = false;
  };

  // 同步标签页的显示状态（不触发递归渲染）
  UI.setStashTabsUI = function () {
    const items = el('stash-page-items');
    const cur = el('stash-page-currency');
    if (items) items.hidden = UI.stashTab !== 'items';
    if (cur) cur.hidden = UI.stashTab !== 'currency';
    const tabs = root.document.querySelectorAll ? root.document.querySelectorAll('#panel-stash .tab') : [];
    Array.prototype.forEach.call(tabs, (b) => { b.className = 'tab' + (b.dataset.tab === UI.stashTab ? ' on' : ''); });
  };

  UI.moveToStash = function (i) {
    const p = UI.game.player;
    const it = p.inventory[i];
    if (!it) return;
    // 通货石与宝石统一进共享仓库页
    if (it.cat === 'orb' || it.cat === 'gem') { UI.depositToShared(i); return; }
    const free = p.stash.indexOf(null);
    if (free < 0) { G.log('仓库已满！升级仓库可以扩容。', 'c-boss'); G.audio.play('noskill'); return; }
    p.stash[free] = it;
    p.inventory[i] = null;
    UI.dirty.inv = true; UI.dirty.stash = true;
    UI.refreshInventory(); UI.renderStash();
  };

  UI.moveFromStash = function (i) {
    const p = UI.game.player;
    const it = p.stash[i];
    if (!it) return;
    if (!UI.addToInv(it)) return;
    p.stash[i] = null;
    UI.dirty.inv = true; UI.dirty.stash = true;
    UI.refreshInventory(); UI.renderStash();
  };

  UI.moveAllToStash = function () {
    const p = UI.game.player;
    let n = 0;
    for (let i = 0; i < p.inventory.length; i++) {
      const it = p.inventory[i];
      if (!it) continue;
      if (it.cat === 'orb' || it.cat === 'gem') { UI.depositToShared(i); n++; continue; }
      const free = p.stash.indexOf(null);
      if (free < 0) break;
      p.stash[free] = it;
      p.inventory[i] = null; n++;
    }
    G.log(n ? ('存入了 ' + n + ' 组物品（通货与宝石进入共享仓库）。') : '仓库已满。', n ? 'dim' : 'c-boss');
    UI.dirty.inv = true; UI.dirty.stash = true;
    UI.refreshInventory(); UI.renderStash();
  };

  /* ============================================================
   *  共享仓库：通货石与宝石（跨存档位、可堆叠到 9999）
   * ============================================================ */
  UI.stashTab = 'items';

  UI.setStashTab = function (tab) {
    UI.stashTab = tab === 'currency' ? 'currency' : 'items';
    UI.dirty.stash = true;
    UI.renderStash();
  };

  /* 把背包某格的通货 / 宝石存进共享仓库（受 9999 上限限制） */
  UI.depositToShared = function (i) {
    const p = UI.game.player;
    const it = p.inventory[i];
    if (!it) return 0;
    let put = 0;
    if (it.cat === 'orb') put = G.Shared.addOrb(it.orb, it.count || 1);
    else if (it.cat === 'gem') put = G.Shared.addGem(it.gem, it.tier, it.count || 1);
    else return 0;
    const left = (it.count || 1) - put;
    if (put > 0) {
      if (left > 0) it.count = left; else p.inventory[i] = null;
      G.audio.play('ui');
      if (left > 0) G.log('共享仓库已满（每种上限 ' + G.Shared.MAX + '），剩余 ' + left + ' 个留在背包。', 'c-boss');
    } else {
      G.log('共享仓库该物品已达上限 ' + G.Shared.MAX + ' 个。', 'c-boss');
      G.audio.play('noskill');
    }
    G.Shared.flush();
    UI.dirty.inv = true; UI.dirty.stash = true; UI.dirty.craft = true; UI.dirty.jeweler = true;
    UI.refreshInventory(); UI.renderStash();
    return put;
  };

  /* 把背包里所有通货 / 宝石一次性存入共享仓库 */
  UI.depositAllShared = function () {
    const p = UI.game.player;
    let kinds = 0, total = 0;
    p.inventory.forEach((it, i) => {
      if (!it || (it.cat !== 'orb' && it.cat !== 'gem')) return;
      const put = UI.depositToShared(i);
      if (put > 0) { kinds++; total += put; }
    });
    // 顺带把物品仓库里遗留的通货 / 宝石也搬过来
    const moved = UI.migrateSharedFromStash();
    if (total || moved) G.log('存入共享仓库：' + total + ' 个（' + kinds + ' 组）' + (moved ? '，另从物品仓库整理出 ' + moved + ' 个' : ''), 'c-rare');
    else G.log('背包里没有通货石或宝石。', 'dim');
    G.Shared.flush();
    UI.dirty.inv = true; UI.dirty.stash = true;
    UI.refreshInventory(); UI.renderStash();
  };

  /* 旧存档 / 手动放进物品仓库的通货与宝石 → 自动搬进共享仓库 */
  UI.migrateSharedFromStash = function () {
    const p = UI.game.player;
    if (!Array.isArray(p.stash)) return 0;
    let moved = 0;
    for (let i = 0; i < p.stash.length; i++) {
      const it = p.stash[i];
      if (!it || (it.cat !== 'orb' && it.cat !== 'gem')) continue;
      const n = it.count || 1;
      const put = it.cat === 'orb' ? G.Shared.addOrb(it.orb, n) : G.Shared.addGem(it.gem, it.tier, n);
      if (put <= 0) continue;
      moved += put;
      if (put < n) it.count = n - put; else p.stash[i] = null;
    }
    if (moved) G.Shared.flush();
    return moved;
  };

  /* 从共享仓库取出（1 个 / 一整叠） */
  UI.withdrawShared = function (kind, key, all) {
    const p = UI.game.player;
    const gem = kind === 'gem' ? G.Shared.parseGemKey(key) : null;
    let want;
    if (kind === 'orb') want = all ? G.Shared.countOrb(key) : 1;
    else want = all ? G.Shared.countGem(gem.gem, gem.tier) : 1;
    if (want <= 0) return;
    // 背包空间：已有同种堆叠时可以继续叠加
    const same = p.inventory.filter((x) => x && x.cat === kind &&
      (kind === 'orb' ? x.orb === key : (x.gem === gem.gem && x.tier === gem.tier)))[0];
    if (!same && UI.firstEmpty() < 0) { G.log('背包已满！', 'c-boss'); G.audio.play('noskill'); return; }
    const take = kind === 'orb' ? G.Shared.takeOrb(key, want) : G.Shared.takeGem(gem.gem, gem.tier, want);
    if (take <= 0) return;
    UI.addToInv(kind === 'orb' ? L.orbItem(key, take) : L.makeGemOf(gem.gem, gem.tier, take));
    G.Shared.flush();
    G.audio.play('ui');
    UI.dirty.inv = true; UI.dirty.stash = true; UI.dirty.craft = true; UI.dirty.jeweler = true;
    UI.refreshInventory(); UI.renderStash();
  };

  UI.renderShared = function () {
    // 通货石
    const orbBox = el('shared-orbs');
    if (orbBox) {
      orbBox.innerHTML = '';
      D.ORBS.forEach((o) => {
        const n = G.Shared.countOrb(o.id);
        const c = root.document.createElement('div');
        c.className = 'scell' + (n ? ' has' : '');
        c.innerHTML = '<span class="si" style="color:' + o.color + '">' + o.icon + '</span>' +
          '<span class="sn">' + o.name + '</span>' +
          '<span class="sc">' + n + '</span>';
        c.addEventListener('mouseenter', (ev) => UI.tooltip(L.orbItem(o.id, 1), ev, {}));
        c.addEventListener('mousemove', (ev) => UI.tooltip(L.orbItem(o.id, 1), ev, {}));
        c.addEventListener('mouseleave', UI.hideTooltip);
        c.addEventListener('click', (ev) => UI.withdrawShared('orb', o.id, ev.shiftKey));
        orbBox.appendChild(c);
      });
    }
    // 宝石
    const gemBox = el('shared-gems');
    if (gemBox) {
      gemBox.innerHTML = '';
      Object.keys(D.GEM_TYPES).forEach((gem) => {
        const t = D.GEM_TYPES[gem];
        for (let tier = 0; tier < 5; tier++) {
          const n = G.Shared.countGem(gem, tier);
          const c = root.document.createElement('div');
          c.className = 'scell gem' + (n ? ' has' : '') + ' t' + tier;
          c.innerHTML = '<span class="si" style="color:' + t.color + '">' + D.gemGlyph(tier) + '</span>' +
            '<span class="sn">' + D.GEM_TIER_SHORT[tier] + t.name + '</span>' +
            '<span class="sc">' + n + '</span>';
          c.addEventListener('mouseenter', (ev) => UI.gemTooltip(gem, tier, ev));
          c.addEventListener('mousemove', (ev) => UI.gemTooltip(gem, tier, ev));
          c.addEventListener('mouseleave', UI.hideTooltip);
          c.addEventListener('click', (ev) => UI.withdrawShared('gem', G.Shared.gemKey(gem, tier), ev.shiftKey));
          gemBox.appendChild(c);
        }
      });
    }
    const stat = el('shared-summary');
    if (stat) {
      stat.innerHTML = '共享仓库：通货 <b>' + G.Shared.totalOrbs() + '</b> 个　宝石 <b>' + G.Shared.totalGems() +
        '</b> 颗　<span class="dim small">（每种上限 ' + G.Shared.MAX + '，所有存档位共用）</span>';
    }
  };


  /* ============================================================
   *  珠宝匠：宝石合成（6 种宝石 × 5 个品质的进度面板）
   * ============================================================ */
  UI.bindJeweler = function () {
    const all = el('btn-gem-all');
    if (all) all.addEventListener('click', () => UI.combineAllGems());
    const pull = el('btn-gem-pull-all');
    if (pull) pull.addEventListener('click', () => UI.removeAllGems());
  };

  /* ---------------- 取下已镶嵌的宝石 ---------------- */
  // 所有带宝石的装备（身上 + 背包 + 仓库）
  UI.socketedItems = function () {
    const p = UI.game.player;
    const out = [];
    D.gearSlots().forEach((s) => {
      const it = p.gear[s];
      if (it && it.gems && it.gems.some(Boolean)) out.push({ item: it, where: '已装备', slot: D.SLOT_BY_ID[s] ? D.SLOT_BY_ID[s].name : s });
    });
    p.inventory.forEach((it) => { if (it && it.cat === 'equip' && it.gems && it.gems.some(Boolean)) out.push({ item: it, where: '背包', slot: '' }); });
    if (Array.isArray(p.stash)) p.stash.forEach((it) => { if (it && it.cat === 'equip' && it.gems && it.gems.some(Boolean)) out.push({ item: it, where: '仓库', slot: '' }); });
    return out;
  };

  UI.removeGemFrom = function (item, idx) {
    const p = UI.game.player;
    if (!item || !item.gems || !item.gems[idx]) return false;
    const g = item.gems[idx];
    item.gems[idx] = null;
    UI.addToInv(L.makeGemOf(g.gem, g.tier, 1));
    S.derive(p);
    UI.dirty.inv = true; UI.dirty.char = true; UI.dirty.jeweler = true; UI.dirty.stash = true;
    G.audio.play('loot');
    G.log('取下 ' + D.gemName(g.gem, g.tier) + '（来自 ' + L.displayName(item) + '）', 'c-magic');
    UI.refreshInventory();
    UI.renderJeweler();
    return true;
  };

  UI.removeAllGems = function () {
    const list = UI.socketedItems();
    let n = 0;
    list.forEach((e) => {
      e.item.gems.forEach((g, i) => { if (g && UI.removeGemFrom(e.item, i)) n++; });
    });
    if (!n) G.log('没有已镶嵌的宝石。', 'dim');
    else G.log('共取下 ' + n + ' 颗宝石。', 'c-rare');
    UI.dirty.inv = true; UI.dirty.jeweler = true;
    UI.refreshInventory();
    UI.renderJeweler();
  };

  // 统计背包里每种宝石的数量（同种同品质会堆叠）
  UI.gemCounts = function () {
    const p = UI.game.player;
    const map = {};
    p.inventory.forEach((it) => {
      if (!it || it.cat !== 'gem') return;
      const k = it.gem + '_' + it.tier;
      map[k] = (map[k] || 0) + (it.count || 1);
    });
    return map;
  };

  UI.renderJeweler = function () {
    if (!UI.ready()) return;
    const counts = UI.gemCounts();
    let total = 0, ready = 0;
    for (const k in counts) total += counts[k];
    Object.keys(D.GEM_TYPES).forEach((gem) => {
      for (let t = 0; t < 4; t++) if ((counts[gem + '_' + t] || 0) >= 3) ready++;
    });
    const sum = el('jewel-summary');
    if (sum) {
      sum.innerHTML = '背包宝石 <b>' + total + '</b> 颗　·　可合成 <b class="' + (ready ? 'c-rare' : 'dim') + '">' + ready + '</b> 处　' +
        '<span class="dim small">（3 颗同种同品质 → 1 颗更高品质）</span>';
    }
    const allBtn = el('btn-gem-all');
    if (allBtn) {
      if (ready > 0) allBtn.removeAttribute('disabled'); else allBtn.setAttribute('disabled', 'disabled');
    }

    const box = el('jeweler-list');
    if (!box) return;
    box.innerHTML = '';
    Object.keys(D.GEM_TYPES).forEach((gem) => {
      const t = D.GEM_TYPES[gem];
      const row = root.document.createElement('div');
      row.className = 'jewel-row';
      let slots = '';
      for (let tier = 0; tier < 5; tier++) {
        const n = counts[gem + '_' + tier] || 0;
        const can = n >= 3 && tier < 4;
        const cls = 'jslot' + (n ? ' has' : '') + (can ? ' ready' : '') + ' t' + tier;
        slots += '<div class="' + cls + '" data-gem="' + gem + '" data-tier="' + tier + '">' +
          '<span class="jg">' + D.gemGlyph(tier) + '</span>' +
          '<span class="jt">' + D.GEM_TIER_SHORT[tier] + '</span>' +
          '<span class="jc">' + (n ? '×' + n : '—') + '</span>' +
          '<span class="js">' + D.statText(t.stat, t.vals[tier]).replace(/^\+\S+\s*/, '+') + '</span>' +
          (can ? '<span class="jgo">合成 →</span>' : '') +
          '</div>';
      }
      row.innerHTML = '<div class="jewel-name" style="color:' + t.color + '">' +
        '<span class="jg-big">' + D.gemGlyph(4) + '</span>' + t.name +
        '<div class="dim small">' + (D.STATS[t.stat] ? D.STATS[t.stat].name : t.stat) + '</div></div>' +
        '<div class="jewel-slots">' + slots + '</div>';
      Array.prototype.forEach.call(row.querySelectorAll ? row.querySelectorAll('.jslot') : [], (cell) => {
        const g = cell.dataset.gem;
        const tier = parseInt(cell.dataset.tier, 10);
        cell.addEventListener('mouseenter', (ev) => UI.gemTooltip(g, tier, ev));
        cell.addEventListener('mousemove', (ev) => UI.gemTooltip(g, tier, ev));
        cell.addEventListener('mouseleave', UI.hideTooltip);
        cell.addEventListener('click', () => UI.combineGems(g, tier));
      });
      box.appendChild(row);
    });
    UI.renderGemPull();
    UI.dirty.jeweler = false;
  };

  // 右侧「已镶嵌宝石」列表
  UI.renderGemPull = function () {
    const box = el('gem-pull-list');
    if (!box) return;
    const list = UI.socketedItems();
    box.innerHTML = '';
    const cnt = el('gem-pull-count');
    if (cnt) cnt.textContent = list.length ? ('共 ' + list.length + ' 件装备带宝石') : '';
    const allBtn = el('btn-gem-pull-all');
    if (allBtn) {
      if (list.length) allBtn.removeAttribute('disabled'); else allBtn.setAttribute('disabled', 'disabled');
    }
    if (!list.length) {
      const none = root.document.createElement('div');
      none.className = 'hint dim';
      none.textContent = '没有已镶嵌的宝石。装备上镶错的宝石可以在这里取下来。';
      box.appendChild(none);
      return;
    }
    list.forEach((e) => {
      const row = root.document.createElement('div');
      row.className = 'pull-row';
      let gems = '';
      e.item.gems.forEach((g, i) => {
        if (!g) return;
        gems += '<button class="gem-chip" data-i="' + i + '" style="color:' + D.GEM_TYPES[g.gem].color + '">' +
          D.gemGlyph(g.tier) + ' ' + D.gemName(g.gem, g.tier) + ' ✕</button>';
      });
      row.innerHTML = '<div class="pr-name" style="color:' + G.RARITY_COLOR[e.item.rarity] + '">' +
        (e.slot || L.displayName(e.item)) + '<span class="dim small"> · ' + e.where + '</span></div>' +
        '<div class="pr-gems">' + gems + '</div>';
      Array.prototype.forEach.call(row.querySelectorAll ? row.querySelectorAll('.gem-chip') : [], (b) => {
        b.addEventListener('click', () => UI.removeGemFrom(e.item, parseInt(b.dataset.i, 10)));
      });
      box.appendChild(row);
    });
  };

  // 合成槽位的悬浮说明
  UI.gemTooltip = function (gem, tier, ev) {
    const t = D.GEM_TYPES[gem];
    const n = UI.gemCounts()[gem + '_' + tier] || 0;
    let h = '<div class="tname" style="color:' + t.color + '">' + D.gemGlyph(tier) + ' ' + D.gemName(gem, tier) +
      ' <span class="lvbadge">' + (tier + 1) + ' / 5 级</span></div>';
    h += '<div class="ttype">持有 ×' + n + '</div><div class="tsep"></div>';
    h += '<div class="tstat">镶嵌效果：' + D.statText(t.stat, t.vals[tier]) + '</div>';
    if (tier < 4) {
      h += '<div class="tstat dim">下一品质：' + D.statText(t.stat, t.vals[tier + 1]) + '</div>';
      h += '<div class="tsep"></div>';
      if (n >= 3) h += '<div class="tstat good">点击合成：消耗 3 颗 → 1 颗 ' + D.gemName(gem, tier + 1) + '</div>';
      else h += '<div class="tstat bad">还差 ' + (3 - n) + ' 颗才能合成</div>';
    } else {
      h += '<div class="tstat good">已是最高品质</div>';
    }
    UI.showTooltip(h, ev, true);
  };

  // 从背包扣除 n 颗指定宝石，返回实际扣除数量
  UI.takeGems = function (gem, tier, n) {
    const p = UI.game.player;
    let need = n;
    for (let i = 0; i < p.inventory.length && need > 0; i++) {
      const it = p.inventory[i];
      if (!it || it.cat !== 'gem' || it.gem !== gem || it.tier !== tier) continue;
      const take = Math.min(need, it.count || 1);
      it.count = (it.count || 1) - take;
      need -= take;
      if (it.count <= 0) p.inventory[i] = null;
    }
    return n - need;
  };

  UI.combineGems = function (gem, tier) {
    if (tier >= 4) { G.audio.play('noskill'); return false; }
    const have = UI.gemCounts()[gem + '_' + tier] || 0;
    if (have < 3) { G.audio.play('noskill'); return false; }
    UI.takeGems(gem, tier, 3);
    const made = L.makeGemOf(gem, tier + 1, 1);
    UI.addToInv(made);
    G.audio.play('lootRare');
    G.log('合成成功：3 颗' + D.gemName(gem, tier) + ' → ' + made.name, 'c-magic');
    UI.dirty.inv = true; UI.dirty.jeweler = true;
    UI.refreshInventory(); UI.renderJeweler();
    return true;
  };

  // 从最低品质开始反复合成，直到再也合不动
  UI.combineAllGems = function () {
    let made = 0;
    for (let pass = 0; pass < 40; pass++) {
      let acted = false;
      for (let tier = 0; tier < 4; tier++) {
        Object.keys(D.GEM_TYPES).forEach((gem) => {
          while ((UI.gemCounts()[gem + '_' + tier] || 0) >= 3) {
            if (UI.combineGems(gem, tier)) { made++; acted = true; } else break;
          }
        });
      }
      if (!acted) break;
    }
    if (!made) G.log('没有可以合成的宝石（需要同种同品质 3 颗）。', 'dim');
    else G.log('一键合成完成，共合成 ' + made + ' 次。', 'c-rare');
    UI.dirty.inv = true; UI.dirty.jeweler = true;
    UI.refreshInventory(); UI.renderJeweler();
  };

  /* ============================================================
   *  城镇建设
   * ============================================================ */
  UI.bindTown = function () { };

  UI.renderTown = function () {
    if (!UI.ready()) return;
    const p = UI.game.player;
    G.text('town-gold', Math.floor(p.gold));
    G.text('town-shards', p.shards || 0);
    const box = el('town-buildings');
    if (!box) return;
    box.innerHTML = '';
    D.BUILDINGS.forEach((b) => {
      const lv = G.Town.level(p, b.id);
      const maxed = lv >= b.max;
      const cost = maxed ? null : G.Town.upgradeCost(b.id, lv + 1);
      const can = maxed ? false : (p.gold >= cost.gold && (p.shards || 0) >= cost.shards);
      const card = root.document.createElement('div');
      card.className = 'bcard' + (maxed ? ' maxed' : '') + (UI.townFocus === b.id ? ' hl' : '');
      card.innerHTML =
        '<div class="bg" style="color:' + b.color + '">' + b.glyph + '</div>' +
        '<div class="bd">' +
        '<div class="bn">' + b.name + '<span class="bl">Lv.' + lv + ' / ' + b.max + '</span></div>' +
        '<div class="bx">' + b.desc + '</div>' +
        '<div class="bc">当前：' + b.perk(lv) + '</div>' +
        (maxed ? '<div class="bc">已达最高等级</div>'
          : '<div class="bc">升级至 Lv.' + (lv + 1) + '：<b>' + b.perk(lv + 1) + '</b><br>' +
            '花费 <b>' + cost.gold + '</b> 金币 + <b class="shard">' + cost.shards + '</b> 深渊残晶</div>') +
        '<button class="btn" ' + (can ? '' : 'disabled') + '>' + (maxed ? '已满级' : (can ? '升级' : (p.gold < cost.gold ? '金币不足' : '残晶不足'))) + '</button>' +
        '</div>';
      const btn = card.querySelector ? card.querySelector('button') : null;
      if (btn) btn.addEventListener('click', () => UI.upgradeBuilding(b.id));
      box.appendChild(card);
    });
    UI.townFocus = null;
    UI.dirty.town = false;
  };

  UI.upgradeBuilding = function (id) {
    const p = UI.game.player;
    const r = G.Town.upgrade(p, id);
    if (!r.ok) { G.log('无法升级：' + r.msg, 'c-boss'); G.audio.play('noskill'); return; }
    const b = D.buildingById[id];
    G.audio.play('levelup');
    S.derive(p);
    UI.dirty.inv = true; UI.dirty.char = true; UI.dirty.town = true;
    G.log('★ ' + b.name + ' 升级至 Lv.' + r.level + '：' + b.perk(r.level), 'c-unique');
    if (UI.game.shake) UI.game.shake(5);
    UI.renderTown();
    UI.refreshInventory();
    if (UI.game.save) UI.game.save();
  };

  /* ============================================================
   *  深渊向导 / 深渊之门
   * ============================================================ */
  UI.bindRift = function () {
    const step = (d) => {
      const max = UI.game.maxUnlockedFloor();
      UI.riftFloor = G.clamp((UI.riftFloor || 1) + d, 1, max);
      UI.renderRift();
    };
    const a = el('rift-minus'); if (a) a.addEventListener('click', () => step(-10));
    const b = el('rift-minus1'); if (b) b.addEventListener('click', () => step(-1));
    const c = el('rift-plus1'); if (c) c.addEventListener('click', () => step(1));
    const d = el('rift-plus'); if (d) d.addEventListener('click', () => step(10));
    const e = el('rift-enter'); if (e) e.addEventListener('click', () => UI.enterDungeon());
  };

  UI.renderRift = function () {
    if (!UI.ready()) return;
    const g = UI.game;
    const p = g.player;
    const max = g.maxUnlockedFloor();
    UI.riftFloor = G.clamp(UI.riftFloor || 1, 1, max);
    G.text('rift-floor', '第 ' + UI.riftFloor + ' 层');
    const diff = D.diffOf(g.diffIdx);
    const info = el('rift-info');
    if (info) {
      info.innerHTML = '最深层数记录：<b>' + max + '</b>　当前难度：<b style="color:' + diff.color + '">' +
        diff.name + '</b>　<span class="dim">存档位 ' + (g.slot + 1) + '</span>';
    }

    /* 难度选择：与层数彻底分开，逐档解锁 */
    const box = el('rift-diffs');
    if (box) {
      box.innerHTML = '';
      const unlocked = g.maxUnlockedDiff();
      D.DIFFICULTIES.forEach((d, i) => {
        const card = root.document.createElement('div');
        const on = i === g.diffIdx;
        const can = i <= unlocked;
        const need = i > 0 ? D.diffUnlock(i) : null;
        card.className = 'dcard' + (on ? ' on' : '') + (can ? '' : ' locked');
        card.dataset.diff = i;
        card.dataset.on = on ? '1' : '0';
        card.dataset.locked = can ? '0' : '1';
        card.style.borderColor = on ? d.color : '';
        const needTxt = !can
          ? '未解锁：在<b style="color:' + D.diffOf(need.diff).color + '">' + D.diffOf(need.diff).name +
            '</b> 难度击败第 <b>' + need.floor + '</b> 层的领主'
          : (on ? '当前难度' : '点击切换');
        const cleared = (p.diffCleared && p.diffCleared[i]) | 0;
        card.innerHTML =
          '<div class="dn" style="color:' + d.color + '">' + d.name + '<span class="dr">' + d.roman + '</span></div>' +
          '<div class="dd">怪物生命 ×' + d.hp + '　伤害 ×' + d.dmg + '<br>掉落率 ×' + d.drop + '　掉落品质 +' + d.quality + '</div>' +
          '<div class="dl' + (can ? '' : ' bad') + '">' + needTxt +
          (cleared ? '<br><span class="dim">本难度已清到第 ' + cleared + ' 层</span>' : '') + '</div>';
        if (can && !on) {
          card.addEventListener('click', () => {
            const r = g.setDiff(i);
            if (!r.ok) { G.log('该难度尚未解锁。', 'c-boss'); G.audio.play('noskill'); return; }
            G.log('难度切换为【' + d.name + '】：怪物生命 ×' + d.hp + '、伤害 ×' + d.dmg + '，掉落率 ×' + d.drop + '、掉落品质 +' + d.quality + '。', 'c-rare');
            G.audio.play('ui');
            UI.renderRift();
            UI.updateHUD();
            if (g.save) g.save();
          });
        }
        box.appendChild(card);
      });
    }

    const dEl = el('rift-diff');
    if (dEl) {
      const mlvl = G.mlvlOf(UI.riftFloor, g.diffIdx);
      const boss = UI.riftFloor % 5 === 0;
      dEl.innerHTML = '怪物等级约 <b>' + mlvl + '</b>　掉落品质 <b>+' + diff.quality + '</b>' +
        (boss ? '　·　<b class="c-boss">BOSS 层</b>' : '') +
        '<br><span class="dim">层数决定怪物等级；难度在其之上加成生命 / 伤害 / 掉落。</span>';
    }
    UI.dirty.rift = false;
  };

  /* ============================================================
   *  洗点（深渊向导 · 塞拉）
   *  ------------------------------------------------------------
   *  费用 = 金币 + 深渊残晶：
   *   · 属性点：只随人物等级增长
   *   · 被动天赋：随人物等级 + 该被动已投入点数
   *   · 技能：随人物等级 + 该技能已投入点数（装备给的技能等级不计入）
   * ============================================================ */
  UI.respecAffordable = function (p, cost) {
    return p.gold >= cost.gold && (p.shards || 0) >= cost.shards;
  };
  UI.canAffordText = function (p, cost) {
    const lack = [];
    if (p.gold < cost.gold) lack.push('金币不足');
    if ((p.shards || 0) < cost.shards) lack.push('深渊残晶不足');
    return lack.join('、');
  };

  UI.spend = function (p, cost) {
    p.gold -= cost.gold;
    p.shards = (p.shards || 0) - cost.shards;
  };

  /* 属性点洗点：退还全部已分配属性点 */
  UI.respecAttr = function () {
    const p = UI.game && UI.game.player;
    if (!p) return false;
    const total = (p.alloc.str | 0) + (p.alloc.dex | 0) + (p.alloc.int | 0) + (p.alloc.vit | 0);
    if (total <= 0) { G.log('还没有分配过属性点。', 'dim'); return false; }
    const cost = D.respecCost.attr(p.level);
    if (!UI.respecAffordable(p, cost)) { G.log('洗点失败：' + UI.canAffordText(p, cost), 'c-boss'); G.audio.play('noskill'); return false; }
    UI.spend(p, cost);
    p.alloc = { str: 0, dex: 0, int: 0, vit: 0 };
    p.attrPoints += total;
    S.derive(p);
    UI.dirty.char = true; UI.dirty.rift = true;
    UI.renderCharacter();
    UI.renderRespec();
    G.renderMiniStats && UI.renderMiniStats();
    G.log('已重置属性点：退还 ' + total + ' 点（花费 ' + cost.gold + ' 金币 + ' + cost.shards + ' 深渊残晶）。', 'c-rare');
    G.audio.play('levelup');
    return true;
  };

  /* 被动天赋洗点：退还该被动已投入的点数 */
  UI.respecPassive = function (id) {
    const p = UI.game && UI.game.player;
    const ps = D.passiveById[id];
    if (!p || !ps) return false;
    const lv = (p.passives && p.passives[id]) | 0;
    if (lv <= 0) return false;
    const cost = D.respecCost.passive(p.level, lv);
    if (!UI.respecAffordable(p, cost)) { G.log('洗点失败：' + UI.canAffordText(p, cost), 'c-boss'); G.audio.play('noskill'); return false; }
    UI.spend(p, cost);
    p.passives[id] = 0;
    p.passivePoints = (p.passivePoints || 0) + lv;
    S.derive(p);
    UI.dirty.char = true; UI.dirty.rift = true;
    UI.renderCharacter();
    UI.renderRespec();
    G.log('已重置被动【' + ps.name + '】：退还 ' + lv + ' 点（花费 ' + cost.gold + ' 金币 + ' + cost.shards + ' 深渊残晶）。', 'c-rare');
    G.audio.play('levelup');
    return true;
  };

  /* 技能洗点：退还该技能已投入的点数，并清空它的强化分支 */
  UI.respecSkill = function (id) {
    const p = UI.game && UI.game.player;
    const sk = D.SKILLS[id];
    if (!p || !sk) return false;
    const lv = S.investedPoints(p, id);          // 只看手动投入，装备加成不算
    const branches = UI.branchSummary(p, id);
    if (lv <= 0 && branches <= 0) return false;
    const cost = D.respecCost.skill(p.level, lv);
    if (!UI.respecAffordable(p, cost)) { G.log('洗点失败：' + UI.canAffordText(p, cost), 'c-boss'); G.audio.play('noskill'); return false; }
    UI.spend(p, cost);
    p.skills[id] = 0;
    if (p.skillBranches) delete p.skillBranches[id];
    p.skillPoints += lv;
    S.derive(p);
    UI.dirty.char = true; UI.dirty.rift = true; UI.dirty.skill = true;
    UI.renderCharacter();
    UI.renderRespec();
    UI.updateSkillbar();
    if (UI.open === 'panel-skill' && UI.skillWin === id) UI.renderSkillWindow();
    G.log('已重置技能【' + sk.name + '】：退还 ' + lv + ' 点技能点、清空 ' + branches + ' 个强化分支（花费 ' +
      cost.gold + ' 金币 + ' + cost.shards + ' 深渊残晶）。', 'c-rare');
    G.audio.play('levelup');
    return true;
  };

  UI.guidePage = 0;
  // 把第 n 段引导写进日志（翻页时调用）
  UI.logGuidePage = function (n) {
    const pages = (G.Town && G.Town.GUIDE_PAGES) || [];
    const pg = pages[G.clamp(n | 0, 0, pages.length - 1)];
    if (!pg) return;
    G.log('—— ' + pg.title + ' ——', 'c-rare');
    pg.lines.forEach((line, i) => G.log(line, i === pg.lines.length - 1 ? 'c-rare' : 'dim'));
  };
  // 翻页
  UI.guideNext = function (d) {
    const pages = (G.Town && G.Town.GUIDE_PAGES) || [];
    const idx = G.clamp((UI.guidePage | 0) + d, 0, Math.max(0, pages.length - 1));
    if (idx === UI.guidePage) return;
    UI.guidePage = idx;
    UI.logGuidePage(idx);
    UI.renderRespec();
    G.audio.play('ui');
  };

  UI.renderRespec = function () {    if (!UI.ready()) return;
    const p = UI.game.player;
    G.text('rs-gold', Math.floor(p.gold));
    G.text('rs-shards', p.shards || 0);

    /* 向导对白：第一次见面逐页讲清楚，之后只留一句提示 */
    const say = el('guide-say');
    if (say) {
      const pages = G.Town.GUIDE_PAGES || [];
      if (UI.guideIntro && pages.length) {
        const idx = G.clamp(UI.guidePage | 0, 0, pages.length - 1);
        UI.guidePage = idx;
        const pg = pages[idx];
        say.innerHTML = '<div class="gs-name">塞拉 · ' + pg.title + '</div>' +
          '<div class="gs-lines">' + pg.lines.map((l) => '<p>' + l + '</p>').join('') + '</div>' +
          '<div class="gs-foot">' +
          '<button class="btn"' + (idx === 0 ? ' disabled' : '') + ' id="guide-prev">◂ 上一段</button>' +
          '<span class="gs-page">' + (idx + 1) + ' / ' + pages.length + '</span>' +
          (idx < pages.length - 1
            ? '<button class="btn" id="guide-next">继续 ▸</button>'
            : '<button class="btn" id="guide-say-ok">我记住了</button>') +
          '</div>';
      } else {
        say.innerHTML = '<div class="gs-name">塞拉</div><div class="gs-lines short"><p>' + G.Town.GUIDE_SHORT + '</p></div>' +
          '<button class="btn" id="guide-say-again">再说一遍</button>';
      }
    }

    /* 属性点 */
    const attrBox = el('rs-attr');
    if (attrBox) {
      const total = (p.alloc.str | 0) + (p.alloc.dex | 0) + (p.alloc.int | 0) + (p.alloc.vit | 0);
      const cost = D.respecCost.attr(p.level);
      const ok = total > 0 && UI.respecAffordable(p, cost);
      attrBox.innerHTML = '<div class="rs-line"><span class="rs-n">属性点</span>' +
        '<span class="rs-d">已分配 <b>' + total + '</b> 点（力量 ' + (p.alloc.str | 0) + ' / 敏捷 ' + (p.alloc.dex | 0) +
        ' / 智力 ' + (p.alloc.int | 0) + ' / 体力 ' + (p.alloc.vit | 0) + '）</span>' +
        '<span class="rs-c">' + UI.costHTML(cost, p) + '</span>' +
        '<button class="btn" id="rs-attr-btn" ' + (ok ? '' : 'disabled') + '>重置属性</button></div>';
    }

    /* 被动天赋 */
    const passBox = el('rs-passives');
    if (passBox) {
      const rows = [];
      D.PASSIVES.forEach((ps) => {
        const lv = (p.passives && p.passives[ps.id]) | 0;
        if (lv <= 0) return;
        const cost = D.respecCost.passive(p.level, lv);
        const ok = UI.respecAffordable(p, cost);
        rows.push('<div class="rs-line"><span class="rs-n">✦ ' + ps.name + '</span>' +
          '<span class="rs-d">已投入 <b>' + lv + '</b> / ' + ps.max + ' 点　<span class="dim">' + ps.text(lv) + '</span></span>' +
          '<span class="rs-c">' + UI.costHTML(cost, p) + '</span>' +
          '<button class="btn" data-rs-passive="' + ps.id + '" ' + (ok ? '' : 'disabled') + '>洗点</button></div>');
      });
      passBox.innerHTML = rows.length ? rows.join('') : '<div class="dim small">还没有投入任何被动天赋点。</div>';
    }

    /* 技能 */
    const skBox = el('rs-skills');
    if (skBox) {
      const rows = [];
      D.classById(p.cls).skills.forEach((id) => {
        const sk = D.SKILLS[id];
        const lv = S.investedPoints(p, id);
        const eff = S.skillLevel(p, id);
        const branches = UI.branchSummary(p, id);
        if (lv <= 0 && branches <= 0) return;
        const cost = D.respecCost.skill(p.level, lv);
        const ok = UI.respecAffordable(p, cost);
        rows.push('<div class="rs-line"><span class="rs-n">' + sk.icon + ' ' + sk.name + '</span>' +
          '<span class="rs-d">已投入 <b>' + lv + '</b> 点（洗点只看投入点数，当前实际 ' + eff + ' 级）　强化分支 <b>' + branches + '</b> 个</span>' +
          '<span class="rs-c">' + UI.costHTML(cost, p) + '</span>' +
          '<button class="btn" data-rs-skill="' + id + '" ' + (ok ? '' : 'disabled') + '>洗点</button></div>');
      });
      skBox.innerHTML = rows.length ? rows.join('') : '<div class="dim small">还没有投入任何技能点。</div>';
    }
  };

  UI.costHTML = function (cost, p) {
    return '<b class="' + (p.gold >= cost.gold ? '' : 'c-boss') + '">' + cost.gold + '</b> 金币 + ' +
      '<b class="shard ' + ((p.shards || 0) >= cost.shards ? '' : 'c-boss') + '">' + cost.shards + '</b> 残晶';
  };

  UI.bindRespec = function () {
    const a = el('rs-attr-btn');
    if (a) a.addEventListener('click', () => UI.respecAttr());
    const say = el('guide-say');
    if (say) {
      say.addEventListener('click', (ev) => {
        const t = ev && ev.target;
        if (!t) return;
        if (t.id === 'guide-say-ok') { UI.guideIntro = false; UI.renderRespec(); }
        else if (t.id === 'guide-say-again') { UI.guideIntro = true; UI.guidePage = 0; UI.renderRespec(); }
        else if (t.id === 'guide-next') { UI.guideNext(1); }
        else if (t.id === 'guide-prev') { UI.guideNext(-1); }
      });
    }
    ['rs-passives', 'rs-skills'].forEach((boxId) => {
      const box = el(boxId);
      if (!box) return;
      box.addEventListener('click', (ev) => {
        const t = ev && ev.target;
        if (!t || !t.dataset) return;
        if (t.dataset.rsPassive) UI.respecPassive(t.dataset.rsPassive);
        else if (t.dataset.rsSkill) UI.respecSkill(t.dataset.rsSkill);
      });
    });
  };

  UI.enterDungeon = function () {
    const g = UI.game;
    if (!UI.ready()) return;
    if (g.area !== 'town') return;
    UI.togglePanel('panel-rift', false);
    const f = G.clamp(UI.riftFloor || 1, 1, g.maxUnlockedFloor());
    g.toDungeon(f);
    G.audio.play('portal');
    UI.onAreaChanged();
  };

  UI.onAreaChanged = function () {
    UI.dirty.inv = true; UI.dirty.char = true; UI.dirty.vendor = true;
    UI.dirty.craft = true; UI.dirty.stash = true; UI.dirty.bs = true;
    UI.dirty.town = true; UI.dirty.jeweler = true; UI.dirty.rift = true;
    UI.updateHUD();
  };

  /* ---------------- 自定义按键小窗（盖在设置面板上，默认不展开） ---------------- */
  UI.openBindIO = function () {
    const box = el('bind-io');
    if (!box) return false;
    UI.renderSettings();
    box.hidden = false;
    return true;
  };

  UI.closeBindIO = function () {
    const box = el('bind-io');
    if (!box || box.hidden) return false;
    box.hidden = true;
    UI.capture = null;
    return true;
  };

  /* ============================================================
   *  训练场（戈登）
   * ============================================================ */
  UI.buildTraining = function () {
    const box = el('training-modes');
    if (!box) return;
    box.innerHTML = '';
    D.TRAINING_MODES.forEach((m) => {
      const b = root.document.createElement('button');
      b.className = 'btn big tmode';
      b.dataset.mode = m.id;
      b.innerHTML = m.name + '<span class="dim small">' + m.desc + '</span>';
      b.addEventListener('click', () => UI.startTraining(m.id));
      box.appendChild(b);
    });
    const t = el('btn-training-town');
    if (t) t.addEventListener('click', () => UI.togglePanel('panel-town'));
  };

  UI.startTraining = function (mode) {
    if (!UI.ready()) return;
    if (UI.game.area !== 'town') { G.log('训练场要从营地的训练大师戈登那里进。', 'c-boss'); return; }
    UI.togglePanel('panel-training', false);
    UI.game.enterTraining(mode);
  };

  /* ============================================================
   *  设置：操作模式 / 按键绑定 / 音效
   * ============================================================ */
  UI.bindSettings = function () {
    const box = el('mode-pick');
    if (box) {
      box.innerHTML = '';
      G.Settings.MODES.forEach((m) => {
        const card = root.document.createElement('div');
        card.className = 'mode-card';
        card.dataset.mode = m.id;
        card.innerHTML = '<div class="mg">' + m.glyph + '</div><div class="mn">' + m.name + '</div>' +
          '<div class="md">' + UI.modeDesc(m.id) + '</div>';
        card.addEventListener('click', () => UI.setMode(m.id));
        box.appendChild(card);
      });
    }
    const rst = el('btn-bind-reset');
    if (rst) rst.addEventListener('click', () => {
      G.Settings.reset();
      G.log('按键绑定已恢复默认。', 'c-rare');
      UI.renderSettings();
      UI.buildSkillbar();
      UI.refreshKeyHints();
      G.audio.play('ui');
    });
    const snd = el('btn-sound');
    if (snd) snd.addEventListener('click', () => {
      const on = !G.Settings.data.audio;
      G.Settings.data.audio = on;
      G.Settings.save();
      G.audio.setEnabled(on);
      UI.renderSettings();
      if (on) G.audio.play('ui');
    });
    // 界面显示开关：头顶血条 / 头顶蓝条 / 脚下闪避条
    G.Settings.SHOWS.forEach((s) => {
      const b = el('btn-' + s.id.toLowerCase());
      if (!b) return;
      if (b.classList) b.classList.add('tgl');
      b.addEventListener('click', () => {
        G.Settings.setShow(s.id, !G.Settings.show(s.id));
        UI.renderSettings();
        G.audio.play('ui');
      });
    });
    /* 自定义按键：默认不展开，点按钮才弹出小窗 */
    const bopen = el('btn-bind-open');
    if (bopen) bopen.addEventListener('click', () => { UI.openBindIO(); G.audio.play('ui'); });
    const bclose = el('btn-bind-close');
    if (bclose) bclose.addEventListener('click', () => UI.closeBindIO());
    const bwrap = el('bind-io');
    if (bwrap) bwrap.addEventListener('click', (ev) => { if (ev.target === bwrap) UI.closeBindIO(); });
    /* 音量滑条：拖动时实时生效，松手才写入设置 */
    const mv = el('music-vol');
    if (mv) {
      mv.addEventListener('input', () => {
        G.music.setVolume(Number(mv.value));
        G.text('music-vol-val', Math.round(Number(mv.value)));
      });
      mv.addEventListener('change', () => {
        G.Settings.setMusicVol(Number(mv.value));
        UI.renderSettings();
      });
    }
    const sv = el('sfx-vol');
    if (sv) {
      sv.addEventListener('input', () => {
        G.audio.setVolume(Number(sv.value));
        G.text('sfx-vol-val', Math.round(Number(sv.value)));
        G.audio.play('ui');
      });
      sv.addEventListener('change', () => {
        G.Settings.setSfxVol(Number(sv.value));
        UI.renderSettings();
      });
    }
    UI.bindCapture();
  };

  // 改键：捕获阶段的监听器，优先于游戏输入
  UI.bindCapture = function () {
    if (!root.document || UI._capBound) return;
    UI._capBound = true;
    const finish = (code) => {
      const action = UI.capture;
      UI.capture = null;
      if (!action) return;
      if (code !== undefined) {
        // 同一按键在同一模式下只能绑定一个动作
        G.Settings.ACTIONS.forEach((a) => {
          if (a.id !== action && G.Settings.getBind(a.id) === code) G.Settings.setBind(a.id, null);
        });
        G.Settings.setBind(action, code || null);
        G.Settings.save();
      }
      UI.renderSettings();
      UI.buildSkillbar();
      UI.refreshKeyHints();
      G.audio.play('ui');
    };
    root.document.addEventListener('keydown', (ev) => {
      if (!UI.capture) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.code === 'Escape') { UI.capture = null; UI.renderSettings(); return; }
      if (ev.code === 'Delete' || ev.code === 'Backspace') { finish(null); return; }
      finish(ev.code);
    }, true);
    root.document.addEventListener('mousedown', (ev) => {
      if (!UI.capture) return;
      ev.preventDefault();
      ev.stopPropagation();
      const code = ev.button === 0 ? 'MouseLeft' : ev.button === 1 ? 'MouseMiddle' : ev.button === 2 ? 'MouseRight' : null;
      if (code) finish(code);
    }, true);
  };

  UI.setMode = function (id) {
    if (!G.Settings.setMode(id)) return;
    G.audio.play('ui');
    UI.anchor = null;
    UI.buildSkillbar();
    UI.updateSkillbar();
    UI.renderSettings();
    UI.refreshKeyHints();
    const def = G.Settings.modeDef(id);
    G.log('操作模式切换为【' + def.name + '】。' + UI.modeDesc(id), 'c-rare');
  };

  UI.renderSettings = function () {
    const box = el('mode-pick');
    if (box) {
      Array.prototype.forEach.call(box.children, (c) => {
        const on = c.dataset.mode === G.Settings.mode();
        c.className = 'mode-card' + (on ? ' on' : '');
      });
    }
    const desc = el('mode-desc');
    if (desc) desc.textContent = G.Settings.modeDef().desc;
    const lb = el('bind-mode-label');
    if (lb) lb.textContent = '（' + G.Settings.modeDef().name + '模式下生效）';
    const bio = el('bind-io-mode');
    if (bio) bio.textContent = '（' + G.Settings.modeDef().name + '模式）';
    const snd = el('btn-sound');
    if (snd) snd.textContent = '音效：' + (G.Settings.data.audio ? '开' : '关');
    /* 音量滑条 */
    const mv = el('music-vol');
    if (mv) { mv.value = G.Settings.musicVol(); G.text('music-vol-val', G.Settings.musicVol()); }
    const sv = el('sfx-vol');
    if (sv) { sv.value = G.Settings.sfxVol(); G.text('sfx-vol-val', G.Settings.sfxVol()); }
    G.Settings.SHOWS.forEach((s) => {
      const b = el('btn-' + s.id.toLowerCase());
      if (!b) return;
      const on = G.Settings.show(s.id);
      b.textContent = s.name + '：' + (on ? '开' : '关');
      b.className = 'btn tgl' + (on ? ' on' : '');
    });

    const list = el('bind-list');
    if (!list) return;
    list.innerHTML = '';
    let group = null;
    G.Settings.ACTIONS.forEach((a) => {
      if (a.group !== group) {
        group = a.group;
        const h = root.document.createElement('div');
        h.className = 'bind-group';
        h.textContent = group;
        list.appendChild(h);
      }
      const code = G.Settings.getBind(a.id);
      const row = root.document.createElement('div');
      row.className = 'bind-row' + (UI.capture === a.id ? ' capturing' : '');
      row.innerHTML = '<span class="ban">' + a.name + '</span>' +
        '<button class="btn bkey' + (code ? '' : ' unbound') + '">' +
        (UI.capture === a.id ? '请按下新按键…' : G.Settings.keyLabel(code)) + '</button>' +
        '<button class="btn bclr" ' + (code ? '' : 'disabled') + '>清除</button>';
      const kb = row.querySelector ? row.querySelector('.bkey') : null;
      if (kb) kb.addEventListener('click', () => {
        UI.capture = a.id;
        UI.renderSettings();
      });
      const cb = row.querySelector ? row.querySelector('.bclr') : null;
      if (cb) cb.addEventListener('click', () => {
        G.Settings.setBind(a.id, null);
        G.Settings.save();
        UI.renderSettings();
        UI.buildSkillbar();
      });
      list.appendChild(row);
    });
    const warn = el('bind-warn');
    if (warn) {
      const miss = ['attack', 'skill1'].filter((id) => !G.Settings.getBind(id));
      warn.textContent = miss.length ? '⚠ 有核心按键未绑定，可能会导致无法战斗。' : '';
    }
  };

  UI.fatal = function (err) {
    const f = el('fatal');
    if (!f) return;
    f.hidden = false;
    f.textContent = '暗影深渊 ' + (G.VERSION_TAG || '') + ' 发生错误：\n' + (err && err.stack ? err.stack : err);
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
