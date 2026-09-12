/* ============================================================
 *  暗影深渊 · filter.js
 *  装备过滤器：自定义规则决定背包 / 仓库 / 商店里装备的显示状态
 *  ------------------------------------------------------------
 *  · 最多 20 条规则，靠前的规则优先生效（命中即决定，不再往下看）
 *  · 每条规则可以包含多条「细则」，同一规则内的细则必须全部满足
 *  · 规则动作：显示 / 高亮显示 / 隐藏
 *  · 支持导出、导入（JSON 文本）
 * ============================================================ */
(function (root) {
  'use strict';
  const G = root.G;
  const D = G.DATA;
  const F = (G.Filter = {});

  F.KEY = 'shadow-abyss-filter-v1';
  F.MAX_RULES = 20;

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

  /* 细则类型：ops 决定可用的比较方式，value 决定输入控件 */
  F.COND_TYPES = [
    {
      id: 'ilvl', name: '物品等级', value: 'number',
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
      id: 'affix', name: '包含词缀', value: 'text',
      ops: [{ id: 'has', name: '包含' }, { id: 'not', name: '不含' }],
      get: (it) => (it.affixes || []).map((a) => a.name + ' ' + D.statText(a.stat, a.value) + ' ' + a.stat).join(' | '),
    },
    {
      id: 'name', name: '名称包含', value: 'text',
      ops: [{ id: 'has', name: '包含' }, { id: 'not', name: '不含' }],
      get: (it) => G.Loot.displayName(it),
    },
    {
      id: 'reqLevel', name: '需求等级', value: 'number',
      ops: [{ id: '>=', name: '≥' }, { id: '<=', name: '≤' }],
      get: (it) => (it.req && it.req.level) | 0,
    },
    {
      id: 'reqStr', name: '需求力量', value: 'number',
      ops: [{ id: '>=', name: '≥' }, { id: '<=', name: '≤' }],
      get: (it) => (it.req && it.req.str) | 0,
    },
    {
      id: 'reqDex', name: '需求敏捷', value: 'number',
      ops: [{ id: '>=', name: '≥' }, { id: '<=', name: '≤' }],
      get: (it) => (it.req && it.req.dex) | 0,
    },
    {
      id: 'reqInt', name: '需求智力', value: 'number',
      ops: [{ id: '>=', name: '≥' }, { id: '<=', name: '≤' }],
      get: (it) => (it.req && it.req.int) | 0,
    },
    {
      id: 'affixCount', name: '词缀条数', value: 'number',
      ops: [{ id: '>=', name: '≥' }, { id: '<=', name: '≤' }, { id: '==', name: '=' }],
      get: (it) => (it.affixes || []).filter((a) => a.kind !== 'unique').length,
    },
    {
      id: 'quality', name: '词缀品质', value: 'number',
      ops: [{ id: '>=', name: '≥' }, { id: '<=', name: '≤' }],
      get: (it) => G.Loot.affixQuality(it),
    },
    {
      id: 'sockets', name: '孔位数', value: 'number',
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
      id: 'score', name: '评分', value: 'number',
      ops: [{ id: '>=', name: '≥' }, { id: '<=', name: '≤' }],
      get: (it, ctx) => G.Loot.score(it, ctx && ctx.stats),
    },
  ];
  F.condType = (id) => F.COND_TYPES.filter((c) => c.id === id)[0] || F.COND_TYPES[0];
  F.rarities = RARITY;
  F.slots = SLOT_GROUPS;

  F.data = { enabled: true, name: '默认过滤器', rules: [] };

  /* ---------------- 存取 ---------------- */
  F.load = function () {
    try {
      const raw = root.localStorage && root.localStorage.getItem(F.KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.rules)) {
          F.data = { enabled: d.enabled !== false, name: d.name || '默认过滤器', rules: d.rules.slice(0, F.MAX_RULES) };
        }
      }
    } catch (e) { /* 坏数据就用默认 */ }
    return F.data;
  };
  F.save = function () {
    try {
      if (root.localStorage) root.localStorage.setItem(F.KEY, JSON.stringify(F.data));
    } catch (e) { }
  };

  F.newRule = function (action) {
    return { action: action || 'hide', enabled: true, conds: [{ type: 'rarity', op: 'is', value: 'common' }] };
  };
  F.addRule = function (rule) {
    if (F.data.rules.length >= F.MAX_RULES) return false;
    F.data.rules.push(rule || F.newRule());
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
  F.exportText = function () { return JSON.stringify(F.data, null, 2); };
  F.importText = function (txt) {
    try {
      const d = JSON.parse(txt);
      if (!d || !Array.isArray(d.rules)) return { ok: false, why: '不是合法的过滤器数据' };
      if (d.rules.length > F.MAX_RULES) return { ok: false, why: '规则数量超过 ' + F.MAX_RULES + ' 条' };
      F.data = {
        enabled: d.enabled !== false,
        name: d.name || '导入的过滤器',
        rules: d.rules.map((r) => ({
          action: F.ACTIONS.some((a) => a.id === r.action) ? r.action : 'hide',
          enabled: r.enabled !== false,
          conds: (r.conds || []).map((c) => ({
            type: F.condType(c.type).id,
            op: c.op || F.condType(c.type).ops[0].id,
            value: c.value,
          })),
        })),
      };
      F.save();
      return { ok: true, rules: F.data.rules.length };
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
    const raw = t.get(item, ctx);
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
      return t.name + ' ' + op + ' ' + val;
    });
    return parts.length ? parts.join(' 且 ') : '（没有细则）';
  };

  F.load();

  // 规则文本里用到的中文名，供界面里显示
  F.statLabel = (k) => (D.STATS[k] ? D.STATS[k].name : k);
})(typeof globalThis !== 'undefined' ? globalThis : this);
