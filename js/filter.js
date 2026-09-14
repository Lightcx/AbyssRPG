/* ============================================================
 *  暗影深渊 · filter.js
 *  装备过滤器：自定义规则决定背包 / 仓库 / 商店里装备的显示状态
 *  ------------------------------------------------------------
 *  · 最多 20 条规则，靠前的规则优先生效（命中即决定，不再往下看）
 *  · 每条规则可以包含多条「细则」，同一规则内的细则必须全部满足
 *  · 规则动作：显示 / 高亮显示 / 隐藏
 *  · 「隐藏」的装备：地面上不显示也不捡（自动吸取 / F 拾取 / 点击都拦下），
 *    背包与仓库里照常显示，只在格子外圈加一道暗色边框
 *  · 支持导出、导入（JSON 文本），点面板上的按钮才弹出文本框
 * ============================================================ */
(function (root) {
  'use strict';
  const G = root.G;
  const D = G.DATA;
  const F = (G.Filter = {});

  F.KEY = 'shadow-abyss-filters-v1';          // 过滤器库（存在本地，跨存档共通）
  F.LEGACY_KEY = 'shadow-abyss-filter-v1';    // 旧版「只有一个过滤器」的数据，读到时自动迁移
  F.MAX_RULES = 20;
  F.MAX_FILTERS = 12;                          // 最多同时保存几个过滤器
  F.NAME_MAX = 16;                             // 过滤器名字最长几个字

  F.ACTIONS = [
    { id: 'normal', name: '显示' },
    { id: 'show', name: '高亮显示' },
    { id: 'hide', name: '隐藏' },
  ];
  F.actionName = (id) => (F.ACTIONS.filter((a) => a.id === id)[0] || F.ACTIONS[0]).name;

  const RARITY = [
    { id: 'common', name: '普通（白）' },
    { id: 'magic', name: '魔法（蓝）' },
    { id: 'rare', name: '稀有（黄）' },
    { id: 'unique', name: '暗金 / 传奇' },
  ];
  const SLOT_GROUPS = [
    { id: 'weapon', name: '武器' },
    { id: 'offhand', name: '副手' },
    { id: 'helm', name: '头盔' },
    { id: 'chest', name: '胸甲' },
    { id: 'gloves', name: '手套' },
    { id: 'boots', name: '靴子' },
    { id: 'belt', name: '腰带' },
    { id: 'ring', name: '戒指' },
    { id: 'amulet', name: '项链' },
    { id: 'armor', name: '任意护甲' },
    { id: 'jewelry', name: '戒指 / 项链' },
  ];

  /* 细则类型：ops 决定可用的比较方式，value 决定输入控件；
   * 有数值输入的细则用 min / max 限定范围（界面上的输入框也会带上，并在写入前 clamp） */
  F.COND_TYPES = [
    {
      id: 'ilvl', name: '物品等级', value: 'number', min: 0, max: 100,
      ops: [{ id: '>=', name: '≥' }, { id: '<=', name: '≤' }, { id: '==', name: '=' }],
      get: (it) => it.ilvl,
    },
    {
      id: 'rarity', name: '稀有度', value: 'rarity',
      ops: [{ id: 'is', name: '是' }, { id: 'not', name: '不是' }],
      get: (it) => it.rarity,
    },
    {
      id: 'slot', name: '装备部位', value: 'slot',
      ops: [{ id: 'is', name: '是' }, { id: 'not', name: '不是' }],
      get: (it) => it.slot,
    },
    {
      id: 'type', name: '装备类型', value: 'type',
      ops: [{ id: 'is', name: '是' }],
      get: (it) => (D.baseById(it.base) || {}).type || it.type || '',
    },
    {
      // 勾选词缀 + 「至少包含 N 条」：value 存最少条数，affixIds 存勾选的词缀 id。
      // 只有一种判定方式，所以界面上不显示「比较方式」下拉
      id: 'affix', name: '包含词缀', value: 'affixPick', min: 1, max: 12,
      ops: [{ id: 'has', name: '至少包含' }],
      get: (it, ctx, cond) => F.countAffixes(it, cond),
    },
    {
      id: 'reqLevel', name: '需求等级', value: 'number', min: 0, max: 100,
      ops: [{ id: '>=', name: '≥' }, { id: '<=', name: '≤' }],
      get: (it) => (it.req && it.req.level) | 0,
    },
    {
      // 力量 / 敏捷 / 智力合并成一条：细则里再选具体看哪一项（默认「任意」= 取三者最高）
      id: 'reqAttr', name: '需求属性', value: 'number', min: 0, max: 99999, attrPick: true,
      ops: [{ id: '>=', name: '≥' }, { id: '<=', name: '≤' }],
      get: (it, ctx, cond) => {
        const r = it.req || {};
        const which = (cond && cond.attr) || 'any';
        if (which === 'str' || which === 'dex' || which === 'int') return r[which] | 0;
        return Math.max(r.str | 0, r.dex | 0, r.int | 0);
      },
    },
    {
      id: 'affixCount', name: '词缀条数', value: 'number', min: 0, max: 6,
      ops: [{ id: '>=', name: '≥' }, { id: '<=', name: '≤' }, { id: '==', name: '=' }],
      get: (it) => (it.affixes || []).filter((a) => a.kind !== 'unique').length,
    },
    {
      id: 'quality', name: '词缀品质', value: 'number', min: 0, max: 100,
      ops: [{ id: '>=', name: '≥' }, { id: '<=', name: '≤' }],
      get: (it) => G.Loot.affixQuality(it),
    },
    {
      id: 'sockets', name: '孔位数', value: 'number', min: 0, max: 4,
      ops: [{ id: '>=', name: '≥' }, { id: '<=', name: '≤' }, { id: '==', name: '=' }],
      get: (it) => it.sockets | 0,
    },
    {
      id: 'twoHand', name: '是否双手', value: 'bool',
      ops: [{ id: 'is', name: '是' }],
      get: (it) => !!it.two,
    },
    {
      id: 'canEquip', name: '当前可穿戴', value: 'bool',
      ops: [{ id: 'is', name: '是' }],
      get: () => false,   // 运行时由 ctx 提供
    },
    {
      id: 'score', name: '评分', value: 'number', min: 0, max: 99999,
      ops: [{ id: '>=', name: '≥' }, { id: '<=', name: '≤' }],
      get: (it, ctx) => G.Loot.score(it, ctx && ctx.stats),
    },
  ];
  F.condType = (id) => F.COND_TYPES.filter((c) => c.id === id)[0] || F.COND_TYPES[0];
  F.hasCond = (id) => F.COND_TYPES.some((c) => c.id === id);
  F.rarities = RARITY;
  F.slots = SLOT_GROUPS;

  /* 数值细则的默认值与取值范围：新加的细则默认 0，写入前一律 clamp */
  F.NUM_DEFAULT = 0;
  /* 「需求属性」细则里可选的属性 */
  F.ATTR_OPTIONS = [
    { id: 'any', name: '任意（取最高）' },
    { id: 'str', name: '力量' },
    { id: 'dex', name: '敏捷' },
    { id: 'int', name: '智力' },
  ];
  F.attrOf = (cond) => {
    const a = cond && cond.attr;
    return F.ATTR_OPTIONS.some((o) => o.id === a) ? a : 'any';
  };

  /* ---------------- 「包含词缀」：勾选 + 至少 N 条 ---------------- */
  F.affixIds = (cond) => ((cond && Array.isArray(cond.affixIds)) ? cond.affixIds.filter((id) => !!id) : []);
  F.affixMin = (cond) => {
    const n = Math.round(Number(cond && cond.value));
    return (isFinite(n) && n > 0) ? n : 1;
  };
  // 这件装备命中了勾选词缀里的几条
  F.countAffixes = function (item, cond) {
    const want = F.affixIds(cond);
    if (!want.length) return 0;
    const have = {};
    (item.affixes || []).forEach((a) => { if (a && a.id) have[a.id] = 1; });
    let n = 0;
    want.forEach((id) => { if (have[id]) n++; });
    return n;
  };

  /* 规则里的「装备部位 / 装备类型」细则会锁定可选部位；返回 null = 没有限制。
   * slot 细则取并集、type 细则按基底表反查部位，多个细则之间取交集。 */
  const SLOT_GROUP_MEMBERS = { armor: ['helm', 'chest', 'gloves', 'boots', 'belt'], jewelry: ['ring', 'amulet'] };
  F.allowedSlots = function (conds) {
    let out = null;
    const narrow = (list) => { out = out ? out.filter((s) => list.indexOf(s) >= 0) : list.slice(); };
    (conds || []).forEach((c) => {
      if (!c) return;
      if (c.type === 'slot' && c.op !== 'not') narrow(SLOT_GROUP_MEMBERS[c.value] || [String(c.value)]);
      if (c.type === 'type' && c.op === 'is') {
        const slots = {};
        (D.BASES || []).forEach((b) => { if (b.type === c.value) slots[b.slot] = 1; });
        const list = Object.keys(slots);
        if (list.length) narrow(list);
      }
    });
    return out;
  };

  /* 词缀选择面板的可选池。
   * hideConflict = true 且规则锁定了部位 / 类型时，只留下「真的会出现在这些部位上」的词缀：
   *   · 没写 slots 的词缀 = 所有部位都能出 → 保留
   *   · 写了 slots 的词缀 → 与允许的部位有交集才保留 */
  F.affixPool = function (conds, hideConflict) {
    const all = D.AFFIXES.slice();
    if (hideConflict === false) return all;
    const slots = F.allowedSlots(conds);
    if (!slots || !slots.length) return all;
    return all.filter((a) => {
      if (!a.slots || !a.slots.length) return true;
      for (let i = 0; i < a.slots.length; i++) {
        if (slots.indexOf(a.slots[i]) >= 0) return true;
      }
      return false;
    });
  };

  /* 词缀列表右侧那行小字：把几组同名的属性区分开
   * （护甲 / 护甲%、附加火焰伤害 / 火焰伤害%、专精之的技能等级……） */
  const STAT_SHORT = {
    armor: '+护甲', armorPct: '护甲%',
    fireDmg: '火焰伤害%', addFire: '+火焰伤害',
    coldDmg: '冰冷伤害%', addCold: '+冰冷伤害',
    lightDmg: '闪电伤害%', addLight: '+闪电伤害',
    poisonDmg: '毒素伤害%', addPoison: '+毒素伤害',
    lifePct: '生命上限%', manaPct: '法力上限%',
  };
  F.affixLabel = function (a) {
    const st = (a && a.stat) || '';
    if (st.indexOf('skill:') === 0) return '+技能等级';
    if (STAT_SHORT[st]) return STAT_SHORT[st];
    const def = D.STATS[st];
    return (def && def.name) || st;
  };
  F.clampValue = function (typeId, v) {
    const t = F.condType(typeId);
    if (t.value !== 'number') return v;
    let n = Math.round(Number(v));
    if (!isFinite(n)) n = F.NUM_DEFAULT;
    return G.clamp(n, t.min == null ? 0 : t.min, t.max == null ? 99999 : t.max);
  };
  /* 老存档 / 导入的数据换个名字也能用：
   * 力量 / 敏捷 / 智力 → 需求属性（取三者最高），「名称包含」已废弃 → 丢掉该细则，
   * 老的「包含词缀」是文本框写的，模型已换成勾选 → 也丢掉（按用户要求清空） */
  F.migrateConds = function (conds) {
    const list = [];
    (conds || []).forEach((c) => {
      if (!c || c.type === 'name') return;
      let type = c.type;
      if (type === 'reqStr' || type === 'reqDex' || type === 'reqInt') type = 'reqAttr';
      if (!F.hasCond(type)) return;
      if (type === 'affix' && !Array.isArray(c.affixIds)) return;   // 老的文字条件：清空
      const t = F.condType(type);
      const one = {
        type: type,
        op: (t.ops.filter((o) => o.id === c.op)[0] || t.ops[0]).id,
        value: t.value === 'number' ? F.clampValue(type, c.value) : c.value,
      };
      if (t.attrPick) one.attr = F.attrOf(c);
      if (t.value === 'affixPick') {
        one.affixIds = F.affixIds(c).slice(0, 60);
        one.value = G.clamp(Math.round(Number(c.value) || 1), 1, 12);
      }
      list.push(one);
    });
    return list;
  };

  /* ---------------- 过滤器库（跨存档共通） ----------------
   *  · 整批过滤器存在本地（localStorage），不属于任何存档：所有角色共用同一批
   *  · F.data 永远指向「当前选中的那一个」，界面里改的就是它（改规则 = 改这个对象）
   *  · 新开存档时会切到一个空过滤器（见 F.onNewCharacter） */
  let uidSeq = 0;
  F.newId = function () { uidSeq++; return 'f' + uidSeq + '-' + (Date.now() % 1000000).toString(36); };

  F.cleanName = function (s) {
    const n = String(s == null ? '' : s).replace(/[\r\n\t]/g, ' ').trim().slice(0, F.NAME_MAX);
    return n || '过滤器';
  };

  /* 名字重了就在后面加个序号，方便在下拉列表里区分 */
  F.uniqueName = function (name, skipId) {
    const base = F.cleanName(name).slice(0, F.NAME_MAX - 3);
    let n = F.cleanName(name), i = 2;
    const taken = (x) => F.list.some((f) => f.id !== skipId && f.name === x);
    while (taken(n)) { n = F.cleanName(base + ' ' + i); i++; }
    return n;
  };

  /* 把一个过滤器对象规整成内部格式（顺带兼容老数据 / 手写 JSON） */
  F.normFilter = function (d, fallbackName) {
    d = d && typeof d === 'object' ? d : {};
    return {
      id: d.id ? String(d.id) : F.newId(),
      name: F.cleanName(d.name || fallbackName || '过滤器'),
      enabled: d.enabled !== false,
      hideConflict: d.hideConflict !== false,
      // 老数据里的细则名（需求力量 / 敏捷 / 智力、名称包含、文本框写的词缀）在这里顺手转换 / 丢弃
      rules: (Array.isArray(d.rules) ? d.rules : []).slice(0, F.MAX_RULES).map((r) => ({
        action: F.ACTIONS.some((a) => a.id === r.action) ? r.action : 'hide',
        enabled: r.enabled !== false,
        conds: F.migrateConds(r.conds),
      })),
    };
  };

  F.blankFilter = function (name) {
    const one = F.normFilter({ name: name }, '过滤器');
    one.rules = [];
    return one;
  };

  F.list = [];
  F.activeId = '';
  F.data = null;

  /* ---------------- 存取 ---------------- */
  F.load = function () {
    let list = [], activeId = '';
    try {
      const raw = root.localStorage && root.localStorage.getItem(F.KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.list) && d.list.length) {
          list = d.list.slice(0, F.MAX_FILTERS).map((x) => F.normFilter(x));
          activeId = d.activeId ? String(d.activeId) : '';
        }
      }
      if (!list.length) {
        /* 第一次跑新版：把旧版的单个过滤器搬进来当第一个；没有旧数据就建一个空的 */
        let legacy = null;
        const old = root.localStorage && root.localStorage.getItem(F.LEGACY_KEY);
        if (old) { try { legacy = JSON.parse(old); } catch (e) { legacy = null; } }
        const one = legacy && typeof legacy === 'object'
          ? F.normFilter(legacy, '默认过滤器')
          : F.blankFilter('过滤器 1');
        list = [one];
        activeId = one.id;
      }
    } catch (e) { /* 坏数据就当没有 */ }
    if (!list.length) list = [F.blankFilter('过滤器 1')];
    F.list = list;
    F.setActive(activeId, true);
    return F.data;
  };

  F.save = function () {
    try {
      if (root.localStorage) {
        root.localStorage.setItem(F.KEY, JSON.stringify({ v: 2, activeId: F.activeId, list: F.list }));
      }
    } catch (e) { }
  };

  /* ---------------- 库操作 ---------------- */
  F.byId = function (id) { return F.list.filter((x) => x.id === id)[0] || null; };

  /* 切换当前过滤器：F.data 指向它，界面里改的就是它 */
  F.setActive = function (id, silent) {
    const one = F.byId(id) || F.list[0] || null;
    if (!one) return null;
    F.activeId = one.id;
    F.data = one;
    if (!silent) F.save();
    return one;
  };

  F.addFilter = function (name) {
    if (F.list.length >= F.MAX_FILTERS) return null;
    const one = F.blankFilter(name || ('过滤器 ' + (F.list.length + 1)));
    one.name = F.uniqueName(one.name);
    F.list.push(one);
    F.setActive(one.id);
    return one;
  };

  F.renameFilter = function (name, id) {
    const one = F.byId(id || F.activeId);
    if (!one) return null;
    one.name = F.uniqueName(name, one.id);
    F.save();
    return one.name;
  };

  F.removeFilter = function (id) {
    if (F.list.length <= 1) return false;         // 至少留一个，界面永远不会空
    let i = -1;
    F.list.forEach((x, k) => { if (x.id === id && i < 0) i = k; });
    if (i < 0) return false;
    const wasActive = F.list[i].id === F.activeId;
    F.list.splice(i, 1);
    if (wasActive) F.setActive(F.list[0].id); else F.save();
    return true;
  };

  /* 新开一个存档：默认给一个空过滤器（已经有一个空的就直接切过去，不重复建） */
  F.onNewCharacter = function () {
    if (!F.data.rules.length) return F.data;
    const empty = F.list.filter((x) => !x.rules.length)[0];
    if (empty) return F.setActive(empty.id);
    return F.addFilter('空过滤器');
  };

  F.newRule = function (action) {
    return { action: action || 'hide', enabled: true, conds: [{ type: 'rarity', op: 'is', value: 'common' }] };
  };
  F.addRule = function (rule) {
    if (F.data.rules.length >= F.MAX_RULES) return false;
    F.data.rules.push(rule || F.newRule());
    return true;
  };
  /* 新增规则默认插到最前面：新写的规则立刻生效，不用手动往上挪 */
  F.insertRule = function (rule) {
    if (F.data.rules.length >= F.MAX_RULES) return false;
    F.data.rules.unshift(rule || F.newRule());
    return true;
  };
  /* 拖拽排序：把第 from 条挪到第 to 条的位置 */
  F.moveRuleTo = function (from, to) {
    const rs = F.data.rules;
    if (!(from >= 0 && from < rs.length)) return false;
    const t = G.clamp(to | 0, 0, rs.length - 1);
    if (t === from) return false;
    const one = rs.splice(from, 1)[0];
    rs.splice(t, 0, one);
    return true;
  };
  F.removeRule = function (i) {
    if (i < 0 || i >= F.data.rules.length) return;
    F.data.rules.splice(i, 1);
  };
  F.moveRule = function (i, d) {
    const j = i + d;
    const rs = F.data.rules;
    if (i < 0 || i >= rs.length || j < 0 || j >= rs.length) return;
    const tmp = rs[i]; rs[i] = rs[j]; rs[j] = tmp;
  };
  F.clear = function () { F.data.rules = []; };

  /* ---------------- 导入 / 导出 ---------------- */
  /* 导出当前过滤器（带上名字，方便对方知道是哪一套） */
  F.exportText = function () {
    return JSON.stringify({ enabled: F.data.enabled, name: F.data.name, hideConflict: F.data.hideConflict, rules: F.data.rules }, null, 2);
  };
  /* 导入：不做覆盖，而是作为库里的一个新过滤器加进来并选中 */
  F.importText = function (txt) {
    try {
      const d = JSON.parse(txt);
      if (!d || !Array.isArray(d.rules)) return { ok: false, why: '不是合法的过滤器数据' };
      if (d.rules.length > F.MAX_RULES) return { ok: false, why: '规则数量超过 ' + F.MAX_RULES + ' 条' };
      if (F.list.length >= F.MAX_FILTERS) return { ok: false, why: '最多只能保存 ' + F.MAX_FILTERS + ' 个过滤器，先删掉一个再导入' };
      const one = F.normFilter(d, '导入的过滤器');
      one.name = F.uniqueName(d.name || '导入的过滤器');
      F.list.push(one);
      F.setActive(one.id);
      return { ok: true, rules: one.rules.length, name: one.name };
    } catch (e) {
      return { ok: false, why: '解析失败：' + e.message };
    }
  };

  /* ---------------- 匹配 ---------------- */
  function slotMatches(item, want) {
    const s = item.slot;
    if (want === 'armor') return ['helm', 'chest', 'gloves', 'boots', 'belt'].indexOf(s) >= 0;
    if (want === 'jewelry') return s === 'ring' || s === 'amulet';
    return s === want;
  }
  function boolOf(v) { return v === true || v === 'true' || v === 1 || v === '1'; }

  F.matchCond = function (item, cond, ctx) {
    const t = F.condType(cond.type);
    const raw = t.get(item, ctx, cond);
    const v = cond.value;
    switch (t.value) {
      case 'number': {
        const num = Number(raw);
        if (raw == null || isNaN(num)) return false;
        const want = Number(v);
        if (isNaN(want)) return false;
        if (cond.op === '>=') return num >= want;
        if (cond.op === '<=') return num <= want;
        if (cond.op === '==') return num === want;
        return false;
      }
      case 'rarity': return cond.op === 'not' ? raw !== v : raw === v;
      case 'slot': return cond.op === 'not' ? !slotMatches(item, v) : slotMatches(item, v);
      case 'type': return String(raw) === String(v);
      case 'affixPick': {
        const want = F.affixIds(cond);
        if (!want.length) return true;                    // 一条词缀都没勾 → 这条细则不参与筛选
        const hit = F.countAffixes(item, cond);
        const min = F.affixMin(cond);
        return cond.op === 'not' ? hit < min : hit >= min;
      }
      case 'bool': {
        const b = cond.type === 'canEquip' ? !!(ctx && ctx.canEquip) : boolOf(raw);
        return cond.op === 'is' ? b === boolOf(v) : b !== boolOf(v);
      }
      default: {
        const hay = String(raw || '').toLowerCase();
        const needle = String(v == null ? '' : v).toLowerCase();
        if (!needle) return false;
        const has = hay.indexOf(needle) >= 0;
        return cond.op === 'not' ? !has : has;
      }
    }
  };

  F.ruleMatches = function (item, rule, ctx) {
    if (!rule || rule.enabled === false) return false;
    const conds = rule.conds || [];
    if (!conds.length) return false;
    for (let i = 0; i < conds.length; i++) {
      if (!F.matchCond(item, conds[i], ctx)) return false;
    }
    return true;
  };

  /* 靠前的规则优先生效；返回 { state, index, action } */
  F.decide = function (item, ctx) {
    if (!F.data.enabled || !item || item.cat !== 'equip') return { state: 'normal', index: -1 };
    for (let i = 0; i < F.data.rules.length; i++) {
      const r = F.data.rules[i];
      if (F.ruleMatches(item, r, ctx)) {
        return { state: r.action === 'hide' ? 'hide' : r.action === 'show' ? 'show' : 'normal', index: i, action: r.action };
      }
    }
    return { state: 'normal', index: -1 };
  };

  /* 规则的可读描述（界面与提示框共用） */
  F.ruleText = function (rule) {
    const parts = (rule.conds || []).map((c) => {
      const t = F.condType(c.type);
      const op = (t.ops.filter((o) => o.id === c.op)[0] || t.ops[0]).name;
      let val = c.value;
      if (t.value === 'rarity') val = (RARITY.filter((r) => r.id === c.value)[0] || { name: c.value }).name;
      if (t.value === 'slot') val = (SLOT_GROUPS.filter((r) => r.id === c.value)[0] || { name: c.value }).name;
      if (t.value === 'bool') val = boolOf(c.value) ? '是' : '否';
      if (t.value === 'affixPick') {
        const ids = F.affixIds(c);
        const names = ids.map((id) => (D.affixById[id] || {}).name || id);
        const head = (c.op === 'not' ? '不含这么多：' : '至少 ') + F.affixMin(c) + ' 条';
        const tail = names.length ? '（' + names.slice(0, 3).join(' / ') + (names.length > 3 ? ' 等 ' + names.length + ' 条' : '') + '）'
          : '（还没勾选词缀）';
        return t.name + ' ' + head + tail;
      }
      // 「需求属性」会额外带上选中的那一项（力量 / 敏捷 / 智力 / 任意）
      const attr = t.attrPick ? ((F.ATTR_OPTIONS.filter((a) => a.id === F.attrOf(c))[0] || {}).name || '') + ' ' : '';
      return t.name + ' ' + attr + op + ' ' + val;
    });
    return parts.length ? parts.join(' 且 ') : '（没有细则）';
  };

  F.load();

  // 规则文本里用到的中文名，供界面里显示
  F.statLabel = (k) => (D.STATS[k] ? D.STATS[k].name : k);
})(typeof globalThis !== 'undefined' ? globalThis : this);
