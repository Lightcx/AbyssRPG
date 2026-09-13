/* ============================================================
 *  暗影深渊 · data.js
 *  全部游戏数据：属性 / 装备基底 / 词缀 / 暗金 / 宝石 /
 *  怪物 / 精英词缀 / BOSS / 技能 / 职业 / 难度 / 做装通货 / 城镇建筑
 * ============================================================ */
(function (root) {
  'use strict';
  const G = root.G;
  const D = (G.DATA = {});

  /* ---------------- 平衡常量（想改数值先改这里） ---------------- */
  G.BALANCE = {
    /* 怪物生命 / 伤害随等级的指数增长。
     * 掉落品质提升（高级以多词缀黄装与暗金为主）后，玩家长线输出成长是乘法叠乘的，
     * 所以这里的指数要跟上：1.031 大致让「终点进度」的击杀时间回到 5 秒以上。 */
    monsterLifeExp: 1.044,     // 怪物生命随怪物等级指数增长
    monsterDmgExp: 1.028,      // 怪物伤害
    monsterXpExp: 1.075,       // 怪物经验
    eliteLife: 3.6, eliteDmg: 1.3,
    bossLife: 12,              // BOSS 生命倍率（相对同等级普通怪）
    bossXp: 9,
    playerBaseSpeed: 168,
    xpCurve: (lv) => Math.floor(60 * Math.pow(lv, 1.62)),
    deathGoldLoss: 0.1,
    dropBase: 0.30,            // 普通怪掉落装备的基础概率
    goldBase: 14,
    /* 技能伤害的攻速基准：技能伤害 = 武器均伤 × (武器攻速 / 这个值)。
     * 取全部武器攻速的平均值（约 1.16），所以整体强度不变，只是把「慢速高单伤」白赚的那份去掉。 */
    skillRefAps: 1.16,
  };

  // 怪物等级：**层数**是主项，难度只在此之上加少量等级
  G.mlvlOf = function (floor, diffIdx) {
    const add = (D.DIFFICULTIES[G.clamp(diffIdx | 0, 0, D.DIFFICULTIES.length - 1)] || {}).mlvlAdd || 0;
    return Math.max(1, Math.round(1 + floor * 1.2 + add));
  };
  /* ---------------- 怪物防御成长（物理 / 元素同一条目标曲线） ----------------
   * 目标减伤： mit(mlvl) = 上限(难度) × (1 - e^(-mlvl/K(难度)))
   *   · 平滑、单调，随深渊层数上升；难度越高上限越高、K 越小（爬得更快 ⇒ 曲线更陡）
   *   · 1~10 层只有几个百分点，前期手感不变
   * 两条通道都对齐这条曲线，所以物理与元素的等效输出基本一致：
   *   · 元素抗性数值 = resistMitigation 的反函数（数值 = 150 × mit / (1 - mit)）
   *   · 护甲整体缩放 = 「达到该减伤所需的护甲」÷「各怪基础护甲的参考值 × 1.06^mlvl」
   *     （每只怪按自己的基础护甲上下浮动，厚甲的更抗物理、脆皮的更怕物理）
   * 目标值：80 层（mlvl 97~102）平均减伤约 19.5% / 28% / 37% / 46% / 54% / 62%
   */
  G.BALANCE.monsterDefCap = [0.30, 0.40, 0.50, 0.58, 0.65, 0.72];
  G.BALANCE.monsterDefK = [70, 62, 55, 48, 42, 36];
  G.MONSTER_AVG_ARMOR = 18;          // 各怪基础护甲的参考均值（用于把护甲整体对齐到目标减伤）

  G.monsterDefMit = function (mlvl, diffIdx) {
    const B = G.BALANCE;
    const i = G.clamp(diffIdx | 0, 0, B.monsterDefCap.length - 1);
    const m = Math.max(0, mlvl || 1);
    return B.monsterDefCap[i] * (1 - Math.exp(-m / B.monsterDefK[i]));
  };
  // 目标减伤 → 抗性数值（喂给 S.resistMitigation）
  G.monsterResist = function (mlvl, diffIdx) {
    const mit = G.monsterDefMit(mlvl, diffIdx);
    if (mit <= 0.002) return 0;
    return Math.round(150 * mit / (1 - mit));
  };
  G.monsterResists = function (mlvl, diffIdx) {
    const v = G.monsterResist(mlvl, diffIdx);
    return { fire: v, cold: v, lightning: v, poison: v };
  };
  // 目标减伤 → 护甲整体缩放系数（数值解：让「各怪护甲减伤的平均值」正好等于目标减伤）
  G.monsterArmorScale = function (mlvl, diffIdx) {
    const m = G.monsterDefMit(mlvl, diffIdx);
    const lv = Math.max(1, mlvl || 1);
    if (m <= 0.003) return 1;
    const bases = G.MONSTER_ARMORS && G.MONSTER_ARMORS.length ? G.MONSTER_ARMORS : [8];
    const C = 55 + 15 * lv;
    const g = Math.pow(1.06, lv);
    let lo = 0, hi = 8;
    for (let it = 0; it < 26; it++) {
      const k = (lo + hi) / 2;
      let sum = 0;
      for (let i = 0; i < bases.length; i++) {
        const a = bases[i] * g * k;
        sum += a / (a + C);
      }
      if (sum / bases.length < m) lo = k; else hi = k;
    }
    return (lo + hi) / 2;
  };
  G.monsterArmor = function (baseArmor, mlvl, diffIdx) {
    return Math.max(0, Math.round(baseArmor * Math.pow(1.06, mlvl) * G.monsterArmorScale(mlvl, diffIdx)));
  };

  // 击杀经验
  G.xpForMonster = function (mlvl, kind, diffIdx) {
    const B = G.BALANCE;
    let mul = Math.pow(B.monsterXpExp, mlvl);
    if (kind === 'elite') mul *= 3.4;
    if (kind === 'boss') mul *= B.bossXp;
    const base = kind === 'boss' ? 26 : kind === 'elite' ? 22 : 13;
    return Math.max(1, Math.round(base * mul * (1 + (diffIdx || 0) * 0.35)));
  };

  /* ---------------- 属性定义 ---------------- */
  // kind: 'flat' 直接相加 | 'pct' 百分比
  const STATS = {
    str: { name: '力量', short: '力', kind: 'flat' },
    dex: { name: '敏捷', short: '敏', kind: 'flat' },
    int: { name: '智力', short: '智', kind: 'flat' },
    vit: { name: '体力', short: '体', kind: 'flat' },
    life: { name: '生命上限', kind: 'flat' },
    lifePct: { name: '生命上限', kind: 'pct' },
    mana: { name: '法力上限', kind: 'flat' },
    manaPct: { name: '法力上限', kind: 'pct' },
    armor: { name: '护甲', kind: 'flat' },
    armorPct: { name: '护甲', kind: 'pct' },
    allResist: { name: '全元素抗性', kind: 'flat' },
    fireResist: { name: '火焰抗性', kind: 'pct' },
    coldResist: { name: '冰冷抗性', kind: 'pct' },
    lightResist: { name: '闪电抗性', kind: 'pct' },
    poisonResist: { name: '毒素抗性', kind: 'pct' },
    crit: { name: '暴击几率', kind: 'pct' },
    critDmg: { name: '暴击伤害', kind: 'pct' },
    aps: { name: '攻击速度', kind: 'pct' },
    moveSpeed: { name: '移动速度', kind: 'pct' },
    dmgPct: { name: '伤害', kind: 'pct' },
    physDmg: { name: '物理伤害', kind: 'pct' },
    fireDmg: { name: '火焰伤害', kind: 'pct' },
    coldDmg: { name: '冰冷伤害', kind: 'pct' },
    lightDmg: { name: '闪电伤害', kind: 'pct' },
    poisonDmg: { name: '毒素伤害', kind: 'pct' },
    addFire: { name: '火焰伤害', kind: 'flat' },
    addCold: { name: '冰冷伤害', kind: 'flat' },
    addLight: { name: '闪电伤害', kind: 'flat' },
    addPoison: { name: '毒素伤害', kind: 'flat' },
    lifeRegen: { name: '每秒生命回复', kind: 'flat' },
    manaRegen: { name: '每秒法力回复', kind: 'flat' },
    lifeOnHit: { name: '击中回复生命', kind: 'flat' },
    lifeSteal: { name: '生命偷取', kind: 'pct' },
    manaSteal: { name: '法力偷取', kind: 'pct' },
    mf: { name: '魔法装备掉落', kind: 'pct' },
    gf: { name: '金币掉落', kind: 'pct' },
    cdr: { name: '冷却缩减', kind: 'pct' },
    areaDmg: { name: '范围伤害', kind: 'pct' },
    thorns: { name: '伤害反弹', kind: 'flat' },
    pickup: { name: '拾取范围', kind: 'flat' },
    xpBonus: { name: '经验获取', kind: 'pct' },
    dmgReduce: { name: '受到伤害降低', kind: 'pct' },
    allSkills: { name: '所有技能等级', kind: 'flat' },
    dodge: { name: '闪避几率', kind: 'pct' },
    dodgeCharges: { name: '闪避充能次数', kind: 'flat' },
    dodgeRecharge: { name: '闪避恢复时间', kind: 'pct' },
  };
  D.STATS = STATS;

  // 生成属性描述文本
  D.statText = function (key, value) {
    const def = STATS[key] || null;
    const v = Math.round(value * 10) / 10;
    if (key.indexOf('skill:') === 0) {
      const sk = D.SKILLS[key.slice(6)];
      return '+' + v + ' ' + (sk ? sk.name : key.slice(6)) + ' 技能等级';
    }
    if (key === 'dodgeCharges') return '闪避充能 +' + Math.round(v) + ' 次';
    if (key === 'dodgeRecharge') return '闪避恢复时间 -' + v + '%';
    if (def && def.kind === 'pct') return '+' + v + '% ' + def.name;
    if (key === 'thorns') return '攻击者受到 ' + Math.round(v) + ' 点伤害';
    if (key === 'lifeSteal') return '生命偷取 ' + v + '%';
    if (key === 'manaSteal') return '法力偷取 ' + v + '%';
    if (key === 'lifeRegen') return '每秒回复 ' + Math.round(v) + ' 点生命';
    if (key === 'manaRegen') return '每秒回复 ' + Math.round(v) + ' 点法力';
    if (key === 'lifeOnHit') return '击中时回复 ' + Math.round(v) + ' 点生命';
    if (key === 'pickup') return '拾取范围 +' + Math.round(v);
    if (key === 'mf') return '+' + v + '% 魔法装备掉落几率';
    if (key === 'gf') return '+' + v + '% 金币掉落';
    if (key === 'xpBonus') return '+' + v + '% 经验获取';
    if (key === 'cdr') return '冷却缩减 ' + v + '%';
    if (key === 'addFire') return '附加 ' + Math.round(v) + ' 点火焰伤害';
    if (key === 'addCold') return '附加 ' + Math.round(v) + ' 点冰冷伤害';
    if (key === 'addLight') return '附加 ' + Math.round(v) + ' 点闪电伤害';
    if (key === 'addPoison') return '附加 ' + Math.round(v) + ' 点毒素伤害';
    return '+' + Math.round(v) + ' ' + (def ? def.name : key);
  };

  /* ---------------- 装备槽位 ---------------- */
  D.SLOTS = [
    { id: 'helm', name: '头盔', glyph: '⛑' },
    { id: 'amulet', name: '项链', glyph: '☘' },
    { id: 'chest', name: '胸甲', glyph: '🛡' },
    { id: 'weapon', name: '武器', glyph: '⚔' },
    { id: 'gloves', name: '手套', glyph: '✋' },
    { id: 'offhand', name: '副手', glyph: '📖' },
    { id: 'belt', name: '腰带', glyph: '▬' },
    { id: 'boots', name: '靴子', glyph: '👢' },
    { id: 'ring1', name: '戒指 I', glyph: '○', accepts: 'ring' },
    { id: 'ring2', name: '戒指 II', glyph: '○', accepts: 'ring' },
  ];
  D.SLOT_BY_ID = {}; D.SLOTS.forEach((s) => { D.SLOT_BY_ID[s.id] = s; });
  D.gearSlots = () => ['helm', 'amulet', 'chest', 'weapon', 'gloves', 'offhand', 'belt', 'boots', 'ring1', 'ring2'];

  /* ---------------- 装备基底（程序化生成 8 个等级段） ---------------- */
  D.TIER_ILVL = [1, 8, 17, 27, 39, 52, 66, 80];
  const TIER_NAMES = ['粗制', '普通', '精制', '秘银', '符文', '龙鳞', '深渊', '神谕'];

  /* 双手武器的「两手预算」倍率：
   * 双手武器一次占掉主手 + 副手，所以基底数值与词缀数值都按单手的 2 倍给，
   * 孔位上限也等于「单手武器上限 + 副手上限」（2 + 2 = 4）。 */
  D.TWO_HAND_MULT = 2;

  // 数值只看 (min+max)/2 的均值；双手武器的均值按「单手 ×2」的 DPS 目标反推
  const WEAPON_TYPES = {
    dagger: { label: '匕首', kind: 'melee', names: ['短匕', '锐匕', '剔骨匕', '秘银匕', '符文匕', '龙牙匕', '深渊匕', '弑神匕'], dmg: [2, 6], aps: 1.65, growth: 1.40, req: 'dex', reqVal: 8, implicit: [{ stat: 'crit', value: 3 }] },
    sword: { label: '剑', kind: 'melee', names: ['短剑', '长剑', '阔剑', '秘银剑', '符文剑', '龙牙剑', '深渊之刃', '神谕裁决'], dmg: [3, 8], aps: 1.30, growth: 1.42, req: 'str', reqVal: 12, implicit: [{ stat: 'aps', value: 4 }] },
    axe: { label: '斧', kind: 'melee', names: ['手斧', '战斧', '双刃斧', '秘银斧', '符文斧', '龙牙斧', '深渊裂斧', '神谕斩斧'], dmg: [4, 11], aps: 1.12, growth: 1.46, req: 'str', reqVal: 16, implicit: [{ stat: 'critDmg', value: 20 }] },
    mace: { label: '锤', kind: 'melee', names: ['木棒', '钉锤', '战锤', '秘银锤', '符文锤', '龙牙锤', '深渊碎锤', '神谕灭锤'], dmg: [5, 14], aps: 0.98, growth: 1.48, req: 'str', reqVal: 20, implicit: [{ stat: 'areaDmg', value: 8 }] },
    greatsword: { label: '巨剑', kind: 'melee', two: true, names: ['铁巨剑', '钢巨剑', '骑士巨剑', '秘银巨剑', '符文巨剑', '龙牙巨剑', '深渊巨剑', '神谕圣剑'], dmg: [9, 21], aps: 0.95, growth: 1.42, req: 'str', reqVal: 26, implicit: [{ stat: 'dmgPct', value: 6 }] },
    greataxe: { label: '巨斧', kind: 'melee', two: true, names: ['铁巨斧', '钢巨斧', '狂战巨斧', '秘银巨斧', '符文巨斧', '龙牙巨斧', '深渊巨斧', '神谕狂斧'], dmg: [14, 26], aps: 0.85, growth: 1.46, req: 'str', reqVal: 30, implicit: [{ stat: 'crit', value: 4 }] },
    bow: { label: '弓', kind: 'ranged', two: true, names: ['短弓', '猎弓', '复合弓', '秘银弓', '符文弓', '龙牙弓', '深渊长弓', '神谕星弓'], dmg: [7, 14], aps: 1.24, growth: 1.40, req: 'dex', reqVal: 20, implicit: [{ stat: 'aps', value: 5 }] },
    crossbow: { label: '弩', kind: 'ranged', two: true, names: ['轻弩', '重弩', '攻城弩', '秘银弩', '符文弩', '龙牙弩', '深渊弩', '神谕雷弩'], dmg: [11, 18], aps: 0.92, growth: 1.40, req: 'dex', reqVal: 28, implicit: [{ stat: 'critDmg', value: 30 }] },
    staff: { label: '法杖', kind: 'magic', two: true, names: ['木杖', '法师杖', '元素杖', '秘银杖', '符文杖', '龙骨杖', '深渊法杖', '神谕星辰杖'], dmg: [8, 16], aps: 1.10, growth: 1.44, req: 'int', reqVal: 22, implicit: [{ stat: 'dmgPct', value: 8 }, { stat: 'mana', value: 20 }] },
    wand: { label: '魔杖', kind: 'magic', names: ['木杖尖', '骨杖', '魔杖', '秘银魔杖', '符文魔杖', '龙骨魔杖', '深渊魔杖', '神谕贤者杖'], dmg: [2, 7], aps: 1.45, growth: 1.40, req: 'int', reqVal: 10, implicit: [{ stat: 'aps', value: 8 }] },
    scepter: { label: '权杖', kind: 'magic', names: ['铁权杖', '圣权杖', '大祭司杖', '秘银权杖', '符文权杖', '龙骨权杖', '深渊权杖', '神谕日杖'], dmg: [3, 8], aps: 1.20, growth: 1.44, req: 'int', reqVal: 14, implicit: [{ stat: 'allResist', value: 6 }] },
  };

  const OFFHAND_TYPES = {    shield: { label: '盾牌', names: ['木盾', '铁盾', '塔盾', '秘银盾', '符文盾', '龙骨盾', '深渊之盾', '神谕壁垒'], armor: [12, 30, 62, 120, 220, 380, 620, 980], req: 'str', reqVal: 14, implicit: [{ stat: 'allResist', value: 8 }] },
    orb: { label: '法球', names: ['水晶球', '秘法球', '元素球', '秘银球', '符文球', '龙骨球', '深渊球', '神谕天球'], armor: [3, 8, 16, 30, 56, 96, 158, 250], req: 'int', reqVal: 16, implicit: [{ stat: 'mana', value: 25 }, { stat: 'aps', value: 6 }] },
    quiver: { label: '箭袋', names: ['皮箭袋', '猎人箭袋', '鹰眼箭袋', '秘银箭袋', '符文箭袋', '龙骨箭袋', '深渊箭袋', '神谕星袋'], armor: [3, 7, 14, 26, 48, 84, 138, 218], req: 'dex', reqVal: 16, implicit: [{ stat: 'aps', value: 6 }, { stat: 'dex', value: 6 }] },
  };

  const ARMOR_TYPES = {
    helm: { label: '头盔', names: ['皮帽', '头盔', '战盔', '秘银盔', '符文盔', '龙骨盔', '深渊王冠', '神谕冠冕'], armor: [6, 14, 30, 58, 108, 186, 304, 480], req: 'str', reqVal: 8, implicit: [{ stat: 'life', value: 8 }] },
    chest: { label: '胸甲', names: ['皮甲', '锁甲', '板甲', '秘银甲', '符文甲', '龙鳞甲', '深渊胸甲', '神谕战铠'], armor: [12, 28, 58, 112, 208, 356, 580, 910], req: 'str', reqVal: 14, implicit: [{ stat: 'life', value: 12 }] },
    gloves: { label: '手套', names: ['布手套', '皮手套', '锁甲手套', '秘银手套', '符文手套', '龙鳞手套', '深渊手套', '神谕护手'], armor: [4, 9, 19, 36, 68, 116, 190, 300], req: 'str', reqVal: 6, implicit: [{ stat: 'aps', value: 3 }] },
    boots: { label: '靴子', names: ['草鞋', '皮靴', '铁靴', '秘银战靴', '符文战靴', '龙鳞战靴', '深渊踏靴', '神谕疾行靴'], armor: [4, 10, 21, 40, 74, 128, 208, 330], req: 'str', reqVal: 6, implicit: [{ stat: 'moveSpeed', value: 4 }] },
    belt: { label: '腰带', names: ['布带', '皮带', '铁扣腰带', '秘银腰带', '符文腰带', '龙鳞腰带', '深渊腰带', '神谕束带'], armor: [4, 9, 18, 34, 64, 110, 180, 285], req: 'str', reqVal: 6, implicit: [{ stat: 'life', value: 6 }] },
    ring: { label: '戒指', names: ['铜戒', '银戒', '金戒', '秘银之戒', '符文之戒', '龙骨之戒', '深渊指环', '神谕印记'], armor: [0, 0, 0, 0, 0, 0, 0, 0], req: null, reqVal: 0, implicit: [{ stat: 'crit', value: 1 }] },
    amulet: { label: '项链', names: ['骨链', '银链', '金链', '秘银坠饰', '符文坠饰', '龙骨坠饰', '深渊圣物', '神谕之心'], armor: [0, 0, 0, 0, 0, 0, 0, 0], req: null, reqVal: 0, implicit: [{ stat: 'allResist', value: 5 }] },
  };

  // 装备等级需求：与物品等级挂钩且平滑（约 55%），避免“打到的装备穿不上”
  const LvReq = (ilvl) => Math.max(1, Math.round(ilvl * 0.55));

  const BASES = [];
  const baseById = {};
  function addBase(b) { BASES.push(b); baseById[b.id] = b; }
  Object.keys(WEAPON_TYPES).forEach((t) => {
    const def = WEAPON_TYPES[t];
    for (let i = 0; i < D.TIER_ILVL.length; i++) {
      const g = Math.pow(def.growth, i);
      const avg = (def.dmg[0] + def.dmg[1]) / 2 * g;
      const min = Math.max(1, Math.round(avg * 0.78));
      const max = Math.max(min + 1, Math.round(avg * 1.26));
      const req = { level: LvReq(D.TIER_ILVL[i]) };
      if (def.req) req[def.req] = Math.round(def.reqVal * g * 0.9);
      addBase({
        id: 'w_' + t + '_' + i, name: def.names[i], slot: 'weapon', type: t, kind: def.kind, two: !!def.two,
        ilvl: D.TIER_ILVL[i], min, max, aps: def.aps, armor: 0, req, implicit: def.implicit || [],
      });
    }
  });
  Object.keys(OFFHAND_TYPES).forEach((t) => {
    const def = OFFHAND_TYPES[t];
    for (let i = 0; i < D.TIER_ILVL.length; i++) {
      const req = { level: LvReq(D.TIER_ILVL[i]) };
      if (def.req) req[def.req] = Math.round(def.reqVal * Math.pow(1.4, i) * 0.9);
      addBase({
        id: 'o_' + t + '_' + i, name: def.names[i], slot: 'offhand', type: t, kind: t === 'shield' ? 'shield' : 'focus',
        ilvl: D.TIER_ILVL[i], min: 0, max: 0, aps: 1, armor: def.armor[i], req, implicit: def.implicit || [],
      });
    }
  });
  Object.keys(ARMOR_TYPES).forEach((t) => {
    const def = ARMOR_TYPES[t];
    for (let i = 0; i < D.TIER_ILVL.length; i++) {
      const req = { level: LvReq(D.TIER_ILVL[i]) };
      if (def.req) req[def.req] = Math.max(4, Math.round(def.reqVal * Math.pow(1.42, i) * 0.9));
      addBase({
        id: 'a_' + t + '_' + i, name: def.names[i], slot: t, type: t, kind: 'armor',
        ilvl: D.TIER_ILVL[i], min: 0, max: 0, aps: 1, armor: def.armor[i], req, implicit: def.implicit || [],
      });
    }
  });
  D.BASES = BASES;
  D.baseById = (id) => baseById[id];
  D.basesForSlot = function (slot, ilvl) {
    const out = BASES.filter((b) => b.slot === slot && b.ilvl <= Math.max(1, ilvl) + 3);
    return out.length ? out : BASES.filter((b) => b.slot === slot);
  };
  D.WEAPON_TYPES = WEAPON_TYPES;
  D.OFFHAND_TYPES = OFFHAND_TYPES;
  D.ARMOR_TYPES = ARMOR_TYPES;
  D.TIER_NAMES = TIER_NAMES;

  /* ---------------- 词缀 ---------------- */
  // v: 8 个等级段的数值，掷取范围 [0.72v, v]
  function affix(id, kind, name, stat, v, group, extra) {
    // spread：数值下限的比例，默认 0.72；取整后必须稳定的词缀（如充能次数）可以收窄
    const spread = (extra && extra.spread) || 0.72;
    const tiers = v.map((val, i) => ({ ilvl: D.TIER_ILVL[i], min: Math.round(val * spread * 10) / 10, max: val }));
    return Object.assign({ id, kind, name, stat, tiers, group: group || stat }, extra || {});
  }
  /* 装备部位分组：
   *   ARMOR_GEAR  护甲类装备 —— 护甲 / 生命 / 法力 / 抗性 只出现在这里（以及戒指）
   *   ARMOR_RING  护甲类 + 戒指
   */
  const ARMOR_GEAR = ['helm', 'chest', 'gloves', 'boots', 'belt', 'offhand'];
  const ARMOR_RING = ARMOR_GEAR.concat(['ring']);

  /* 词缀分为前缀与后缀两类，装备上的数量上限：
   *   魔法（蓝）：最多 1 前缀 + 1 后缀
   *   稀有（黄）：最多 3 前缀 + 3 后缀
   * 前缀偏「属性 / 进攻 / 技能」，后缀偏「抗性 / 速度 / 收益 / 回复」。
   */
  const AFFIXES = [
    /* ================= 前缀：属性 / 进攻 / 防御 / 技能 ================= */
    affix('p_str', 'prefix', '强壮的', 'str', [8, 18, 32, 52, 80, 120, 175, 250]),
    affix('p_dex', 'prefix', '灵巧的', 'dex', [8, 18, 32, 52, 80, 120, 175, 250]),
    affix('p_int', 'prefix', '睿智的', 'int', [8, 18, 32, 52, 80, 120, 175, 250]),
    affix('p_vit', 'prefix', '坚韧的', 'vit', [8, 18, 32, 52, 80, 120, 175, 250]),
    affix('p_dmgPct', 'prefix', '残酷的', 'dmgPct', [8, 14, 22, 32, 44, 58, 76, 98], null, { slots: ['weapon'] }),
    affix('p_physDmg', 'prefix', '沉重的', 'physDmg', [10, 18, 28, 40, 55, 72, 92, 116], null, { slots: ['weapon', 'amulet', 'gloves'] }),
    affix('p_addFire', 'prefix', '炽热的', 'addFire', [6, 14, 26, 44, 72, 110, 165, 240], null, { slots: ['weapon', 'amulet'] }),
    affix('p_addCold', 'prefix', '冰封的', 'addCold', [5, 12, 22, 38, 62, 95, 142, 206], null, { slots: ['weapon', 'amulet'] }),
    affix('p_addLight', 'prefix', '雷霆的', 'addLight', [7, 16, 30, 50, 82, 126, 188, 272], null, { slots: ['weapon', 'amulet'] }),
    affix('p_addPoison', 'prefix', '剧毒的', 'addPoison', [6, 13, 25, 42, 68, 104, 156, 226], null, { slots: ['weapon', 'amulet'] }),
    affix('p_fireDmg', 'prefix', '燃烧的', 'fireDmg', [6, 10, 15, 21, 28, 36, 45, 55]),
    affix('p_coldDmg', 'prefix', '霜寒的', 'coldDmg', [6, 10, 15, 21, 28, 36, 45, 55]),
    affix('p_lightDmg', 'prefix', '风暴的', 'lightDmg', [6, 10, 15, 21, 28, 36, 45, 55]),
    affix('p_poisonDmg', 'prefix', '瘟疫的', 'poisonDmg', [6, 10, 15, 21, 28, 36, 45, 55]),
    affix('p_crit', 'prefix', '精准的', 'crit', [1.5, 2.6, 3.8, 5.2, 6.8, 8.5, 10.5, 12.5], null, { slots: ['weapon', 'amulet', 'gloves', 'helm'] }),
    affix('p_critDmg', 'prefix', '致命的', 'critDmg', [12, 20, 30, 42, 56, 72, 90, 110], null, { slots: ['weapon', 'amulet', 'gloves'] }),
    /* 护甲：只在护甲类装备与戒指上出现 */
    affix('p_armor', 'prefix', '坚固的', 'armor', [14, 32, 62, 110, 185, 295, 450, 660], 'p_armor', { slots: ARMOR_RING.slice() }),
    affix('p_armorPct', 'prefix', '壁垒的', 'armorPct', [8, 13, 18, 24, 30, 36, 42, 50], 'p_armor', { slots: ARMOR_RING.slice() }),
    /* 技能等级：属于前缀 */
    affix('p_skill', 'prefix', '专精之', 'skill:__CLASS__', [1, 1, 1, 2, 2, 3, 3, 4], null, { rare: 0.4, dynamic: 'skill' }),
    affix('p_allSkills', 'prefix', '大师的', 'allSkills', [1, 1, 1, 2, 2, 2, 3, 3], null, { rare: 0.25 }),

    /* ================= 后缀：抗性 / 速度 / 收益 / 回复 ================= */
    /* 生命 / 法力：只在护甲类装备与戒指上出现 */
    affix('s_life', 'suffix', '生命之', 'life', [20, 46, 88, 155, 260, 405, 605, 880], null, { slots: ARMOR_RING.slice() }),
    affix('s_mana', 'suffix', '法力之', 'mana', [12, 26, 48, 84, 140, 215, 320, 465], null, { slots: ARMOR_RING.slice() }),
    /* 攻速（已统一攻击 / 施法速度）与移速 */
    affix('s_aps', 'suffix', '迅捷之', 'aps', [4, 7, 10, 13, 16, 19, 22, 25], null, { slots: ['weapon', 'gloves', 'helm', 'amulet'] }),
    affix('s_moveSpeed', 'suffix', '疾风之', 'moveSpeed', [4, 6, 8, 10, 12, 14, 16, 18], null, { slots: ['boots', 'amulet'] }),
    /* 偷取 / 回复 */
    affix('s_lifeSteal', 'suffix', '吸血之', 'lifeSteal', [1, 1.6, 2.4, 3.2, 4, 5, 6, 7], null, { slots: ['weapon', 'amulet', 'gloves'], rare: 0.35 }),
    affix('s_manaSteal', 'suffix', '汲魔之', 'manaSteal', [2, 3, 4, 5.5, 7, 9, 11, 14], null, { slots: ['weapon', 'amulet', 'gloves'] }),
    affix('s_lifeRegen', 'suffix', '再生的', 'lifeRegen', [1.5, 3.5, 7, 12, 20, 32, 50, 74]),
    affix('s_manaRegen', 'suffix', '灵光之', 'manaRegen', [1, 2.5, 5, 9, 15, 24, 38, 58]),
    affix('s_dmgReduce', 'suffix', '守护的', 'dmgReduce', [2, 3, 4, 5, 6, 7, 8, 9], null, { rare: 0.3 }),
    /* 收益类：掉落 / 经验 / 冷却 / 范围 / 拾取 / 闪避 */
    affix('s_mf', 'suffix', '财富之', 'mf', [6, 11, 18, 27, 38, 52, 68, 88]),
    affix('s_gf', 'suffix', '贪婪之', 'gf', [10, 18, 30, 45, 64, 88, 116, 150]),
    affix('s_xp', 'suffix', '智慧之', 'xpBonus', [3, 5, 8, 11, 15, 19, 24, 30]),
    affix('s_cdr', 'suffix', '通悟之', 'cdr', [3, 5, 7, 9, 11, 13, 15, 18], null, { rare: 0.3 }),
    affix('s_areaDmg', 'suffix', '波及之', 'areaDmg', [6, 10, 15, 21, 28, 36, 45, 56]),
    affix('s_dodge', 'suffix', '幻影之', 'dodge', [2, 3, 4, 5, 6, 7, 8, 9], null, { slots: ['boots', 'chest', 'belt', 'helm'] }),
    affix('s_pickup', 'suffix', '磁力之', 'pickup', [14, 22, 32, 44, 58, 74, 92, 112]),
    /* 闪避充能：只出现在鞋子上（戒指不吃这条），spread 收窄保证取整后数值稳定 */
    affix('s_dodgeCharges', 'suffix', '疾影之', 'dodgeCharges', [1.4, 1.4, 1.4, 2.4, 2.4, 2.4, 3.4, 3.4], null, { slots: ['boots'], noRing: true, rare: 0.35, spread: 0.9 }),
    affix('s_dodgeRecharge', 'suffix', '轻盈之', 'dodgeRecharge', [6, 9, 12, 15, 18, 21, 25, 30], null, { slots: ['boots'], noRing: true }),
    /* 抗性：一条全抗 + 四系单抗，只在护甲类装备与戒指上出现 */
    affix('s_allResist', 'suffix', '抗性之', 'allResist', [5, 9, 14, 20, 27, 35, 44, 54], null, { slots: ARMOR_RING.slice() }),
    affix('s_fireRes', 'suffix', '防火之', 'fireResist', [7, 13, 21, 31, 43, 57, 73, 90], null, { slots: ARMOR_RING.slice() }),
    affix('s_coldRes', 'suffix', '御寒之', 'coldResist', [7, 13, 21, 31, 43, 57, 73, 90], null, { slots: ARMOR_RING.slice() }),
    affix('s_lightRes', 'suffix', '绝缘之', 'lightResist', [7, 13, 21, 31, 43, 57, 73, 90], null, { slots: ARMOR_RING.slice() }),
    affix('s_poisonRes', 'suffix', '解毒之', 'poisonResist', [7, 13, 21, 31, 43, 57, 73, 90], null, { slots: ARMOR_RING.slice() }),
  ];
  /* 戒指可以出现任意类型的词缀：给所有带部位限制的词缀补上 ring（noRing 的例外） */
  AFFIXES.forEach((a) => { if (a.slots && !a.noRing && a.slots.indexOf('ring') < 0) a.slots.push('ring'); });
  D.AFFIXES = AFFIXES;
  D.affixById = {}; AFFIXES.forEach((a) => { D.affixById[a.id] = a; });
  D.affixesForSlot = function (slot, kind) {
    return AFFIXES.filter((a) => {
      if (a.kind !== kind) return false;
      if (a.slots && a.slots.indexOf(slot) < 0) return false;
      return true;
    });
  };
  /* 每件装备的前缀 / 后缀数量上限 */
  D.AFFIX_CAP = {
    common: { prefix: 0, suffix: 0 },
    magic: { prefix: 1, suffix: 1 },
    rare: { prefix: 3, suffix: 3 },
    unique: { prefix: 0, suffix: 0 },
  };

  /* ---------------- 宝石 ---------------- */
  D.GEM_TYPES = {
    ruby: { name: '红宝石', stat: 'str', color: '#e2464a', vals: [5, 10, 18, 30, 48] },
    emerald: { name: '绿宝石', stat: 'dex', color: '#48d06a', vals: [5, 10, 18, 30, 48] },
    sapphire: { name: '蓝宝石', stat: 'int', color: '#4a86ff', vals: [5, 10, 18, 30, 48] },
    amethyst: { name: '紫水晶', stat: 'vit', color: '#a460ff', vals: [5, 10, 18, 30, 48] },
    topaz: { name: '黄玉', stat: 'crit', color: '#ffd24a', vals: [1, 2, 3, 4.5, 6] },
    diamond: { name: '钻石', stat: 'allResist', color: '#cfe8ff', vals: [4, 8, 13, 19, 26] },
  };
  D.GEM_TIER_NAME = ['碎裂的', '裂开的', '完整的', '无瑕的', '完美的'];
  // 每种品质一个独立图标，方便一眼区分
  D.GEM_TIER_GLYPH = ['◇', '◈', '◆', '✦', '★'];
  D.GEM_TIER_SHORT = ['碎裂', '裂开', '完整', '无瑕', '完美'];
  D.gemName = function (gem, tier) { return D.GEM_TIER_NAME[tier] + D.GEM_TYPES[gem].name; };
  D.gemGlyph = function (tier) { return D.GEM_TIER_GLYPH[G.clamp(tier | 0, 0, 4)]; };
  D.gemStat = function (gem, tier) { const t = D.GEM_TYPES[gem]; return { stat: t.stat, value: t.vals[tier] }; };

  /* ---------------- 药水 ---------------- */
  D.POTIONS = {
    life: { name: '生命药水', color: '#e2464a', vals: [60, 180, 420, 900] },
    mana: { name: '法力药水', color: '#4a86ff', vals: [50, 140, 320, 660] },
  };

  /* ---------------- 暗金（传奇）装备 ---------------- */
  const UNIQUES = [
    { id: 'u_bloodletter', name: '血喉', type: 'dagger', slot: 'weapon', ilvl: 5, flavor: '它渴望着下一次切割。',
      mods: [{ stat: 'dmgPct', value: 25 }, { stat: 'crit', value: 5 }, { stat: 'lifeSteal', value: 4 }], power: 'bleed' },
    { id: 'u_stormcaller', name: '唤雷者', type: 'sword', slot: 'weapon', ilvl: 12, flavor: '剑锋划过之处，天空回应以怒雷。',
      mods: [{ stat: 'lightDmg', value: 30 }, { stat: 'crit', value: 6 }, { stat: 'addLight', value: 60 }], power: 'stormcall' },
    { id: 'u_razorwind', name: '裂风', type: 'axe', slot: 'weapon', ilvl: 20, flavor: '快得只剩下风的形状。',
      mods: [{ stat: 'aps', value: 22 }, { stat: 'crit', value: 8 }, { stat: 'physDmg', value: 40 }], power: 'thousandcuts' },
    { id: 'u_worldbreaker', name: '碎界者', type: 'greataxe', slot: 'weapon', ilvl: 30, flavor: '大地在它落下前就已碎裂。',
      mods: [{ stat: 'dmgPct', value: 60 }, { stat: 'areaDmg', value: 40 }, { stat: 'str', value: 90 }], power: 'quake' },
    { id: 'u_frostbite', name: '霜噬', type: 'bow', slot: 'weapon', ilvl: 24, flavor: '箭矢离弦时，空气结晶。',
      mods: [{ stat: 'coldDmg', value: 45 }, { stat: 'critDmg', value: 60 }, { stat: 'addCold', value: 90 }], power: 'frostbite' },
    { id: 'u_emberheart', name: '烬心法杖', type: 'staff', slot: 'weapon', ilvl: 16, flavor: '杖中囚禁着一颗燃烧的心。',
      mods: [{ stat: 'fireDmg', value: 40 }, { stat: 'aps', value: 18 }, { stat: 'mana', value: 80 }], power: 'ignite' },
    { id: 'u_voidsong', name: '虚空咏叹', type: 'wand', slot: 'weapon', ilvl: 34, flavor: '每一次咏唱都从虚空借来力量。',
      mods: [{ stat: 'dmgPct', value: 45 }, { stat: 'allSkills', value: 2 }, { stat: 'mana', value: 140 }], power: 'arcaneEcho' },
    { id: 'u_titanhelm', name: '泰坦之冠', type: 'helm', slot: 'helm', ilvl: 18, flavor: '巨人的头骨被打磨成了王冠。',
      mods: [{ stat: 'str', value: 70 }, { stat: 'life', value: 260 }, { stat: 'dmgReduce', value: 6 }], power: 'juggernaut' },
    { id: 'u_phoenix', name: '不死鸟胸甲', type: 'chest', slot: 'chest', ilvl: 26, flavor: '灰烬之中，它总会再次燃起。',
      mods: [{ stat: 'life', value: 420 }, { stat: 'fireResist', value: 45 }, { stat: 'armor', value: 260 }], power: 'phoenix' },
    { id: 'u_shadowstep', name: '影行靴', type: 'boots', slot: 'boots', ilvl: 14, flavor: '踏出一步，便已在别处。',
      mods: [{ stat: 'moveSpeed', value: 18 }, { stat: 'dodge', value: 8 }, { stat: 'dex', value: 40 }], power: 'swiftness' },
    { id: 'u_greed', name: '贪婪之握', type: 'gloves', slot: 'gloves', ilvl: 10, flavor: '它从不松开握着的东西。',
      mods: [{ stat: 'mf', value: 90 }, { stat: 'gf', value: 150 }, { stat: 'pickup', value: 90 }], power: 'greed' },
    { id: 'u_sage', name: '贤者腰带', type: 'belt', slot: 'belt', ilvl: 22, flavor: '知识是最沉的负担。',
      mods: [{ stat: 'int', value: 60 }, { stat: 'xpBonus', value: 45 }, { stat: 'cdr', value: 12 }], power: 'sage' },
    { id: 'u_bloodpact', name: '血契之戒', type: 'ring', slot: 'ring', ilvl: 20, flavor: '代价总是要付的。',
      mods: [{ stat: 'lifeSteal', value: 5 }, { stat: 'dmgPct', value: 30 }, { stat: 'life', value: 180 }], power: 'vampiric' },
    { id: 'u_stormeye', name: '雷眼坠饰', type: 'amulet', slot: 'amulet', ilvl: 28, flavor: '瞳孔中是永不停止的风暴。',
      mods: [{ stat: 'lightDmg', value: 50 }, { stat: 'crit', value: 10 }, { stat: 'allSkills', value: 2 }], power: 'chainlightning' },
    { id: 'u_berserker', name: '狂怒之怒', type: 'greatsword', slot: 'weapon', ilvl: 40, flavor: '越是濒死，越是清醒。',
      mods: [{ stat: 'dmgPct', value: 55 }, { stat: 'aps', value: 18 }, { stat: 'critDmg', value: 120 }], power: 'berserk' },
    { id: 'u_glasscannon', name: '玻璃大炮', type: 'crossbow', slot: 'weapon', ilvl: 44, flavor: '脆弱，且毁灭一切。',
      mods: [{ stat: 'dmgPct', value: 110 }, { stat: 'critDmg', value: 180 }, { stat: 'lifePct', value: -20 }], power: 'glass' },
    { id: 'u_leviathan', name: '利维坦壁垒', type: 'shield', slot: 'offhand', ilvl: 36, flavor: '深海之下的城垣。',
      mods: [{ stat: 'armor', value: 620 }, { stat: 'allResist', value: 45 }, { stat: 'thorns', value: 240 }], power: 'thornsAura' },
    { id: 'u_soulharvest', name: '收割者', type: 'scepter', slot: 'weapon', ilvl: 50, flavor: '每一缕亡魂都让它更锋利。',
      mods: [{ stat: 'dmgPct', value: 50 }, { stat: 'lifeOnHit', value: 60 }, { stat: 'areaDmg', value: 35 }], power: 'lifestorm' },
    { id: 'u_voidheart', name: '虚空之心', type: 'orb', slot: 'offhand', ilvl: 46, flavor: '它替你思考，也替你疯狂。',
      mods: [{ stat: 'allSkills', value: 2 }, { stat: 'critDmg', value: 90 }, { stat: 'mana', value: 220 }], power: 'arcaneEcho' },
    { id: 'u_skyfall', name: '天陨', type: 'mace', slot: 'weapon', ilvl: 56, flavor: '星辰坠落时留下的碎片。',
      mods: [{ stat: 'dmgPct', value: 80 }, { stat: 'areaDmg', value: 60 }, { stat: 'critDmg', value: 150 }], power: 'quake' },
  ];
  D.UNIQUES = UNIQUES;
  D.uniqueById = {}; UNIQUES.forEach((u) => { D.uniqueById[u.id] = u; });

  D.POWER_TEXT = {
    bleed: '攻击有 25% 几率使目标流血，持续造成伤害。',
    stormcall: '攻击有 10% 几率召唤落雷，造成 200% 闪电伤害。',
    thousandcuts: '攻击有 18% 几率立即追加一次 60% 伤害的打击。',
    quake: '击杀敌人时引发地震，对周围造成 250% 物理伤害。',
    frostbite: '暴击使敌人冰冻 2 秒，受到伤害提高 25%。',
    ignite: '火焰技能点燃敌人，持续造成火焰伤害。',
    arcaneEcho: '施放技能有 25% 几率不消耗法力并立即重置冷却。',
    juggernaut: '每 200 点护甲使你的伤害提高 3%。',
    phoenix: '死亡时以 50% 生命复活（每层一次）。',
    swiftness: '击杀敌人后 3 秒内移动速度提高 40%。',
    greed: '金币掉落翻倍，并自动拾取周围物品。',
    sage: '经验获取大幅提高。',
    vampiric: '额外获得 5% 生命偷取。',
    chainlightning: '击中时有 15% 几率释放闪电链，跳跃 4 次。',
    berserk: '生命低于 35% 时，伤害提高 60%，攻速提高 25%。',
    glass: '伤害大幅提高，但生命上限降低。',
    thornsAura: '每秒对周围敌人造成相当于 150% 反弹伤害的伤害。',
    lifestorm: '击杀敌人时回复 6% 最大生命。',
  };
  D.POWER_NAME = {
    bleed: '流血', stormcall: '唤雷', thousandcuts: '千刃', quake: '碎地', frostbite: '霜噬',
    ignite: '点燃', arcaneEcho: '秘法回响', juggernaut: '不动如山', phoenix: '不死鸟',
    swiftness: '疾影', greed: '贪婪', sage: '贤者', vampiric: '血契', chainlightning: '闪电链',
    berserk: '狂怒', glass: '玻璃', thornsAura: '荆棘光环', lifestorm: '灵魂收割',
  };

  /* ---------------- 怪物 ---------------- */
  const MONSTERS = [
    { id: 'imp', name: '沉沦魔', kind: 'melee', shape: 'imp', color: '#7fbf5a', size: 12, life: 12, dmg: 26, armor: 5, speed: 108, range: 26, cd: 0.85, xp: 9, minFloor: 1, weight: 12 },
    { id: 'skeleton', name: '骷髅战士', kind: 'melee', shape: 'skel', color: '#d8d4c4', size: 14, life: 18, dmg: 35, armor: 8, speed: 82, range: 30, cd: 1.0, xp: 12, minFloor: 1, weight: 12 },
    { id: 'archer', name: '骷髅弓手', kind: 'ranged', shape: 'skel', color: '#c9c2a4', size: 13, life: 15, dmg: 31, armor: 4, speed: 76, range: 340, cd: 1.6, xp: 13, minFloor: 1, weight: 10, proj: { speed: 330, color: '#e8e0c0', size: 4 } },
    { id: 'zombie', name: '腐尸', kind: 'melee', shape: 'zombie', color: '#7a9350', size: 17, life: 36, dmg: 53, armor: 14, speed: 58, range: 32, cd: 1.5, xp: 16, minFloor: 2, weight: 10 },
    { id: 'bat', name: '血蝠', kind: 'melee', shape: 'bat', color: '#b0455a', size: 11, life: 11, dmg: 29, armor: 6, speed: 132, range: 24, cd: 0.7, xp: 11, minFloor: 2, weight: 9, erratic: true },
    { id: 'spider', name: '深渊蛛', kind: 'ranged', shape: 'spider', color: '#8a6bd0', size: 13, life: 20, dmg: 29, armor: 6, speed: 92, range: 260, cd: 1.4, xp: 15, minFloor: 3, weight: 9, proj: { speed: 260, color: '#8ce07a', size: 5, elem: 'poison', dot: 0.5 } },
    { id: 'hound', name: '地狱犬', kind: 'charger', shape: 'hound', color: '#c9752f', size: 15, life: 27, dmg: 66, armor: 8, speed: 96, range: 30, cd: 1.2, xp: 20, minFloor: 4, weight: 9, charge: { speed: 430, cd: 3.2, dmg: 1.5 } },
    { id: 'wraith', name: '幽魂', kind: 'caster', shape: 'wraith', color: '#6fc8d8', size: 15, life: 22, dmg: 57, armor: 2, speed: 74, range: 300, cd: 2.0, xp: 22, minFloor: 5, weight: 8, ghost: true, proj: { speed: 230, color: '#6fc8d8', size: 7, elem: 'cold', homing: 1.4 } },
    { id: 'gargoyle', name: '石像鬼', kind: 'brute', shape: 'brute', color: '#8d8d97', size: 21, life: 66, dmg: 88, armor: 40, speed: 66, range: 40, cd: 1.6, xp: 32, minFloor: 6, weight: 8 },
    { id: 'overseer', name: '恶魔督军', kind: 'brute', shape: 'brute', color: '#b3402f', size: 23, life: 84, dmg: 110, armor: 34, speed: 72, range: 44, cd: 1.5, xp: 40, minFloor: 8, weight: 7, area: 46 },
    { id: 'flame', name: '烈焰元素', kind: 'caster', shape: 'elemental', color: '#ff8a3c', size: 16, life: 46, dmg: 92, armor: 12, speed: 70, range: 290, cd: 1.7, xp: 30, minFloor: 9, weight: 7, proj: { speed: 250, color: '#ff8a3c', size: 9, elem: 'fire', explode: 46 } },
    { id: 'frost', name: '冰霜元素', kind: 'caster', shape: 'elemental', color: '#7fd8ff', size: 16, life: 49, dmg: 84, armor: 14, speed: 70, range: 290, cd: 1.8, xp: 30, minFloor: 9, weight: 7, proj: { speed: 240, color: '#7fd8ff', size: 9, elem: 'cold', slow: 0.45 } },
    { id: 'lich', name: '巫妖', kind: 'caster', shape: 'wraith', color: '#b06fd8', size: 17, life: 78, dmg: 101, armor: 20, speed: 68, range: 320, cd: 2.2, xp: 46, minFloor: 11, weight: 6, summon: 'skeleton', summonCd: 6.5, proj: { speed: 300, color: '#b06fd8', size: 8, homing: 1.1 } },
    { id: 'slasher', name: '裂魂者', kind: 'melee', shape: 'demon', color: '#d1476a', size: 18, life: 62, dmg: 119, armor: 22, speed: 104, range: 34, cd: 1.1, xp: 38, minFloor: 10, weight: 8 },
    /* 训练场的假人：不会动、不会打人、打不死，只用来测伤害（weight 0 = 不会随机刷出来） */
    { id: 'dummy', name: '训练假人', kind: 'dummy', shape: 'dummy', color: '#b79b6a', size: 16, life: 40, dmg: 0, armor: 8, speed: 0, range: 0, cd: 99, xp: 0, minFloor: 1, weight: 0, dummy: true },
    { id: 'dummy_boss', name: '训练用恶魔像', kind: 'dummy', shape: 'dummy_boss', color: '#d1476a', size: 26, life: 40, dmg: 0, armor: 30, speed: 0, range: 0, cd: 99, xp: 0, minFloor: 1, weight: 0, dummy: true, isBossDummy: true },
  ];
  D.MONSTERS = MONSTERS;
  D.monsterById = {}; MONSTERS.forEach((m) => { D.monsterById[m.id] = m; });
  // 各怪基础护甲（训练假人除外）：护甲整体缩放要按它们的平均值对齐目标减伤
  G.MONSTER_ARMORS = MONSTERS.filter((m) => !m.dummy).map((m) => m.armor || 0);
  D.monstersForFloor = function (floor) {
    return MONSTERS.filter((m) => !m.dummy && m.minFloor <= floor + 1);
  };

  /* 训练场（戈登）的三种模式 */
  D.TRAINING_MODES = [
    { id: 'single', name: '单个假人', desc: '一个木桩，专心测单体输出' },
    { id: 'multi', name: '多个假人', desc: '三个假人排开，测范围伤害' },
    { id: 'boss', name: 'BOSS 假人', desc: '恶魔像，对首领加成的分支会在这里生效' },
  ];
  D.trainingModeById = (id) => D.TRAINING_MODES.filter((m) => m.id === id)[0] || D.TRAINING_MODES[0];

  /* ---------------- 精英词缀 ---------------- */
  D.ELITE_AFFIXES = [
    { id: 'swift', name: '迅捷', text: '移动速度 +45%', stats: { moveSpeed: 45 } },
    { id: 'mighty', name: '强壮', text: '伤害 +35%', mod: { dmg: 1.35 } },
    { id: 'tough', name: '坚韧', text: '生命 +150%', mod: { life: 2.5 } },
    { id: 'stone', name: '石肤', text: '护甲 +150%', mod: { armor: 2.5 } },
    { id: 'fire', name: '火焰强化', text: '攻击附加火焰伤害，死亡时爆发火环', onHitElem: 'fire', deathNova: { elem: 'fire', mult: 1.4, radius: 120 } },
    { id: 'cold', name: '冰冷强化', text: '攻击附加冰冷伤害并减速', onHitElem: 'cold' },
    { id: 'light', name: '雷霆强化', text: '攻击附加闪电伤害，死亡时释放电环', onHitElem: 'lightning', deathNova: { elem: 'lightning', mult: 1.6, radius: 140 } },
    { id: 'vampiric', name: '吸血', text: '造成伤害时回复生命', lifesteal: 0.35 },
    { id: 'evasive', name: '幻影', text: '闪避 30% 的攻击', stats: { dodge: 30 } },
    { id: 'explosive', name: '爆裂', text: '死亡时爆炸，造成范围伤害', deathNova: { elem: 'physical', mult: 2.0, radius: 130 } },
    { id: 'aura_rage', name: '狂暴光环', text: '附近怪物伤害 +30%', aura: { kind: 'rage', radius: 220, dmg: 1.3 } },
    { id: 'aura_heal', name: '再生光环', text: '附近怪物持续回复生命', aura: { kind: 'heal', radius: 220, hps: 0.05 } },
    { id: 'thorns', name: '尖刺', text: '反弹 40% 近战伤害', stats: { thornsPct: 40 } },
  ];
  D.eliteAffixById = {}; D.ELITE_AFFIXES.forEach((a) => { D.eliteAffixById[a.id] = a; });

  /* ---------------- BOSS ---------------- */
  const BOSSES = [
    { id: 'b_flesh', name: '血肉吞噬者', shape: 'brute', color: '#a8323c', size: 34, life: 115, dmg: 37, armor: 24, speed: 62, range: 56, cd: 1.5,
      attacks: [{ type: 'fan', cd: 4.5, count: 3, speed: 300, elem: 'physical', mult: 1.2, color: '#c04a4a' },
                { type: 'summon', cd: 8, mob: 'zombie', count: 3 },
                { type: 'charge', cd: 7, speed: 520, mult: 2.0 }], enrage: '冲撞与腐尸' },
    { id: 'b_frost', name: '霜语者·维拉', shape: 'wraith', color: '#5fc8ff', size: 32, life: 92, dmg: 33, armor: 14, speed: 70, range: 340, cd: 1.8,
      attacks: [{ type: 'nova', cd: 6, radius: 190, elem: 'cold', mult: 1.5, color: '#7fd8ff', slow: 0.5 },
                { type: 'fan', cd: 3.4, count: 5, speed: 260, elem: 'cold', mult: 1.0, color: '#7fd8ff' },
                { type: 'teleport', cd: 6.5 }], enrage: '冰霜新星与瞬移' },
    { id: 'b_flame', name: '焰喉', shape: 'elemental', color: '#ff7a2c', size: 34, life: 96, dmg: 40, armor: 18, speed: 74, range: 300, cd: 1.6,
      attacks: [{ type: 'cone', cd: 5, radius: 280, arc: 0.7, elem: 'fire', mult: 1.8, color: '#ff9a3c' },
                { type: 'meteor', cd: 7, count: 4, elem: 'fire', mult: 2.2, color: '#ff7a2c', radius: 90 },
                { type: 'fan', cd: 3, count: 4, speed: 300, elem: 'fire', mult: 0.9, color: '#ff9a3c' }], enrage: '火海与陨石' },
    { id: 'b_bone', name: '白骨之王', shape: 'skel', color: '#e0dcc8', size: 36, life: 102, dmg: 35, armor: 26, speed: 78, range: 60, cd: 1.4,
      attacks: [{ type: 'summon', cd: 6, mob: 'skeleton', count: 4 },
                { type: 'fan', cd: 4, count: 7, speed: 320, elem: 'physical', mult: 1.0, color: '#e8e0c0' },
                { type: 'charge', cd: 6, speed: 500, mult: 1.8 }], enrage: '骷髅军团' },
    { id: 'b_weaver', name: '深渊编织者', shape: 'demon', color: '#9a5cff', size: 35, life: 98, dmg: 37, armor: 20, speed: 84, range: 320, cd: 1.7,
      attacks: [{ type: 'chain', cd: 4.5, count: 6, elem: 'lightning', mult: 1.3, color: '#ffe45c' },
                { type: 'nova', cd: 7, radius: 210, elem: 'physical', mult: 1.6, color: '#c07aff' },
                { type: 'teleport', cd: 5 },
                { type: 'fan', cd: 3.2, count: 6, speed: 280, elem: 'lightning', mult: 0.9, color: '#ffe45c' }], enrage: '闪电链与虚空新星' },
  ];
  D.BOSSES = BOSSES;
  D.bossForFloor = function (floor, diff) {
    const idx = Math.floor(floor / 5) + (diff || 0);
    return BOSSES[((idx - 1) % BOSSES.length + BOSSES.length) % BOSSES.length];
  };

  /* ---------------- 技能 ---------------- */
  const SKILLS = {
    /* 野蛮人 */
    barb_basic: { id: 'barb_basic', cls: 'barb', name: '重击', icon: '🗡', type: 'basic', cost: 0, cd: 0, elem: 'physical', weaponMult: 1.0, base: 100, per: 8, radius: 66, arc: 1.6, maxLevel: 25, desc: '挥动武器劈砍面前的敌人。' },
    barb_rend: { id: 'barb_rend', cls: 'barb', name: '撕裂', icon: '🩸', type: 'cone', cost: 12, cd: 3.5, elem: 'physical', weaponMult: 1.1, base: 120, per: 14, radius: 112, arc: 1.5, dot: { elem: 'physical', mult: 0.3, dur: 5 }, reqLevel: 1, maxLevel: 25, desc: '对锥形范围内的敌人造成伤害并使其流血。' },
    barb_whirl: { id: 'barb_whirl', cls: 'barb', name: '旋风斩', icon: '🌀', type: 'around', cost: 22, cd: 4.5, elem: 'physical', weaponMult: 0.85, base: 110, per: 13, radius: 100, reqLevel: 3, maxLevel: 25, desc: '旋转劈砍，对周围所有敌人造成伤害。' },
    barb_shout: { id: 'barb_shout', cls: 'barb', name: '战吼', icon: '📢', type: 'buff', cost: 25, cd: 16, elem: 'physical', base: 0, per: 0, reqLevel: 7, maxLevel: 25, buff: { id: 'shout', name: '战吼', dur: 10, dmg: 25, perDmg: 4, armor: 60, perArmor: 10, icon: '📢' }, desc: '发出怒吼，提高自身伤害与护甲。' },
    barb_leap: { id: 'barb_leap', cls: 'barb', name: '跃击', icon: '💥', type: 'leap', cost: 18, cd: 7, elem: 'physical', weaponMult: 1.6, base: 150, per: 18, radius: 120, range: 380, stun: 1.2, reqLevel: 12, maxLevel: 25, desc: '跃向目标地点，落地造成范围伤害并眩晕。' },
    /* 法师 */
    sorc_basic: { id: 'sorc_basic', cls: 'sorc', name: '秘法弹', icon: '✨', type: 'basic', cost: 0, cd: 0, elem: 'physical', weaponMult: 1.0, base: 105, per: 9, proj: { speed: 520, size: 7, color: '#c9a4ff' }, maxLevel: 25, desc: '发射一枚秘法飞弹。' },
    sorc_fireball: { id: 'sorc_fireball', cls: 'sorc', name: '火球术', icon: '🔥', type: 'projectile', cost: 16, cd: 1.6, elem: 'fire', weaponMult: 1.3, base: 165, per: 21, proj: { speed: 460, size: 14, color: '#ff8a3c', explode: 88 }, ignite: { mult: 0.25, dur: 4 }, reqLevel: 1, maxLevel: 25, desc: '投出火球，命中后爆炸并点燃敌人。' },
    sorc_nova: { id: 'sorc_nova', cls: 'sorc', name: '冰霜新星', icon: '❄', type: 'nova', cost: 20, cd: 5.5, elem: 'cold', base: 150, per: 19, weaponMult: 0.9, radius: 190, slow: 0.55, slowDur: 3, reqLevel: 3, maxLevel: 25, desc: '冰霜从脚下爆发，造成伤害并大幅减速。' },
    sorc_chain: { id: 'sorc_chain', cls: 'sorc', name: '闪电链', icon: '⚡', type: 'chain', cost: 24, cd: 4.5, elem: 'lightning', base: 190, per: 26, weaponMult: 0.8, count: 5, range: 260, reqLevel: 7, maxLevel: 25, desc: '闪电在敌人之间跳跃，最多命中 5 个目标。' },
    sorc_teleport: { id: 'sorc_teleport', cls: 'sorc', name: '传送', icon: '🌌', type: 'teleport', cost: 14, cd: 4, range: 460, reqLevel: 12, maxLevel: 25, novaOnLand: { elem: 'physical', mult: 0.5, radius: 88 }, desc: '瞬间传送到目标位置，落地时造成冲击。' },
    /* 猎魔人 */
    rogue_basic: { id: 'rogue_basic', cls: 'rogue', name: '快速射击', icon: '🏹', type: 'basic', cost: 0, cd: 0, elem: 'physical', weaponMult: 1.0, base: 96, per: 8, proj: { speed: 640, size: 4, color: '#ffe9a8', arrow: true }, maxLevel: 25, desc: '射出快速箭矢。' },
    rogue_multishot: { id: 'rogue_multishot', cls: 'rogue', name: '多重射击', icon: '🎯', type: 'fan', cost: 15, cd: 2.2, elem: 'physical', weaponMult: 0.7, base: 105, per: 13, count: 7, spread: 0.95, proj: { speed: 580, size: 4, color: '#ffe9a8', arrow: true }, reqLevel: 1, maxLevel: 25, desc: '扇形射出一排箭矢。' },
    rogue_pierce: { id: 'rogue_pierce', cls: 'rogue', name: '穿刺箭', icon: '➹', type: 'projectile', cost: 18, cd: 3.2, elem: 'physical', weaponMult: 1.9, base: 175, per: 23, pierce: 99, proj: { speed: 900, size: 6, color: '#fff0c0', arrow: true, length: 34 }, reqLevel: 3, maxLevel: 25, desc: '射出穿透一切的强力箭矢。' },
    rogue_poison: { id: 'rogue_poison', cls: 'rogue', name: '毒云', icon: '☠', type: 'ground', cost: 20, cd: 6, elem: 'poison', base: 60, per: 9, weaponMult: 0.4, radius: 124, dur: 6, tick: 0.5, reqLevel: 7, maxLevel: 25, desc: '在目标区域留下持续伤害的毒云。' },
    rogue_shadow: { id: 'rogue_shadow', cls: 'rogue', name: '影袭', icon: '🌑', type: 'dash', cost: 16, cd: 5, elem: 'physical', weaponMult: 1.5, base: 150, per: 19, range: 300, radius: 64, reqLevel: 12, maxLevel: 25, desc: '瞬移到目标位置，对路径上的敌人造成伤害。' },
  };
  D.SKILLS = SKILLS;
  /* 技能等级软化上限：25 级之后（只能靠装备堆）数值仍会提升，但没有新分支，
   * 且越往后每一点价值越低 —— 等比递减，永远大于 0：
   *   26 级 = 95%、27 级 = 90.3%、28 级 = 85.7% …… 总计约等于 19 个正常等级 */
  D.SKILL_SOFT_CAP = 25;
  D.SKILL_POST_CAP_DECAY = 0.95;
  // 超出上限的第 k 级（k 从 1 数起）价值系数
  D.postCapWeight = (k) => Math.pow(D.SKILL_POST_CAP_DECAY, k);
  // 用于数值计算的等效技能等级
  D.skillScaleLevel = function (lv) {
    const L = Math.max(0, lv | 0);
    if (L <= D.SKILL_SOFT_CAP) return L;
    let eff = D.SKILL_SOFT_CAP;
    for (let k = 1; k <= L - D.SKILL_SOFT_CAP; k++) eff += D.postCapWeight(k);
    return eff;
  };
  D.skillDamageMult = function (sk, level) { return (sk.base + (sk.per || 0) * (D.skillScaleLevel(level) - 1)) / 100; };

  /* ============================================================
   *  技能强化分支
   *  ------------------------------------------------------------
   *  · 每个技能在 5 / 10 / 15 / 20 级各有 2 个分支，25 级有 3 个更强力的分支
   *  · 同一档位的分支互斥：选了其中一个，其它就锁死
   *  · 解锁只看「手动投入的点数」，与装备提供的技能等级无关
   * ============================================================ */
  D.SKILL_TIERS = [5, 10, 15, 20, 25];
  D.BRANCH_STRONG_TIER = 25;
  D.BRANCH_TIER_NAME = { 5: '初阶', 10: '中阶', 15: '高阶', 20: '大师', 25: '传奇' };

  // [名称, 修饰符] —— 同一档位的两个分支强度要接近，只换取向（伤害 / 范围 / 续航 / 特效）
  const BRANCH_RAW = {
    /* ---- 野蛮人 ---- */
    barb_basic: [
      ['开山式', { dmg: 20 }], ['狂乱劈砍', { aps: 18 }],
      ['裂甲', { dmg: 15, knockback: 50 }], ['溅血', { splash: 30 }],
      ['巨人重击', { dmg: 25, vsBoss: 20 }], ['战吼预备', { crit: 8, critDmg: 25 }],
      ['斩首', { execute: { hp: 30, dmg: 60 } }], ['震慑', { stun: 0.8, radius: 15 }],
      ['天崩', { dmg: 45, radius: 30 }], ['剑刃风暴', { aps: 30, splash: 35, knockback: 60 }], ['不屈战意', { leech: 8, manaOnKill: 6 }],
    ],
    barb_rend: [
      ['深创', { dmg: 20 }], ['凝血', { cost: -25 }],
      ['扩大创口', { radius: 25 }], ['持久流血', { dot: 35 }],
      ['撕裂血肉', { dot: 40, dur: 3 }], ['猛击', { dmg: 25, knockback: 60 }],
      ['割喉', { execute: { hp: 35, dmg: 70 } }], ['血怒汲取', { leech: 6, manaOnKill: 5 }],
      ['血海', { dmg: 45, dot: 50 }], ['恐怖领域', { radius: 35, chill: { slow: 0.3, dur: 3 } }], ['无尽饥渴', { leech: 10, vsBoss: 20 }],
    ],
    barb_whirl: [
      ['利刃', { dmg: 18 }], ['省力', { cost: -25 }],
      ['扩风', { radius: 22 }], ['疾旋', { cd: -20 }],
      ['碎骨旋斩', { dmg: 22, knockback: 40 }], ['嗜血旋转', { leech: 5 }],
      ['骨裂', { stun: 0.7, crit: 8 }], ['无尽怒气', { manaOnCast: 8, cd: -15 }],
      ['剑刃风暴', { dmg: 40, radius: 30 }], ['血肉磨盘', { dmg: 15, execute: { hp: 30, dmg: 80 } }], ['风暴之眼', { leech: 8, splash: 40, cost: -30 }],
    ],
    barb_shout: [
      ['洪亮', { buff: 20 }], ['省力', { cost: -30 }],
      ['持久怒吼', { dur: 4 }], ['迅捷怒吼', { cd: -20 }],
      ['狂战怒吼', { buff: 30, crit: 5 }], ['铁壁怒吼', { buff: 20, leech: 4 }],
      ['战争践踏', { stun: 1.0, radius: 30 }], ['不屈意志', { leech: 5, manaOnKill: 6 }],
      ['泰坦怒吼', { buff: 60 }], ['战争号角', { buff: 20, dur: 6, cd: -25 }], ['先祖庇护', { buff: 35, leech: 8, vsBoss: 15 }],
    ],
    barb_leap: [
      ['重踏', { dmg: 20 }], ['轻装', { cost: -25 }],
      ['冲击波', { radius: 25 }], ['快速起跳', { cd: -25 }],
      ['地裂', { dmg: 25, stun: 0.4 }], ['余震', { splash: 45, knockback: 60 }],
      ['天罚', { dmg: 20, vsBoss: 25 }], ['震慑大地', { stun: 1.2, radius: 20 }],
      ['陨石坠落', { dmg: 50, radius: 35 }], ['替换基础闪避', { swapDodge: true }], ['大地守护', { leech: 8, splash: 50 }],
    ],
    /* ---- 法师 ---- */
    sorc_basic: [
      ['锐利秘法', { dmg: 18 }], ['疾速咏唱', { aps: 18 }],
      ['双生飞弹', { count: 1 }], ['元素灌注', { elem: { fire: 0.5 } }],
      ['秘法过载', { dmg: 25, crit: 8 }], ['汲取秘能', { manaOnKill: 8 }],
      ['穿透飞弹', { pierce: 2 }], ['秘法爆裂', { explode: 40, size: 20 }],
      ['奥术洪流', { dmg: 45, count: 2 }], ['虚空飞弹', { pierce: 5, speed: 40 }], ['秘能循环', { manaOnKill: 12, aps: 25 }],
    ],
    sorc_fireball: [
      ['炽热', { dmg: 20 }], ['节能', { cost: -25 }],
      ['巨大火球', { explode: 35, size: 25 }], ['连锁点燃', { cd: -20, dot: 30 }],
      ['熔岩核心', { dmg: 25, dot: 35 }], ['灼热加速', { speed: 35, cd: -12 }],
      ['炎爆', { explode: 50, radius: 20 }], ['燃烧殆尽', { burn: { mult: 0.5, dur: 4 } }],
      ['陨石术', { dmg: 50, explode: 60 }], ['火焰风暴', { dmg: 20, count: 2 }], ['凤凰之焰', { dot: 70, burn: { mult: 0.6, dur: 5 } }],
    ],
    sorc_nova: [
      ['冰锥', { dmg: 20 }], ['节能', { cost: -25 }],
      ['寒霜扩散', { radius: 25 }], ['迅速冷却', { cd: -20 }],
      ['深度冻结', { chill: { slow: 0.25, dur: 3 }, stun: 0.6 }], ['冰爆', { dmg: 25, crit: 8 }],
      ['绝对零度', { chill: { slow: 0.35, dur: 4 }, dmg: 15 }], ['碎冰', { execute: { hp: 35, dmg: 70 } }],
      ['冰川时代', { dmg: 45, radius: 30 }], ['冰封王座', { stun: 1.2, chill: { slow: 0.3, dur: 5 } }], ['寒冰护体', { leech: 8, vsBoss: 20 }],
    ],
    sorc_chain: [
      ['高压', { dmg: 20 }], ['节能', { cost: -25 }],
      ['更多跳跃', { count: 2 }], ['快速充能', { cd: -20 }],
      ['超载', { dmg: 25, crit: 8 }], ['导电', { count: 1, radius: 20 }],
      ['静电领域', { dmg: 20, vsBoss: 25 }], ['感电汲取', { manaOnKill: 8, leech: 5 }],
      ['雷霆万钧', { dmg: 50, count: 2 }], ['风暴之链', { count: 4 }], ['电能回流', { cd: -25, manaOnKill: 12 }],
    ],
    sorc_teleport: [
      ['冲击强化', { dmg: 20 }], ['节能', { cost: -30 }],
      ['更远传送', { radius: 25 }], ['快速传送', { cd: -25 }],
      ['空间撕裂', { dmg: 25, radius: 20 }], ['湮灭回响', { splash: 50, knockback: 70 }],
      ['双重跳跃', { cd: -20, cost: -20 }], ['湮灭冲击', { execute: { hp: 30, dmg: 60 } }],
      ['空间崩塌', { dmg: 50, radius: 35 }], ['替换基础闪避', { swapDodge: true }], ['虚空回响', { manaOnCast: 12, splash: 60 }],
    ],
    /* ---- 猎魔人 ---- */
    rogue_basic: [
      ['锐箭', { dmg: 18 }], ['疾射', { aps: 20 }],
      ['双重射击', { count: 1 }], ['淬毒箭', { elem: { poison: 0.5 } }],
      ['致命一击', { crit: 8, critDmg: 30 }], ['稳定手法', { dmg: 20, speed: 20 }],
      ['穿透箭', { pierce: 2 }], ['猎杀本能', { execute: { hp: 30, dmg: 60 } }],
      ['箭雨', { dmg: 20, count: 2 }], ['穿云箭', { pierce: 6, speed: 40 }], ['猎手专注', { aps: 30, manaOnKill: 8 }],
    ],
    rogue_multishot: [
      ['锐利箭矢', { dmg: 20 }], ['节能', { cost: -25 }],
      ['更多箭矢', { count: 2 }], ['快速装填', { cd: -20 }],
      ['扩散射击', { radius: 30 }], ['精准齐射', { dmg: 22, speed: 25 }],
      ['箭如雨下', { count: 2, dmg: 15 }], ['破甲箭', { crit: 8, vsBoss: 25 }],
      ['万箭齐发', { count: 4 }], ['死亡箭幕', { dmg: 45, count: 2 }], ['猎人节律', { cost: -40, cd: -25, manaOnKill: 8 }],
    ],
    rogue_pierce: [
      ['强化箭头', { dmg: 20 }], ['节能', { cost: -25 }],
      ['破空', { speed: 35 }], ['迅速瞄准', { cd: -20 }],
      ['贯穿', { dmg: 25, pierce: 1 }], ['撕裂箭', { dmg: 18, size: 25 }],
      ['致命穿透', { execute: { hp: 35, dmg: 70 } }], ['猎龙箭', { dmg: 15, vsBoss: 35 }],
      ['弑神之箭', { dmg: 55 }], ['音爆', { speed: 60, knockback: 80, splash: 40 }], ['猎手印记', { leech: 8, manaOnKill: 10 }],
    ],
    rogue_poison: [
      ['剧毒', { dmg: 20 }], ['节能', { cost: -25 }],
      ['扩散毒雾', { radius: 25 }], ['持久毒云', { dur: 3 }],
      ['浓缩毒素', { dot: 40 }], ['快速投掷', { cd: -20, speed: 30 }],
      ['腐蚀之云', { dmg: 20, chill: { slow: 0.3, dur: 3 } }], ['致命毒素', { execute: { hp: 30, dmg: 60 } }],
      ['瘟疫之云', { dmg: 45, radius: 30 }], ['永恒毒雾', { dur: 6, dot: 40 }], ['毒液汲取', { leech: 10, manaOnKill: 8 }],
    ],
    rogue_shadow: [
      ['暗影利刃', { dmg: 20 }], ['节能', { cost: -25 }],
      ['更长突进', { radius: 25 }], ['快速潜行', { cd: -25 }],
      ['影分身', { dmg: 25, radius: 20 }], ['暗影溅射', { splash: 45 }],
      ['致命突袭', { execute: { hp: 35, dmg: 70 } }], ['暗影掌控', { crit: 10, critDmg: 30 }],
      ['千影斩', { dmg: 50, radius: 30 }], ['替换基础闪避', { swapDodge: true }], ['暗影庇护', { leech: 10, splash: 50 }],
    ],
  };

  const ELEM_CN_MAP = { physical: '物理', fire: '火焰', cold: '冰冷', lightning: '闪电', poison: '毒素' };
  const MOD_TEXT = {
    dmg: (v) => '技能伤害 ' + (v > 0 ? '+' : '') + v + '%',
    cost: (v) => '法力消耗 ' + (v > 0 ? '+' : '') + v + '%',
    cd: (v) => '冷却时间 ' + (v > 0 ? '+' : '') + v + '%',
    aps: (v) => '攻击速度 +' + v + '%',
    radius: (v) => '作用范围 ' + (v > 0 ? '+' : '') + v + '%',
    count: (v) => '弹道 / 命中目标 +' + v,
    speed: (v) => '投射物速度 +' + v + '%',
    size: (v) => '投射物体积 +' + v + '%',
    pierce: (v) => '穿透 +' + v,
    dur: (v) => '持续时间 +' + v + ' 秒',
    dot: (v) => '持续伤害 +' + v + '%',
    explode: (v) => '爆炸范围 +' + v + '%',
    buff: (v) => '增益强度 +' + v + '%',
    stun: (v) => '眩晕 +' + v + ' 秒',
    slow: (v) => '减速 +' + v + '%',
    knockback: (v) => '击退 +' + v,
    leech: (v) => '生命偷取 +' + v + '%',
    manaOnKill: (v) => '击杀回复 ' + v + ' 点法力',
    manaOnCast: (v) => '施放回复 ' + v + ' 点法力',
    crit: (v) => '该技能暴击率 +' + v + '%',
    critDmg: (v) => '该技能暴击伤害 +' + v + '%',
    vsBoss: (v) => '对首领伤害 +' + v + '%',
    execute: (v) => '对生命低于 ' + v.hp + '% 的敌人伤害 +' + v.dmg + '%',
    elem: (v) => Object.keys(v).map((k) => Math.round(v[k] * 100) + '% 伤害转化为' + (ELEM_CN_MAP[k] || k)).join('，'),
    splash: (v) => '命中溅射：对周围敌人造成 ' + v + '% 伤害',
    burn: (v) => '命中点燃：每秒 ' + Math.round(v.mult * 100) + '% 伤害，持续 ' + v.dur + ' 秒',
    chill: (v) => '命中减速 ' + Math.round(v.slow * 100) + '% / ' + v.dur + ' 秒',
    swapDodge: () => '闪避键改为释放本技能（消耗闪避充能）',
  };
  const MOD_ICON = {
    dmg: '⚔', cost: '◍', cd: '⏱', aps: '⚡', radius: '◎', count: '⁙', speed: '➤', size: '⬤', pierce: '➹',
    dur: '⌛', dot: '☠', explode: '✸', buff: '✦', stun: '✷', slow: '❄', knockback: '↦', leech: '♥',
    manaOnKill: '◈', manaOnCast: '◉', crit: '✧', critDmg: '✵', vsBoss: '☠', execute: '⚑', elem: '❂',
    splash: '✺', burn: '🔥', chill: '❆', swapDodge: '⤢',
  };

  /* 修饰符 → 说明文本 */
  D.modText = function (mods) {
    const out = [];
    Object.keys(mods || {}).forEach((k) => {
      const fn = MOD_TEXT[k];
      if (fn) out.push(fn(mods[k]));
    });
    return out;
  };
  /* 修饰符 → 图标（取第一个有图标的键） */
  D.modIcon = function (mods) {
    const keys = Object.keys(mods || {});
    for (let i = 0; i < keys.length; i++) if (MOD_ICON[keys[i]]) return MOD_ICON[keys[i]];
    return '◆';
  };

  /* 生成某个技能的完整分支树：{ 5: [b, b], 10: [...], ... } */
  D.skillBranches = function (skillId) {
    const raw = BRANCH_RAW[skillId];
    if (!raw) return null;
    const out = {};
    let i = 0;
    D.SKILL_TIERS.forEach((tier) => {
      const n = tier === D.BRANCH_STRONG_TIER ? 3 : 2;
      const list = [];
      for (let k = 0; k < n; k++) {
        const r = raw[i++] || ['分支', {}];
        list.push({
          id: skillId + ':' + tier + ':' + k,
          skill: skillId, tier: tier, index: k,
          name: r[0], mods: r[1] || {},
          text: D.modText(r[1] || {}),
          icon: D.modIcon(r[1] || {}),
          strong: tier === D.BRANCH_STRONG_TIER,
        });
      }
      out[tier] = list;
    });
    return out;
  };
  D.branchCount = (skillId) => {
    const b = D.skillBranches(skillId);
    if (!b) return 0;
    let n = 0;
    D.SKILL_TIERS.forEach((t) => { n += b[t].length; });
    return n;
  };
  D.branchById = function (skillId, id) {
    const b = D.skillBranches(skillId);
    if (!b) return null;
    for (let i = 0; i < D.SKILL_TIERS.length; i++) {
      const list = b[D.SKILL_TIERS[i]];
      for (let k = 0; k < list.length; k++) if (list[k].id === id) return list[k];
    }
    return null;
  };

  /* ---------------- 洗点费用（深渊向导） ----------------
   *  · 属性点：只看人物等级
   *  · 被动 / 技能：人物等级 + 该处已投入的点数（不含装备加成）
   */
  D.respecCost = {
    attr: (level) => ({
      gold: Math.round(180 * level * (1 + level / 50)),
      shards: 3 + Math.floor(level / 6),
    }),
    passive: (level, pts) => ({
      gold: Math.round(160 * level * (1 + pts / 6)),
      shards: Math.max(1, Math.round(2 * pts * (1 + level / 40))),
    }),
    skill: (level, pts) => ({
      gold: Math.round(140 * level * (1 + pts / 8)),
      shards: Math.max(1, Math.round(1.2 * pts * (1 + level / 40))),
    }),
  };

  /* ---------------- 职业 ---------------- */
  const CLASSES = [
    {
      id: 'barb', name: '野蛮人', title: 'Berserker', glyph: '🪓', color: '#e2a04a', primary: 'str',
      desc: '以蛮力撕碎一切。高生命、高护甲，擅长近身范围屠杀。',
      weaponHint: '推荐：斧 / 巨斧 / 剑',
      base: { str: 26, dex: 10, int: 6, vit: 24 },
      perLevel: { str: 3.0, dex: 0.6, int: 0.3, vit: 2.4 },
      lifeBase: 80, manaBase: 22, lifePerVit: 4.5, lifePerLevel: 8, manaPerInt: 3.2,
      skills: ['barb_basic', 'barb_rend', 'barb_whirl', 'barb_shout', 'barb_leap'],
      skillReqs: [0, 1, 3, 7, 12],
    },
    {
      id: 'sorc', name: '法师', title: 'Sorceress', glyph: '🔮', color: '#7aa8ff', primary: 'int',
      desc: '掌控元素的原初之力。范围伤害爆炸，但身板脆弱。',
      weaponHint: '推荐：法杖 / 魔杖 / 法球',
      base: { str: 8, dex: 12, int: 30, vit: 16 },
      perLevel: { str: 0.4, dex: 0.7, int: 3.2, vit: 1.6 },
      lifeBase: 58, manaBase: 45, lifePerVit: 3.6, lifePerLevel: 5, manaPerInt: 5,
      skills: ['sorc_basic', 'sorc_fireball', 'sorc_nova', 'sorc_chain', 'sorc_teleport'],
      skillReqs: [0, 1, 3, 7, 12],
    },
    {
      id: 'rogue', name: '猎魔人', title: 'Demon Hunter', glyph: '🏹', color: '#9fe06a', primary: 'dex',
      desc: '以速度与精准取胜。远程高爆发，靠翻滚与位移活下来。',
      weaponHint: '推荐：弓 / 弩 / 匕首',
      base: { str: 12, dex: 30, int: 10, vit: 18 },
      perLevel: { str: 0.6, dex: 3.2, int: 0.5, vit: 1.9 },
      lifeBase: 66, manaBase: 32, lifePerVit: 4.2, lifePerLevel: 7, manaPerInt: 4,
      skills: ['rogue_basic', 'rogue_multishot', 'rogue_pierce', 'rogue_poison', 'rogue_shadow'],
      skillReqs: [0, 1, 3, 7, 12],
    },
  ];
  D.CLASSES = CLASSES;
  D.classMap = {}; CLASSES.forEach((c) => { D.classMap[c.id] = c; });
  D.classById = (id) => D.classMap[id] || null;
  D.activeSkills = (cls) => { const c = D.classById(cls); return c ? c.skills.slice(1) : []; };

  /* ---------------- 难度 ----------------
   * 与「深渊层数」彻底分开：
   *   · 层数只决定怪物等级（见 G.mlvlOf）
   *   · 难度在层数之上叠加怪物生命 / 伤害 / 掉落率 / 掉落品质
   * 解锁：在当前难度击败「下一个 5 的倍数层」的深渊领主，即可解锁下一档
   *   （普通 通关 5 层 → 专家；专家 通关 10 层 → 噩梦 ……）
   */
  D.DIFFICULTIES = [
    { name: '普通', roman: 'I', hp: 1.0, dmg: 1.0, xp: 1.0, drop: 1.0, quality: 0, mlvlAdd: 0, resistPen: 0, color: '#cbb894' },
    { name: '专家', roman: 'II', hp: 1.5, dmg: 1.2, xp: 1.5, drop: 1.35, quality: 1, mlvlAdd: 1, resistPen: 10, color: '#8ce07a' },
    { name: '噩梦', roman: 'III', hp: 2.4, dmg: 1.45, xp: 2.2, drop: 1.8, quality: 2, mlvlAdd: 2, resistPen: 22, color: '#7aa8ff' },
    { name: '地狱', roman: 'IV', hp: 3.8, dmg: 1.75, xp: 3.4, drop: 2.4, quality: 3, mlvlAdd: 3, resistPen: 38, color: '#ff8a3c' },
    { name: '炼狱', roman: 'V', hp: 6.0, dmg: 2.1, xp: 5.2, drop: 3.2, quality: 4, mlvlAdd: 4, resistPen: 58, color: '#ff4a4a' },
    { name: '湮灭', roman: 'VI', hp: 9.5, dmg: 2.5, xp: 8.0, drop: 4.2, quality: 5, mlvlAdd: 5, resistPen: 78, color: '#c07aff' },
  ];
  D.diffOf = (idx) => D.DIFFICULTIES[G.clamp(idx | 0, 0, D.DIFFICULTIES.length - 1)];
  /* 生物定义查表（怪物或 BOSS），用于从存档里还原实体 */
  D.defById = (id) => D.monsterById[id] || D.BOSSES.filter((b) => b.id === id)[0] || null;
  /* 解锁第 i 档难度需要在第 i-1 档打到第 unlockFloor 层的领主 */
  D.diffUnlock = (idx) => ({ diff: idx - 1, floor: 5 * idx });
  D.MAX_DIFF = D.DIFFICULTIES.length - 1;

  /* ---------------- 被动 ---------------- */
  D.PASSIVES = [
    { id: 'pa_tough', name: '钢铁体魄', max: 5, text: (l) => '生命上限 +' + (l * 5) + '%', stats: (l) => ({ lifePct: l * 5 }) },
    { id: 'pa_wrath', name: '狂怒', max: 5, text: (l) => '伤害 +' + (l * 4) + '%', stats: (l) => ({ dmgPct: l * 4 }) },
    { id: 'pa_precision', name: '精准', max: 5, text: (l) => '暴击几率 +' + (l * 2) + '%', stats: (l) => ({ crit: l * 2 }) },
    { id: 'pa_swift', name: '疾风步', max: 5, text: (l) => '移动速度 +' + (l * 4) + '%', stats: (l) => ({ moveSpeed: l * 4 }) },
    { id: 'pa_fortune', name: '财富', max: 5, text: (l) => '魔法装备与金币掉落 +' + (l * 15) + '%', stats: (l) => ({ mf: l * 15, gf: l * 15 }) },
    { id: 'pa_focus', name: '专注', max: 5, text: (l) => '冷却缩减 +' + (l * 3) + '%', stats: (l) => ({ cdr: l * 3 }) },
    { id: 'pa_leech', name: '汲取', max: 5, text: (l) => '生命偷取 +' + (l * 1.5) + '%', stats: (l) => ({ lifeSteal: l * 1.5 }) },
    { id: 'pa_arcane', name: '秘能', max: 5, text: (l) => '法力上限 +' + (l * 10) + '%', stats: (l) => ({ manaPct: l * 10 }) },
  ];
  D.passiveById = {}; D.PASSIVES.forEach((p) => { D.passiveById[p.id] = p; });

  /* ---------------- 做装通货（类似于流放之路的通货石） ----------------
   * tier: 稀有度权重档（越高越难掉落）
   * weight: 掉落的相对权重
   * minMlvl: 怪物等级低于此值不会掉落
   */
  D.ORBS = [
    {
      id: 'ascend', name: '晋升石', icon: '◈', color: '#7f9dff', tier: 1, weight: 130, minMlvl: 1, price: 220,
      use: '普通 → 魔法', desc: '把普通装备提升为魔法装备，并增加随机词缀。',
    },
    {
      id: 'augment', name: '增幅石', icon: '✦', color: '#8fd0ff', tier: 1, weight: 100, minMlvl: 3, price: 260,
      use: '装备 +1 词缀', desc: '为词缀未满的装备增加 1 条随机词缀。',
    },
    {
      id: 'purify', name: '净化石', icon: '○', color: '#d6d2cc', tier: 1, weight: 115, minMlvl: 1, price: 150,
      use: '蓝/黄 → 白装', desc: '抹去魔法与稀有装备上的所有词缀，将其还原为普通装备。',
    },
    {
      id: 'refine', name: '炼化石', icon: '❖', color: '#ffe45c', tier: 2, weight: 78, minMlvl: 8, price: 900,
      use: '魔法 → 稀有', desc: '把魔法装备提升为稀有装备，并增加随机词缀。',
    },
    {
      id: 'chaos', name: '混沌石', icon: '✹', color: '#ff8a3c', tier: 2, weight: 62, minMlvl: 10, price: 1200,
      use: '重掷全部词缀', desc: '重掷装备上的全部词缀。不改变装备稀有度或孔位。',
    },
    {
      id: 'fracture', name: '裂解石', icon: '✂', color: '#c07aff', tier: 2, weight: 76, minMlvl: 8, price: 700,
      use: '移除 1 条词缀', desc: '随机移除装备上的一条词缀。',
    },
    {
      id: 'whetstone', name: '点金石', icon: '✧', color: '#8ce07a', tier: 2, weight: 72, minMlvl: 6, price: 800,
      use: '提升数值', desc: '提升装备基底与词缀的数值。',
    },
    {
      id: 'drill', name: '钻孔石', icon: '⊙', color: '#e8d5b5', tier: 2, weight: 58, minMlvl: 12, price: 650,
      use: '+1 孔位', desc: '为装备增加一个孔位。',
    },
    {
      id: 'legend', name: '传说石', icon: '★', color: '#d98b2b', tier: 3, weight: 22, minMlvl: 22, price: 3600,
      use: '黄装 → 传奇',
      // desc 里的换行会原样显示（#tooltip .tflavor 用了 white-space:pre-line）
      desc: '为稀有装备注入一条随机的暗金特效，保留装备自身词缀。\n对已被注入的装备重复使用则会刷新其暗金特效。',
    },
  ];
  D.orbById = {}; D.ORBS.forEach((o) => { D.orbById[o.id] = o; });

  D.MATERIAL = { id: 'shard', name: '深渊残晶', icon: '❖', color: '#9fe8ff', desc: '分解装备得到的材料，用于升级城镇建筑。' };

  /* ---------------- 深渊区域风格 ----------------
   * 每层随机挑一种：决定地面 / 墙体底色、地面装饰的种类、以及发光的物件。
   * base 是这套风格的底色（渲染时再叠一点「层数深度」的色调），
   * light 是发光的物件：kind 决定画成什么样子，hue / color 决定光色。 */
  D.ABYSS_THEMES = [
    {
      id: 'crypt', name: '幽暗墓穴', wall: 'block',
      base: { floor: [26, 22, 19], wall: [14, 12, 11], wallTop: [46, 40, 33] },
      decor: ['crack', 'bone', 'rubble', 'blood', 'moss'],
      light: 'torch', lightName: '火把', lightHue: 32, lightColor: '#ffb060', lightR: [120, 185],
    },
    {
      id: 'forest', name: '幽林', wall: 'forest',
      base: { floor: [22, 32, 21], wall: [11, 17, 11], wallTop: [44, 64, 38] },
      decor: ['grass', 'rock', 'moss', 'root', 'crack'],
      light: 'mushroom', lightName: '荧光蘑菇', lightHue: 132, lightColor: '#9cf08a', lightR: [105, 155],
    },
    {
      id: 'snow', name: '霜原', wall: 'glacier',
      // 冰川是白的：冰体接近纯白，缝里只留一点淡蓝灰
      base: { floor: [52, 58, 68], wall: [104, 120, 140], wallTop: [214, 228, 242] },
      decor: ['snow', 'ice', 'rock', 'crack'],
      light: 'crystal', lightName: '冰晶', lightHue: 196, lightColor: '#bfeaff', lightR: [120, 170],
    },
    {
      id: 'lava', name: '熔岩洞窟', wall: 'rocky',
      // 岩壁底色是暗橙红：缝里像有余温，碎石比它亮一档
      base: { floor: [42, 25, 19], wall: [96, 40, 18], wallTop: [104, 52, 30] },
      decor: ['rock', 'spike', 'crack', 'blood'],
      light: 'lava', lightName: '熔岩', lightHue: 14, lightColor: '#ff8a3c', lightR: [150, 215],
    },
  ];
  D.themeById = (id) => D.ABYSS_THEMES.filter((t) => t.id === id)[0] || D.ABYSS_THEMES[0];

  /* ---------------- 城镇建筑 ----------------
   * 每级提供一条永久加成（战斗类加成立即生效，功能类影响对应服务）
   * cost(lv) 返回升到 lv 级所需花费
   */
  D.BUILDING_VAULT_CAP = (l) => 40 + 20 * Math.max(1, l | 0);
  // 仓库每升 1 级顺带扩 5 格背包（1 级 = 基础 60 格，满级 5 级 = 80 格）
  D.BUILDING_BAG_CAP = (l) => 60 + 5 * (Math.max(1, l | 0) - 1);
  D.BUILDINGS = [
    {
      id: 'forge', name: '铁匠铺', glyph: '⚒', max: 5, color: '#c9752f',
      desc: '熔炉越是炽热，从废弃装备中回炉出的残晶就越多。',
      perk: (l) => '分解装备的残晶产出 +' + (l * 25) + '%',
      salvage: (l) => 1 + (l - 1) * 0.25,
      cost: (l) => ({ gold: Math.round(700 * Math.pow(2.05, l - 2)), shards: Math.round(6 * Math.pow(1.9, l - 2)) }),
    },
    {
      id: 'workshop', name: '秘法工坊', glyph: '⚗', max: 5, color: '#7aa8ff',
      desc: '工匠们在工坊里把深渊的碎片锻造成做装用的通货石。',
      perk: (l) => '通货石掉落几率 +' + (l * 15) + '%、深渊残晶掉落率 +' + (l * 20) + '%',
      orbDrop: (l) => 1 + l * 0.15,
      shardDrop: (l) => 1 + l * 0.2,
      cost: (l) => ({ gold: Math.round(900 * Math.pow(2.05, l - 2)), shards: Math.round(8 * Math.pow(1.9, l - 2)) }),
    },
    {
      id: 'altar', name: '深渊祭坛', glyph: '⛩', max: 5, color: '#d98b2b',
      desc: '向深渊献祭，换取血肉与力量上的祝福。',
      perk: (l) => '生命上限 +' + (l * 4) + '%、伤害 +' + (l * 3) + '%、全抗 +' + (l * 2.5) + '',
      stats: (l) => ({ lifePct: l * 4, dmgPct: l * 3, allResist: l * 2.5 }),
      cost: (l) => ({ gold: Math.round(1200 * Math.pow(2.1, l - 2)), shards: Math.round(10 * Math.pow(1.9, l - 2)) }),
    },
    {
      id: 'trainyard', name: '训练场', glyph: '⚔', max: 5, color: '#9fe06a',
      desc: '与木桩和陪练厮杀，让每一次深渊之行都更有收获。',
      perk: (l) => '经验获取 +' + (l * 7) + '%',
      stats: (l) => ({ xpBonus: l * 7 }),
      cost: (l) => ({ gold: Math.round(800 * Math.pow(2.0, l - 2)), shards: Math.round(6 * Math.pow(1.85, l - 2)) }),
    },
    {
      id: 'vault', name: '仓库', glyph: '▤', max: 5, color: '#cbb894',
      desc: '扩建仓库，把刷到的好东西统统留下来。',
      perk: (l) => '仓库容量 ' + D.BUILDING_VAULT_CAP(l) + ' 格　背包 ' + D.BUILDING_BAG_CAP(l) + ' 格',
      stashCap: (l) => D.BUILDING_VAULT_CAP(l),
      bagCap: (l) => D.BUILDING_BAG_CAP(l),
      cost: (l) => ({ gold: Math.round(600 * Math.pow(1.95, l - 2)), shards: Math.round(5 * Math.pow(1.8, l - 2)) }),
    },
    {
      id: 'market', name: '集市', glyph: '⚖', max: 5, color: '#ffe45c',
      desc: '商人川流不息，金币与好货都会更多。',
      perk: (l) => '金币掉落 +' + (l * 12) + '%、魔法装备掉落 +' + (l * 7) + '%',
      stats: (l) => ({ gf: l * 12, mf: l * 7 }),
      cost: (l) => ({ gold: Math.round(1000 * Math.pow(2.05, l - 2)), shards: Math.round(8 * Math.pow(1.9, l - 2)) }),
    },
  ];
  D.buildingById = {}; D.BUILDINGS.forEach((b) => { D.buildingById[b.id] = b; });
})(typeof globalThis !== 'undefined' ? globalThis : this);
