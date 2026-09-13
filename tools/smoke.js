/* ============================================================
 *  暗影深渊 · 无头冒烟测试
 *  用法：node tools/smoke.js [帧数]
 *  在 Node 中模拟 DOM/Canvas，跑完整游戏循环，检查运行时错误
 * ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');

process.chdir(path.join(__dirname, '..'));

/* ---------------- 极简 DOM / Canvas 垫片 ---------------- */
const noop = () => { };
function FakeCtx() {
  const grad = { addColorStop: noop };
  // 浏览器会拒绝非有限数（NaN / Infinity），这里照做，避免渲染层的 NaN 悄悄溜过去
  const finite = (name, args) => {
    for (let i = 0; i < args.length; i++) {
      if (typeof args[i] === 'number' && !Number.isFinite(args[i])) {
        throw new TypeError('Failed to execute \'' + name + '\': The provided double value is non-finite.');
      }
    }
    return grad;
  };
  return {
    canvas: { width: 1280, height: 720 },
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    font: '10px sans-serif', textAlign: 'left', textBaseline: 'top',
    shadowColor: '#000', shadowBlur: 0, globalCompositeOperation: 'source-over',
    save: noop, restore: noop, setTransform: noop, resetTransform: noop,
    translate: noop, scale: noop, rotate: noop, clearRect: noop,
    fillRect: noop, strokeRect: noop, rect: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
    arc: noop, ellipse: noop, fill: noop, stroke: noop, clip: noop,
    drawImage: noop, setLineDash: noop, putImageData: noop,
    fillText: noop, strokeText: noop,
    measureText: () => ({ width: 42 }),
    createRadialGradient: function () { return finite('createRadialGradient', arguments); },
    createLinearGradient: function () { return finite('createLinearGradient', arguments); },
    createPattern: () => null, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
}
class FakeEl {
  constructor(tag, id) {
    this.tagName = (tag || 'div').toUpperCase();
    this.id = id || '';
    this.children = [];
    this.style = {};
    // 真实 DOM 的 dataset 会把值转成字符串
    this.dataset = new Proxy({}, {
      set: (t, k, v) => { t[k] = String(v); return true; },
      get: (t, k) => t[k],
      deleteProperty: (t, k) => { delete t[k]; return true; },
    });
    this.hidden = false;
    this.className = '';
    this._html = '';
    this.textContent = '';
    this.value = '';
    this.width = 180; this.height = 180;
    this.offsetWidth = 120; this.offsetHeight = 60;
    this.parentNode = null;
    this._ctx = null;
    const self = this;
    const list = () => String(self.className || '').split(/\s+/).filter(Boolean);
    this.classList = {
      add: function () {
        const l = list();
        Array.prototype.forEach.call(arguments, (c) => { if (l.indexOf(c) < 0) l.push(c); });
        self.className = l.join(' ');
      },
      remove: function () {
        const drop = Array.prototype.slice.call(arguments);
        self.className = list().filter((c) => drop.indexOf(c) < 0).join(' ');
      },
      toggle: function (c, on) {
        const has = list().indexOf(c) >= 0;
        const want = on === undefined ? !has : !!on;
        if (want && !has) this.add(c);
        else if (!want && has) this.remove(c);
        return want;
      },
      contains: (c) => list().indexOf(c) >= 0,
    };
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get firstChild() { return this.children[0]; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  insertBefore(c) { this.children.unshift(c); c.parentNode = this; return c; }
  contains() { return false; }
  closest() { return null; }
  addEventListener() { }
  removeEventListener() { }
  querySelector() { return new FakeEl('span'); }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 60 }; }
  getContext() { if (!this._ctx) this._ctx = FakeCtx(); return this._ctx; }
  setAttribute() { } getAttribute() { return null; } removeAttribute() { }
  focus() { } blur() { } click() { }
}

const els = new Map();
function getEl(id) {
  if (!els.has(id)) els.set(id, new FakeEl('div', id));
  return els.get(id);
}
const store = new Map();
globalThis.__HEADLESS__ = true;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = noop;
globalThis.location = { reload: noop, href: 'file:///index.html' };
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.AudioContext = undefined;
globalThis.document = {
  readyState: 'complete',
  body: new FakeEl('body'),
  getElementById: getEl,
  createElement: (tag) => new FakeEl(tag),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop,
  removeEventListener: noop,
};

/* ---------------- 加载游戏脚本 ---------------- */
const files = ['core.js', 'data.js', 'loot.js', 'stats.js', 'dungeon.js', 'town.js', 'combat.js', 'entities.js', 'render.js', 'filter.js', 'ui.js', 'game.js', 'main.js'];
files.forEach((f) => {
  const p = path.join(__dirname, '..', 'js', f);
  if (!fs.existsSync(p)) throw new Error('缺少文件: ' + p);
  require(p);
});

const G = globalThis.G;

/* ---------------- 断言工具 ---------------- */
let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(label + (extra != null ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n\x1b[36m== ' + t + ' ==\x1b[0m'); }
function report(label) { console.log('  ✓ ' + label); }

/* ============================================================ */
section('1. 数据完整性');
ok(G.DATA.BASES.length > 90, '装备基底生成', G.DATA.BASES.length);
ok(G.DATA.AFFIXES.length > 40, '词缀数量', G.DATA.AFFIXES.length);
ok(G.DATA.MONSTERS.length >= 12, '怪物种类', G.DATA.MONSTERS.length);
ok(G.DATA.UNIQUES.length >= 18, '暗金数量', G.DATA.UNIQUES.length);
// 暗金基底必须存在
let badUnique = 0;
G.DATA.UNIQUES.forEach((u) => {
  const found = G.DATA.BASES.some((b) => b.slot === u.slot && b.type === u.type);
  if (!found) { badUnique++; console.log('    ! 暗金无匹配基底: ' + u.id); }
});
ok(badUnique === 0, '暗金基底可解析', badUnique);
// 技能引用
let badSkill = 0;
G.DATA.CLASSES.forEach((c) => {
  c.skills.forEach((id) => { if (!G.DATA.SKILLS[id]) { badSkill++; console.log('    ! 未知技能 ' + id); } });
  ok(c.skills.length === 5, c.name + ' 技能数=5');
});
ok(badSkill === 0, '职业技能引用正确');
report('基础数据校验完成');

/* ============================================================ */
section('2. 掉落 / 物品生成（随机 3000 件 × ilvl 1-90）');
const rng = G.RNG(12345);
let itemCount = 0, socketCount = 0, uniqueCount = 0, rareCount = 0, magicCount = 0;
const raritySeen = {};
let totalStatSum = 0;
for (let i = 0; i < 3000; i++) {
  const ilvl = 1 + Math.floor(rng.next() * 90);
  const it = G.Loot.makeItem(rng, { ilvl, mf: rng.range(0, 400), cls: rng.pick(['barb', 'sorc', 'rogue']) });
  itemCount++;
  raritySeen[it.rarity] = (raritySeen[it.rarity] || 0) + 1;
  if (it.rarity === 'unique') uniqueCount++;
  if (it.rarity === 'rare') rareCount++;
  if (it.rarity === 'magic') magicCount++;
  if (it.sockets > 0) { socketCount++; if (it.gems.length !== it.sockets) ok(false, '孔位数量不一致'); }
  if (!G.DATA.baseById(it.base)) ok(false, '物品基底无效: ' + it.base);
  if (it.rarity !== 'unique' && it.rarity !== 'common' && it.affixes.length === 0) ok(false, '魔法/稀有物品没有词缀');
  const stats = G.Stats.itemStats(it);
  let sum = 0; for (const k in stats) sum += Math.abs(stats[k]);
  totalStatSum += sum;
  if (sum <= 0) ok(false, '物品无任何属性: ' + it.uid + ' ' + it.rarity);
  const html = G.Loot.tooltipHTML(it, null, {});
  if (!html || html.indexOf('undefined') >= 0 || html.indexOf('NaN') >= 0) {
    ok(false, 'tooltip 异常: ' + G.Loot.displayName(it) + ' / ' + (html.match(/undefined|NaN/g) || []).join(','));
  }
  if (!(G.Loot.price(it) > 0)) ok(false, '价格异常');
}
ok(itemCount === 3000, '生成 3000 件装备');
ok(uniqueCount > 0 && rareCount > 0 && magicCount > 0, '四种稀有度均出现', JSON.stringify(raritySeen));
ok(socketCount > 0, '带孔装备出现', socketCount);
report('装备生成 ' + itemCount + ' 件，暗金 ' + uniqueCount + '，稀有 ' + rareCount + '，魔法 ' + magicCount + '，带孔 ' + socketCount);
report('平均属性强度 ' + Math.round(totalStatSum / itemCount));

/* 宝石 / 药水 */
const gem = G.Loot.makeGem(rng, 30);
ok(!!G.DATA.GEM_TYPES[gem.gem], '宝石生成');
ok(!!G.DATA.gemStat(gem.gem, gem.tier).stat, '宝石属性');
report('宝石：' + gem.name);

/* ============================================================ */
section('3. 地牢生成（1-25 层 & 极端参数）');
for (let f = 1; f <= 25; f++) {
  const diffIdx = Math.floor(f / 6);
  const map = G.Dungeon.generate(G.RNG(f * 977 + 13), { floor: f, diffIdx });
  if (!map || map.rooms.length < 4) ok(false, '第 ' + f + ' 层房间过少: ' + (map && map.rooms.length));
  if (!map.spawns.length) ok(false, '第 ' + f + ' 层没有刷怪点');
  const startSolid = G.Dungeon.solidAtWorld(map, map.playerStart.x, map.playerStart.y);
  if (startSolid) ok(false, '第 ' + f + ' 层出生点在墙里');
  const stairsSolid = G.Dungeon.solidAtWorld(map, map.stairs.x, map.stairs.y);
  if (stairsSolid) ok(false, '第 ' + f + ' 层传送门在墙里');
  const los = G.Dungeon.lineOfSight(map, map.playerStart.x, map.playerStart.y, map.playerStart.x + 20, map.playerStart.y);
  if (typeof los !== 'boolean') ok(false, 'lineOfSight 返回值异常');
  const hasBoss = map.spawns.some((s) => s.kind === 'boss');
  if ((f % 5 === 0) !== hasBoss) ok(false, '第 ' + f + ' 层 BOSS 标记错误 (isBoss=' + map.isBoss + ')');
}
for (let i = 0; i < 40; i++) {
  const map = G.Dungeon.generate(G.RNG(9001 + i * 77), { floor: 1 + i, diffIdx: i % 5 });
  const free = G.Dungeon.findFree(map, map.playerStart.x, map.playerStart.y, 15);
  if (G.Dungeon.circleBlocked(map, free.x, free.y, 12)) ok(false, 'findFree 返回了被阻挡的位置');
}
report('25 层地牢结构校验通过（出生点/传送门/BOSS 层/寻位）');

/* ============================================================ */
section('4. 启动游戏 & 长时间模拟');
const game = G.boot();
ok(!!game, 'G.boot() 成功');
ok(!!G.GAME && G.GAME === game, 'G.GAME 已挂载');
game.startClass('barb');
ok(game.started, '开局成功');
ok(game.area === 'town', '开局位于城镇（余烬营地）', game.area);
ok(game.map && game.map.npcs && game.map.npcs.length >= 6, '城镇生成了 NPC', game.map.npcs.length);
ok(game.map.buildings.length >= 6, '城镇生成了建筑', game.map.buildings.length);
game.toDungeon(1);
ok(game.area === 'dungeon', '可以从城镇进入地牢', game.area);
ok(game.monsters.length > 0, '进入地牢后有怪物', game.monsters.length);
ok(!G.Dungeon.solidAtWorld(game.map, game.player.x, game.player.y), '玩家出生点可通行');
ok(game.player.stats.maxLife > 0 && game.player.life > 0, '玩家生命初始化');
report('职业：' + game.player.cls + '　生命 ' + game.player.stats.maxLife + '　伤害 ' +
  Math.round(game.player.stats.weaponMin) + '-' + Math.round(game.player.stats.weaponMax));

const FRAMES = parseInt(process.argv[2] || '9000', 10);
let errors = 0, maxMonsters = 0, maxParticles = 0, deaths = 0, levels = 0, floorsCleared = 0;
const startLevel = game.player.level;
const seedRng = G.RNG(4242);
const startFloor = game.floor;
let stuckFrames = 0, lastX = game.player.x, lastY = game.player.y;

for (let f = 0; f < FRAMES; f++) {
  try {
    const p = game.player;
    // 智能模拟：靠近最近的怪物并攻击，随机放技能，血量低喝药
    let best = null, bd = 1e9;
    for (const m of game.monsters) {
      if (m.dead) continue;
      const d = G.dist2(p.x, p.y, m.x, m.y);
      if (d < bd) { bd = d; best = m; }
    }
    if (best) {
      p.attackTarget = best;
      if (G.dist(p.x, p.y, best.x, best.y) > 50) {
        const a = G.ang(p.x, p.y, best.x, best.y);
        const mv = G.Dungeon.slideMove(game.map, p.x, p.y, Math.cos(a) * 2.6, Math.sin(a) * 2.6, p.r);
        p.x = mv.x; p.y = mv.y;
      }
    } else {
      p.attackTarget = null;
      if (game.portalOpen) {
        const a = G.ang(p.x, p.y, game.map.stairs.x, game.map.stairs.y);
        const mv = G.Dungeon.slideMove(game.map, p.x, p.y, Math.cos(a) * 2.6, Math.sin(a) * 2.6, p.r);
        p.x = mv.x; p.y = mv.y;
      }
    }
    // 卡墙检测：模拟玩家绕过障碍（直接挪到目标附近）以继续测试战斗
    if (f % 60 === 59) {
      if (G.dist(p.x, p.y, lastX, lastY) < 12) stuckFrames++; else stuckFrames = 0;
      lastX = p.x; lastY = p.y;
      if (stuckFrames > 0 && best) {
        p.x = best.x + G.rand(-30, 30);
        p.y = best.y + G.rand(-30, 30);
        stuckFrames = 0;
      }
    }
    // 随机技能
    const actives = G.DATA.activeSkills(p.cls);
    if (seedRng.chance(0.06)) {
      const id = seedRng.pick(actives);
      if (G.Stats.skillLevel(p, id) > 0) {
        p.facing = G.rand(0, G.TAU);
        G.Skills.cast(game, p, id, { x: p.x + Math.cos(p.facing) * 150, y: p.y + Math.sin(p.facing) * 150 });
      }
    }
    if (p.life / p.stats.maxLife < 0.5) game.usePotion('life');
    if (p.mana / p.stats.maxMana < 0.4) game.usePotion('mana');
    if (seedRng.chance(0.02)) G.input.simulate('Space');
    if (seedRng.chance(0.01)) G.input.simulate('Digit2');
    if (seedRng.chance(0.002)) { G.UI.togglePanel('panel-inventory'); G.UI.togglePanel('panel-inventory'); }
    if (seedRng.chance(0.002)) { G.UI.togglePanel('panel-character'); G.UI.togglePanel('panel-character'); }
    if (seedRng.chance(0.001)) { G.UI.togglePanel('panel-vendor'); G.UI.buy(0); G.UI.togglePanel('panel-vendor'); }
    if (seedRng.chance(0.01)) game.pickupNearby();

    const beforeFloor = game.floor;
    game.update(1 / 60);
    if (game.floor !== beforeFloor) floorsCleared++;
    if (game.player.dead) deaths++;
    maxMonsters = Math.max(maxMonsters, game.monsters.length);
    maxParticles = Math.max(maxParticles, game.particles.length);
  } catch (e) {
    errors++;
    console.error('\x1b[31m[帧 ' + f + ' 异常]\x1b[0m', e && e.stack ? e.stack : e);
    if (errors > 4) break;
  }
}
ok(errors === 0, '模拟过程无异常', errors + ' 个异常');
ok(game.player.x === game.player.x && game.player.y === game.player.y, '玩家坐标有效（非 NaN）');
ok(maxMonsters > 0, '怪物系统运行', '峰值 ' + maxMonsters);
ok(game.player.kills > 0, '确实击杀了怪物', game.player.kills + ' 击杀');
if (FRAMES >= 3000) ok(game.player.level > startLevel, '角色升级', 'Lv.' + startLevel + ' → Lv.' + game.player.level);
else report('（帧数较少，跳过升级断言）');
ok(game.player.gold > 0, '金币获取', Math.round(game.player.gold));
ok(game.player.inventory.filter(Boolean).length > 0, '拾取到物品', game.player.inventory.filter(Boolean).length + ' 件');
report('模拟 ' + FRAMES + ' 帧（' + Math.round(FRAMES / 60) + ' 秒游戏时间）');
report('击杀 ' + game.player.kills + '　等级 ' + game.player.level + '　层数 ' + game.floor +
  '　难度 ' + G.DATA.diffOf(game.diffIdx).name + '　通过层数 ' + floorsCleared);
report('峰值怪物 ' + maxMonsters + '　峰值粒子 ' + maxParticles + '　死亡次数 ' + deaths);
report('金币 ' + Math.round(game.player.gold) + '　背包 ' + game.player.inventory.filter(Boolean).length + '/60');

/* ============================================================ */
section('5. 装备 / 宝石 / 商店 交互');
const p = game.player;
// 构造一件装备并穿上
const testWeapon = G.Loot.makeItem(rng, { ilvl: Math.max(1, p.level), slot: 'weapon', rarity: 'rare', cls: p.cls });
const oldWeapon = p.gear.weapon;
p.gear.weapon = testWeapon;
G.Stats.derive(p);
ok(p.stats.weaponDps > 0, '装备武器后 DPS 有效', Math.round(p.stats.weaponDps));
// 宝石
const testGear = G.Loot.makeItem(rng, { ilvl: Math.max(1, p.level), slot: 'chest', rarity: 'rare', cls: p.cls });
testGear.sockets = Math.max(1, testGear.sockets);
testGear.gems = new Array(testGear.sockets).fill(null);
p.inventory[0] = testGear;
const g2 = G.Loot.makeGem(rng, 60);
p.inventory[1] = g2;
const dmgBefore = G.Stats.itemStats(testGear).crit || 0;
G.UI.insertGemInto(testGear);
const after = G.Stats.itemStats(testGear);
ok(Object.keys(after).length > 0, '镶嵌宝石后属性可读取');
ok(testGear.gems.filter(Boolean).length === 1, '宝石已镶嵌到孔位');
ok(p.inventory[1] == null, '宝石已从背包移除');
// 全装备穿戴后属性健全
G.DATA.gearSlots().forEach((s) => {
  if (!p.gear[s] && s !== 'offhand' && s !== 'amulet' && s !== 'ring1' && s !== 'ring2') {
    p.gear[s] = G.Loot.makeItem(rng, { ilvl: Math.max(1, p.level), slot: s === 'ring1' || s === 'ring2' ? 'ring' : s, rarity: 'rare', cls: p.cls });
  }
});
G.Stats.derive(p);
ok(p.stats.maxLife > 0 && isFinite(p.stats.armor) && isFinite(p.stats.crit), '全套装备后属性有效');
report('满装备：生命 ' + p.stats.maxLife + '　护甲 ' + p.stats.armor + '　暴击 ' + p.stats.crit.toFixed(1) +
  '%　DPS ' + Math.round(p.stats.weaponDps) + '　MF +' + Math.round(p.stats.mf) + '%');

// 商店
G.UI.rollVendorStock();
p.gold += 100000;
const invBefore = p.inventory.filter(Boolean).length;
G.UI.buy(0); G.UI.buy(8); G.UI.buy(G.UI.vendorStock.length - 1);
ok(p.inventory.filter(Boolean).length > invBefore, '商店购买成功');
const goldBefore = p.gold;
p.inventory.forEach((it, i) => { if (it && it.cat === 'equip') G.UI.sellInv(i); });
ok(p.gold > goldBefore, '出售装备获得金币');
report('商店买入/卖出正常');

// 排序 & 一键卖出（背包里的按钮已移除，改由商人面板调用同一套逻辑）
const junkBefore = p.inventory.filter(Boolean).length;
for (let i = 0; i < 10; i++) p.inventory[i] = G.Loot.makeItem(rng, { ilvl: 20, rarity: 'common' });
G.UI.sellAllEquipRun();
G.UI.sortInventory();
ok(p.inventory.length === 60 && p.inventory.filter(Boolean).length < junkBefore + 10,
  '一键卖出清掉了装备（' + junkBefore + ' + 10 → ' + p.inventory.filter(Boolean).length + '）');
ok(p.inventory.every((it) => !it || it.rarity), '整理后背包里都是完整的物品');
report('背包整理与一键卖出正常');

/* ============================================================ */
section('6. BOSS 层与难度推进');
game.floor = 5;
game.enterFloor(5);
ok(game.map.isBoss, '第 5 层是 BOSS 层');
const boss = game.monsters.filter((m) => m.isBoss)[0];
ok(!!boss, 'BOSS 已生成', boss && boss.name);
const trash = game.monsters.filter((m) => !m.isBoss && !m.elite)[0];
ok(boss.maxLife > 150, 'BOSS 生命值合理', boss && Math.round(boss.maxLife));
ok(!trash || boss.maxLife > trash.maxLife * 6, 'BOSS 明显强于普通怪',
  boss && trash ? Math.round(boss.maxLife) + ' vs ' + Math.round(trash.maxLife) : 'n/a');
const diffBefore = game.diffIdx;
// 打死 BOSS
G.Combat.hitMonster(game, boss, { physical: boss.maxLife * 10 }, { source: 'player' });
ok(boss.dead, 'BOSS 被击杀');
/* 难度不再自动提升：改为「在本难度打下 5 的倍数层」解锁下一档 */
ok(game.diffIdx === diffBefore, '击杀 BOSS 不再自动提升难度', diffBefore + ' → ' + game.diffIdx);
ok((game.player.diffCleared[game.diffIdx] | 0) >= 5, '击杀 BOSS 会记录本难度的最深层数',
  JSON.stringify(game.player.diffCleared));
ok(game.phoenixUsed === false, '不死鸟标记已重置');
// 拾取全部掉落
for (let i = 0; i < 60 && game.pickups.length; i++) game.collectPickup(game.pickups[0]);
ok(game.pickups.length < 5, 'BOSS 掉落可拾取', game.pickups.length);
report('BOSS：' + boss.name + '　生命 ' + Math.round(boss.maxLife) + '　掉落 ' + G.RARITY_NAME.rare + '+ 若干');

/* BOSS 技能全部触发一遍 */
[1, 2, 3, 4, 5].forEach((f) => {
  game.floor = f * 5;
  game.enterFloor(f * 5);
  const b = game.monsters.filter((m) => m.isBoss)[0];
  if (!b) { ok(false, 'BOSS 缺失 floor=' + f * 5); return; }
  b.aggro = true;
  b.spawnT = 0;
  try {
    (b.def.attacks || []).forEach((a) => { G.Combat.bossAttack(game, b, a); });
    for (let i = 0; i < 12; i++) G.ENT.updateMonster(game, b, 1 / 60);
    G.Combat.bossAttack(game, b, { type: 'charge', speed: 400, mult: 2 });
    for (let i = 0; i < 80; i++) game.update(1 / 60);
  } catch (e) {
    ok(false, 'BOSS 技能异常 ' + b.name, e.message);
  }
});
report('5 个 BOSS 的全部技能均已执行无异常');

/* ============================================================ */
section('7. 传送门与楼层推进');
game.floor = 7;
game.enterFloor(7);
const floorNow = game.floor;
// 记录开门前的玩家位置，用来验证门会出现在玩家附近
game.player.x = game.map.playerStart.x;
game.player.y = game.map.playerStart.y;
const stairsBefore = { x: game.map.stairs.x, y: game.map.stairs.y };
game.killed = game.totalMonsters;
game.checkFloorClear();
ok(game.portalOpen, '清怪后传送门开启');
const pd = G.dist(game.player.x, game.player.y, game.map.stairs.x, game.map.stairs.y);
ok(pd < 200, '传送门出现在玩家附近（' + Math.round(pd) + 'px）');
ok(stairsBefore.x !== game.map.stairs.x || stairsBefore.y !== game.map.stairs.y, '传送门位置从房间角落挪到了玩家身边');
ok(!G.Dungeon.circleBlocked(game.map, game.map.stairs.x, game.map.stairs.y, 18), '传送门落在可通行的位置');

// 站在门上但什么都不按 → 不会自动进入
for (let i = 0; i < 120; i++) {
  game.player.x = game.map.stairs.x;
  game.player.y = game.map.stairs.y;
  game.update(1 / 60);
}
ok(game.floor === floorNow, '站在传送门上不会自动进入下一层', '第 ' + game.floor + ' 层');
ok(game.atPortal(64), '站在传送门旁时 atPortal 判定为真');

// 传送到远处 → atPortal 为假
game.player.x = game.map.stairs.x + 300;
game.player.y = game.map.stairs.y + 300;
game.update(1 / 60);
ok(!game.atPortal(64), '离远后 atPortal 判定为假');

// 按 F 进入
game.player.x = game.map.stairs.x;
game.player.y = game.map.stairs.y;
G.input.simulate('KeyF');
game.update(1 / 60);
G.input.simulateUp('KeyF');
ok(game.floor === floorNow + 1, '按 F 进入下一层', floorNow + ' → ' + game.floor);
ok(!game.portalOpen, '进入新一层后传送门关闭');
report('楼层推进正常：第 ' + floorNow + ' 层 → 第 ' + game.floor + ' 层（按 F 进入）');

/* ============================================================ */
section('8. 存档 / 读档');
p.gold = 12345;
p.level = 17;
game.save();
ok(G.storage.exists(), '存档已写入');
const game2 = new G.Game(999);
const loaded = game2.load();
ok(loaded, '读档成功');
ok(game2.player.level === 17, '等级已恢复', game2.player.level);
ok(Math.round(game2.player.gold) === 12345, '金币已恢复', game2.player.gold);
ok(game2.floor === game.floor, '层数已恢复', game2.floor);
ok(game2.player.gear.weapon && game2.player.gear.weapon.cat === 'equip', '装备已恢复');
ok(game2.player.inventory.length === 60, '背包已恢复');
G.Stats.derive(game2.player);
ok(game2.player.stats.maxLife > 0, '读档后属性重算正常', game2.player.stats.maxLife);
report('存档体积 ' + Math.round(JSON.stringify(G.storage.load()).length / 1024) + ' KB　等级 ' + game2.player.level + '　层数 ' + game2.floor);

/* ============================================================ */
section('9. 死亡 / 复活与技能冷却');
const p3 = game.player;
p3.gold = 1000;
p3.dead = false;
p3.invuln = 0;
p3.stats.dodge = 0; // 排除闪避随机性对测试的干扰
G.Combat.hitPlayer(game, { physical: 1e9 }, {});
ok(p3.dead, '玩家被击杀');
ok(Math.round(p3.gold) === 900, '死亡损失 10% 金币', p3.gold);
for (let i = 0; i < 240; i++) game.update(1 / 60);
ok(!p3.dead, '3 秒后自动复活');
ok(p3.life > 0, '复活后生命 > 0', Math.round(p3.life));
// 冷却
const skId = G.DATA.activeSkills(p3.cls)[0];
p3.skills[skId] = 5;
p3.mana = p3.stats.maxMana;
p3.cds[skId] = 0;
const cast1 = G.Skills.cast(game, p3, skId, { x: p3.x + 50, y: p3.y });
ok(cast1 === true, '技能释放成功');
ok(p3.cds[skId] > 0 || G.DATA.SKILLS[skId].cd === 0, '技能进入冷却');
const cast2 = G.Skills.cast(game, p3, skId, { x: p3.x + 50, y: p3.y });
ok(cast2 === false, '冷却中无法再次释放');
for (let i = 0; i < 400; i++) game.update(1 / 60);
ok(p3.cds[skId] <= 0.001, '冷却结束', p3.cds[skId].toFixed(3));
report('死亡惩罚、复活与技能冷却正常');

/* ============================================================ */
section('10. 三职业 + 长时间深度模拟');
['barb', 'sorc', 'rogue'].forEach((cls) => {
  const g3 = new G.Game(cls === 'barb' ? 11 : cls === 'sorc' ? 22 : 33);
  G.GAME = g3;
  G.UI.game = g3;
  g3.player = G.ENT.makePlayer(g3, cls);
  g3.started = true;
  g3.enterFloor(3);
  let err = 0;
  for (let f = 0; f < 2400; f++) {
    try {
      const pl = g3.player;
      pl.attackTarget = g3.monsters.filter((m) => !m.dead)[0] || null;
      if (pl.attackTarget) {
        const a = G.ang(pl.x, pl.y, pl.attackTarget.x, pl.attackTarget.y);
        pl.x += Math.cos(a) * 1.6; pl.y += Math.sin(a) * 1.6;
      }
      const ids = G.DATA.activeSkills(cls);
      ids.forEach((id) => {
        if (G.Stats.skillLevel(pl, id) <= 0) pl.skills[id] = 3;
        if (seedRng.chance(0.01)) G.Skills.cast(g3, pl, id, { x: pl.x + 100, y: pl.y });
      });
      if (pl.life < pl.stats.maxLife * 0.4) pl.life = pl.stats.maxLife;
      g3.update(1 / 60);
    } catch (e) { err++; if (err < 3) console.error('   [' + cls + '] ', e.stack); }
  }
  ok(err === 0, cls + ' 模拟无异常', err);
  report(cls + '：等级 ' + g3.player.level + '　击杀 ' + g3.player.kills + '　DPS ' + Math.round(g3.player.stats.weaponDps));
});

/* 深层数压力测试 */
const g4 = new G.Game(777);
G.GAME = g4; G.UI.game = g4;
g4.player = G.ENT.makePlayer(g4, 'sorc');
g4.started = true;
g4.diffIdx = 4;
g4.enterFloor(45);
ok(g4.mlvl > 50, '高层怪物等级', g4.mlvl);
ok(g4.mlvl === G.mlvlOf(45, 4), '怪物等级 = 层数为主 + 难度少量加成', g4.mlvl + ' vs ' + G.mlvlOf(45, 4));
let deepErr = 0, deepFrames = 0;
for (let f = 0; f < 1800; f++) {
  try {
    const pl = g4.player;
    pl.level = 70;
    pl.alloc = { str: 0, dex: 0, int: 400, vit: 200 };
    if (f % 60 === 0) G.Stats.derive(pl);
    pl.life = pl.stats.maxLife;
    pl.attackTarget = g4.monsters.filter((m) => !m.dead)[0] || null;
    if (pl.attackTarget) { pl.x = pl.attackTarget.x - 60; pl.y = pl.attackTarget.y; }
    g4.update(1 / 60);
    deepFrames++;
  } catch (e) { deepErr++; if (deepErr < 3) console.error('   [deep]', e.stack); }
}
ok(deepErr === 0, '高难度深层模拟无异常', deepErr);
ok(g4.player.stats.maxLife > 1000, '高等级玩家生命成长', g4.player.stats.maxLife);
report('炼狱 45 层（怪物等级 ' + g4.mlvl + '）：生命 ' + g4.player.stats.maxLife + '　击杀 ' + g4.player.kills);

/* ============================================================ */
section('11. 操作模式：鼠标模式 / WASD 模式');
{
  const g = new G.Game(31337);
  G.GAME = g; G.UI.game = g;
  g.player = G.ENT.makePlayer(g, 'rogue');
  g.started = true;
  g.enterFloor(2);
  const pl = g.player;
  G.Stats.derive(pl);
  ok(pl.stats.weaponKind === 'ranged', '猎魔人使用远程武器', pl.stats.weaponKind);
  g.aimWorld = () => ({ x: pl.x + Math.cos(pl.facing) * 120, y: pl.y + Math.sin(pl.facing) * 120 });
  const clearMouse = () => { G.input.mouse.left = false; G.input.mouse.right = false; G.input.mouse.leftPressed = false; G.input.mouse.rightPressed = false; };

  /* ================= 鼠标模式 ================= */
  G.Settings.setMode('mouse');
  ok(G.Settings.getBind('attack') === 'MouseRight', '鼠标模式：右键为普通攻击', G.Settings.getBind('attack'));
  ok(G.Settings.getBind('skill1') === 'Digit1' && G.Settings.getBind('skill4') === 'Digit4', '鼠标模式：1-4 为四个技能');
  ok(!G.Settings.getBind('moveUp'), '鼠标模式：WASD 默认未绑定（纯鼠标移动）');

  /* 右键点敌人 → 锁定攻击 + 远程保持距离 */
  g.monsters.length = 0;
  const mob = G.ENT.makeMonster(g, 'skeleton', pl.x + 120, pl.y, {});
  mob.spawnT = 0; mob.aggro = true; mob.speed = 0;      // 固定怪物，只观察玩家位移
  mob.maxLife = 999999; mob.life = 999999;              // 别被打死，否则会脱离锁定
  g.monsters.push(mob);
  pl.facing = 0;
  const d0 = G.dist(pl.x, pl.y, mob.x, mob.y);
  G.input.mouse.right = true; G.input.mouse.rightPressed = true;
  for (let i = 0; i < 45; i++) {
    G.input.mouse.rightPressed = (i === 0);
    g.update(1 / 60);
    mob.x = mob.homeX; mob.y = mob.homeY;
  }
  const d1 = G.dist(pl.x, pl.y, mob.x, mob.y);
  ok(pl.attackTarget === mob, '鼠标模式：右键点击敌人会锁定目标', !!pl.attackTarget);
  ok(d1 >= d0 - 6, '鼠标模式：远程攻击时不会向敌人前进（' + d0.toFixed(0) + ' → ' + d1.toFixed(0) + '）');
  ok(G.ENT.keepDistance(pl) > 100, '远程职业有保持距离阈值', Math.round(G.ENT.keepDistance(pl)));
  clearMouse();

  /* 左键点地面 → 只移动，不攻击 */
  g.monsters.length = 0;
  pl.attackTarget = null;
  g.update(1 / 60);
  pl.facing = Math.PI;
  G.input.mouse.left = true; G.input.mouse.leftPressed = true;
  g.update(1 / 60);
  ok(pl.attackTarget === null, '鼠标模式：左键点击不会锁定攻击目标');
  const mx0 = pl.x;
  for (let i = 0; i < 20; i++) { G.input.mouse.leftPressed = false; g.update(1 / 60); }
  ok(pl.x < mx0, '鼠标模式：左键朝点击位置移动', mx0.toFixed(0) + ' → ' + pl.x.toFixed(0));
  clearMouse();
  g.update(1 / 60);

  /* 按住左键不会顺手打出普攻 */
  const killsBefore = pl.kills;
  G.input.mouse.left = true; G.input.mouse.leftPressed = true;
  for (let i = 0; i < 30; i++) { G.input.mouse.leftPressed = false; g.update(1 / 60); }
  ok(pl.kills === killsBefore, '鼠标模式：按住左键不会自动攻击');
  clearMouse();
  g.update(1 / 60);

  /* --- 鼠标死区：光标在角色附近时停下，移开后恢复移动 --- */
  g.enterTown({ silent: true });
  const pt = g.player;
  const open = G.Dungeon.tileCenter(23, 17);      // 城镇中央街道，天生无阻挡
  pt.x = open.x; pt.y = open.y; pt.moveTarget = null;
  const DZ = G.ENT.MOUSE_DEAD_ZONE;
  ok(DZ >= 20 && DZ <= 60, '鼠标死区半径合理（' + DZ + 'px）');
  const aimPt = { x: pt.x + 200, y: pt.y };
  g.aimWorld = () => ({ x: aimPt.x, y: aimPt.y });
  clearMouse();
  G.input.mouse.left = true; G.input.mouse.leftPressed = true;
  for (let i = 0; i < 90; i++) { G.input.mouse.leftPressed = false; g.update(1 / 60); }
  const nearD = G.dist(pt.x, pt.y, aimPt.x, aimPt.y);
  ok(nearD <= DZ + 6, '按住左键走到光标处会停下（距光标 ' + nearD.toFixed(1) + 'px）');
  const stopX = pt.x, stopY = pt.y;
  for (let i = 0; i < 30; i++) g.update(1 / 60);
  ok(G.dist(pt.x, pt.y, stopX, stopY) < 2, '光标不动时角色保持静止');
  ok(!!pt.moveTarget, '按住期间保留移动目标点');

  /* 光标在死区内小幅晃动 → 角色不应移动 */
  aimPt.x = pt.x + DZ - 6; aimPt.y = pt.y + 4;
  for (let i = 0; i < 40; i++) g.update(1 / 60);
  ok(Math.abs(pt.x - stopX) < 2 && Math.abs(pt.y - stopY) < 2, '光标停在死区内时角色不跟随移动',
    'Δ=' + G.dist(pt.x, pt.y, stopX, stopY).toFixed(1) + 'px');

  /* 光标移出死区 → 立即恢复移动 */
  aimPt.x = pt.x - 180;
  for (let i = 0; i < 40; i++) g.update(1 / 60);
  ok(pt.x < stopX - 30, '光标移出死区后角色恢复移动（' + stopX.toFixed(0) + ' → ' + pt.x.toFixed(0) + '）');
  /* 松开左键后走到目标点就停 */
  G.input.mouse.left = false; G.input.mouse.leftPressed = false;
  g.update(1 / 60);
  clearMouse();
  for (let i = 0; i < 150; i++) g.update(1 / 60);
  ok(Math.abs(pt.x - aimPt.x) < DZ + 8 && pt.moveTarget === null, '松开左键后走到目标点并停下',
    Math.abs(pt.x - aimPt.x).toFixed(0) + 'px');
  g.toDungeon(2);

  /* ================= WASD 模式 ================= */
  G.Settings.setMode('wasd');
  ok(G.Settings.getBind('attack') === 'MouseLeft', 'WASD 模式：左键为普通攻击', G.Settings.getBind('attack'));
  ok(G.Settings.getBind('skill1') === 'MouseRight', 'WASD 模式：右键为技能 1', G.Settings.getBind('skill1'));
  ok(G.Settings.getBind('skill2') === 'Digit1' && G.Settings.getBind('skill3') === 'Digit2' && G.Settings.getBind('skill4') === 'Digit3',
    'WASD 模式：1/2/3 为技能 2/3/4', [G.Settings.getBind('skill2'), G.Settings.getBind('skill3'), G.Settings.getBind('skill4')].join('/'));
  ok(G.Settings.getBind('moveUp') === 'KeyW' && G.Settings.getBind('moveRight') === 'KeyD', 'WASD 模式：WASD 负责移动');

  /* 猎魔人：1 → 穿刺箭（activeSkills[1]） */
  const actives = G.DATA.activeSkills('rogue');
  ok(actives[1] === 'rogue_pierce' && actives[2] === 'rogue_poison' && actives[3] === 'rogue_shadow',
    '猎魔人 activeSkills 顺序正确', actives.join(','));

  /* WASD 移动 */
  const wx0 = pl.x, wy0 = pl.y;
  G.input.simulate('KeyA');
  for (let i = 0; i < 12; i++) g.update(1 / 60);
  G.input.simulateUp('KeyA');
  ok(pl.x < wx0, 'WASD 模式：A 键向左移动', wx0.toFixed(0) + ' → ' + pl.x.toFixed(0));
  G.input.simulate('KeyS');
  for (let i = 0; i < 12; i++) g.update(1 / 60);
  G.input.simulateUp('KeyS');
  ok(pl.y > wy0, 'WASD 模式：S 键向下移动');

  /* 左键攻击：只出手，不移动 */
  g.monsters.length = 0;
  pl.attackTarget = null;
  pl.attackTimer = 0;
  pl.facing = 0;
  const wx1 = pl.x, wy1 = pl.y;
  const mob2 = G.ENT.makeMonster(g, 'skeleton', pl.x + 100, pl.y, {});
  mob2.spawnT = 0; mob2.speed = 0;
  g.monsters.push(mob2);
  const hp0 = mob2.life;
  G.input.mouse.left = true; G.input.mouse.leftPressed = true;
  for (let i = 0; i < 40; i++) { G.input.mouse.leftPressed = false; g.update(1 / 60); mob2.x = mob2.homeX; mob2.y = mob2.homeY; }
  clearMouse();
  ok(Math.abs(pl.x - wx1) < 6 && Math.abs(pl.y - wy1) < 6, 'WASD 模式：左键攻击不会让角色移动',
    wx1.toFixed(0) + ',' + wy1.toFixed(0) + ' → ' + pl.x.toFixed(0) + ',' + pl.y.toFixed(0));
  ok(g.projectiles.length > 0 || mob2.life <= hp0, 'WASD 模式：左键确实打出了普通攻击');

  /* 技能键：Digit1 释放穿刺箭（actives[1]），右键释放技能 1 */
  const castLog = [];
  const origCast = G.Skills.cast;
  G.Skills.cast = function (game, p, id, aim) { castLog.push(id); return origCast.apply(this, arguments); };
  pl.mana = pl.stats.maxMana;
  actives.forEach((id) => { pl.skills[id] = 3; });
  pl.cds = {};
  G.input.simulate('Digit1');
  g.update(1 / 60);
  G.input.simulateUp('Digit1');
  ok(castLog.indexOf(actives[1]) >= 0, 'WASD 模式：数字键 1 = 技能 2（穿刺箭）', castLog.join(','));
  castLog.length = 0;
  pl.cds = {};
  G.input.mouse.right = true; G.input.mouse.rightPressed = true;
  g.update(1 / 60);
  clearMouse();
  ok(castLog.indexOf(actives[0]) >= 0, 'WASD 模式：右键 = 技能 1', castLog.join(','));
  G.Skills.cast = origCast;

  /* 鼠标模式：Digit1 = 技能 1 */
  G.Settings.setMode('mouse');
  const castLog2 = [];
  G.Skills.cast = function (game, p, id, aim) { castLog2.push(id); return origCast.apply(this, arguments); };
  pl.cds = {};
  G.input.simulate('Digit1');
  g.update(1 / 60);
  G.input.simulateUp('Digit1');
  ok(castLog2.indexOf(actives[0]) >= 0, '鼠标模式：数字键 1 = 技能 1', castLog2.join(','));
  G.Skills.cast = origCast;
  G.Settings.setMode('mouse');
  g.aimWorld = G.Game.prototype.aimWorld;
}
report('两种操作模式的按键分工、移动与攻击行为均正确');

/* ============================================================ */
section('11b. 设置与按键重绑定');
{
  G.Settings.reset();
  G.Settings.setMode('mouse');
  ok(G.Settings.ACTIONS.length >= 20, '可重绑定的动作数量', G.Settings.ACTIONS.length);
  ok(G.Settings.ACTIONS.every((a) => G.Settings.getBind(a.id) !== undefined), '每个动作都有绑定值（可为未绑定）');

  /* 改键 */
  G.Settings.setBind('potionLife', 'KeyR');
  ok(G.Settings.getBind('potionLife') === 'KeyR', '改键生效');
  ok(G.Settings.keyLabel('KeyR') === 'R' && G.Settings.keyLabel('Space') === '空格' && G.Settings.keyLabel('MouseLeft') === '鼠标左键',
    '按键显示名正确', [G.Settings.keyLabel('KeyR'), G.Settings.keyLabel('Space')].join('/'));
  ok(G.Settings.pressed('potionLife') === false, '未按下的改键动作返回 false');
  G.input.simulate('KeyR');
  ok(G.Settings.pressed('potionLife') === true, '改键后按新键可触发动作');
  G.input.endFrame();
  G.input.simulateUp('KeyR');

  /* 两种模式互不影响 */
  G.Settings.setBind('potionLife', 'KeyR');            // 鼠标模式
  ok(G.Settings.getBind('potionLife', 'wasd') === 'KeyQ', '另一个模式的绑定不受影响');
  ok(G.Settings.getBind('potionLife', 'mouse') === 'KeyR', '当前模式的绑定已修改');

  /* 鼠标键绑定可被识别 */
  ok(G.Settings.isMouseAction('attack') === true, '鼠标模式普攻绑定的是鼠标键');
  G.Settings.setMode('wasd');
  ok(G.Settings.isMouseAction('attack') === true, 'WASD 模式普攻同样绑定鼠标键');

  /* 持久化 */
  G.Settings.save();
  const reloaded = G.Settings.load();
  ok(reloaded.binds.mouse.potionLife === 'KeyR', '设置写入 localStorage 后可读回');
  ok(reloaded.mode === 'wasd', '操作模式被持久化', reloaded.mode);
  ok(reloaded.binds.wasd.moveUp === 'KeyW', 'WASD 绑定被持久化');

  /* 恢复默认 */
  G.Settings.reset();
  ok(G.Settings.getBind('potionLife', 'mouse') === 'KeyQ', '恢复默认后回到默认绑定', G.Settings.getBind('potionLife', 'mouse'));
  ok(G.Settings.mode() === 'wasd', '恢复默认不会改变当前操作模式');
  G.Settings.setMode('mouse');

  /* 设置界面渲染 */
  let uiErr = 0;
  try {
    G.UI.buildStart(G.GAME);
    G.UI.togglePanel('panel-settings', true);
    G.UI.renderSettings();
    const dl = G.el('mode-desc');
    ok(dl && dl.textContent.length > 0, '设置面板显示当前模式说明');
    const lbl = G.el('bind-mode-label');
    ok(lbl && lbl.textContent.indexOf('鼠标操作') >= 0, '按键列表标注当前模式', lbl && lbl.textContent);
    ok(G.el('bind-list').children.length > 0, '按键绑定列表已渲染', G.el('bind-list').children.length + ' 行');
    G.UI.setMode('wasd');
    ok(G.el('mode-desc').textContent.indexOf('W A S D') >= 0, '切换模式后说明同步更新', G.el('mode-desc').textContent.slice(0, 24));
    ok(G.Settings.mode() === 'wasd', '设置面板切换模式生效');
    G.UI.setMode('mouse');
    G.UI.togglePanel('panel-settings', false);
  } catch (e) { uiErr++; console.error('   [设置界面]', e && e.stack ? e.stack : e); }
  ok(uiErr === 0, '设置界面渲染/交互无异常', uiErr);

  /* 暂停菜单里的设置入口 */
  ok(!!G.el('btn-menu-settings'), '暂停菜单存在“游戏设置”按钮');
  const g2 = new G.Game(4711);
  G.GAME = g2; G.UI.game = g2;
  g2.startClass('barb', 0);
  G.UI.setPaused(true);
  ok(g2.paused === true && G.el('panel-menu').hidden === false, '暂停菜单已打开');
  // 模拟点击“游戏设置”：保持暂停并打开设置面板
  G.el('panel-menu').hidden = true;
  G.UI._settingsFromMenu = true;
  G.UI.togglePanel('panel-settings', true);
  ok(G.UI.open === 'panel-settings', '从暂停菜单打开设置');
  ok(g2.paused === true, '打开设置期间游戏保持暂停（不会被偷袭）');
  G.UI.togglePanel('panel-settings', false);
  ok(G.el('panel-menu').hidden === false, '关闭设置后回到暂停菜单');
  ok(G.UI._settingsFromMenu === false, '暂停来源标记已复位');
  G.UI.setPaused(false);
  ok(g2.paused === false, '继续游戏后恢复运行');
  // 快捷键打开设置（非暂停来源）关闭时不应弹出暂停菜单
  G.UI.togglePanel('panel-settings', true);
  G.UI.togglePanel('panel-settings', false);
  ok(G.el('panel-menu').hidden === true, '快捷键打开设置后关闭不会弹出暂停菜单');
  report('设置面板的改键、模式隔离、持久化、界面渲染与暂停入口正常');
}

/* ============================================================ */
section('11c. 走远自动关闭 NPC 窗口');
{
  const g = new G.Game(9182);
  G.GAME = g; G.UI.game = g;
  g.startClass('barb', 0);
  const p = g.player;
  const npc = g.townMap.npcs[0];
  g.player.x = npc.x; g.player.y = npc.y;
  g.interactNpc(npc);
  ok(G.UI.open === npc.panel, '与 NPC 交谈打开窗口', G.UI.open);
  ok(!!G.UI.anchor, '打开了锚点追踪');
  g.update(1 / 60);
  ok(G.UI.open === npc.panel, '站在 NPC 旁边窗口保持打开');

  /* 走远 → 自动关闭 */
  g.player.x = npc.x + 400; g.player.y = npc.y + 400;
  g.update(1 / 60);
  g.update(1 / 60);
  g.update(1 / 60);
  ok(G.UI.open === null, '走远后窗口自动关闭', G.UI.open);

  /* 快捷键打开的面板不会因为走远而关闭 */
  G.UI.togglePanel('panel-inventory', true);
  ok(G.UI.anchor === null, '快捷键打开的面板没有锚点');
  g.player.x = npc.x - 500;
  g.update(1 / 60); g.update(1 / 60); g.update(1 / 60);
  ok(G.UI.open === 'panel-inventory', '快捷键面板不会因走远而关闭', G.UI.open);
  G.UI.togglePanel('panel-inventory', false);

  /* 深渊之门同样有锚点 */
  g.player.x = g.map.gate.x; g.player.y = g.map.gate.y;
  g.interactGate();
  ok(G.UI.open === 'panel-rift' && !!G.UI.anchor, '深渊之门窗口带锚点');
  g.player.x = g.map.gate.x + 500;
  g.update(1 / 60); g.update(1 / 60); g.update(1 / 60);
  ok(G.UI.open === null, '离开深渊之门后窗口自动关闭');

  /* 换场景时清空锚点 */
  g.toDungeon(1);
  ok(G.UI.anchor === null, '切换场景后锚点被清空');
  report('NPC / 深渊之门窗口的走远自动关闭正常');
}

/* ============================================================ */
section('12. 多存档位');
{
  G.storage.clearAll();
  const a = new G.Game(101);
  G.GAME = a; G.UI.game = a;
  a.startClass('barb', 0);
  a.player.gold = 1111; a.player.level = 9;
  a.save();
  const b = new G.Game(202);
  G.GAME = b; G.UI.game = b;
  b.startClass('sorc', 1);
  b.player.gold = 2222; b.player.level = 14;
  b.save();
  const list = G.storage.list();
  ok(list.length === G.SAVE_SLOTS, '存档位数量为 ' + G.SAVE_SLOTS, list.length);
  ok(list[0] && list[0].cls === 'barb' && list[1] && list[1].cls === 'sorc', '两个存档位分别保存不同角色');
  ok(list[0].gold === 1111 && list[1].gold === 2222, '存档摘要数据正确', JSON.stringify([list[0].gold, list[1].gold]));
  ok(list[0].area === 'town', '存档记录了所在区域', list[0].area);
  const c = new G.Game(303);
  G.GAME = c; G.UI.game = c;
  ok(c.load(1), '读取存档位 2 成功');
  ok(c.player.cls === 'sorc' && Math.round(c.player.gold) === 2222, '存档位 2 数据正确', c.player.cls + '/' + c.player.gold);
  ok(c.slot === 1, '当前存档位被记录', c.slot);
  ok(G.storage.meta(0).gold === 1111, '存档位 1 未被覆盖');
  ok(c.player.town && c.player.town.buildings.forge >= 1, '城镇建筑状态已保存');
  ok(Array.isArray(c.player.stash) && c.player.stash.length === G.Town.stashCap(c.player), '仓库已按建筑等级扩容', c.player.stash.length);
  G.storage.clear(0);
  ok(!G.storage.exists(0) && G.storage.exists(1), '可以单独删除某个存档位');
  G.storage.clearAll();
  ok(!G.storage.exists(1), '清空全部存档位');
  report('多存档位读写 / 摘要 / 删除正常');
}

/* ============================================================ */
section('13. 城镇 / NPC / 建筑升级');
{
  const g = new G.Game(555);
  G.GAME = g; G.UI.game = g;
  g.startClass('rogue', 0);
  ok(g.area === 'town', '开局位于城镇');
  ok(g.townMap && g.townMap.buildings.length >= 6, '城镇建筑数量', g.townMap.buildings.length);
  ok(g.townMap.npcs.length >= 6, '城镇 NPC 数量', g.townMap.npcs.length);
  const startSolid = G.Dungeon.solidAtWorld(g.townMap, g.townMap.playerStart.x, g.townMap.playerStart.y);
  ok(!startSolid, '城镇出生点可通行');
  let npcSolid = 0;
  g.townMap.npcs.forEach((n) => { if (G.Dungeon.solidAtWorld(g.townMap, n.x, n.y)) npcSolid++; });
  ok(npcSolid === 0, 'NPC 都站在可通行地面上', npcSolid);
  let doorSolid = 0;
  g.townMap.buildings.forEach((b) => {
    const c = G.Dungeon.tileCenter(b.door.tx, b.door.ty);
    if (G.Dungeon.solidAtWorld(g.townMap, c.x, c.y)) doorSolid++;
  });
  ok(doorSolid === 0, '每栋建筑的门前都可通行', doorSolid);
  const npc = g.townMap.npcs[0];
  ok(!!G.Town.npcAt(g.townMap, npc.x, npc.y, 10), 'npcAt 能找到 NPC');
  ok(!!G.Town.nearestNpc(g.townMap, npc.x + 20, npc.y, 80), 'nearestNpc 能找到 NPC');
  g.player.x = npc.x; g.player.y = npc.y;
  g.interactNpc(npc);
  ok(G.UI.open === npc.panel, '与 NPC 交谈会打开对应面板', G.UI.open);

  /* 建筑升级 */
  const p = g.player;
  p.gold = 100000; p.shards = 1000;
  const lifeBefore = p.stats.maxLife;
  const r = G.Town.upgrade(p, 'altar');
  ok(r.ok && G.Town.level(p, 'altar') === 2, '建筑可以升级', JSON.stringify(r));
  G.Stats.derive(p);
  ok(p.stats.maxLife > lifeBefore, '祭坛升级提供生命加成', lifeBefore + ' → ' + p.stats.maxLife);
  ok(G.Town.upgradeCost('altar', 6) === null, '超过最高等级没有升级费用');
  for (let i = 0; i < 10; i++) G.Town.upgrade(p, 'altar');
  ok(G.Town.level(p, 'altar') === 5, '建筑等级封顶 5', G.Town.level(p, 'altar'));
  const poor = { gold: 0, shards: 0, town: G.Town.defaultTown() };
  ok(!G.Town.canUpgrade(poor, 'forge').ok, '资源不足时无法升级建筑');
  ok(G.Town.orbBonus(p) > 1, '工坊提供通货掉落加成', G.Town.orbBonus(p).toFixed(2));
  ok(G.Town.salvageBonus(p) >= 1, '铁匠铺提供分解加成', G.Town.salvageBonus(p).toFixed(2));

  /* 城镇 <-> 地牢 */
  g.toDungeon(3);
  ok(g.area === 'dungeon' && g.floor === 3, '从城镇进入指定层数地牢', g.area + '/' + g.floor);
  ok(!!g.map.townPortal, '地牢入口生成了回城传送门');
  ok(g.townPortalAt(g.map.townPortal.x, g.map.townPortal.y, 10), 'townPortalAt 判定正确');
  g.monsters.length = 0;
  ok(g.toTown('recall'), '脱离战斗后可以回城');
  ok(g.area === 'town', '回城成功');
  g.toDungeon(4);
  const mob = G.ENT.makeMonster(g, 'skeleton', g.player.x + 60, g.player.y, {});
  mob.spawnT = 0;
  g.monsters.push(mob);
  ok(!g.toTown('recall'), '战斗中禁止回城');

  /* 城镇里跑完整帧循环：覆盖城镇渲染 / 光照 / 小地图 / NPC 绘制 / 交互提示 */
  g.monsters.length = 0;
  g.toTown('recall');
  let townErr = 0;
  const npcTarget = g.townMap.npcs[0];
  for (let i = 0; i < 90; i++) {
    try {
      if (i < 30) { g.player.x = npcTarget.x + 200; g.player.y = npcTarget.y; }
      else { g.player.x = npcTarget.x + 20; g.player.y = npcTarget.y + 20; }
      g.update(1 / 60);
    } catch (e) { townErr++; console.error('   [城镇帧]', e && e.stack ? e.stack : e); }
  }
  ok(townErr === 0, '城镇帧循环（渲染/光照/小地图）无异常', townErr);
  ok(g.area === 'town' && g.monsters.length === 0, '城镇内没有怪物');
  g.player.x = g.map.gate.x; g.player.y = g.map.gate.y;
  ok(g.nearGate(40), '站到门上时 nearGate 为真');
  G.UI.openRift();
  ok(G.UI.open === 'panel-rift', '深渊之门打开向导面板', G.UI.open);
  G.UI.togglePanel('panel-rift', false);
  ok(g.toDungeon(1), '再次进入深渊');
  let dungErr = 0;
  for (let i = 0; i < 30; i++) { try { g.update(1 / 60); } catch (e) { dungErr++; console.error(e.stack); } }
  ok(dungErr === 0, '地牢帧循环无异常（含回城传送门绘制）', dungErr);
  report('城镇、NPC 面板、建筑升级、回城传送门均正常');
}

/* ============================================================ */
section('14. 做装通货（Orbs）');
{
  const oRng = G.RNG(8888);
  ok(G.DATA.ORBS.length >= 8, '通货石种类', G.DATA.ORBS.length);
  let bad = 0;
  G.DATA.ORBS.forEach((o) => {
    if (!o.id || !o.name || !o.desc || !o.use || !(o.price > 0)) { bad++; console.log('    ! 通货定义不完整: ' + o.id); }
  });
  ok(bad === 0, '通货定义完整');

  /* 白 → 蓝 */
  const white = G.Loot.makeItem(oRng, { ilvl: 40, slot: 'chest', baseId: 'a_chest_3', rarity: 'common' });
  white.affixes = []; white.rarity = 'common';
  let res = G.Loot.applyOrb(oRng, white, 'ascend');
  ok(res.ok && white.rarity === 'magic' && white.affixes.length >= 1, '晋升石：白装 → 蓝装并附加词缀', white.rarity + '/' + white.affixes.length);
  ok(!G.Loot.canUseOrb(white, 'ascend').ok, '晋升石不能用于蓝装');

  /* 增幅石 */
  if (white.affixes.length < 2) {
    const n0 = white.affixes.length;
    res = G.Loot.applyOrb(oRng, white, 'augment');
    ok(res.ok && white.affixes.length === n0 + 1, '增幅石：追加 1 条词缀', n0 + ' → ' + white.affixes.length);
  }
  while (white.affixes.length < 2) G.Loot.addRandomAffix(oRng, white, {});
  ok(!G.Loot.canUseOrb(white, 'augment').ok, '词缀已满时无法使用增幅石');

  /* 蓝 → 黄 */
  res = G.Loot.applyOrb(oRng, white, 'refine');
  ok(res.ok && white.rarity === 'rare' && white.affixes.length >= 3, '炼化石：蓝装 → 黄装并补足词缀', white.rarity + '/' + white.affixes.length);
  ok(white.name && white.name.length > 0, '稀有装备拥有名字', white.name);

  /* 点金石 */
  white.affixes.forEach((a) => { a.value = 0.1; });
  const valBefore = white.affixes.map((a) => a.value);
  const capBefore = { min: white.min, max: white.max };
  res = G.Loot.applyOrb(oRng, white, 'whetstone');
  ok(res.ok, '点金石可用', res.msg);
  const improved = white.affixes.some((a, i) => a.value > valBefore[i]);
  ok(improved, '点金石提升了词缀数值');
  ok(white.min >= capBefore.min && white.max >= capBefore.max, '点金石提升了基础数值', capBefore.min + '–' + capBefore.max + ' → ' + white.min + '–' + white.max);
  ok(white.min <= white.baseCap.min && white.max <= white.baseCap.max, '提升不超过数值上限', white.min + '/' + white.baseCap.min);
  const rg = G.Loot.entryRange(white.affixes[0], white.ilvl);
  ok(white.affixes[0].value <= rg.hi + 0.001, '词缀不超过档位上限', white.affixes[0].value + ' <= ' + rg.hi);

  /* 裂解石 */
  const n1 = white.affixes.length;
  res = G.Loot.applyOrb(oRng, white, 'fracture');
  ok(res.ok && white.affixes.length === n1 - 1, '裂解石：移除 1 条词缀', n1 + ' → ' + white.affixes.length);

  /* 混沌石 */
  const sig = white.affixes.map((a) => a.id + a.value).join(',');
  res = G.Loot.applyOrb(oRng, white, 'chaos');
  ok(res.ok && white.affixes.length === n1 - 1, '混沌石保持词缀数量', white.affixes.length);
  ok(white.affixes.map((a) => a.id + a.value).join(',') !== sig || white.affixes.length === 0, '混沌石重掷了词缀');

  /* 钻孔石 */
  const sok0 = white.sockets | 0;
  res = G.Loot.applyOrb(oRng, white, 'drill');
  ok(res.ok && white.sockets === sok0 + 1 && white.gems.length === white.sockets, '钻孔石 +1 孔位', white.sockets);
  for (let i = 0; i < 6; i++) G.Loot.applyOrb(oRng, white, 'drill');
  ok(white.sockets === G.Loot.socketMax(white), '孔位达到该部位上限', white.sockets + ' / ' + G.Loot.socketMax(white));
  ok(!G.Loot.canUseOrb(white, 'drill').ok, '孔位满时无法继续钻孔');

  /* 传说石 */
  res = G.Loot.applyOrb(oRng, white, 'legend');
  ok(res.ok && white.power && white.rarity === 'unique', '传说石：黄装 → 传奇特效', white.power);
  ok(!!G.DATA.POWER_TEXT[white.power], '传奇特效有对应文本');
  ok(!G.Loot.canUseOrb(white, 'chaos').ok, '传奇装备不能再使用混沌石');
  // 传说石可以重复使用：换一条暗金特效（刷新）
  const pw0 = white.power;
  ok(G.Loot.canUseOrb(white, 'legend').ok, '已注入暗金特效的装备可以再用传说石');
  res = G.Loot.applyOrb(oRng, white, 'legend');
  ok(res.ok && white.power && white.power !== pw0, '重复使用会刷新成另一条暗金特效', pw0 + ' → ' + white.power);
  ok(res.lines.join('').indexOf('刷新暗金特效') >= 0, '日志写明是「刷新」而不是「获得」');

  /* 净化石 */
  const blue2 = G.Loot.makeItem(oRng, { ilvl: 30, slot: 'helm', rarity: 'magic', cls: 'sorc' });
  res = G.Loot.applyOrb(oRng, blue2, 'purify');
  ok(res.ok && blue2.rarity === 'common' && blue2.affixes.length === 0, '净化石：蓝装 → 白装并清空词缀', blue2.rarity + '/' + blue2.affixes.length);

  /* 非法目标 */
  ok(!G.Loot.canUseOrb(blue2, 'refine').ok, '炼化石不能用于白装');
  ok(!G.Loot.canUseOrb({ cat: 'gem' }, 'ascend').ok, '通货不能用于非装备');
  ok(!G.Loot.applyOrb(oRng, blue2, 'refine').ok, '非法使用不会改变装备');

  /* 通货物品 / 掉落 / 价格 */
  const orbItem = G.Loot.orbItem('chaos', 3);
  ok(orbItem.cat === 'orb' && orbItem.count === 3, '通货物品可以堆叠');
  ok(G.Loot.price(orbItem) === G.DATA.orbById.chaos.price * 3, '通货价格按数量计算');
  let orbDrops = 0;
  for (let i = 0; i < 400; i++) {
    const drops = G.Loot.rollDrops(G.RNG(1000 + i), { mlvl: 40, kind: 'elite', mult: 1, cls: 'barb' });
    orbDrops += drops.filter((d) => d && d.cat === 'orb').length;
  }
  ok(orbDrops > 0, '精英怪会掉落通货石', orbDrops);
  const html = G.Loot.tooltipHTML(orbItem, null, {});
  ok(html.indexOf('undefined') < 0 && html.indexOf('NaN') < 0, '通货 tooltip 正常');
  report('9 种通货石的功能与边界全部通过（掉落样本 ' + orbDrops + ' 颗）');
}

/* ============================================================ */
section('15. 词缀数值 / 档位显示 & 分解');
{
  const rng3 = G.RNG(2468);
  let checked = 0, tierShown = 0, rangeShown = 0, qualityOk = 0;
  for (let i = 0; i < 400; i++) {
    const it = G.Loot.makeItem(rng3, { ilvl: 1 + Math.floor(rng3.next() * 80), cls: 'barb' });
    // 暗金装备的固定词缀没有档位，只检验随机词缀
    if (!it.affixes.some((a) => a.kind !== 'unique')) continue;
    checked++;
    const html = G.Loot.tooltipHTML(it, null, {});
    if (html.indexOf('undefined') >= 0 || html.indexOf('NaN') >= 0) ok(false, 'tooltip 含 undefined/NaN');
    if (html.indexOf('atier') >= 0) tierShown++;
    if (html.indexOf('arng') >= 0) rangeShown++;
    const q = G.Loot.affixQuality(it);
    if (q == null || (q >= 0 && q <= 100)) qualityOk++;
    it.affixes.forEach((a) => {
      const rg = G.Loot.entryRange(a, it.ilvl, G.Loot.affixMult(it));
      if (rg && (a.value < rg.lo - 0.5 || a.value > rg.hi + 0.5)) ok(false, '词缀数值超出档位范围: ' + a.value + ' / ' + rg.lo + '-' + rg.hi);
    });
  }
  ok(checked > 50, '取样装备数量', checked);
  ok(tierShown === checked, '所有词缀都显示了档位标签', tierShown + '/' + checked);
  ok(rangeShown === checked, '所有词缀都显示了数值范围', rangeShown + '/' + checked);
  ok(qualityOk === checked, '词缀数值品质计算正常', qualityOk + '/' + checked);

  /* ---- 档位方向：T1 最好（ilvl 最高），T8 最差 ---- */
  const pStr = G.DATA.affixById.p_str;
  const hiT = G.Loot.affixRange(pStr, 90);
  const loT = G.Loot.affixRange(pStr, 1);
  ok(hiT.tier === 1, 'ilvl 90 的装备词缀是 T1（最高档）', 'T' + hiT.tier);
  ok(loT.tier === 8, 'ilvl 1 的装备词缀是 T8（最低档）', 'T' + loT.tier);
  let monotone = true, lastTier = 0;
  for (let il = 1; il <= 95; il++) {
    const r = G.Loot.affixRange(pStr, il);
    if (r.tier > lastTier && lastTier !== 0) monotone = false;  // 等级升高不能让档位变差
    if (r.tier < 1 || r.tier > 8) monotone = false;
    lastTier = r.tier;
  }
  ok(monotone, '物品等级升高时档位只会变好（T 数字单调不增）');
  ok(hiT.hi > loT.hi * 20, 'T1 的数值远高于 T8', loT.hi + ' → ' + hiT.hi);

  /* ---- 配色分档：T1 红 / T2 粉 / T3-T4 青 / T5-T6 绿 / T7-T8 灰 ---- */
  const colorBands = [1, 2, 3, 4, 5, 6, 7, 8].map((t) => G.Loot.tierClass(t));
  ok(colorBands.join(',') === 't1,t2,t3,t3,t4,t4,t5,t5', '档位配色分档正确', colorBands.join(','));
  ok(G.Loot.tierClass(0) === 't5' && G.Loot.tierClass(undefined) === 't5', '缺失档位回退为灰色');

  /* ---- 提示框渲染出的 T 号与配色类 ---- */
  const topItem = G.Loot.makeItem(rng3, { ilvl: 88, slot: 'chest', rarity: 'rare', cls: 'barb' });
  const topHtml = G.Loot.tooltipHTML(topItem, null, {});
  ok(topHtml.indexOf('atier t1">T1<') >= 0, 'ilvl 88 装备的词缀渲染为红色 T1');
  const lowItem = G.Loot.makeItem(rng3, { ilvl: 3, slot: 'chest', rarity: 'rare', cls: 'barb' });
  const lowHtml = G.Loot.tooltipHTML(lowItem, null, {});
  ok(lowHtml.indexOf('atier t5">T8<') >= 0, 'ilvl 3 装备的词缀渲染为灰色 T8');
  ok(lowItem.affixes.every((a) => G.Loot.entryRange(a, lowItem.ilvl).tier === 8), '低等级装备全部是 T8');

  // 武器基础数值区间显示：本身有浮动值的基底 → 「最低段 - 最高段」
  const w = G.Loot.makeItem(rng3, { ilvl: 50, slot: 'weapon' });
  const wHtml = G.Loot.tooltipHTML(w, null, {});
  const baseLine = (wHtml.match(/class="tstat base">[\s\S]*?<\/div>/) || [''])[0];
  ok(baseLine.indexOf('上限') < 0, '基础数值那一行不再出现「上限」字样', baseLine.replace(/<[^>]*>/g, ' ').trim());
  ok(!!w.baseCap && w.baseCap.min >= w.min, '装备带有基础数值上限');
  // 区间要算上装备自身的伤害加成（dmgPct / physDmg），和提示框保持一致
  const wAll = G.Stats.itemStats(w);
  const wBonus = 1 + (wAll.dmgPct || 0) / 100 + (wAll.physDmg || 0) / 100;
  const wantRange = G.Loot.baseRangeText(w, wBonus);
  const shownRange = (wHtml.match(/class="arng"[^>]*>([^<]*)</) || [])[1];
  ok(shownRange === wantRange, '武器伤害显示为区间「' + wantRange + '」', shownRange);
  ok(/^\d+-\d+ - \d+-\d+$/.test(shownRange || ''), '区间是“两段浮动值”的写法（如 7-9 - 10-12）', shownRange);
  const wRg = G.Loot.baseRange(w);
  ok(wRg.lo instanceof Array && wRg.hi instanceof Array, '武器区间是两段浮动值');
  ok(wRg.lo[1] < wRg.hi[0] && wRg.lo[0] < wRg.lo[1] && wRg.hi[0] < wRg.hi[1],
    '低段与高段不重叠且各自有序', wRg.lo.join('-') + ' / ' + wRg.hi.join('-'));

  // 单值基底（护甲）→ 「下限 - 上限」
  const arm = G.Loot.makeItem(rng3, { ilvl: 50, slot: 'chest', rarity: 'rare' });
  const armShown = (G.Loot.tooltipHTML(arm, null, {}).match(/class="arng"[^>]*>([^<]*)</) || [])[1];
  ok(armShown === G.Loot.baseFloor(arm).armor + ' - ' + arm.baseCap.armor,
    '护甲显示为「' + G.Loot.baseFloor(arm).armor + ' - ' + arm.baseCap.armor + '」', armShown);

  // 各武器基底的低/高段都不能交叉
  let cross = 0, samp = 0;
  G.DATA.BASES.filter((b) => b.slot === 'weapon').forEach((b) => {
    const it = G.Loot.makeItem(rng3, { ilvl: b.ilvl, slot: 'weapon', baseId: b.id, rarity: 'common' });
    const r = G.Loot.baseRange(it);
    samp++;
    if (!(r.lo[1] < r.hi[0] && r.lo[0] < r.lo[1] && r.hi[0] < r.hi[1])) cross++;
  });
  ok(cross === 0 && samp > 30, '所有武器基底的伤害区间都单调不交叉', cross + ' / ' + samp);

  // 分解
  const tiers = ['common', 'magic', 'rare', 'unique'];
  let prev = 0, mono = true;
  tiers.forEach((r) => {
    const it = G.Loot.makeItem(rng3, { ilvl: 40, slot: 'chest', rarity: r, noUnique: false });
    const v = G.Loot.salvageYield(it);
    if (v < prev) mono = false;
    prev = v;
    if (!(v > 0)) ok(false, '分解产出异常: ' + r);
  });
  ok(mono, '稀有度越高分解产出越多');
  report('词缀档位 / 范围 / 品质显示与分解产出校验通过');
}

/* ============================================================ */
section('15b. 前缀 / 后缀体系');
{
  const rngA = G.RNG(13572468);
  const cap = G.DATA.AFFIX_CAP;
  ok(cap.magic.prefix === 1 && cap.magic.suffix === 1, '蓝装上限 1 前缀 + 1 后缀', JSON.stringify(cap.magic));
  ok(cap.rare.prefix === 3 && cap.rare.suffix === 3, '黄装上限 3 前缀 + 3 后缀', JSON.stringify(cap.rare));

  /* ---- 词缀归类：属性/进攻/技能 → 前缀；抗性/速度/收益/回复 → 后缀 ---- */
  const kindOf = (id) => (G.DATA.affixById[id] || {}).kind;
  const inPrefix = { p_str: '力量', p_vit: '体力', p_crit: '暴击率', p_critDmg: '暴击伤害', p_skill: '技能等级', p_allSkills: '所有技能等级', p_armor: '护甲', p_armorPct: '护甲%' };
  const inSuffix = {
    s_allResist: '全抗', s_fireRes: '火抗', s_coldRes: '冰抗', s_lightRes: '电抗', s_poisonRes: '毒抗',
    s_moveSpeed: '移速', s_aps: '攻速', s_xp: '经验获取', s_mf: '魔法装备掉落', s_gf: '金币掉落',
    s_dmgReduce: '受到伤害降低', s_lifeRegen: '每秒生命回复', s_manaRegen: '每秒法力回复',
    s_manaSteal: '法力偷取', s_lifeSteal: '生命偷取',
  };
  const wrongKind = Object.keys(inPrefix).filter((id) => kindOf(id) !== 'prefix')
    .concat(Object.keys(inSuffix).filter((id) => kindOf(id) !== 'suffix'));
  ok(wrongKind.length === 0, '属性 / 进攻 / 技能类词缀是前缀，抗性 / 速度 / 收益 / 回复类是后缀',
    wrongKind.join(' '));

  /* ---- 已按需求移除的词缀 ---- */
  const removed = {
    p_life: '前缀固定生命', p_lifePct: '前缀生命%', p_thorns: '前缀伤害反弹',
    s_str: '后缀力量', s_dex: '后缀敏捷', s_int: '后缀智力', s_vit: '后缀体力',
    s_castSpeed: '独立的施法速度词缀', s_lifeOnHit: '击中回复生命', s_manaOnKill: '击杀回复法力',
    s_resist: '重复的全抗词缀',
  };
  const stillThere = Object.keys(removed).filter((id) => G.DATA.affixById[id]);
  ok(stillThere.length === 0, '已按要求移除的词缀都不存在了', stillThere.map((id) => removed[id]).join('、'));
  ok(!G.DATA.STATS.castSpeed && !G.DATA.STATS.manaOnKill, '施法速度 / 击杀回蓝属性已移除');
  ok(!!G.DATA.STATS.manaSteal, '新增法力偷取属性');

  /* ---- 生命 / 法力 / 护甲 / 抗性 只在护甲类装备与戒指上 ---- */
  const ARMOR_GEAR = ['helm', 'chest', 'gloves', 'boots', 'belt', 'offhand'];
  const restricted = ['p_armor', 'p_armorPct', 's_life', 's_mana', 's_allResist',
    's_fireRes', 's_coldRes', 's_lightRes', 's_poisonRes'];
  const badSlot = [];
  restricted.forEach((id) => {
    const a = G.DATA.affixById[id];
    if (!a || !a.slots) { badSlot.push(id + '(无限制)'); return; }
    const extra = a.slots.filter((s) => ARMOR_GEAR.indexOf(s) < 0 && s !== 'ring');
    if (extra.length) badSlot.push(id + '→' + extra.join(','));
    // 每个护甲部位 + 戒指都必须能出
    ARMOR_GEAR.concat(['ring']).forEach((s) => {
      if (a.slots.indexOf(s) < 0) badSlot.push(id + '缺少' + s);
    });
  });
  ok(badSlot.length === 0, '护甲 / 生命 / 法力 / 抗性 只出现在护甲类与戒指上', badSlot.join(' '));

  // 武器与项链上不能出现这些词缀
  const noGear = [];
  ['weapon', 'amulet'].forEach((s) => {
    restricted.forEach((id) => {
      const a = G.DATA.affixById[id];
      if (a && a.slots && a.slots.indexOf(s) >= 0) noGear.push(id + '@' + s);
    });
  });
  ok(noGear.length === 0, '武器 / 项链上不会出现护甲、生命、法力、抗性', noGear.join(' '));

  /* ---- 移速只在鞋子、项链与戒指上 ---- */
  const ms = G.DATA.affixById.s_moveSpeed;
  ok(ms.slots.length === 3 && ms.slots.indexOf('boots') >= 0 && ms.slots.indexOf('amulet') >= 0 && ms.slots.indexOf('ring') >= 0,
    '移速只出现在鞋子 / 项链 / 戒指', ms.slots.join(','));
  ok(ms.slots.indexOf('chest') < 0 && ms.slots.indexOf('helm') < 0 && ms.slots.indexOf('gloves') < 0 && ms.slots.indexOf('belt') < 0,
    '胸甲 / 头盔 / 手套 / 腰带 上不会出现移速');

  /* ---- 戒指可以出现任意类型的词缀（例外：两条闪避靴子专属词缀） ---- */
  const bootsOnly = ['s_dodgeCharges', 's_dodgeRecharge'];
  const notOnRing = G.DATA.AFFIXES.filter((a) => a.slots && a.slots.indexOf('ring') < 0).map((a) => a.id);
  ok(notOnRing.length === bootsOnly.length && notOnRing.every((id) => bootsOnly.indexOf(id) >= 0),
    '只有两条闪避词缀不出现在戒指上', notOnRing.join(','));
  const ringPre = G.DATA.affixesForSlot('ring', 'prefix').length;
  const ringSuf = G.DATA.affixesForSlot('ring', 'suffix').length;
  ok(ringPre === G.DATA.AFFIXES.filter((a) => a.kind === 'prefix').length &&
    ringSuf === G.DATA.AFFIXES.filter((a) => a.kind === 'suffix').length - bootsOnly.length,
    '戒指拥有除靴子专属外的全部前后缀池', ringPre + '+' + ringSuf);

  /* ---- 攻击速度 / 施法速度已合并为一条 ---- */
  const apsAffixes = G.DATA.AFFIXES.filter((a) => a.stat === 'aps' || a.stat === 'castSpeed');
  ok(apsAffixes.length === 1 && apsAffixes[0].id === 's_aps', '攻速与施法速度合并为一条属性',
    apsAffixes.map((a) => a.id).join(','));
  // 四系单抗各自独立，可以同时出现
  const groupOf = (id) => (G.DATA.affixById[id] || {}).group;
  const resGroups = ['s_fireRes', 's_coldRes', 's_lightRes', 's_poisonRes'].map(groupOf);
  ok(new Set(resGroups).size === 4, '四系单抗属于不同互斥组', resGroups.join(','));
  // 护甲 / 护甲% 仍然互斥
  ok(groupOf('p_armor') === groupOf('p_armorPct'), '护甲与护甲% 互斥', groupOf('p_armor') + '/' + groupOf('p_armorPct'));

  /* ---- 每个部位都要有足够的前缀 / 后缀池填满 3+3 ---- */
  const slots = G.DATA.gearSlots().map((s) => ((s === 'ring1' || s === 'ring2') ? 'ring' : s));
  const thin = [];
  slots.forEach((s) => {
    const pn = G.DATA.affixesForSlot(s, 'prefix').length;
    const sn = G.DATA.affixesForSlot(s, 'suffix').length;
    if (pn < 6 || sn < 6) thin.push(s + '(' + pn + '/' + sn + ')');
  });
  ok(thin.length === 0, '所有部位的前缀 / 后缀池都足够', thin.join(', '));
  const nPre = G.DATA.AFFIXES.filter((a) => a.kind === 'prefix').length;
  const nSuf = G.DATA.AFFIXES.filter((a) => a.kind === 'suffix').length;
  ok(nPre >= 15 && nSuf >= 15, '前缀 / 后缀数量充足', nPre + ' 前缀 / ' + nSuf + ' 后缀');

  /* ---- 大量掉落：数量、上限与部位限制必须成立 ---- */
  const GEAR_ONLY = ['p_armor', 'p_armorPct', 's_life', 's_mana', 's_allResist', 's_fireRes', 's_coldRes', 's_lightRes', 's_poisonRes'];
  const ARMOR_OK = ['helm', 'chest', 'gloves', 'boots', 'belt', 'offhand', 'ring'];
  let nMagic = 0, nRare = 0, badMagic = 0, badRare = 0, maxPre = 0, maxSuf = 0, maxTotal = 0, badLoc = 0;
  for (let i = 0; i < 4000; i++) {
    const it = G.Loot.makeItem(rngA, { ilvl: 1 + Math.floor(rngA.next() * 90), cls: rngA.pick(['barb', 'sorc', 'rogue']) });
    const pn = G.Loot.countAffixes(it, 'prefix'), sn = G.Loot.countAffixes(it, 'suffix');
    if (it.rarity === 'magic') {
      nMagic++;
      if (pn > 1 || sn > 1 || pn + sn < 1) { badMagic++; if (badMagic < 3) console.log('    ! 蓝装 ' + pn + '+' + sn); }
    } else if (it.rarity === 'rare') {
      nRare++;
      maxPre = Math.max(maxPre, pn); maxSuf = Math.max(maxSuf, sn); maxTotal = Math.max(maxTotal, pn + sn);
      if (pn > 3 || sn > 3 || pn + sn < 3) { badRare++; if (badRare < 3) console.log('    ! 黄装 ' + pn + '+' + sn); }
    }
    // 部位限制：护甲类词缀不能出现在武器 / 项链上；护甲类词缀必须符合部位
    it.affixes.forEach((a) => {
      if (GEAR_ONLY.indexOf(a.id) >= 0 && ARMOR_OK.indexOf(it.slot) < 0) badLoc++;
      if (a.id === 's_moveSpeed' && ['boots', 'amulet', 'ring'].indexOf(it.slot) < 0) badLoc++;
    });
    const html = G.Loot.tooltipHTML(it, null, {});
    if (html.indexOf('undefined') >= 0 || html.indexOf('NaN') >= 0) ok(false, 'tooltip 异常: ' + it.uid);
  }
  ok(nMagic > 300 && nRare > 100, '取样到足够的蓝装与黄装', nMagic + ' 蓝 / ' + nRare + ' 黄');
  ok(badMagic === 0, '蓝装全部满足 1 前缀 + 1 后缀上限', badMagic);
  ok(badRare === 0, '黄装全部满足 3 前缀 + 3 后缀上限', badRare);
  ok(maxPre <= 3 && maxSuf <= 3, '黄装单类最多 3 条', maxPre + ' 前缀 / ' + maxSuf + ' 后缀');
  ok(maxTotal <= 6, '掉落黄装词缀总数不超过 6', maxTotal);
  ok(badLoc === 0, '掉落装备的词缀部位限制全部正确', badLoc + ' 处越界');

  /* ---- 提示框显示前缀 / 后缀数量 ---- */
  const rareIt = G.Loot.makeItem(rngA, { ilvl: 60, slot: 'chest', rarity: 'rare', cls: 'barb' });
  const tip = G.Loot.tooltipHTML(rareIt, null, {});
  ok(tip.indexOf('前缀') >= 0 && tip.indexOf('后缀') >= 0, '提示框显示前缀 / 后缀数量');
  ok(tip.indexOf('/ 3') >= 0, '提示框显示上限（/ 3）');

  /* ---- 做装同样遵守上限 ---- */
  const blue = G.Loot.makeItem(rngA, { ilvl: 40, slot: 'helm', rarity: 'magic', cls: 'barb' });
  let guard = 0;
  while (G.Loot.canAddAny(blue) && guard++ < 10) G.Loot.addRandomAffix(rngA, blue, { cls: 'barb' });
  ok(G.Loot.countAffixes(blue, 'prefix') === 1 && G.Loot.countAffixes(blue, 'suffix') === 1,
    '蓝装被补成 1 前缀 + 1 后缀', G.Loot.countAffixes(blue, 'prefix') + '+' + G.Loot.countAffixes(blue, 'suffix'));
  ok(!G.Loot.canUseOrb(blue, 'augment').ok, '蓝装词缀满后无法继续增幅');
  ok(G.Loot.addRandomAffix(rngA, blue, { cls: 'barb' }) === null, '满词缀时无法再加词缀');

  const res = G.Loot.applyOrb(rngA, blue, 'refine');
  ok(res.ok && blue.rarity === 'rare', '炼化石把蓝装提升为黄装');
  ok(G.Loot.countAffixes(blue, 'prefix') <= 3 && G.Loot.countAffixes(blue, 'suffix') <= 3, '炼化石不突破单类上限',
    G.Loot.countAffixes(blue, 'prefix') + '+' + G.Loot.countAffixes(blue, 'suffix'));
  ok(blue.affixes.length >= 3 && blue.affixes.length <= 6, '黄装词缀总数 3-6', blue.affixes.length);

  const before = blue.affixes.length;
  G.Loot.applyOrb(rngA, blue, 'chaos');
  ok(G.Loot.countAffixes(blue, 'prefix') <= 3 && G.Loot.countAffixes(blue, 'suffix') <= 3 && blue.affixes.length === before,
    '混沌石重掷后数量不变且不超上限', G.Loot.countAffixes(blue, 'prefix') + '+' + G.Loot.countAffixes(blue, 'suffix'));

  const full = G.Loot.makeItem(rngA, { ilvl: 70, slot: 'chest', rarity: 'rare', cls: 'barb' });
  let aug = 0;
  while (G.Loot.canUseOrb(full, 'augment').ok && aug++ < 12) G.Loot.applyOrb(rngA, full, 'augment', { cls: 'barb' });
  ok(G.Loot.countAffixes(full, 'prefix') === 3 && G.Loot.countAffixes(full, 'suffix') === 3,
    '增幅石可以把黄装补满到 3 + 3', G.Loot.countAffixes(full, 'prefix') + '+' + G.Loot.countAffixes(full, 'suffix'));
  ok(!G.Loot.canUseOrb(full, 'augment').ok, '满 6 条后无法继续增幅', G.Loot.canUseOrb(full, 'augment').why);
  ok(G.Loot.maxAffixes(full) === 6, '黄装词缀总上限为 6');

  /* ---- 法力偷取在战斗中生效 ---- */
  const gg = new G.Game(31415);
  G.GAME = gg; G.UI.game = gg;
  gg.player = G.ENT.makePlayer(gg, 'sorc');
  gg.started = true;
  gg.enterFloor(2);
  const pl = gg.player;
  pl.gear.amulet = G.Loot.makeItem(gg.rng, { ilvl: 30, slot: 'amulet', rarity: 'rare' });
  pl.gear.amulet.affixes = [{ id: 's_manaSteal', stat: 'manaSteal', value: 20, tier: 5, kind: 'suffix', name: '汲魔之' }];
  G.Stats.derive(pl);
  ok(pl.stats.manaSteal === 20, '法力偷取进入派生属性', pl.stats.manaSteal);
  pl.mana = 0;
  gg.monsters.length = 0;
  const mob = G.ENT.makeMonster(gg, 'skeleton', pl.x + 40, pl.y, {});
  mob.spawnT = 0;
  gg.monsters.push(mob);
  const dealt = G.Combat.hitMonster(gg, mob, { physical: 200 }, { source: 'player' });
  ok(pl.mana > 0, '击中后按伤害偷取法力', '造成 ' + dealt + ' → 回蓝 ' + Math.round(pl.mana));
  ok(Math.abs(pl.mana - dealt * 0.2) < 1.5, '偷取值 = 伤害 × 法力偷取%', pl.mana.toFixed(1));
  pl.mana = pl.stats.maxMana;
  G.Combat.hitMonster(gg, mob, { physical: 200 }, { source: 'player' });
  ok(pl.mana === pl.stats.maxMana, '法力回复不会超过上限');

  /* ---- 每秒法力回复后缀 ---- */
  const mr = G.Loot.makeItem(gg.rng, { ilvl: 40, slot: 'belt', rarity: 'rare' });
  mr.affixes = [{ id: 's_manaRegen', stat: 'manaRegen', value: 40, tier: 6, kind: 'suffix', name: '灵光之' }];
  const before2 = pl.stats.manaRegen;
  pl.gear.belt = mr;
  G.Stats.derive(pl);
  ok(pl.stats.manaRegen >= before2 + 39, '每秒法力回复后缀生效', before2.toFixed(1) + ' → ' + pl.stats.manaRegen.toFixed(1));
  const tip2 = G.Loot.tooltipHTML(mr, pl, {});
  ok(tip2.indexOf('每秒回复') >= 0 && tip2.indexOf('法力') >= 0, '法力回复词缀文本正确');
  report('前缀 / 后缀体系：归类、上限、掉落与做装全部符合规则');
}

/* ============================================================ */
section('16. UI 面板（城镇服务 / 做装 / 仓库 / 建筑）');
{
  const g = new G.Game(6161);
  G.GAME = g; G.UI.game = g;
  g.startClass('sorc', 2);
  const p = g.player;
  let uiErr = 0;
  const guard = (label, fn) => {
    try { fn(); } catch (e) { uiErr++; console.error('   [UI:' + label + ']', e && e.stack ? e.stack : e); }
  };

  // 起始界面：存档位列表 / 职业选择 / 读档
  guard('buildStart', () => G.UI.buildStart(g));
  guard('pickClassFor', () => G.UI.pickClassFor(2, g));
  guard('buildSlots', () => G.UI.buildSlots(g));
  G.storage.save(g.storage ? null : null, 0);

  // 城镇中的每个服务面板
  ['panel-inventory', 'panel-character', 'panel-vendor', 'panel-help',
    'panel-craft', 'panel-stash', 'panel-blacksmith', 'panel-town', 'panel-jeweler', 'panel-rift',
    'panel-settings'].forEach((id) => {
    guard('toggle:' + id, () => G.UI.togglePanel(id, true));
    guard('render:' + id, () => G.UI.updateHUD());
  });
  guard('openRift', () => G.UI.openRift());
  guard('renderRift', () => G.UI.renderRift());
  guard('renderCraft', () => G.UI.renderCraft());
  guard('renderStash', () => G.UI.renderStash());
  guard('renderBlacksmith', () => G.UI.renderBlacksmith());
  guard('renderTown', () => G.UI.renderTown());
  guard('renderJeweler', () => G.UI.renderJeweler());
  ok(uiErr === 0, '所有 UI 渲染函数无异常', uiErr + ' 个异常');

  // 做装流程（通过 UI 层）
  const it = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'chest', rarity: 'common', baseId: 'a_chest_2' });
  it.affixes = []; it.rarity = 'common';
  G.UI.addToInv(it);
  G.UI.addToInv(G.Loot.orbItem('ascend', 5));
  G.UI.addToInv(G.Loot.orbItem('refine', 3));
  G.UI.addToInv(G.Loot.orbItem('whetstone', 3));
  G.UI.addToInv(G.Loot.orbItem('drill', 1));
  G.UI.craftUid = it.uid;
  G.UI.togglePanel('panel-craft', true);
  G.UI.renderCraft();
  G.UI.useOrb('ascend');
  ok(it.rarity === 'magic' && it.affixes.length >= 1, 'UI 晋升石生效', it.rarity + '/' + it.affixes.length);
  G.UI.useOrb('refine');
  ok(it.rarity === 'rare', 'UI 炼化石生效', it.rarity);
  const sok = it.sockets | 0;
  G.UI.useOrb('drill');
  ok(it.sockets === sok + 1, 'UI 钻孔石生效', it.sockets);
  const orbStack = p.inventory.filter((x) => x && x.cat === 'orb' && x.orb === 'ascend')[0];
  ok(orbStack && orbStack.count === 4, '通货石按堆叠消耗', orbStack && orbStack.count);

  // NPC 交谈 → 打开对应面板
  const npc = g.townMap.npcs.filter((n) => n.panel === 'panel-craft')[0];
  G.UI.openNpcPanel(npc);
  ok(G.UI.open === 'panel-craft', 'NPC 打开做装面板', G.UI.open);

  // 仓库搬运
  p.inventory[0] = G.Loot.makeItem(g.rng, { ilvl: 20, slot: 'helm', rarity: 'common' });
  const stashIdx = p.stash.indexOf(null);
  G.UI.moveToStash(0);
  ok(p.stash[stashIdx] && p.inventory[0] === null, '物品存入仓库');
  G.UI.moveFromStash(stashIdx);
  ok(p.inventory[0] && p.stash[stashIdx] === null, '物品从仓库取出');

  // 分解
  p.shards = 0;
  p.inventory[1] = G.Loot.makeItem(g.rng, { ilvl: 40, slot: 'chest', rarity: 'magic' });
  const yield0 = G.Loot.salvageYield(p.inventory[1]);
  G.UI.salvageAt(1);
  ok(p.shards > 0, 'UI 分解获得残晶', p.shards);
  ok(p.inventory[1] === null, '分解后物品消失');
  ok(p.shards >= yield0, '分解产出不低于基础值');

  // 建筑升级（UI 层）
  p.gold = 50000; p.shards = 500;
  G.UI.togglePanel('panel-town', true);
  const lv0 = G.Town.level(p, 'market');
  G.UI.upgradeBuilding('market');
  ok(G.Town.level(p, 'market') === lv0 + 1, 'UI 升级建筑', G.Town.level(p, 'market'));

  // 宝石合成
  for (let i = 0; i < 3; i++) G.UI.addToInv({ uid: G.uid(), cat: 'gem', gem: 'ruby', tier: 1, name: '裂开的红宝石', color: '#e2464a' });
  G.UI.renderJeweler();
  G.UI.combineGems('ruby', 1);
  ok(p.inventory.some((x) => x && x.cat === 'gem' && x.gem === 'ruby' && x.tier === 2), 'UI 宝石合成升阶');

  // 深渊向导 → 进入地牢
  G.UI.togglePanel('panel-rift', true);
  G.UI.riftFloor = 99;
  G.UI.renderRift();
  ok(G.UI.riftFloor === g.maxUnlockedFloor(), '层数选择被限制在已解锁范围', G.UI.riftFloor);
  p.maxFloor = 5;
  G.UI.riftFloor = 2;
  G.UI.enterDungeon();
  ok(g.area === 'dungeon' && g.floor === 2, 'UI 进入地牢', g.area + '/' + g.floor);
  // 地牢中禁止打开城镇服务
  G.UI.togglePanel('panel-craft', true);
  ok(G.UI.open !== 'panel-craft', '地牢中无法打开城镇服务面板', G.UI.open);
  G.UI.openRift();
  ok(G.UI.open !== 'panel-rift', '地牢中无法使用深渊之门');

  // 商店里的通货石
  G.UI.rollVendorStock();
  ok(G.UI.vendorStock.some((s) => s.kind === 'orb'), '商人出售通货石');
  p.gold += 100000;
  const orbIdx = G.UI.vendorStock.findIndex((s) => s.kind === 'orb');
  const invN = p.inventory.filter(Boolean).length;
  G.UI.buy(orbIdx);
  ok(p.inventory.filter(Boolean).length >= invN, '可以购买通货石');
  guard('renderVendor', () => G.UI.renderVendor());

  // 存档面板按钮
  guard('menu', () => G.UI.setPaused(true));
  ok(!!G.el('menu-record').innerHTML, '暂停菜单显示存档信息');
  guard('onAreaChanged', () => G.UI.onAreaChanged());
  ok(uiErr === 0, 'UI 交互流程无异常', uiErr + ' 个异常');
  G.storage.clearAll();
  report('城镇服务、做装、仓库、建筑、向导的面板流程全部通过');
}

/* ============================================================ */
section('16b. 角色面板：技能 / 天赋说明与加点收益');
{
  const g = new G.Game(20250901);
  G.GAME = g; G.UI.game = g;
  g.startClass('barb', 0);
  const p = g.player;
  p.level = 20; p.skillPoints = 12; p.passivePoints = 3;
  p.skills.barb_rend = 5; p.skills.barb_whirl = 0; p.skills.barb_leap = 0;
  G.Stats.derive(p);

  const html = G.UI.skillDetailHTML('barb_rend');
  ok(html.indexOf('undefined') < 0 && html.indexOf('NaN') < 0, '技能说明无 undefined / NaN');
  ok(html.indexOf('Lv.5') >= 0, '技能说明显示当前等级', (html.match(/Lv\.\d+ \/ \d+/) || [''])[0]);
  ok(html.indexOf('基础伤害') >= 0, '技能说明显示基础伤害');
  ok(html.indexOf('伤害倍率') >= 0, '技能说明显示武器伤害倍率');
  ok(html.indexOf('投入下一点') >= 0, '技能说明显示加点收益区块');
  ok(html.indexOf('→') >= 0, '技能说明显示“当前 → 下一级”的对比');

  // 收益数值必须随加点单调增加
  const p2 = g.player;
  p2.skills.barb_rend = 1;
  const h1 = G.UI.skillDetailHTML('barb_rend');
  const p2b = new G.Game(5); p2b.player = G.ENT.makePlayer(p2b, 'barb'); p2b.player.level = 20;
  p2b.player.skills.barb_rend = 10;
  G.UI.game = p2b;
  const h10 = G.UI.skillDetailHTML('barb_rend');
  const num = (s) => { const m = s.match(/基础伤害 ([\d.]+) →/); return m ? parseFloat(m[1]) : -1; };
  ok(num(h10) > num(h1), '技能等级越高，基础伤害越高', num(h1) + ' → ' + num(h10));
  ok(G.UI.skillDetailHTML('barb_rend').indexOf('基础伤害') >= 0, '高等级技能说明正常生成');
  G.UI.game = g;

  // 未解锁 / 满级
  p.level = 20;
  p.skills.barb_leap = 0;
  const locked = G.UI.skillDetailHTML('barb_leap');
  ok(locked.indexOf('尚未学习') >= 0, '未学习技能标注“尚未学习”');
  p.level = 5;
  ok(G.UI.skillDetailHTML('barb_leap').indexOf('需要角色等级') >= 0, '未达等级要求时提示需要等级');
  p.level = 20;
  p.skills.barb_rend = G.DATA.SKILLS.barb_rend.maxLevel;
  ok(G.UI.skillDetailHTML('barb_rend').indexOf('已满级') >= 0, '满级技能提示已满级',
    G.DATA.SKILLS.barb_rend.maxLevel + ' 点');

  // 装备加成
  p.skills.barb_rend = 3;
  const gearW = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'weapon', rarity: 'rare', cls: 'barb' });
  gearW.affixes = [{ id: 's_skill', stat: 'skill:barb_rend', value: 2, tier: 3, kind: 'suffix', name: '专精之' }];
  p.gear.weapon = gearW;
  G.Stats.derive(p);
  const gh = G.UI.skillDetailHTML('barb_rend');
  ok(gh.indexOf('已投入 3 点') >= 0 && gh.indexOf('装备 +2') >= 0, '技能说明区分已投入点数与装备加成');

  // 全部技能 / 天赋都能生成说明
  let bad = 0;
  G.DATA.CLASSES.forEach((c) => c.skills.forEach((id) => {
    const s = G.UI.skillDetailHTML(id);
    if (!s || s.indexOf('undefined') >= 0 || s.indexOf('NaN') >= 0) { bad++; console.log('    ! 技能说明异常: ' + id); }
  }));
  G.DATA.PASSIVES.forEach((ps) => {
    const s = G.UI.passiveDetailHTML(ps.id);
    if (!s) bad++;
  });
  ok(bad === 0, '三职业全部技能与被动都能生成说明', bad);

  // 被动说明
  p.passives = { pa_wrath: 2 };
  p.passivePoints = 3;
  const ph = G.UI.passiveDetailHTML('pa_wrath');
  ok(ph.indexOf('投入下一点') >= 0, '被动说明包含加点收益');
  ok(ph.indexOf('伤害 +8%') >= 0 && ph.indexOf('伤害 +12%') >= 0, '被动说明显示当前与下一级效果', ph.slice(0, 120));
  p.passives.pa_wrath = 5;
  ok(G.UI.passiveDetailHTML('pa_wrath').indexOf('已满级') >= 0, '满级被动提示已满级');

  // 面板渲染 + 悬浮事件绑定
  let err = 0;
  try {
    G.UI.dirty.char = true;
    G.UI.renderCharacter();
    ok(G.el('skill-list').children.length > 0, '角色面板技能列表已渲染', G.el('skill-list').children.length + ' 项');
    G.UI.showTooltip(G.UI.skillDetailHTML('barb_rend'), { clientX: 100, clientY: 100 }, false);
    ok(G.el('tooltip').hidden === false, 'showTooltip 能显示技能说明');
    ok(G.el('tooltip').innerHTML.indexOf('基础伤害') >= 0, '提示框内容正确');
    G.UI.hideTooltip();
    ok(G.el('tooltip').hidden === true, 'hideTooltip 能隐藏提示框');
  } catch (e) { err++; console.error('   [技能提示]', e && e.stack ? e.stack : e); }
  ok(err === 0, '技能说明渲染无异常', err);
  p.gear.weapon = null;
  G.Stats.derive(p);
  report('技能 / 天赋说明与加点收益显示正常');
}

/* ============================================================ */
section('16c. 装备提升标识 / 红色边框 / 背包装整理规则');
{
  const g = new G.Game(777001);
  G.GAME = g; G.UI.game = g;
  g.startClass('barb', 0);
  const p = g.player;
  p.level = 30;
  p.alloc = { str: 60, dex: 0, int: 0, vit: 40 };
  G.Stats.derive(p);
  p.inventory = new Array(60).fill(null);
  G.UI._upCache = { sig: '', map: {} };

  // 每个部位都穿上一件普通装备作为基准
  G.DATA.gearSlots().forEach((s, i) => {
    const slotName = (s === 'ring1' || s === 'ring2') ? 'ring' : s;
    const it = G.Loot.makeItem(g.rng, { ilvl: 30, slot: slotName, rarity: 'common' });
    it.rarity = 'common'; it.affixes = [];
    if (s === 'weapon') it.min = 40, it.max = 60;
    p.gear[s] = it;
  });
  G.Stats.derive(p);
  G.UI._upCache = { sig: '', map: {} };

  // 造两件胸甲：一件远强于当前，一件远弱于当前
  const strong = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'chest', rarity: 'rare' });
  strong.affixes = [{ id: 'p_life', stat: 'life', value: 900, tier: 5, kind: 'prefix', name: '顽强的' }];
  const weak = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'chest', rarity: 'rare' });
  weak.affixes = [{ id: 's_mana', stat: 'mana', value: 5, tier: 0, kind: 'suffix', name: '法力之' }];
  ok(G.UI.isUpgrade(strong) === true, '明显更强的装备被标记为可提升');
  ok(G.UI.isUpgrade(weak) === false, '不如当前装备的不会被标记');
  ok(G.Loot.score(strong, p.stats) > G.Loot.score(p.gear.chest, p.stats), '评分对比前提成立');

  // 等级不足 / 属性不足 → 红框且不算提升
  const highLvl = G.Loot.makeItem(g.rng, { ilvl: 95, slot: 'chest', rarity: 'rare' });
  highLvl.affixes = [{ id: 'p_life', stat: 'life', value: 5000, tier: 8, kind: 'prefix', name: '顽强的' }];
  highLvl.req = { level: 99, str: 1 };
  ok(!!G.UI.canEquip(highLvl), '高等级装备无法穿戴', G.UI.canEquip(highLvl));
  ok(G.UI.cantEquip(highLvl) === true, '无法穿戴的装备会被标记');
  ok(G.UI.cellClass(highLvl).indexOf('cant-equip') >= 0, '红框类名已添加', G.UI.cellClass(highLvl));
  // 红框只表示「暂时穿不上」，评分箭头照旧：穿不上的更强装备同样标绿箭头
  ok(G.UI.isUpgrade(highLvl) === true, '穿不上但更强的装备仍标记为可提升');
  ok(G.UI.cellClass(highLvl).indexOf('upgrade') >= 0, '红框装备同时带 upgrade 类', G.UI.cellClass(highLvl));
  ok(G.UI.cellInner(highLvl).indexOf('up-mark') >= 0, '红框装备显示绿色上三角');
  const strReq = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'chest', rarity: 'rare' });
  strReq.req = { level: 1, str: 9999 };
  ok(G.UI.cantEquip(strReq) === true, '属性不足同样标记为无法穿戴');
  ok(G.UI.cellClass(strong).indexOf('upgrade') >= 0, '可提升装备带上 upgrade 类名');

  // 单元格内容含绿色上三角
  ok(G.UI.cellInner(strong).indexOf('up-mark') >= 0, '可提升装备的格子含 up-mark 标记');
  ok(G.UI.cellInner(weak).indexOf('up-mark') < 0, '普通装备没有标记');

  // 背包渲染
  p.inventory[0] = strong; p.inventory[1] = weak; p.inventory[2] = highLvl; p.inventory[3] = strReq;
  G.UI.dirty.inv = true;
  G.UI.refreshInventory();
  const grid = G.el('inv-grid');
  ok(grid.children[0].className.indexOf('upgrade') >= 0, '背包格子应用了提升样式');
  ok(grid.children[2].className.indexOf('cant-equip') >= 0, '背包格子应用了红框样式');
  ok(grid.children[0].innerHTML.indexOf('up-mark') >= 0, '背包格子渲染出绿色上三角');
  ok(grid.children[2].innerHTML.indexOf('up-mark') >= 0, '红框格子也渲染出绿色上三角');

  // 整理规则：稀有度优先 > 同稀有度内可提升优先 > 物品等级
  p.inventory = new Array(60).fill(null);
  const mk = (slot, rarity, ilvl) => {
    const it = G.Loot.makeItem(g.rng, { ilvl, slot, rarity });
    it.affixes = [];
    return it;
  };
  const commonPlain = mk('helm', 'common', 30);
  const commonUp = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'helm', rarity: 'common' });
  commonUp.affixes = [{ id: 'p_life', stat: 'life', value: 900, tier: 5, kind: 'prefix', name: '顽强的' }];
  const magicUp = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'helm', rarity: 'magic' });
  magicUp.affixes = [{ id: 'p_life', stat: 'life', value: 900, tier: 5, kind: 'prefix', name: '顽强的' }];
  const rareWeak = mk('helm', 'rare', 30);
  const uniqueWeak = mk('helm', 'unique', 30);
  ok(G.UI.isUpgrade(commonUp), '测试用普通胸甲/头盔可提升');
  ok(G.UI.isUpgrade(magicUp), '测试用魔法头盔可提升');
  ok(!G.UI.isUpgrade(rareWeak), '测试用稀有头盔不可提升');
  p.inventory[0] = commonPlain; p.inventory[1] = rareWeak;
  p.inventory[2] = commonUp; p.inventory[3] = magicUp; p.inventory[4] = uniqueWeak;
  G.UI._upCache = { sig: '', map: {} };
  G.UI.sortInventory();
  const inv = p.inventory.filter(Boolean);
  const idx = (it) => inv.indexOf(it);
  ok(idx(uniqueWeak) < idx(rareWeak), '稀有度优先：暗金排在稀有之前');
  ok(idx(rareWeak) < idx(magicUp), '稀有度优先：稀有排在魔法之前（即使魔法可提升）');
  ok(idx(magicUp) < idx(commonUp), '稀有度优先：魔法排在普通之前');
  ok(idx(commonUp) < idx(commonPlain), '同为普通时，可提升的排在前面');
  report('整理顺序：暗金 → 稀有 → 魔法(可提升) → 普通(可提升) → 普通');
}

/* ============================================================ */
section('16d. 宝石堆叠 / 珠宝匠 / 共享仓库');
{
  G.Shared.clear();
  const g = new G.Game(556677);
  G.GAME = g; G.UI.game = g;
  g.startClass('rogue', 0);
  const p = g.player;
  p.inventory = new Array(60).fill(null);

  /* --- 品质图标各不相同 --- */
  const glyphs = [0, 1, 2, 3, 4].map((t) => G.DATA.gemGlyph(t));
  ok(new Set(glyphs).size === 5, '5 个品质的宝石图标互不相同', glyphs.join(' '));
  ok(G.UI.itemGlyph(G.Loot.makeGemOf('ruby', 0, 1)) !== G.UI.itemGlyph(G.Loot.makeGemOf('ruby', 4, 1)), '背包图标按品质区分');

  /* --- 宝石可堆叠 --- */
  G.UI.addToInv(G.Loot.makeGemOf('ruby', 2, 1));
  G.UI.addToInv(G.Loot.makeGemOf('ruby', 2, 1));
  G.UI.addToInv(G.Loot.makeGemOf('ruby', 2, 3));
  const stacks = p.inventory.filter((x) => x && x.cat === 'gem' && x.gem === 'ruby' && x.tier === 2);
  ok(stacks.length === 1, '同种同品质宝石堆叠到一格', stacks.length + ' 格');
  ok(stacks[0].count === 5, '堆叠数量正确', stacks[0] && stacks[0].count);
  ok(G.Loot.price(stacks[0]) === Math.round(40 * Math.pow(2.4, 2) * 5), '堆叠宝石按数量计价', G.Loot.price(stacks[0]));
  // 不同品质不混堆
  G.UI.addToInv(G.Loot.makeGemOf('ruby', 3, 1));
  ok(p.inventory.filter((x) => x && x.cat === 'gem').length === 2, '不同品质分开堆叠');
  // 格子显示数量
  ok(G.UI.cellInner(stacks[0]).indexOf('>5<') >= 0, '宝石格子显示堆叠数量');

  /* --- 镶嵌只消耗 1 颗 --- */
  const gear = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'chest', rarity: 'rare' });
  gear.sockets = 2; gear.gems = [null, null];
  p.gear.chest = gear;
  const rubyIdx = p.inventory.indexOf(stacks[0]);
  G.UI.insertGemFromInv(rubyIdx);
  ok(gear.gems.filter(Boolean).length === 1, '成功镶嵌 1 颗宝石');
  ok(stacks[0].count === 4, '镶嵌后堆叠从 5 减到 4', stacks[0].count);

  /* --- 合成消耗 3 颗 --- */
  p.inventory = new Array(60).fill(null);
  G.UI.addToInv(G.Loot.makeGemOf('ruby', 0, 7));
  ok(G.UI.gemCounts().ruby_0 === 7, '合成前持有 7 颗');
  G.UI.combineGems('ruby', 0);
  ok(G.UI.gemCounts().ruby_0 === 4 && G.UI.gemCounts().ruby_1 === 1, '合成消耗 3 颗并产出 1 颗高品质',
    G.UI.gemCounts().ruby_0 + ' / ' + G.UI.gemCounts().ruby_1);
  G.UI.combineAllGems();
  ok(G.UI.gemCounts().ruby_1 >= 1, '一键合成后仍有产物', JSON.stringify(G.UI.gemCounts()));

  /* --- 珠宝匠面板渲染 --- */
  let jerr = 0;
  try {
    G.UI.togglePanel('panel-jeweler', true);
    G.UI.renderJeweler();
    ok(G.el('jeweler-list').children.length === 6, '珠宝匠面板按 6 种宝石分行', G.el('jeweler-list').children.length);
    ok(G.el('jewel-summary').innerHTML.indexOf('背包宝石') >= 0, '面板顶部显示统计');
  } catch (e) { jerr++; console.error('   [珠宝匠]', e && e.stack ? e.stack : e); }
  ok(jerr === 0, '珠宝匠面板渲染无异常', jerr);

  /* --- 共享仓库：存取 / 上限 / 跨存档 --- */
  G.Shared.clear();
  p.inventory = new Array(60).fill(null);
  G.UI.addToInv(G.Loot.orbItem('chaos', 12));
  G.UI.addToInv(G.Loot.makeGemOf('emerald', 3, 8));
  const orbSlot = p.inventory.findIndex((x) => x && x.cat === 'orb');
  const gemSlot = p.inventory.findIndex((x) => x && x.cat === 'gem');
  G.UI.depositToShared(orbSlot);
  G.UI.depositToShared(gemSlot);
  ok(p.inventory[orbSlot] === null && p.inventory[gemSlot] === null, '存入共享仓库后背包清空');
  ok(G.Shared.countOrb('chaos') === 12, '通货存入共享仓库', G.Shared.countOrb('chaos'));
  ok(G.Shared.countGem('emerald', 3) === 8, '宝石存入共享仓库', G.Shared.countGem('emerald', 3));
  ok(G.Shared.totalOrbs() === 12 && G.Shared.totalGems() === 8, '共享仓库统计正确');

  // 取出 1 个 / 一整叠
  G.UI.withdrawShared('orb', 'chaos', false);
  ok(G.Shared.countOrb('chaos') === 11, '取出 1 个通货');
  ok(p.inventory.filter((x) => x && x.cat === 'orb')[0].count === 1, '取出到背包的是 1 个');
  G.UI.withdrawShared('orb', 'chaos', true);
  ok(G.Shared.countOrb('chaos') === 0, 'Shift 取出一整叠');
  ok(p.inventory.filter((x) => x && x.cat === 'orb')[0].count === 12, '取出的通货与背包里的原有堆叠合并（1 + 11）',
    p.inventory.filter((x) => x && x.cat === 'orb')[0].count);
  ok(p.inventory.filter((x) => x && x.cat === 'orb').length === 1, '合并后只占一格');

  // 上限 9999
  G.Shared.addOrb('chaos', 99999);
  ok(G.Shared.countOrb('chaos') === G.Shared.MAX, '单种上限 ' + G.Shared.MAX, G.Shared.countOrb('chaos'));
  const put = G.Shared.addOrb('chaos', 10);
  ok(put === 0, '达到上限后无法继续存入', put);

  // 跨存档共享 + 持久化
  G.Shared.clear();
  G.Shared.addOrb('ascend', 42);
  G.Shared.addGem('diamond', 1, 3);
  G.Shared.flush();
  G.storage.clearAll();                      // 删除所有角色存档
  G.Shared.load();                           // 重新读取
  ok(G.Shared.countOrb('ascend') === 42 && G.Shared.countGem('diamond', 1) === 3,
    '删除存档位后共享仓库依然存在（跨存档共享）',
    G.Shared.countOrb('ascend') + '/' + G.Shared.countGem('diamond', 1));
  const g2 = new G.Game(99);
  G.UI.game = g2; G.GAME = g2;
  g2.startClass('sorc', 1);                  // 另一个存档位的角色
  ok(G.Shared.countOrb('ascend') === 42, '另一个存档位的角色能看到同一份共享仓库');

  // 物品仓库里的通货 / 宝石会自动搬进共享仓库
  const p2 = g2.player;
  p2.stash = [];
  p2.stash[0] = G.Loot.orbItem('refine', 5);
  p2.stash[1] = G.Loot.makeGemOf('topaz', 2, 4);
  const moved = G.UI.migrateSharedFromStash();
  ok(moved === 9 && p2.stash[0] === null, '物品仓库里遗留的通货宝石自动搬入共享仓库', moved);

  // 快速存入
  p2.inventory = new Array(60).fill(null);
  G.UI.addToInv(G.Loot.orbItem('purify', 3));
  G.UI.addToInv(G.Loot.makeGemOf('ruby', 0, 6));
  G.UI.addToInv(G.Loot.makeItem(g.rng, { ilvl: 20, slot: 'helm', rarity: 'common' }));   // 装备不应被搬走
  const before = G.Shared.totalOrbs() + G.Shared.totalGems();
  G.UI.depositAllShared();
  ok(G.Shared.totalOrbs() + G.Shared.totalGems() === before + 9, '快速存入把通货与宝石全部收进共享仓库');
  ok(p2.inventory.filter((x) => x && x.cat === 'equip').length === 1, '快速存入不会动装备');

  // 面板渲染
  let serr = 0;
  try {
    G.UI.togglePanel('panel-stash', true);
    G.UI.setStashTab('currency');
    ok(G.el('shared-orbs').children.length === G.DATA.ORBS.length, '共享仓库列出全部通货', G.el('shared-orbs').children.length);
    ok(G.el('shared-gems').children.length === 6 * 5, '共享仓库列出 6×5 种宝石', G.el('shared-gems').children.length);
    G.UI.setStashTab('items');
    ok(G.el('stash-page-items').hidden === false, '标签页可以切回物品仓库');
  } catch (e) { serr++; console.error('   [共享仓库]', e && e.stack ? e.stack : e); }
  ok(serr === 0, '共享仓库界面渲染无异常', serr);
  G.Shared.clear();
  report('宝石堆叠 / 品质图标 / 珠宝匠面板 / 跨存档共享仓库全部正常');
}

/* ============================================================ */
section('16e. 戒指双槽位对比与指定装备');
{
  const g = new G.Game(24680);
  G.GAME = g; G.UI.game = g;
  g.startClass('barb', 0);
  const p = g.player;
  p.level = 30;
  p.alloc = { str: 60, dex: 0, int: 0, vit: 40 };
  G.Stats.derive(p);
  p.inventory = new Array(60).fill(null);
  UIcacheReset();

  function UIcacheReset() { G.UI._upCache = { sig: '', map: {} }; }

  // 两个戒指位各放一枚不同的戒指
  const r1 = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'ring', rarity: 'rare' });
  r1.affixes = [{ id: 'p_str', stat: 'str', value: 5, tier: 0, kind: 'prefix', name: '强壮的' }];
  const r2 = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'ring', rarity: 'rare' });
  r2.affixes = [{ id: 'p_str', stat: 'str', value: 200, tier: 7, kind: 'prefix', name: '强壮的' }];
  p.gear.ring1 = r1; p.gear.ring2 = r2;
  G.Stats.derive(p);

  const strong = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'ring', rarity: 'rare' });
  strong.affixes = [{ id: 'p_str', stat: 'str', value: 150, tier: 6, kind: 'prefix', name: '强壮的' }];

  const cmp = G.Loot.compareAll(p, strong);
  ok(cmp.length === 2, '戒指返回两个槽位的对比', cmp.length);
  ok(cmp[0].slot === 'ring1' && cmp[1].slot === 'ring2', '对比分别对应戒指 I / II', cmp.map((c) => c.slot).join(','));
  ok(cmp[0].label === '戒指 I' && cmp[1].label === '戒指 II', '槽位标签正确');
  ok(cmp[0].delta > 0, '对比戒指 I：装上会提升', cmp[0].delta);
  ok(cmp[1].delta < 0, '对比戒指 II：装上会降低', cmp[1].delta);
  ok(cmp[0].delta !== cmp[1].delta, '两个槽位的评分变化不同');

  // 非戒指只返回一条
  const helm = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'helm', rarity: 'rare' });
  ok(G.Loot.compareAll(p, helm).length === 1, '非戒指装备只返回一条对比');

  // 提示框同时显示两个槽位
  const html = G.Loot.tooltipHTML(strong, p, { compare: true });
  ok(html.indexOf('戒指 I') >= 0 && html.indexOf('戒指 II') >= 0, '戒指提示框同时显示两个槽位的评分变化');
  ok(html.indexOf('右键点击可选择装备到') >= 0, '提示框说明可以指定槽位');

  // 指定装备到戒指 II
  p.inventory[0] = strong;
  G.UI.equipFromInv(0, 'ring2');
  ok(p.gear.ring2 === strong, '可以指定装备到戒指 II');
  ok(p.gear.ring1 === r1, '戒指 I 未被影响');
  ok(p.inventory[0] === r2, '被替换下来的戒指回到背包');

  // 装备到戒指 I
  G.UI.equipFromInv(0, 'ring1');
  ok(p.gear.ring1 === r2, '接着可以指定装备到戒指 I');
  ok(p.inventory[0] === r1, '原戒指 I 回到背包');

  // 未指定时保持自动选择（两个都满 → 替换戒指 I）
  p.inventory[0] = r1;
  G.UI.equipFromInv(0);
  ok(p.gear.ring1 === r1, '不指定槽位时沿用默认规则');

  // 右键菜单里会出现两个选项
  p.inventory[0] = strong;
  let menuEntries = null;
  const origCtx = G.UI.ctx;
  G.UI.ctx = function (ev, entries) { menuEntries = entries; };
  G.UI.cellRightClick(0, { clientX: 0, clientY: 0 });
  G.UI.ctx = origCtx;
  ok(menuEntries && menuEntries.some((e) => e.label.indexOf('戒指 I') >= 0) &&
    menuEntries.some((e) => e.label.indexOf('戒指 II') >= 0), '右键菜单提供两个戒指槽位选项',
    menuEntries ? menuEntries.map((e) => e.label).join(' / ') : 'none');
  report('戒指双槽位评分对比与指定装备正常');
}

/* ============================================================ */
section('16f. 词缀前后缀标识 / 悬停看当前装备 / 宝石拿起镶嵌 / 取下宝石');
{
  const g = new G.Game(909090);
  G.GAME = g; G.UI.game = g;
  g.startClass('barb', 0);
  const p = g.player;
  p.level = 30;
  p.inventory = new Array(60).fill(null);
  G.UI.heldGem = null;

  /* ---- 1. 词缀行标注前缀 / 后缀，且前缀排在前面 ---- */
  const it = G.Loot.makeItem(g.rng, { ilvl: 40, slot: 'chest', rarity: 'rare', cls: 'barb' });
  it.affixes = [
    { id: 's_mf', stat: 'mf', value: 20, tier: 3, kind: 'suffix', name: '财富之' },
    { id: 'p_str', stat: 'str', value: 30, tier: 3, kind: 'prefix', name: '强壮的' },
    { id: 's_life', stat: 'life', value: 100, tier: 3, kind: 'suffix', name: '生命之' },
    { id: 'p_crit', stat: 'crit', value: 4, tier: 3, kind: 'prefix', name: '精准的' },
  ];
  const html = G.Loot.tooltipHTML(it, null, {});
  ok(html.indexOf('akind pre') >= 0 && html.indexOf('akind suf') >= 0, '词缀行标注了前缀 / 后缀');
  ok((html.match(/>前</g) || []).length === 2 && (html.match(/>后</g) || []).length === 2, '前 / 后 标记数量与词缀一致',
    (html.match(/>前</g) || []).length + ' 前 / ' + (html.match(/>后</g) || []).length + ' 后');
  const order = G.Loot.sortedAffixes(it).map((a) => a.kind);
  ok(order.join(',') === 'prefix,prefix,suffix,suffix', '展示顺序为前缀在前、后缀在后', order.join(','));
  ok(/前缀 <b[^>]*>2 \/ 3<\/b>/.test(html), '统计行显示前缀 2 / 3');

  /* ---- 2. 悬停未穿戴装备 → 左右并列「已穿戴装备 | 新装备」 ---- */
  const wornHelm = G.Loot.makeItem(g.rng, { ilvl: 40, slot: 'helm', rarity: 'rare' });
  wornHelm.affixes = [{ id: 'p_str', stat: 'str', value: 55, tier: 4, kind: 'prefix', name: '强壮的' }];
  p.gear.helm = wornHelm;
  const newHelm = G.Loot.makeItem(g.rng, { ilvl: 40, slot: 'helm', rarity: 'rare' });
  newHelm.affixes = [{ id: 'p_str', stat: 'str', value: 20, tier: 2, kind: 'prefix', name: '强壮的' }];

  const partners = G.UI.equipPartners(newHelm);
  ok(partners.length === 1 && partners[0].item === wornHelm, '找到对应槽位的已穿戴装备', partners.length + ' 件');
  ok(partners[0].label === '头盔', '对照窗口标注槽位名', partners[0].label);

  const tp = G.el('tooltip');
  G.UI.tooltip(newHelm, { clientX: 40, clientY: 40 }, { compare: true });
  ok(tp.className === 'wide', '对比时提示框切换为宽版', tp.className);
  ok(tp.innerHTML.indexOf('已穿戴装备 · 头盔') >= 0, '左窗口标题为「已穿戴装备」');
  ok(tp.innerHTML.indexOf('>新装备<') >= 0, '右窗口标题为「新装备」');
  ok(tp.innerHTML.indexOf('class="twin"') >= 0 && (tp.innerHTML.match(/class="tcol /g) || []).length === 2,
    '确实是左右并列两个窗口', (tp.innerHTML.match(/class="tcol /g) || []).length + ' 个窗口');
  // 左右窗口的内容分别是旧装备与新装备
  const oldIdx = tp.innerHTML.indexOf('已穿戴装备 · 头盔');
  const newIdx = tp.innerHTML.indexOf('>新装备<');
  ok(oldIdx < newIdx, '旧装备在左、新装备在右');
  ok(tp.innerHTML.indexOf('+55 力量') >= 0, '左窗口显示旧装备属性');
  ok(tp.innerHTML.indexOf('+20 力量') >= 0, '右窗口显示新装备属性');
  ok(tp.innerHTML.indexOf(G.Loot.displayName(wornHelm)) >= 0 && tp.innerHTML.indexOf(G.Loot.displayName(newHelm)) >= 0,
    '两件装备的名字都在提示里');
  ok(/tcmp-foot[^>]*>(▲|▼)/.test(tp.innerHTML), '底部给出评分对比结论');
  // 评分结论属于「新装备」那个窗口，且位于它的底部
  const newColStart = tp.innerHTML.indexOf('class="tcol new"');
  const footIdx = tp.innerHTML.indexOf('tcmp-foot');
  ok(newColStart >= 0 && footIdx > newColStart, '评分结论显示在未穿戴装备的窗口里');
  const tail = footIdx >= 0 ? tp.innerHTML.slice(footIdx) : '';
  ok(footIdx > tp.innerHTML.lastIndexOf('tstat') && tail.indexOf('tname') < 0,
    '评分结论位于该窗口底部（其后不再有属性行）');
  G.UI.hideTooltip();

  /* 看过对比之后，普通提示框（技能 / 天赋 / 坚韧 / 宝石…）必须恢复自带的暗色底：
   * #tooltip.wide 是「外框透明、暗色底画在两侧窗口上」，漏清掉整个提示框就会变透明 */
  G.UI.showTooltip('<div class="tname">钢铁体魄</div>', { clientX: 40, clientY: 40 });
  ok(tp.className === '', '对比之后再看法术 / 天赋说明，提示框会清掉 wide 恢复暗色底', tp.className);
  ok(tp.innerHTML.indexOf('class="tcol ') < 0, '普通提示框里不再残留对比窗口的骨架');
  G.UI.hideTooltip();

  // 悬停身上这件装备时退化为单窗口
  G.UI.tooltip(wornHelm, { clientX: 40, clientY: 40 }, { compare: true });
  ok(tp.className === '' && tp.innerHTML.indexOf('class="twin"') < 0, '悬停已穿戴装备时不显示对比窗口');
  G.UI.hideTooltip();

  // 空槽位 → 单窗口
  const emptySlotItem = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'boots', rarity: 'rare' });
  p.gear.boots = null;
  G.UI.tooltip(emptySlotItem, { clientX: 40, clientY: 40 }, { compare: true });
  ok(tp.innerHTML.indexOf('class="twin"') < 0 && tp.innerHTML.indexOf('该部位当前为空') >= 0,
    '该部位为空时只显示新装备并提示空槽位');
  G.UI.hideTooltip();

  // 戒指 → 三个窗口（戒指 I / 戒指 II / 新装备）
  p.gear.ring1 = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'ring', rarity: 'rare' });
  p.gear.ring2 = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'ring', rarity: 'rare' });
  const ringHover = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'ring', rarity: 'rare' });
  ok(G.UI.equipPartners(ringHover).length === 2, '戒指会对照两个戒指位');
  G.UI.tooltip(ringHover, { clientX: 40, clientY: 40 }, { compare: true });
  ok((tp.innerHTML.match(/class="tcol /g) || []).length === 3, '戒指显示 3 个窗口',
    (tp.innerHTML.match(/class="tcol /g) || []).length);
  ok(tp.innerHTML.indexOf('已穿戴装备 · 戒指 I') >= 0 && tp.innerHTML.indexOf('已穿戴装备 · 戒指 II') >= 0,
    '两个戒指位分别成列');
  ok(tp.innerHTML.indexOf('右键点击可选择装备到') >= 0, '戒指提示可以指定槽位');
  G.UI.hideTooltip();
  p.gear.ring1 = null; p.gear.ring2 = null;

  /* ---- 3. 宝石「拿起 → 点击装备镶嵌」 ---- */
  const gear = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'chest', rarity: 'rare' });
  gear.sockets = 2; gear.gems = [null, null];
  const stack = G.Loot.makeGemOf('ruby', 2, 5);
  p.inventory[0] = gear;
  p.inventory[1] = stack;

  G.UI.cellLeftClick(1);                       // 点击宝石
  ok(!!G.UI.heldGem && G.UI.heldGem.uid === stack.uid, '点击宝石会被拿起');
  ok(G.el('held-gem').hidden === false, '光标上出现宝石图标');
  ok(stack.count === 5, '拿起时不会消耗宝石');

  G.UI.cellLeftClick(0);                       // 点击有孔装备
  ok(gear.gems.filter(Boolean).length === 1, '点击有孔装备后完成镶嵌');
  ok(gear.gems[0] && gear.gems[0].gem === 'ruby' && gear.gems[0].tier === 2, '镶嵌的宝石种类正确');
  ok(stack.count === 4, '只消耗 1 颗', stack.count);
  ok(G.UI.heldGem === null, '镶嵌后自动放下宝石');
  ok(G.el('held-gem').hidden === true, '光标图标消失');

  // 没有孔位的装备不会消耗宝石，且保持拿起状态
  const noSock = G.Loot.makeItem(g.rng, { ilvl: 30, slot: 'boots', rarity: 'rare' });
  noSock.sockets = 0; noSock.gems = [];
  p.inventory[2] = noSock;
  G.UI.cellLeftClick(1);
  ok(!!G.UI.heldGem, '再次拿起宝石');
  const c0 = stack.count;
  G.UI.cellLeftClick(2);
  ok(stack.count === c0, '点击无孔装备不会消耗宝石');
  ok(!!G.UI.heldGem, '镶嵌失败时保持拿起状态');

  // 把剩下的孔位也镶满
  G.UI.cellLeftClick(0);
  ok(gear.gems.filter(Boolean).length === 2, '第二个孔位也镶上了', gear.gems.filter(Boolean).length + '/2');
  ok(stack.count === c0 - 1, '镶嵌消耗 1 颗');

  // 孔位已满 → 不再消耗，且保持拿起
  G.UI.cellLeftClick(1);
  ok(!!G.UI.heldGem, '第三次拿起宝石');
  const c1 = stack.count;
  G.UI.cellLeftClick(0);
  ok(stack.count === c1, '孔位已满时不会消耗宝石', '孔位 ' + gear.gems.filter(Boolean).length + '/2');
  ok(!!G.UI.heldGem, '孔位已满时保持拿起状态');
  G.UI.releaseGem();
  ok(G.UI.heldGem === null && G.el('held-gem').hidden === true, '可以手动放下宝石');

  // 装备栏（已穿戴）也可以直接镶嵌
  p.gear.helm = wornHelm;
  wornHelm.sockets = 1; wornHelm.gems = [null];
  G.UI.cellLeftClick(1);
  ok(!!G.UI.heldGem, '拿起宝石准备镶嵌到已穿戴装备');
  G.UI.socketHeldGem(wornHelm);
  ok(wornHelm.gems[0] && wornHelm.gems[0].gem === 'ruby', '已穿戴的装备也能镶嵌');
  ok(G.UI.heldGem === null, '镶嵌后放下');

  /* ---- 4. 珠宝匠取下宝石 ---- */
  const before = stack.count;
  G.UI.removeGemFrom(gear, 0);
  ok(gear.gems[0] === null, '宝石从装备上取下');
  const back = p.inventory.filter((x) => x && x.cat === 'gem' && x.gem === 'ruby' && x.tier === 2)
    .reduce((s, x) => s + (x.count || 1), 0);
  ok(back === before + 1, '取下的宝石回到背包', back);

  G.UI.renderJeweler();
  ok(G.el('jeweler-list').children.length === 6, '合成面板 6 行全部渲染', G.el('jeweler-list').children.length);
  const pullRows = G.el('gem-pull-list').children.length;
  ok(pullRows > 0, '右侧列出已镶嵌宝石的装备', pullRows + ' 件');
  G.UI.removeAllGems();
  const stillHas = G.UI.socketedItems().length;
  ok(stillHas === 0, '「全部取下」清空所有镶嵌', stillHas);

  // 面板结构：左右两栏，合成区不滚动
  const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');  ok(htmlSrc.indexOf('id="btn-gem-pull-all"') >= 0 && htmlSrc.indexOf('id="gem-pull-list"') >= 0, '珠宝匠面板包含取下宝石区块');
  const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const jl = cssSrc.match(/\.jewel-list\{[^}]*\}/);
  ok(jl && jl[0].indexOf('overflow:visible') >= 0 && jl[0].indexOf('max-height') < 0,
    '宝石合成区不再有滚动条', jl ? jl[0] : 'none');
  report('前后缀标识 / 当前装备预览 / 拿起镶嵌 / 取下宝石全部正常');
}

/* ============================================================ */
section('16g. 对比窗口分离 & 孔位菱形标识');
{
  const cssSrc2 = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  // 每个对比窗口都是独立的小窗：各自有边框 / 底色 / 阴影，高度互不拉伸
  const wide = cssSrc2.match(/#tooltip\.wide\{[^}]*\}/);
  ok(wide && wide[0].indexOf('border:0') >= 0 && wide[0].indexOf('background:none') >= 0 &&
    wide[0].indexOf('padding:0') >= 0,
    '对比时外层不再画共用的框与底（短窗口才不会被拉长）', wide ? wide[0].slice(0, 70) : 'none');
  const divider = cssSrc2.match(/#tooltip \.tcol \+ \.tcol::before\{[^}]*\}/);
  ok(!divider, '窗口之间不再有竖向分隔线（改成两个独立的窗）');
  ok(/\.twin\{[^}]*gap:16px/.test(cssSrc2) && /\.twin\{[^}]*align-items:flex-start/.test(cssSrc2),
    '对比窗口并排且各自独立（flex + flex-start，不互相拉伸）');
  const tcolCss = cssSrc2.match(/#tooltip \.tcol\{[^}]*\}/);
  ok(tcolCss && tcolCss[0].indexOf('width:292px') >= 0 && tcolCss[0].indexOf('border:1px solid') >= 0 &&
    tcolCss[0].indexOf('background:') >= 0 && tcolCss[0].indexOf('box-shadow:') >= 0,
    '每个对比窗口自己就是一个完整的小窗（边框 + 底色 + 阴影）');
  ok(tcolCss && tcolCss[0].indexOf('padding:8px 10px') >= 0, '窗口内边距保持不变');
  ok(/#tooltip \.tstat\.base \.arng::before\{content:"范围 "/.test(cssSrc2.replace(/\n/g, '')),
    '基础数值区间带「范围」前缀，避免与当前数值混淆');
  // 孔位菱形
  const sock = cssSrc2.match(/\.sockets i\{[^}]*\}/);
  ok(sock && sock[0].indexOf('rotate(45deg)') >= 0, '孔位标记是菱形（rotate 45deg）', sock ? sock[0] : 'none');
  ok(sock && sock[0].indexOf('border-radius:50%') < 0, '孔位标记不再是圆形');

  const g2 = new G.Game(606060);
  G.GAME = g2; G.UI.game = g2;
  g2.player = G.ENT.makePlayer(g2, 'barb');

  // 无孔 → 没有孔位标识
  const zero = G.Loot.makeItem(g2.rng, { ilvl: 30, slot: 'chest', rarity: 'common' });
  zero.sockets = 0; zero.gems = [];
  ok(G.UI.socketsHTML(zero) === '', '无孔装备不显示孔位标识');
  ok(G.UI.cellInner(zero).indexOf('sockets') < 0, '无孔装备的格子里没有孔位标记');

  // 一孔一个菱形，并标注「孔位 已镶嵌 / 总数」
  const sockBad = [];
  [1, 2, 3, 4].forEach((n) => {
    const it = G.Loot.makeItem(g2.rng, { ilvl: 40, slot: 'chest', rarity: 'rare' });
    it.sockets = n; it.gems = new Array(n).fill(null);
    const html = G.UI.socketsHTML(it);
    if ((html.match(/<i /g) || []).length !== n || html.indexOf('孔位 0 / ' + n) < 0) sockBad.push(n + ' 孔');
  });
  ok(sockBad.length === 0, '1-4 孔各渲染对应数量的菱形，并标注孔位数量', sockBad.join('、'));

  // 已镶嵌的菱形带宝石颜色
  const gemmed = G.Loot.makeItem(g2.rng, { ilvl: 40, slot: 'chest', rarity: 'rare' });
  gemmed.sockets = 2; gemmed.gems = [{ gem: 'ruby', tier: 1 }, null];
  const gh = G.UI.socketsHTML(gemmed);
  ok((gh.match(/class="filled"/g) || []).length === 1, '已镶嵌的孔位标记为 filled');
  ok(gh.indexOf(G.DATA.GEM_TYPES.ruby.color) >= 0, '已镶嵌的菱形使用宝石颜色', G.DATA.GEM_TYPES.ruby.color);
  ok(gh.indexOf('孔位 1 / 2') >= 0, '提示文本统计已镶嵌数量');

  // 背包格子渲染里也带上了
  const p = g2.player;
  p.inventory = new Array(60).fill(null);
  p.inventory[0] = gemmed;
  G.UI.dirty.inv = true;
  G.UI.refreshInventory();
  const cellHtml = G.el('inv-grid').children[0].innerHTML;
  ok((cellHtml.match(/<i /g) || []).length === 2, '背包格子渲染出 2 颗孔位菱形',
    (cellHtml.match(/<i /g) || []).length);

  /* ---- 角色面板（C）的装备栏：空槽位名称 + 已穿戴装备的孔位标识 ---- */
  p.gear = {};
  Object.keys(G.DATA.SLOT_BY_ID).forEach((k) => { p.gear[k] = null; });
  const doll = G.el('equip-doll');
  doll.innerHTML = '';
  Object.keys(G.DATA.SLOT_BY_ID).forEach((k) => {
    const d = new FakeEl('div');
    d.className = 'slot-equip';
    d.dataset.slot = k;
    doll.appendChild(d);
  });
  G.UI.refreshEquipDoll();
  const cellsOf = () => Array.prototype.slice.call(doll.children);
  const emptyCells = cellsOf().filter((c) => (c.className || '').split(/\s+/).indexOf('empty') >= 0);
  ok(emptyCells.length === G.DATA.SLOTS.length, '空槽位都标记为 empty', emptyCells.length + ' 个');
  ok(emptyCells.every((c) => c.innerHTML.indexOf(G.DATA.SLOT_BY_ID[c.dataset.slot].name + ' · 空') >= 0),
    '空槽位显示为「部位 · 空」，例如「手套 · 空」',
    emptyCells.length ? emptyCells[0].innerHTML.replace(/<[^>]*>/g, '') : 'none');
  ok(emptyCells.every((c) => c.innerHTML.indexOf('sockets') < 0), '空槽位没有孔位标识');

  const worn = G.Loot.makeItem(g2.rng, { ilvl: 40, slot: 'gloves', rarity: 'rare' });
  worn.sockets = 3; worn.gems = [{ gem: 'ruby', tier: 0 }, null, null];
  p.gear.gloves = worn;
  G.UI.refreshEquipDoll();
  const pick = (slot) => cellsOf().filter((c) => c.dataset.slot === slot)[0];
  const gloveCell = pick('gloves');
  ok(gloveCell && (gloveCell.className || '').split(/\s+/).indexOf('empty') < 0, '穿上装备后不再是空槽位');
  ok(gloveCell && (gloveCell.innerHTML.match(/<i /g) || []).length === 3,
    '已穿戴装备图标下也显示 3 颗孔位菱形',
    gloveCell ? (gloveCell.innerHTML.match(/<i /g) || []).length + ' 颗' : 'none');
  ok(gloveCell && gloveCell.innerHTML.indexOf(G.DATA.GEM_TYPES.ruby.color) >= 0,
    '装备栏的菱形也用宝石颜色');
  const plain = G.Loot.makeItem(g2.rng, { ilvl: 40, slot: 'helm', rarity: 'rare' });
  plain.sockets = 0; plain.gems = [];
  p.gear.helm = plain;
  G.UI.refreshEquipDoll();
  const helmCell = pick('helm');
  ok(helmCell && helmCell.innerHTML.indexOf('sockets') < 0, '无孔装备的装备栏格子不显示孔位标识');
  report('对比竖线与孔位菱形标识校验通过');
}

/* ============================================================ */
section('16h. 技能强化分支：数据、解锁、互斥与生效');
{
  const D = G.DATA;
  const S = G.Stats;
  /* ---- 数据完整性 ---- */
  ok(JSON.stringify(D.SKILL_TIERS) === JSON.stringify([5, 10, 15, 20, 25]), '分支档位为 5/10/15/20/25',
    D.SKILL_TIERS.join('/'));
  let totalBr = 0, dup = {}, badMod = [], badBr = [];
  Object.keys(D.SKILLS).forEach((sid) => {
    const tree = D.skillBranches(sid);
    D.SKILL_TIERS.forEach((t) => {
      const want = t === 25 ? 3 : 2;
      const list = tree && tree[t];
      if (!list || list.length !== want) badBr.push(sid + ' ' + t + ' 级=' + (list ? list.length : 'x'));
      (list || []).forEach((b) => {
        totalBr++;
        if (dup[b.id]) ok(false, '分支 id 重复：' + b.id);
        dup[b.id] = true;
        if (!b.name || !b.text.length || !b.icon) ok(false, '分支缺字段：' + b.id);
        Object.keys(b.mods).forEach((k) => { if (!D.modText({ [k]: b.mods[k] }).length) badMod.push(b.id + ':' + k); });
      });
    });
  });
  ok(badBr.length === 0, '每个技能 5/10/15/20 级各 2 个分支、25 级 3 个（共 ' + totalBr + ' 个）', badBr.join('、'));
  ok(totalBr === Object.keys(D.SKILLS).length * 11 && totalBr > 0, '每个技能 11 个分支，共 ' + totalBr + ' 个');
  ok(badMod.length === 0, '所有修饰符都有可读的说明文本', badMod.join(','));
  ok(Object.keys(D.SKILLS).every((k) => D.SKILLS[k].maxLevel === 25), '技能等级上限提升到 25');

  /* ---- 25 级之后的成长：等比递减但永远 > 0 ---- */
  const sc = D.skillScaleLevel;
  ok(sc(25) === 25, '25 级以内没有衰减', sc(25));
  ok(Math.abs(sc(26) - 25.95) < 1e-9, '26 级等效 25.95 级（95%）', sc(26).toFixed(4));
  ok(Math.abs(sc(27) - (25 + 0.95 + 0.9025)) < 1e-9, '27 级继续按 90.25% 累加', sc(27).toFixed(4));
  let mono = true, zeroGain = false;
  for (let lv = 26; lv <= 99; lv++) {
    const a = sc(lv), b = sc(lv + 1);
    if (!(b > a)) mono = false;
    if (b - a <= 0) zeroGain = true;
  }
  ok(mono && !zeroGain, '25 级之后每一级都仍然有收益且不会归零', sc(99).toFixed(3));
  ok((sc(26) - sc(25)) < (sc(25) - sc(24)), '26 级的收益低于 25 级的收益');
  ok(sc(99) < 45 && sc(99) > 43, '超出部分收敛（99 级等效约 43.6 级）', sc(99).toFixed(3));

  /* ---- 技能等级门槛：装备可以顶开分支，脱掉就失效 ---- */
  const g3 = new G.Game(424242);
  G.GAME = g3; G.UI.game = g3;
  g3.player = G.ENT.makePlayer(g3, 'barb');
  const p3 = g3.player;
  p3.level = 30;
  G.Stats.derive(p3);
  const SID = 'barb_whirl';
  ok(G.UI.branchState(p3, SID, 5, 0) === 'locked', '没投点时 5 级分支是锁着的');
  p3.skills[SID] = 5;
  G.Stats.derive(p3);
  ok(G.UI.branchState(p3, SID, 5, 0) === 'open', '技能到 5 级后分支可选择');
  ok(G.UI.branchState(p3, SID, 10, 0) === 'locked', '10 级分支仍然锁着');
  ok(G.UI.pickBranch(SID, 10, 0) === false, '等级不够时无法分配分支');
  ok(!S.chosenBranch(p3, SID, 10), '失败的分配不会写入存档数据');

  // 装备 +6 技能等级 → 顶到 11 级，10 级分支解锁
  const gearSk = G.Loot.makeItem(g3.rng, { ilvl: 60, slot: 'helm', rarity: 'rare' });
  gearSk.affixes = [{ id: 's_skill', stat: 'skill:' + SID, value: 6, tier: 2, kind: 'suffix', name: '专精之' }];
  p3.gear.helm = gearSk;
  G.Stats.derive(p3);
  ok(S.skillLevel(p3, SID) === 11, '装备把技能顶到 11 级', S.skillLevel(p3, SID));
  ok(G.UI.branchState(p3, SID, 10, 1) === 'open', '装备加成可以解锁 10 级分支');
  ok(G.UI.pickBranch(SID, 10, 1) === true, '装备加成下可以正常分配分支');
  const b10 = D.skillBranches(SID)[10][1];
  ok(S.chosenBranch(p3, SID, 10) === b10.id, '分支已记录');
  ok(!!S.branchActive(p3, SID, 10), '分支当前生效');
  const modsWith = S.skillMods(p3, SID);
  ok(Object.keys(modsWith).length > 0, '分支修饰符汇总非空', JSON.stringify(modsWith));

  // 脱掉装备 → 等级掉回 5，分支保留但失效
  p3.gear.helm = null;
  G.Stats.derive(p3);
  ok(S.skillLevel(p3, SID) === 5, '脱下装备后技能等级掉回 5', S.skillLevel(p3, SID));
  ok(S.chosenBranch(p3, SID, 10) === b10.id, '失效的分支选择仍然保留');
  ok(!S.branchActive(p3, SID, 10), '等级不足时分支不生效');
  ok(!!S.branchDormant(p3, SID, 10), '被标记为失效状态');
  ok(Object.keys(S.skillMods(p3, SID)).length === 0, '失效分支不再提供任何修饰符',
    JSON.stringify(S.skillMods(p3, SID)));
  ok(G.UI.branchState(p3, SID, 10, 1) === 'dormant', '界面状态为「失效」');
  ok(G.UI.dormantCount(p3, SID) === 1, '失效计数正确');

  // 重新穿上 → 恢复生效
  p3.gear.helm = gearSk;
  G.Stats.derive(p3);
  ok(!!S.branchActive(p3, SID, 10) && G.UI.dormantCount(p3, SID) === 0, '重新装备后分支恢复生效');

  /* ---- 同档位互斥 ---- */
  ok(G.UI.branchState(p3, SID, 10, 0) === 'blocked', '同档位另一个分支被锁死');
  ok(G.UI.pickBranch(SID, 10, 0) === false, '不能同时选择同档位的两个分支');
  G.UI.pickBranch(SID, 5, 0);
  ok(G.UI.branchSummary(p3, SID) === 2, '两个不同档位的分支可以同时存在', G.UI.branchSummary(p3, SID));

  /* ---- 修饰符真的生效 ---- */
  const base = D.SKILLS[SID];
  const dmgOf = () => { const c = G.Combat.attackComponents(p3, base, 11); let t = 0; for (const k in c) t += c[k]; return t; };
  // 先清掉 5 级分支，再加一个纯伤害分支（利刃 {dmg:18}）
  delete p3.skillBranches[SID][5];
  const dmgBefore = dmgOf();
  p3.skillBranches[SID][5] = D.skillBranches(SID)[5][0].id;
  const dmgAfter = dmgOf();
  ok(dmgAfter > dmgBefore, '伤害分支提高了技能伤害', Math.round(dmgBefore) + ' → ' + Math.round(dmgAfter));
  ok(Math.abs(dmgAfter / dmgBefore - 1.18) < 0.02, '提升幅度与分支数值一致（+18%）',
    ((dmgAfter / dmgBefore - 1) * 100).toFixed(1) + '%');

  // 消耗 / 冷却 / 范围 / 数量
  const costBranch = D.skillBranches('barb_leap')[5][1];      // 轻装 {cost:-25}
  p3.skills.barb_leap = 25;
  G.Stats.derive(p3);
  const leapBase = S.skillShape(p3, D.SKILLS.barb_leap);
  p3.skillBranches.barb_leap = { 5: costBranch.id };
  const leapCut = S.skillShape(p3, D.SKILLS.barb_leap);
  ok(leapCut.cost < leapBase.cost, '减耗分支降低了法力消耗', leapBase.cost + ' → ' + leapCut.cost);
  ok(leapCut.cost === Math.round(leapBase.cost * 0.75), '减耗数值正确（-25%）', leapCut.cost);

  p3.skills.rogue_multishot = 0;
  const msId = 'rogue_multishot';
  p3.skillBranches[msId] = {};
  p3.skills[msId] = 25;
  G.Stats.derive(p3);
  const fanBase = S.skillShape(p3, D.SKILLS[msId]);
  ok(fanBase.count === D.SKILLS[msId].count, '未选分支时箭矢数等于基础值', fanBase.count);
  p3.skillBranches[msId][10] = D.skillBranches(msId)[10][0].id;   // 更多箭矢 {count:2}
  const fanMore = S.skillShape(p3, D.SKILLS[msId]);
  ok(fanMore.count === fanBase.count + 2, '数量分支让箭矢 +2', fanBase.count + ' → ' + fanMore.count);

  p3.skillBranches[msId][15] = D.skillBranches(msId)[15][0].id;   // 扩散射击 {radius:30}
  const fanWide = S.skillShape(p3, D.SKILLS[msId]);
  ok(fanWide.spread > fanBase.spread, '范围分支放大了扇形角度', fanBase.spread.toFixed(2) + ' → ' + fanWide.spread.toFixed(2));
  ok(Math.abs(fanWide.spread - fanBase.spread * 1.3) < 1e-6, '扇形角度放大幅度正确（+30%）', fanWide.spread.toFixed(2));

  p3.skillBranches[msId][20] = D.skillBranches(msId)[20][0].id;   // 箭如雨下 {count:2, dmg:15}
  p3.skillBranches[msId][25] = D.skillBranches(msId)[25][0].id;   // 万箭齐发 {count:4}
  const fanAll = S.skillShape(p3, D.SKILLS[msId]);
  ok(fanAll.count === fanBase.count + 2 + 2 + 4, '多个档位叠加后累计 +8 支箭', fanBase.count + ' → ' + fanAll.count);
  const strong25 = D.skillBranches(msId)[25];
  ok(strong25.length === 3 && strong25.every((b) => b.strong), '25 级提供 3 个强力分支');

  // 元素转化
  const sb = D.SKILLS.rogue_basic;
  p3.skills.rogue_basic = 25;
  G.Stats.derive(p3);
  const plain1 = G.Combat.attackComponents(p3, sb, 25);
  p3.skillBranches.rogue_basic = { 10: D.skillBranches('rogue_basic')[10][1].id };  // 淬毒箭 {elem:{poison:0.5}}
  const mixed = G.Combat.attackComponents(p3, sb, 25);
  ok(mixed.poison > 0 && mixed.poison > plain1.poison, '元素转化把一半伤害转成毒素', Math.round(mixed.poison));
  ok(Math.abs((mixed.physical + mixed.poison) / (plain1.physical + plain1.poison) - 1) < 0.02,
    '转化不会凭空增减总伤害');
  delete p3.skillBranches.rogue_basic;

  // 斩杀 / 命中回复 / 暴击：直接验证 C.hitMonster 的分支处理
  const g4 = new G.Game(777);
  G.GAME = g4; G.UI.game = g4;
  g4.player = G.ENT.makePlayer(g4, 'barb');
  const p4 = g4.player;
  p4.level = 40;
  g4.toDungeon(4);                              // 需要地图才能结算击杀与掉落
  G.Stats.derive(p4);
  p4.stats.crit = 0;
  const mon = G.ENT.makeMonster ? G.ENT.makeMonster(g4, 'skeleton', 40, p4.x + 40, p4.y) : null;
  if (mon) {
    p4.skills.barb_basic = 20;                  // 需要 20 级才能用 20 级分支
    p4.skillBranches.barb_basic = { 20: D.skillBranches('barb_basic')[20][0].id };  // 斩首
    G.Stats.derive(p4);
    p4.stats.crit = 0;                          // 关掉暴击，保证伤害可比较
    mon.dodgeChance = 0;
    const exMods = S.skillMods(p4, 'barb_basic');
    ok(exMods.execute && exMods.execute.hp === 30, '斩杀分支的修饰符被正确汇总', JSON.stringify(exMods));
    const comps = { physical: 100, fire: 0, cold: 0, lightning: 0, poison: 0 };
    mon.maxLife = 10000; mon.life = 3000;      // 30% → 触发斩杀
    const noMods = G.Combat.hitMonster(g4, mon, Object.assign({}, comps), {});
    mon.life = 3000;
    const withEx = G.Combat.hitMonster(g4, mon, Object.assign({}, comps), { mods: exMods });
    ok(withEx > noMods * 1.4, '斩杀分支对低血量目标造成更高伤害', noMods + ' → ' + withEx);
    // 满血目标不触发斩杀
    mon.life = 10000;
    const full = G.Combat.hitMonster(g4, mon, Object.assign({}, comps), { mods: exMods });
    ok(Math.abs(full - noMods) <= 1, '高血量目标不吃斩杀加成', noMods + ' → ' + full);

    // 生命偷取 / 溅射 / 点燃 / 减速 / 击杀回蓝
    p4.life = 100;
    mon.life = 10000;
    G.Combat.hitMonster(g4, mon, Object.assign({}, comps), { mods: { leech: 50 } });
    ok(p4.life > 100, '生命偷取分支按伤害回血', '100 → ' + Math.round(p4.life));

    p4.mana = 10;
    mon.life = 10000;
    G.Combat.hitMonster(g4, mon, Object.assign({}, comps), { mods: { manaOnKill: 9999 } });
    ok(p4.mana === 10, '目标没死时不给击杀回蓝', p4.mana);
    mon.life = 5;
    G.Combat.hitMonster(g4, mon, Object.assign({}, comps), { mods: { manaOnKill: 9999 } });
    ok(p4.mana > 10, '击杀回蓝分支在目标死亡时生效', Math.round(p4.mana));

    // 溅射：主目标以外的敌人也吃到一部分伤害
    const g5b = new G.Game(5151);
    G.GAME = g5b; G.UI.game = g5b;
    g5b.player = G.ENT.makePlayer(g5b, 'barb');
    const p5b = g5b.player;
    p5b.level = 40;
    g5b.toDungeon(4);
    p5b.x = g5b.map.playerStart.x; p5b.y = g5b.map.playerStart.y;
    G.Stats.derive(p5b); p5b.stats.crit = 0;
    const a1 = G.ENT.makeMonster(g5b, 'skeleton', p5b.x + 40, p5b.y, { mlvl: 40 });
    const a2 = G.ENT.makeMonster(g5b, 'skeleton', p5b.x + 70, p5b.y + 20, { mlvl: 40 });
    const a3 = G.ENT.makeMonster(g5b, 'skeleton', p5b.x + 900, p5b.y, { mlvl: 40 });
    g5b.monsters = [a1, a2, a3];
    [a1, a2, a3].forEach((m) => { m.maxLife = 100000; m.life = 100000; m.armor = 0; m.res = {}; });
    const hits = { physical: 200, fire: 0, cold: 0, lightning: 0, poison: 0 };
    const before2 = a2.life, before3 = a3.life;
    G.Combat.hitMonster(g5b, a1, Object.assign({}, hits), { mods: { splash: 50 } });
    ok(a2.life < before2, '溅射伤害打到了旁边的敌人', Math.round(before2 - a2.life));
    ok(a3.life === before3, '远处敌人不受溅射影响');
    ok(Math.abs((before2 - a2.life) - (100000 - a1.life) * 0.5 / 1) < 60, '溅射伤害约为主目标的 50%',
      Math.round(before2 - a2.life) + ' vs ' + Math.round(100000 - a1.life));

    // 点燃 / 减速
    const a4 = G.ENT.makeMonster(g5b, 'skeleton', p5b.x + 60, p5b.y + 40, { mlvl: 40 });
    g5b.monsters.push(a4);
    a4.maxLife = 100000; a4.life = 100000; a4.armor = 0; a4.res = {};
    G.Combat.hitMonster(g5b, a4, Object.assign({}, hits), { mods: { burn: { mult: 0.4, dur: 3 }, chill: { slow: 0.4, dur: 3 } } });
    ok(a4.dots && a4.dots.length && a4.dots[0].dps > 0, '点燃分支挂上了持续伤害', a4.dots && a4.dots.length);
    ok(a4.slow && a4.slow.remaining > 0, '减速分支生效', a4.slow && a4.slow.pct);

    // 攻速分支：普通攻击的出手间隔变短
    const basicId = 'barb_basic';
    p5b.skills[basicId] = 25;                    // 需要技能等级才能让分支生效
    S.derive(p5b);
    const iv0 = S.basicAttackInterval(p5b);
    p5b.skillBranches[basicId] = { 5: D.skillBranches(basicId)[5][1].id };   // 狂乱劈砍 {aps:18}
    const iv1 = S.basicAttackInterval(p5b);
    ok(iv1 < iv0, '攻速分支缩短了普通攻击间隔', iv0.toFixed(3) + ' → ' + iv1.toFixed(3));
    ok(Math.abs(iv1 - iv0 / 1.18) < 1e-6, '攻速加成数值正确（+18%）');
    delete p5b.skillBranches[basicId];

    // 不再有「命中回复生命」这类过弱的属性
    let healMods = 0;
    Object.keys(D.SKILLS).forEach((sid) => {
      D.SKILL_TIERS.forEach((t) => {
        D.skillBranches(sid)[t].forEach((b) => {
          if (b.mods.onHitHeal || b.mods.onHitMana) healMods++;
        });
      });
    });
    ok(healMods === 0, '技能强化里不再包含命中回血 / 回蓝这类属性', healMods + ' 处');
  } else {
    ok(false, '无法生成测试怪物');
  }

  report('技能分支的数据 / 解锁 / 互斥 / 失效 / 生效全部正常');
}

/* ============================================================ */
section('16i. 技能窗口与洗点');
{
  const D = G.DATA;
  const S = G.Stats;
  const g5 = new G.Game(909090);
  G.GAME = g5; G.UI.game = g5;
  g5.player = G.ENT.makePlayer(g5, 'sorc');
  const p5 = g5.player;
  p5.level = 40;
  p5.skillPoints = 30;
  p5.skills.sorc_fireball = 12;
  G.Stats.derive(p5);

  /* ---- 角色面板：技能行不再直接加点 ---- */
  G.UI.dirty.char = true;
  G.UI.renderCharacter();
  const list = G.el('skill-list');
  const first = list.children[0];
  ok(first.innerHTML.indexOf('<button') < 0, '角色面板的技能行不再有直接加点按钮');
  ok(first.innerHTML.indexOf('sbr') >= 0 && first.innerHTML.indexOf('点击查看') >= 0, '技能行提示点击查看强化窗口');
  ok(first.className.indexOf('clickable') >= 0, '技能行可点击');

  /* ---- 打开窗口 ---- */
  G.UI.openSkillWindow('sorc_fireball');
  const pnl = G.el('panel-skill');
  ok(pnl.hidden === false, '技能窗口被打开');
  ok(G.UI.open === 'panel-skill', '当前面板是技能窗口', G.UI.open);
  ok(G.UI.skillWin === 'sorc_fireball', '记录了当前技能');
  const tree = G.el('sk-tree');
  const nodes = tree.children.filter((c) => (c.className || '').indexOf('skn') >= 0 && (c.className || '').indexOf('br') >= 0);
  const want = D.branchCount('sorc_fireball');
  ok(nodes.length === want, '树上渲染出全部 ' + want + ' 个分支节点', nodes.length);
  ok(nodes.every((n) => n.dataset.branch && n.dataset.state), '每个节点都带分支 id 与状态');
  ok(tree.innerHTML.indexOf('<svg') >= 0 && tree.innerHTML.indexOf('class="bar"') >= 0, '主线用 SVG 绘制');
  ok(tree.innerHTML.indexOf('class="link') >= 0, '分支有连接线');
  const ticks = tree.children.filter((c) => (c.className || '').indexOf('sktick') >= 0);
  ok(ticks.length === 5, '主线刻度有 5 个（5/10/15/20/25）', ticks.length);
  ok(tree.children.some((c) => (c.className || '').indexOf('skill-self') >= 0), '左侧有技能本体图标');
  ok(tree.innerHTML.indexOf('viewBox="0 0 ' + G.UI.skLayout.w + ' ' + G.UI.skLayout.h + '"') >= 0, '画布尺寸正确');

  /* ---- 布局：节点之间不重叠且都在画布内 ---- */
  const LT = G.UI.skLayout;
  const inX = (x, r) => x - r >= 0 && x + r <= LT.w;
  const inY = (y, r) => y - r >= 0 && y + r <= LT.h;
  const tierXs = G.DATA.SKILL_TIERS.map((t) => LT.tierX[t]);
  let overlap = false;
  for (let i = 1; i < tierXs.length; i++) if (tierXs[i] - tierXs[i - 1] < LT.nodeR * 2 + 6) overlap = true;
  ok(!overlap, '相邻档位的节点不重叠', tierXs.join(' / '));
  ok(tierXs.every((x) => inX(x, LT.nodeR)) && inX(LT.iconX, LT.iconR) && inX(LT.strongX, LT.strongR),
    '所有节点横向都在画布内');
  ok(inY(LT.upY, LT.nodeR) && inY(LT.downY, LT.nodeR) && LT.strongY.every((y) => inY(y, LT.strongR)),
    '所有节点纵向都在画布内');
  ok(LT.upY < LT.barY && LT.downY > LT.barY, '上下分支分别位于主线两侧');
  ok(LT.strongY.length === 3, '25 级三个分支的纵向位置已定义');

  // 12 级 → 5/10 档开放，15 档锁着
  ok(nodes.filter((n) => n.dataset.state === 'open').length === 4, '12 级时开放 2 个档位共 4 个可选分支',
    nodes.filter((n) => n.dataset.state === 'open').length);
  ok(nodes.filter((n) => n.dataset.state === 'locked').length === want - 4, '其余分支全部未解锁');

  /* ---- 点击节点分配 ---- */
  ok(G.UI.pickBranch('sorc_fireball', 5, 0) === true, '可以通过窗口分配分支');
  G.UI.renderSkillWindow();
  const on = tree.children.filter((c) => c.dataset && c.dataset.state === 'on');
  ok(on.length === 1, '已选分支标记为生效', on.length);
  const blocked = tree.children.filter((c) => c.dataset && c.dataset.state === 'blocked');
  ok(blocked.length === 1, '同档位另一个分支变为已锁死', blocked.length);

  /* ---- 窗口里的 +1 点 ---- */
  const pts0 = p5.skillPoints, lv0 = p5.skills.sorc_fireball;
  ok(G.UI.addSkillPoint('sorc_fireball') === true, '在窗口里加了一点技能点');
  ok(p5.skillPoints === pts0 - 1 && p5.skills.sorc_fireball === lv0 + 1, '技能点与技能等级同步变化',
    lv0 + ' → ' + p5.skills.sorc_fireball);
  p5.skillPoints = 0;
  ok(G.UI.addSkillPoint('sorc_fireball') === false, '没有技能点时加不了');
  p5.skillPoints = 30;

  /* ---- 悬停详情 ---- */
  G.UI.showBranchDetail('sorc_fireball', 5, 0);
  const det = G.el('sk-detail');
  const b50 = D.skillBranches('sorc_fireball')[5][0];
  ok(det.innerHTML.indexOf(b50.name) >= 0, '底部详情显示分支名');
  ok(det.innerHTML.indexOf('同档位互斥') >= 0, '底部详情说明互斥规则');
  ok(det.innerHTML.indexOf(b50.text[0]) >= 0, '底部详情显示具体效果', b50.text[0]);

  /* ---- 洗点：费用只跟等级与投入点数挂钩 ---- */
  const inv0 = S.investedPoints(p5, 'sorc_fireball');
  const costA = D.respecCost.skill(p5.level, inv0);
  ok(costA.gold > 0 && costA.shards > 0, '技能洗点有金币与残晶费用', JSON.stringify(costA));
  ok(D.respecCost.skill(60, inv0).gold > costA.gold, '等级越高洗点越贵');
  ok(D.respecCost.skill(p5.level, inv0 + 12).gold > costA.gold, '投入点数越多洗点越贵');
  // 装备提供的技能等级不影响费用
  const gear2 = G.Loot.makeItem(g5.rng, { ilvl: 60, slot: 'helm', rarity: 'rare' });
  gear2.affixes = [{ id: 's_skill', stat: 'skill:sorc_fireball', value: 5, tier: 1, kind: 'suffix', name: '专精之' }];
  p5.gear.helm = gear2;
  G.Stats.derive(p5);
  ok(S.skillLevel(p5, 'sorc_fireball') === inv0 + 5, '装备让实际技能等级提升 5 级', S.skillLevel(p5, 'sorc_fireball'));
  const costC = D.respecCost.skill(p5.level, S.investedPoints(p5, 'sorc_fireball'));
  ok(costC.gold === costA.gold && costC.shards === costA.shards,
    '装备提供的技能等级不影响洗点费用', JSON.stringify(costC));
  ok(D.respecCost.skill(p5.level, S.skillLevel(p5, 'sorc_fireball')).gold > costA.gold,
    '（对照）若按实际等级计费会更贵');

  /* ---- 属性点洗点：只看等级 ---- */
  const attr1 = D.respecCost.attr(40);
  const attr2 = D.respecCost.attr(40);
  ok(attr1.gold === attr2.gold && attr1.shards === attr2.shards, '属性洗点费用只与等级有关');
  ok(D.respecCost.attr(50).gold > attr1.gold, '属性洗点费用随等级增长');

  /* ---- 实际洗点流程 ---- */
  p5.alloc = { str: 0, dex: 0, int: 10, vit: 5 };
  p5.attrPoints = 3;
  p5.gold = 10; p5.shards = 0;
  G.Stats.derive(p5);
  ok(G.UI.respecAttr() === false, '资源不足时无法洗属性点');
  ok(p5.alloc.int === 10, '失败的洗点不会清空加点');
  p5.gold = 9999999; p5.shards = 9999;
  ok(G.UI.respecAttr() === true, '资源足够时洗点成功');
  ok(p5.alloc.int === 0 && p5.alloc.vit === 0, '属性点全部退回');
  ok(p5.attrPoints === 3 + 15, '退回的属性点进入可用池', p5.attrPoints);
  const goldAfter = p5.gold;
  ok(goldAfter === 9999999 - attr1.gold, '扣除了对应金币', 9999999 - goldAfter);
  ok(p5.shards === 9999 - attr1.shards, '扣除了对应残晶');

  // 被动洗点
  p5.passives = { pa_wrath: 4 };
  p5.passivePoints = 1;
  const pcost = D.respecCost.passive(p5.level, 4);
  ok(G.UI.respecPassive('pa_wrath') === true, '被动天赋洗点成功');
  ok((p5.passives.pa_wrath | 0) === 0 && p5.passivePoints === 5, '被动点退还', p5.passivePoints);
  ok(p5.gold === goldAfter - pcost.gold, '被动洗点扣除金币');
  p5.gold = 9999999; p5.shards = 9999;

  // 技能洗点：退还点数并清空分支
  ok(G.UI.branchSummary(p5, 'sorc_fireball') >= 1, '洗点前有已选分支');
  const inv = S.investedPoints(p5, 'sorc_fireball');
  const sp0 = p5.skillPoints;
  const scost = D.respecCost.skill(p5.level, inv);
  const gold0 = p5.gold, shard0 = p5.shards;
  ok(G.UI.respecSkill('sorc_fireball') === true, '技能洗点成功');
  ok((p5.skills.sorc_fireball | 0) === 0, '技能等级清零（已投入点数归零）');
  ok(p5.skillPoints === sp0 + inv, '技能点全部退还', sp0 + ' → ' + p5.skillPoints);
  ok(!p5.skillBranches.sorc_fireball, '强化分支被清空');
  ok(G.UI.branchSummary(p5, 'sorc_fireball') === 0, '分支计数归零');
  ok(p5.gold === gold0 - scost.gold && p5.shards === shard0 - scost.shards, '技能洗点扣费正确',
    gold0 + ' → ' + p5.gold);
  ok(S.investedPoints(p5, 'sorc_fireball') === 0 && S.skillLevel(p5, 'sorc_fireball') === 5,
    '投入清零，但装备提供的 5 级加成仍在', S.skillLevel(p5, 'sorc_fireball'));
  p5.gear.helm = null;
  G.Stats.derive(p5);
  ok(S.skillLevel(p5, 'sorc_fireball') === 0, '脱下装备后该技能彻底归零');

  /* ---- 洗点面板渲染 ---- */
  p5.gold = 5000; p5.shards = 5;
  p5.skills.sorc_nova = 6;
  p5.passives = { pa_focus: 2 };
  p5.alloc = { str: 0, dex: 0, int: 4, vit: 0 };
  G.UI.dirty.rift = true;
  G.UI.renderRespec();
  const rsAttr = G.el('rs-attr');
  ok(rsAttr.innerHTML.indexOf('重置属性') >= 0, '洗点面板有属性重置按钮');
  ok(rsAttr.innerHTML.indexOf('rs-attr-btn') >= 0, '属性按钮 id 正确');
  const rsP = G.el('rs-passives');
  ok(rsP.innerHTML.indexOf('专注') >= 0 && rsP.innerHTML.indexOf('data-rs-passive="pa_focus"') >= 0, '列出了已投入的被动');
  const rsS = G.el('rs-skills');
  ok(rsS.innerHTML.indexOf('冰霜新星') >= 0 && rsS.innerHTML.indexOf('data-rs-skill="sorc_nova"') >= 0, '列出了已投入的技能');
  ok(rsS.innerHTML.indexOf('洗点只看投入点数') >= 0, '面板说明洗点只看投入点数');
  ok(G.el('rs-gold').textContent === '5000' || G.el('rs-gold').textContent === 5000, '显示金币', G.el('rs-gold').textContent);

  /* ---- 存档：分支选择要能存下来 ---- */
  p5.skillBranches.sorc_nova = { 5: D.skillBranches('sorc_nova')[5][1].id };
  g5.area = 'town';
  ok(g5.save() !== false, '存档成功');
  const data = G.storage.load(g5.slot);
  ok(data && data.skillBranches && data.skillBranches.sorc_nova, '存档里包含技能分支');
  const g6 = new G.Game(g5.slot);
  G.GAME = g6; G.UI.game = g6;
  ok(g6.load(g5.slot) === true, '读档成功');
  ok(g6.player.skillBranches.sorc_nova && g6.player.skillBranches.sorc_nova[5], '分支选择被正确读回');

  report('技能窗口与洗点流程校验通过');
}

/* ============================================================ */
section('16m. 深渊之门 / 深渊向导 职责分离与首次引导');
{
  const D = G.DATA;
  const guide = G.Town.NPCS.filter((n) => n.id === 'guide')[0];
  const gateNpc = G.Town.NPCS.filter((n) => n.panel === 'panel-rift')[0];
  ok(!!guide, '深渊向导 NPC 存在');
  ok(guide.panel === 'panel-respec', '深渊向导只打开洗点面板', guide.panel);
  ok(!gateNpc, '没有 NPC 直接打开深渊之门面板（之门由地图交互触发）');

  // HTML 结构：两个面板各管一件事
  const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const riftHtml = htmlSrc.slice(htmlSrc.indexOf('id="panel-rift"'), htmlSrc.indexOf('id="panel-respec"'));
  const respecHtml = htmlSrc.slice(htmlSrc.indexOf('id="panel-respec"'), htmlSrc.indexOf('id="panel-skill"'));
  ok(riftHtml.indexOf('rift-enter') >= 0 && riftHtml.indexOf('rift-floor') >= 0, '深渊之门面板只负责选层进入');
  ok(riftHtml.indexOf('rs-attr') < 0 && riftHtml.indexOf('rs-skills') < 0, '深渊之门面板里没有洗点内容');
  ok(respecHtml.indexOf('rs-attr') >= 0 && respecHtml.indexOf('rs-skills') >= 0, '洗点面板里有洗点内容');
  ok(respecHtml.indexOf('rift-enter') < 0 && respecHtml.indexOf('rift-floor') < 0, '洗点面板里没有进入深渊的按钮');
  ok(riftHtml.indexOf('深渊之门') >= 0, '深渊之门面板标题正确');
  ok(respecHtml.indexOf('深渊向导 · 塞拉') >= 0, '洗点面板标题是深渊向导');

  /* ---- 第一次交谈：说引导话 ---- */
  const g9 = new G.Game(606060);
  G.GAME = g9; G.UI.game = g9;
  g9.player = G.ENT.makePlayer(g9, 'barb');
  const p9 = g9.player;
  p9.level = 30;
  g9.area = 'town';
  G.Stats.derive(p9);
  ok(p9.guideMet === false, '新角色还没见过深渊向导');
  const PAGES = G.Town.GUIDE_PAGES;
  ok(PAGES.length >= 3, '引导分成多段', PAGES.length + ' 段');
  ok(G.Town.GUIDE_INTRO.length >= 10, '引导内容足够多', G.Town.GUIDE_INTRO.length + ' 句');

  /* ---- 引导要介绍其他 NPC 与整体玩法，且不打破第四面墙 ---- */
  const allText = G.Town.GUIDE_INTRO.join('');
  const missNpc = ['布洛克', '维恩', '娜塔', '米尔', '加兹', '凯'].filter((nm) => allText.indexOf(nm) < 0);
  ok(missNpc.length === 0, '引导里提到了城镇里的六位 NPC', missNpc.join('、'));
  const missKey = ['深渊之门', '领主', '残晶', '宝石'].filter((w) => allText.indexOf(w) < 0);
  ok(missKey.length === 0, '引导里讲了玩法要点（深渊之门 / 领主 / 残晶 / 宝石）', missKey.join('、'));
  const meta = ['按 F', '快捷键', '面板', '点击', '鼠标', '键盘', '按键', '存档', '界面'];
  const broke = meta.filter((w) => allText.indexOf(w) >= 0);
  ok(broke.length === 0, '引导不跳出世界观（没有操作/系统词汇）', broke.join('、'));

  G.logLines.length = 0;
  const npcObj = { id: 'guide', name: guide.name, title: guide.title, panel: 'panel-respec', x: p9.x, y: p9.y };
  G.UI.openNpcPanel(npcObj);
  ok(G.UI.open === 'panel-respec', '与深渊向导交谈打开洗点面板', G.UI.open);
  ok(p9.guideMet === true, '记录已见过深渊向导');
  ok(G.UI.guideIntro === true && G.UI.guidePage === 0, '从第一段开始讲');
  const spoken = G.logLines.map((l) => l.msg);
  ok(PAGES[0].lines.every((line) => spoken.indexOf(line) >= 0), '第一段对白写进了日志', spoken.length + ' 条日志');
  ok(G.Town.GUIDE_INTRO.length > PAGES[0].lines.length, '第一段没有一次性倒完');
  const say = G.el('guide-say');
  ok(say.innerHTML.indexOf(PAGES[0].lines[0]) >= 0, '对白框显示第一段台词');
  ok(say.innerHTML.indexOf(PAGES[0].title) >= 0, '对白框显示本段标题', PAGES[0].title);
  ok(say.innerHTML.indexOf('guide-next') >= 0, '第一段有「继续」按钮');
  ok(say.innerHTML.indexOf('guide-say-ok') < 0, '没到最后一段时不显示结束按钮');
  ok(say.innerHTML.indexOf('1 / ' + PAGES.length) >= 0, '显示页码');

  /* ---- 逐段翻页 ---- */
  G.logLines.length = 0;
  G.UI.guideNext(1);
  ok(G.UI.guidePage === 1, '翻到第二段', G.UI.guidePage);
  ok(PAGES[1].lines.every((line) => G.logLines.map((l) => l.msg).indexOf(line) >= 0), '第二段对白也写进日志');
  ok(G.el('guide-say').innerHTML.indexOf(PAGES[1].lines[0]) >= 0, '对白框换成第二段');
  ok(G.el('guide-say').innerHTML.indexOf('guide-prev') >= 0, '第二段有「上一段」按钮');
  G.UI.guideNext(-1);
  ok(G.UI.guidePage === 0, '可以退回上一段');
  ok(/<button[^>]*disabled[^>]*id="guide-prev"|<button[^>]*id="guide-prev"[^>]*disabled/.test(G.el('guide-say').innerHTML),
    '第一段的「上一段」不可用');
  // 翻到最后一段
  G.UI.guidePage = PAGES.length - 1;
  G.UI.renderRespec();
  ok(G.el('guide-say').innerHTML.indexOf('guide-say-ok') >= 0, '最后一段给出「我记住了」');
  ok(G.el('guide-say').innerHTML.indexOf('guide-next') < 0, '最后一段没有「继续」');
  ok(G.el('guide-say').innerHTML.indexOf(PAGES.length + ' / ' + PAGES.length) >= 0, '页码显示到最后一段');

  // 点「我记住了」→ 收起，之后只留一句提示
  G.UI.guideIntro = false;
  G.UI.renderRespec();
  ok(G.el('guide-say').innerHTML.indexOf('再说一遍') >= 0, '收起后可以再让向导说一遍');
  ok(G.el('guide-say').innerHTML.indexOf(G.Town.GUIDE_SHORT) >= 0, '收起后显示简短提示');
  G.UI.guideIntro = true;
  G.UI.renderRespec();
  ok(G.el('guide-say').innerHTML.indexOf('guide-say-again') < 0, '展开时不再显示「再说一遍」');

  /* ---- 第二次交谈不再重复引导 ---- */
  G.UI.togglePanel('panel-respec', false);
  G.logLines.length = 0;
  G.UI.openNpcPanel(npcObj);
  const spoken2 = G.logLines.map((l) => l.msg);
  ok(spoken2.indexOf(G.Town.GUIDE_INTRO[0]) < 0, '第二次交谈不再重复整段引导', spoken2.join(' / ').slice(0, 40));

  /* ---- 深渊之门只进入深渊 ---- */
  g9.area = 'town';
  G.UI.openRift(null);
  ok(G.UI.open === 'panel-rift', '深渊之门打开的是选层面板', G.UI.open);
  ok(G.UI.riftFloor >= 1, '默认选中已解锁的最深层数', G.UI.riftFloor);
  ok(G.el('panel-respec').hidden === true, '打开深渊之门时洗点面板被关闭');
  G.UI.togglePanel('panel-rift', false);

  /* ---- 见过向导的状态会存档 ---- */
  g9.area = 'town';
  g9.save();
  const g10 = new G.Game(g9.slot);
  G.GAME = g10; G.UI.game = g10;
  g10.load(g9.slot);
  ok(g10.player.guideMet === true, '「已见过向导」随存档保留');
  g10.area = 'town';
  G.logLines.length = 0;
  G.UI.openNpcPanel(npcObj);
  ok(G.logLines.map((l) => l.msg).indexOf(G.Town.GUIDE_INTRO[0]) < 0,
    '读档后也不会再重复引导');

  report('深渊之门与深渊向导分工明确，首次引导只出现一次');
}

/* ============================================================ */
section('16j. 满分支下全部技能都能正常释放');
{
  const S = G.Stats;
  const D = G.DATA;
  let cast = 0, failed = [];
  ['barb', 'sorc', 'rogue'].forEach((cls) => {
    const g = new G.Game(31337);
    G.GAME = g; G.UI.game = g;
    g.player = G.ENT.makePlayer(g, cls);
    const p = g.player;
    p.level = 99;
    Object.keys(D.SKILLS).forEach((id) => {
      p.skills[id] = 25;
      p.skillBranches[id] = {};
      D.SKILL_TIERS.forEach((t) => { p.skillBranches[id][t] = D.skillBranches(id)[t][0].id; });
    });
    S.derive(p);
    g.toDungeon(6);                            // 有怪可打
    p.x = g.map.playerStart.x; p.y = g.map.playerStart.y;
    D.classById(cls).skills.forEach((id) => {
      p.cds = {}; p.mana = 10 * (p.stats.maxMana + 1000); p.stun = 0;
      const aim = { x: p.x + 120, y: p.y + 40 };
      let r = false;
      try { r = G.Skills.cast(g, p, id, aim); } catch (e) { failed.push(cls + '/' + id + ': ' + e.message); }
      if (r) cast++;
      // 让投射物 / 地面效果 / 跳跃结算跑几帧
      try { for (let i = 0; i < 30; i++) g.update(0.05); } catch (e) { failed.push(cls + '/' + id + ' 更新: ' + e.message); }
    });
    ok(p.life >= 0 && isFinite(p.life), cls + ' 释放技能后生命值正常', Math.round(p.life));
  });
  ok(failed.length === 0, '满分支下所有技能都能正常释放与结算', failed.join(' | '));
  ok(cast === 15, '15 个技能全部成功释放', cast + ' 个');
  report('满分支技能释放压力测试通过');
}

/* ============================================================ */
section('16k. 双手武器与副手互斥时的评分提示');
{
  const L = G.Loot, S = G.Stats;
  const g7 = new G.Game(20240607);
  G.GAME = g7; G.UI.game = g7;
  g7.player = G.ENT.makePlayer(g7, 'barb');
  const p7 = g7.player;
  p7.level = 80;
  S.derive(p7);

  const bare = (it) => { it.affixes = []; it.implicit = []; it.req = {}; it.gems = []; return it; };
  const two = bare(L.makeItem(g7.rng, { ilvl: 45, slot: 'weapon', baseId: 'w_greatsword_5', rarity: 'common' }));
  ok(two.two === true, '测试武器确实是双手武器', two.type);
  const sc = (it) => L.score(it, p7.stats);
  const weakOff = bare(L.makeItem(g7.rng, { ilvl: 5, slot: 'offhand', baseId: 'o_shield_0', rarity: 'common' }));
  weakOff.armor = 1;
  const strongOff = bare(L.makeItem(g7.rng, { ilvl: 60, slot: 'offhand', baseId: 'o_shield_7', rarity: 'common' }));
  strongOff.armor = Math.ceil(sc(two) / 0.14) + 500;          // 评分肯定高于双手武器
  ok(sc(weakOff) < sc(two) && sc(strongOff) > sc(two), '构造出了更弱 / 更强的副手',
    sc(weakOff) + ' < ' + sc(two) + ' < ' + sc(strongOff));

  /* ---- 双手武器 + 空副手：弱副手不应显示「可提升」 ---- */
  p7.gear = { weapon: two, offhand: null };
  S.derive(p7);
  UI_clearUpCache();
  ok(G.UI.isUpgrade(weakOff) === false, '弱副手不再被标成可提升（会被双手武器顶掉）');
  const cmpWeak = L.compare(p7, weakOff);
  ok(cmpWeak && cmpWeak.delta < 0, '对比结论为评分降低', cmpWeak ? cmpWeak.delta : 'none');
  ok(cmpWeak.cur === sc(two), '对比基准把双手武器算进去了', cmpWeak.cur + ' vs ' + sc(two));
  ok(cmpWeak.displaced.length === 1 && cmpWeak.displaced[0].item === two, '记录了会被顶掉的双手武器');
  const footWeak = G.UI.compareFooterHTML(p7, weakOff);
  ok(footWeak.indexOf('评分降低') >= 0, '提示框底部显示「评分降低」');
  ok(footWeak.indexOf('会顶掉') >= 0, '提示框底部说明会顶掉什么', footWeak.replace(/<[^>]*>/g, ' '));

  // 副手足够强时才算提升
  ok(G.UI.isUpgrade(strongOff) === true, '明显更强的副手仍然标记为可提升');
  ok(L.compare(p7, strongOff).delta > 0, '强副手的评分变化为正');
  ok(G.UI.compareFooterHTML(p7, strongOff).indexOf('评分提升') >= 0, '强副手显示评分提升');

  // 对照窗口会把「将被顶掉」的双手武器列出来
  const partners = G.UI.equipPartners(strongOff);
  ok(partners.length === 1 && partners[0].item === two, '悬停副手时对照窗口显示双手武器', partners.length + ' 件');
  ok(partners[0].label.indexOf('将被顶掉') >= 0, '对照窗口标注「将被顶掉」', partners[0].label);

  /* ---- 双手武器 + 空副手：真装上去也确实清空了武器 ---- */
  p7.inventory = new Array(60).fill(null);
  p7.inventory[0] = strongOff;
  G.UI.equipFromInv(0);
  ok(p7.gear.weapon === null, '装上副手后双手武器被顶掉');
  ok(p7.gear.offhand === strongOff, '副手已装备');
  ok(p7.inventory.indexOf(two) >= 0, '被顶掉的双手武器回到背包');

  /* ---- 反向：背着双手武器、身上是一单手 + 副手 ---- */
  const oneHand = bare(L.makeItem(g7.rng, { ilvl: 30, slot: 'weapon', baseId: 'w_sword_3', rarity: 'common' }));
  const smallOff = bare(L.makeItem(g7.rng, { ilvl: 30, slot: 'offhand', baseId: 'o_shield_3', rarity: 'common' }));
  smallOff.armor = Math.ceil((sc(two) - sc(oneHand) + 300) / 0.14);   // 让「单手 + 副手」略强于双手
  p7.gear = { weapon: oneHand, offhand: smallOff };
  S.derive(p7);
  UI_clearUpCache();
  const bothScore = sc(oneHand) + sc(smallOff);
  ok(sc(two) < bothScore, '构造：双手武器不如「单手 + 副手」加起来', sc(two) + ' < ' + bothScore);
  ok(G.UI.isUpgrade(two) === false, '会顶掉副手的双手武器不再标记为可提升');
  const cmpTwo = L.compare(p7, two);
  ok(cmpTwo.displaced.length === 1 && cmpTwo.displaced[0].item === smallOff, '记录了会被顶掉的副手');
  ok(cmpTwo.cur === bothScore, '对比基准 = 武器 + 副手两件之和', cmpTwo.cur);
  ok(G.UI.compareFooterHTML(p7, two).indexOf('评分降低') >= 0, '双手武器提示评分降低');
  ok(G.UI.equipPartners(two).length === 2, '对照窗口同时列出单手武器与副手', G.UI.equipPartners(two).length);

  // 双手武器远强于两件之和时才是提升
  const bigTwo = bare(L.makeItem(g7.rng, { ilvl: 80, slot: 'weapon', baseId: 'w_greataxe_7', rarity: 'common' }));
  bigTwo.min *= 3; bigTwo.max *= 3;              // 人为造一件碾压级的双手武器
  ok(sc(bigTwo) > bothScore, '构造：更强的双手武器', sc(bigTwo) + ' > ' + bothScore);
  UI_clearUpCache();
  ok(G.UI.isUpgrade(bigTwo) === true, '明显更强的双手武器仍然标记为可提升');

  /* ---- 戒指逻辑不受影响 ---- */
  p7.gear = { weapon: null, offhand: null, ring1: null, ring2: null };
  S.derive(p7);
  UI_clearUpCache();
  const ringA = bare(L.makeItem(g7.rng, { ilvl: 40, slot: 'ring', rarity: 'rare' }));
  ringA.affixes = [{ id: 'p_crit', stat: 'crit', value: 12, tier: 3, kind: 'prefix', name: '致命的' }];
  const ringB = bare(L.makeItem(g7.rng, { ilvl: 40, slot: 'ring', rarity: 'rare' }));
  ringB.affixes = [{ id: 'p_str', stat: 'str', value: 20, tier: 3, kind: 'prefix', name: '强壮的' }];
  ok(G.UI.isUpgrade(ringA) === true, '空戒指位仍然标记为可提升');
  p7.gear.ring1 = ringA; p7.gear.ring2 = ringB;
  S.derive(p7);
  UI_clearUpCache();
  const better = sc(ringA) > sc(ringB) ? ringA : ringB;
  const worse = better === ringA ? ringB : ringA;
  const ringNew = bare(L.makeItem(g7.rng, { ilvl: 40, slot: 'ring', rarity: 'rare' }));
  const need = sc(worse) + 50;
  ringNew.affixes = [{ id: 'p_str', stat: 'str', value: Math.ceil(need), tier: 3, kind: 'prefix', name: '强壮的' }];
  ok(sc(ringNew) > sc(worse), '构造：新戒指强于较弱的那枚', sc(ringNew) + ' > ' + sc(worse));
  ok(G.UI.isUpgrade(ringNew) === true, '强于任一枚戒指时标记为可提升');
  ringNew.affixes = [{ id: 'p_str', stat: 'str', value: 1, tier: 8, kind: 'prefix', name: '微弱的' }];
  UI_clearUpCache();
  ok(G.UI.isUpgrade(ringNew) === false, '弱于两枚戒指时不标记为可提升');
}

function UI_clearUpCache() { G.UI._upCache = { sig: null, map: {} }; }

/* ============================================================ */
section('16l. 双手武器：2 倍数值与部位孔位上限');
{
  const D = G.DATA, L = G.Loot;
  ok(D.TWO_HAND_MULT === 2, '双手武器倍率为 2', D.TWO_HAND_MULT);

  /* ---- 基底 DPS ≈ 同档单手的 2 倍 ---- */
  const g8 = new G.Game(88888);
  G.GAME = g8; G.UI.game = g8;
  g8.player = G.ENT.makePlayer(g8, 'barb');
  const dpsOf = (type, tier) => {
    const b = D.BASES.filter((x) => x.type === type && x.ilvl === D.TIER_ILVL[tier])[0];
    return (b.min + b.max) / 2 * b.aps;
  };
  const badPair = [];
  [['greatsword', 'sword'], ['greataxe', 'axe'], ['staff', 'scepter'], ['bow', 'dagger'], ['crossbow', 'dagger']]
    .forEach((pair) => {
      let lo = 9, hi = 0;
      for (let t = 0; t < D.TIER_ILVL.length; t++) {
        const r = dpsOf(pair[0], t) / dpsOf(pair[1], t);
        lo = Math.min(lo, r); hi = Math.max(hi, r);
      }
      if (!(lo > 1.8 && hi < 2.25)) badPair.push(pair[0] + ' ' + lo.toFixed(2) + '×~' + hi.toFixed(2) + '×');
    });
  ok(badPair.length === 0, '双手武器基底的 DPS 全程约为同档单手的 2 倍', badPair.join(' '));
  // 法杖对魔杖（成长率略高，比例会随等级缓慢上浮）
  const staffWand = [0, 7].map((t) => dpsOf('staff', t) / dpsOf('wand', t));
  ok(staffWand[0] > 1.8 && staffWand[1] < 2.6, '法杖相对魔杖约 2 倍（高等级略高）',
    staffWand[0].toFixed(2) + '× ~ ' + staffWand[1].toFixed(2) + '×');

  /* ---- 掉落的双手武器：词缀数值翻倍 ---- */
  const rngT = g8.rng;
  const two = L.makeItem(rngT, { ilvl: 60, slot: 'weapon', baseId: 'w_greatsword_5', rarity: 'rare' });
  const one = L.makeItem(rngT, { ilvl: 60, slot: 'weapon', baseId: 'w_sword_5', rarity: 'rare' });
  ok(two.two === true && one.two === false, '生成了一双手 / 一单手武器');
  ok(L.affixMult(two) === 2 && L.affixMult(one) === 1, '双手武器词缀倍率为 2');
  const ratioOf = (it) => {
    let over = 0, n = 0;
    it.affixes.forEach((a) => {
      const r1 = L.entryRange(a, it.ilvl, 1);
      const r2 = L.entryRange(a, it.ilvl, L.affixMult(it));
      n++;
      if (r1 && a.value > r1.hi + 0.001) over++;                  // 超过单手上限 → 吃了 2 倍
      if (r2 && (a.value < r2.lo - 0.5 || a.value > r2.hi + 0.5)) ok(false, '双手武器词缀超出 2 倍区间');
    });
    return { over, n };
  };
  const rTwo = ratioOf(two), rOne = ratioOf(one);
  ok(rTwo.over === rTwo.n && rTwo.n >= 3, '双手武器的词缀数值全部落在 2 倍区间内', rTwo.over + '/' + rTwo.n);
  ok(rOne.over === 0, '单手武器的词缀数值仍在 1 倍区间内');

  /* ---- 孔位上限：按部位区分，双手武器 = 主手 + 副手 ---- */
  const fakeTwo = { slot: 'weapon', two: true, ilvl: 60 };
  const fakeOne = { slot: 'weapon', two: false, ilvl: 60 };
  ok(L.socketMax(fakeOne) === 2 && L.socketMax(fakeTwo) === 4, '主手 2 孔 / 双手武器 4 孔',
    L.socketMax(fakeOne) + ' / ' + L.socketMax(fakeTwo));
  ok(L.socketMax(fakeTwo) === L.socketMax(fakeOne) + L.socketMax({ slot: 'offhand', ilvl: 60 }),
    '双手武器上限 = 主手上限 + 副手上限');
  const caps = D.SOCKET_MAX;
  ok(caps.offhand === 2 && caps.helm === 2 && caps.boots === 2 && caps.gloves === 2 && caps.belt === 2,
    '副手 / 头盔 / 靴子 / 手套 / 腰带 都是 2 孔', JSON.stringify(caps));
  ok(caps.chest === 3, '胸甲 3 孔', caps.chest);
  ok(caps.ring === 1 && caps.amulet === 2, '戒指 1 孔 / 项链 2 孔');
  const overCap = D.gearSlots().filter((s) => {
    const it = { slot: s === 'ring1' || s === 'ring2' ? 'ring' : s, two: false, ilvl: 60 };
    return L.socketMax(it) > 3;
  });
  ok(overCap.length === 0, '除双手武器外没有部位超过 3 孔', overCap.join(','));

  const drillItem = L.makeItem(rngT, { ilvl: 60, slot: 'weapon', baseId: 'w_greataxe_5', rarity: 'rare' });
  drillItem.sockets = 0; drillItem.gems = [];
  for (let i = 0; i < 12; i++) L.applyOrb(rngT, drillItem, 'drill');
  ok(drillItem.sockets === 4, '双手武器最多能钻到 4 孔', drillItem.sockets);
  ok(!L.canUseOrb(drillItem, 'drill').ok, '4 孔后无法继续钻孔');
  const drillOne = L.makeItem(rngT, { ilvl: 60, slot: 'weapon', baseId: 'w_sword_5', rarity: 'rare' });
  drillOne.sockets = 0; drillOne.gems = [];
  for (let i = 0; i < 12; i++) L.applyOrb(rngT, drillOne, 'drill');
  ok(drillOne.sockets === 2, '单手武器最多 2 孔', drillOne.sockets);
  const drillRing = L.makeItem(rngT, { ilvl: 60, slot: 'ring', rarity: 'rare' });
  drillRing.sockets = 0; drillRing.gems = [];
  for (let i = 0; i < 6; i++) L.applyOrb(rngT, drillRing, 'drill');
  ok(drillRing.sockets === 1, '戒指最多 1 孔', drillRing.sockets);

  // 掉落时不会超过上限，且低等级装备开不满孔
  let over = 0, lowFull = 0, highFull = 0;
  for (let i = 0; i < 600; i++) {
    const it = L.makeItem(rngT, { ilvl: 1 + i % 90, rarity: 'rare' });
    if (it.sockets > L.socketMax(it)) over++;
    if (it.ilvl < 20 && it.sockets >= L.socketMax(it) && L.socketMax(it) > 1) lowFull++;
    if (it.ilvl >= 55 && it.sockets >= L.socketMax(it)) highFull++;
  }
  ok(over === 0, '掉落的孔位数不会超过该部位上限', over);
  ok(lowFull === 0, '低等级（ilvl<20）装备开不满孔', lowFull);
  ok(highFull > 0, '高等级装备可以满孔', highFull);

  /* ---- 图标上的菱形：现在最多 4 孔，始终单排（数量 / filled 由 16g 覆盖） ---- */
  const six = L.makeItem(rngT, { ilvl: 60, slot: 'weapon', baseId: 'w_greataxe_5', rarity: 'rare' });
  six.sockets = 4; six.gems = [{ gem: 'ruby', tier: 1 }, null, { gem: 'sapphire', tier: 2 }, null];
  const html6 = G.UI.socketsHTML(six);
  ok(html6.indexOf('sockets top') < 0 && html6.indexOf('sockets bottom') < 0, '4 孔仍然单排显示');

  // 提示框不再啰嗦地解释双手武器的倍率与孔位
  const tipTwo = L.tooltipHTML(two, g8.player, {});
  ok(tipTwo.indexOf('双手武器：占主手') < 0, '提示框不再重复说明双手武器规则');
  ok(tipTwo.indexOf('孔位上限') < 0, '提示框不再写明孔位上限');

  report('双手武器的 2 倍数值与部位孔位上限校验通过');
}

/* ============================================================ */
section('16n. 做装工坊：工作台布局、通货库存与拿起使用');
{
  const D = G.DATA, L = G.Loot;
  const gC = new G.Game(24680);
  G.GAME = gC; G.UI.game = gC;
  gC.player = G.ENT.makePlayer(gC, 'barb');
  const p = gC.player;
  p.level = 40;
  gC.area = 'town';
  G.Stats.derive(p);
  G.Shared.clear();

  /* ---- 放上工作台 ---- */
  const it = L.makeItem(gC.rng, { ilvl: 30, slot: 'chest', rarity: 'common', baseId: 'a_chest_2' });
  it.affixes = []; it.rarity = 'common';
  p.inventory = new Array(60).fill(null);
  p.inventory[0] = it;
  G.UI.togglePanel('panel-craft', true);
  ok(G.UI.open === 'panel-craft', '做装面板已打开');
  G.UI.setCraftTarget(it.uid);
  const bench = G.el('craft-bench');
  ok(bench.children.some((c) => (c.className || '').indexOf('bench-item') >= 0 && (c.className || '').indexOf('has') >= 0),
    '工作台中央显示了选中的装备');
  ok(bench.innerHTML !== undefined, '工作台已渲染');
  const centerEl = bench.children.filter((c) => (c.className || '').indexOf('bench-item') >= 0)[0];
  ok(centerEl.innerHTML.indexOf(L.displayName(it)) >= 0, '中央显示装备名',
    centerEl.innerHTML.replace(/<[^>]*>/g, ' ').trim().slice(0, 30));

  /* ---- 左侧：物品栏 + 装备栏 ---- */
  const invBox = G.el('craft-inv');
  ok(invBox.children.length >= 1, '左侧物品栏列出了装备', invBox.children.length + ' 格');
  ok(invBox.children[0].className.indexOf('bench-on') >= 0, '当前选中的装备高亮');
  const gearBox = G.el('craft-gear');
  const slotCount = D.gearSlots().length;
  ok(gearBox.children.length === slotCount, '左侧有完整的装备栏', gearBox.children.length + ' / ' + slotCount);

  /* ---- 通货环绕 + 库存来自背包 / 仓库 / 共享仓库 ---- */
  const nodes = bench.children.filter((c) => (c.className || '').indexOf('orb-node') >= 0);
  ok(nodes.length === D.ORBS.length, '工作台上环绕了全部 ' + D.ORBS.length + ' 种通货', nodes.length);
  const LC = G.UI.craftLayout();
  const overlap = [];
  const dists = nodes.map((n) => {
    const m = /left:(-?[\d.]+)px;top:(-?[\d.]+)px/.exec(n.style.cssText || '');
    const x = +m[1] + LC.node / 2, y = +m[2] + LC.node / 2;
    return { dx: x - LC.cx, dy: y - LC.cy, x: x, y: y };
  });
  ok(dists.every((d) => Math.abs(d.dx) < LC.cx && d.y > 0 && d.y < LC.h), '通货节点都在工作台范围内');
  const radii = dists.map((d) => Math.hypot(d.dx / LC.rx, d.dy / LC.ry));
  ok(radii.every((r) => Math.abs(r - 1) < 0.02), '通货节点排成一圈环绕装备',
    radii.map((r) => r.toFixed(2)).join(','));
  for (let i = 0; i < dists.length; i++) {
    for (let j = i + 1; j < dists.length; j++) {
      if (Math.hypot(dists[i].dx - dists[j].dx, dists[i].dy - dists[j].dy) < LC.node) overlap.push(i + '/' + j);
    }
  }
  ok(overlap.length === 0, '通货节点之间不重叠', overlap.join(','));

  // 背包 2 + 个人仓库 3 + 共享仓库 5 = 10
  G.UI.addOrbTo(p.inventory, 'ascend');
  G.UI.addOrbTo(p.inventory, 'ascend');
  G.UI.addOrbTo(p.stash, 'ascend'); G.UI.addOrbTo(p.stash, 'ascend'); G.UI.addOrbTo(p.stash, 'ascend');
  G.Shared.addOrb('ascend', 5); G.Shared.flush();
  G.UI.renderCraft();
  const stock = G.UI.orbStock();
  ok(stock.ascend.inv === 2 && stock.ascend.stash === 3 && stock.ascend.shared === 5,
    '分别统计背包 / 个人仓库 / 共享仓库', JSON.stringify(stock.ascend));
  ok(stock.ascend.total === 10, '总数 = 三者之和', stock.ascend.total);
  const ascendNode = bench.children.filter((c) => c.dataset && c.dataset.orb === 'ascend')[0];
  ok(ascendNode && ascendNode.dataset.count === '10', '节点上显示总数 10', ascendNode && ascendNode.dataset.count);
  ok(G.UI.orbStockText(stock.ascend).indexOf('背包 2') >= 0 && G.UI.orbStockText(stock.ascend).indexOf('共享仓库 5') >= 0,
    '提示里列出各处数量', G.UI.orbStockText(stock.ascend));

  /* ---- 拿起 → 点装备使用 ---- */
  ok(ascendNode.dataset.ok === '1', '晋升石对这件白装可用');
  ok(G.UI.pickUpOrb('ascend') === true, '左键点通货把它「拿起」');
  ok(G.UI.heldOrb && G.UI.heldOrb.orb === 'ascend', '记录了手上的通货');
  G.UI.renderCraft();
  const armed = bench.children.filter((c) => (c.className || '').indexOf('bench-item') >= 0)[0];
  ok(armed.className.indexOf('armed') >= 0, '工作台中央高亮提示可以点');
  ok(armed.innerHTML.indexOf('点击使用晋升石') >= 0, '中央提示会使用哪种通货');
  const nodes2 = bench.children.filter((c) => (c.className || '').indexOf('orb-node') >= 0);
  ok(nodes2.some((n) => (n.className || '').indexOf('held') >= 0), '被拿起的通货标记为 held');

  // 优先消耗背包
  ok(G.UI.applyHeldOrb() === true, '点击工作台中央即可使用通货');
  ok(it.rarity === 'magic', '晋升石生效：白装 → 蓝装', it.rarity);
  ok(G.UI.heldOrb === null, '使用后自动放下通货');
  const st2 = G.UI.orbStock();
  ok(st2.ascend.inv === 1 && st2.ascend.stash === 3 && st2.ascend.shared === 5,
    '优先扣除背包里的通货', JSON.stringify(st2.ascend));
  ok(G.Shared.countOrb('ascend') === 5, '共享仓库未被提前扣除');

  // 背包用完后 → 共享仓库
  const invOrb = p.inventory.filter((x) => x && x.cat === 'orb' && x.orb === 'ascend')[0];
  if (invOrb) { invOrb.count = 0; }
  p.inventory = p.inventory.map((x) => (x && x.cat === 'orb' && x.orb === 'ascend' && (x.count | 0) <= 0 ? null : x));
  G.UI.renderCraft();
  const t2 = G.UI.craftTarget();
  it.rarity = 'common'; it.affixes = [];      // 重置成可再晋升
  G.UI.setCraftTarget(it.uid);
  ok(G.UI.useOrb('ascend') === true, '背包没货时仍能使用');
  ok(G.Shared.countOrb('ascend') === 4, '改从共享仓库扣除', G.Shared.countOrb('ascend'));
  ok((p.stash.filter((x) => x && x.orb === 'ascend')[0] || {}).count === 3, '个人仓库仍然没动');

  // 共享仓库也空了 → 个人仓库
  G.Shared.takeOrb('ascend', 99); G.Shared.flush();
  it.rarity = 'common'; it.affixes = [];
  G.UI.setCraftTarget(it.uid);
  ok(G.UI.useOrb('ascend') === true, '共享仓库空了之后仍能使用');
  const stOrb = p.stash.filter((x) => x && x.orb === 'ascend')[0];
  ok(stOrb && stOrb.count === 2, '最后才动用个人仓库', stOrb && stOrb.count);

  /* ---- 没有存货 / 不可用 ---- */
  const nodes3 = G.el('craft-bench').children.filter((c) => c.dataset && c.dataset.orb);
  const legendNode = nodes3.filter((c) => c.dataset.orb === 'legend')[0];
  ok(legendNode.dataset.count === '0', '没有的通货显示 0', legendNode.dataset.count);
  ok(G.UI.pickUpOrb('legend') === false, '没有存货时无法拿起');
  it.rarity = 'common'; it.affixes = [];
  G.UI.setCraftTarget(it.uid);
  G.UI.addOrbTo(p.inventory, 'legend');
  G.UI.renderCraft();
  const legendNode2 = G.el('craft-bench').children.filter((c) => c.dataset && c.dataset.orb === 'legend')[0];
  ok(legendNode2.dataset.count === '1', '拿到通货后数量更新');
  ok(legendNode2.dataset.ok === '0', '对白装不可用的通货标记为不可用');
  const before = p.inventory.filter((x) => x && x.orb === 'legend')[0].count;
  ok(G.UI.useOrb('legend') === false, '不可用的通货用不了');
  ok(p.inventory.filter((x) => x && x.orb === 'legend')[0].count === before, '失败时不会消耗通货');

  /* ---- 拿起 / 放下的其他路径 ---- */
  G.UI.addOrbTo(p.inventory, 'whetstone');
  G.UI.renderCraft();
  ok(G.UI.pickUpOrb('whetstone') === true, '拿起第二个通货会替换手上的');
  ok(G.UI.heldOrb.orb === 'whetstone', '手上的通货被替换', G.UI.heldOrb.orb);
  ok(G.UI.pickUpOrb('whetstone') === false, '再次点击同一个则放下');
  ok(G.UI.heldOrb === null, '已放下');
  G.UI.pickUpOrb('whetstone');
  G.UI.releaseOrb();
  ok(G.UI.heldOrb === null, '右键 / Esc 可以主动放下');

  // 没有装备时点中央不会误消耗
  G.UI.setCraftTarget(null);
  G.UI.pickUpOrb('whetstone');
  ok(G.UI.applyHeldOrb() === false, '工作台为空时用不了通货');
  G.UI.releaseOrb(true);

  // 库存实时反映背包变化
  G.UI.renderCraft();
  const wNode = G.el('craft-bench').children.filter((c) => c.dataset && c.dataset.orb === 'whetstone')[0];
  ok(wNode.dataset.count === '1', '节点数量跟随库存刷新', wNode.dataset.count);

  report('做装工作台布局、库存统计与拿起使用全部正常');
}

/* ============================================================ */
section('16o. 深渊残晶掉落与秘法工坊加成');
{
  const D = G.DATA, L = G.Loot;
  ok(D.MATERIAL && D.MATERIAL.name === '深渊残晶', '残晶是既有材料', D.MATERIAL && D.MATERIAL.name);
  const sh = L.makeShard(12.4);
  ok(sh.cat === 'shard' && sh.amount === 12, '残晶掉落物会取整', sh.cat + '/' + sh.amount);
  ok(sh.name === D.MATERIAL.name && sh.color === D.MATERIAL.color, '掉落物带名称与配色');
  ok(L.makeShard(0).amount === 1, '最少掉 1 个');

  /* ---- 掉落率：普通怪很小，精英/BOSS 更高 ---- */
  const gS = new G.Game(13579);
  G.GAME = gS; G.UI.game = gS;
  gS.player = G.ENT.makePlayer(gS, 'barb');
  const rate = (kind, bonus, n) => {
    const rng = G.RNG(4242);
    let hit = 0;
    for (let i = 0; i < n; i++) {
      const drops = L.rollDrops(rng, { mlvl: 40, kind: kind, mult: 1, shardBonus: bonus });
      if (drops.some((d) => d.cat === 'shard')) hit++;
    }
    return hit / n;
  };
  const N = 4000;
  const rNormal = rate('normal', 1, N);
  const rNormal2 = rate('normal', 2, N);
  const rElite = rate('elite', 1, N);
  const rBoss = rate('boss', 1, 400);
  ok(rNormal > 0.005 && rNormal < 0.2, '普通怪小概率掉落残晶', (rNormal * 100).toFixed(1) + '%');
  ok(rNormal2 > rNormal * 1.5, '掉落率加成明显提高普通怪的残晶掉落', 
    (rNormal * 100).toFixed(1) + '% → ' + (rNormal2 * 100).toFixed(1) + '%');
  ok(rElite > rNormal, '精英怪掉落率更高', (rElite * 100).toFixed(1) + '%');
  ok(rBoss > rElite, 'BOSS 掉落率最高', (rBoss * 100).toFixed(1) + '%');

  // 掉出来的数量随怪物等级成长
  const amtAt = (mlvl) => {
    const rng = G.RNG(999);
    let sum = 0, n = 0;
    for (let i = 0; i < 600; i++) {
      L.rollDrops(rng, { mlvl: mlvl, kind: 'elite', mult: 1 }).forEach((d) => { if (d.cat === 'shard') { sum += d.amount; n++; } });
    }
    return n ? sum / n : 0;
  };
  const a10 = amtAt(10), a60 = amtAt(60);
  ok(a60 > a10 * 2, '等级越高掉得越多', a10.toFixed(1) + ' → ' + a60.toFixed(1));

  /* ---- 拾取：直接进残晶池，不占背包 ---- */
  gS.toDungeon(3);
  const p = gS.player;
  const bagBefore = p.inventory.filter(Boolean).length;
  const shardsBefore = p.shards || 0;
  gS.dropLoot(p.x + 10, p.y, [L.makeShard(25)]);
  ok(gS.pickups.length >= 1, '残晶掉在地上');
  gS.pickupNearby();
  ok((p.shards || 0) === shardsBefore + 25, '拾取后残晶进入残晶池',
    shardsBefore + ' → ' + p.shards);
  ok(p.inventory.filter(Boolean).length === bagBefore, '不占用背包格子');

  // 自动吸取（拾取范围内不用手动捡）
  const st = p.stats;
  gS.started = true;
  gS.dropLoot(p.x + Math.min(20, st.pickup * 0.5), p.y, [L.makeShard(7)]);
  const beforeAuto = p.shards;
  gS.update(1 / 60);
  ok(p.shards === beforeAuto + 7, '残晶和金币一样会被自动吸取', beforeAuto + ' → ' + p.shards);

  /* ---- 秘法工坊加成 ---- */
  const ws = D.BUILDINGS.filter((b) => b.id === 'workshop')[0];
  ok(!!ws && typeof ws.shardDrop === 'function', '秘法工坊有残晶掉落加成字段');
  ok(Math.abs(ws.shardDrop(0) - 1) < 1e-9, '0 级无加成', ws.shardDrop(0));
  ok(Math.abs(ws.shardDrop(5) - 2) < 1e-9, '5 级 +100%', ws.shardDrop(5));
  ok(ws.perk(5).indexOf('深渊残晶掉落率 +100%') >= 0, '建筑说明写明了残晶加成', ws.perk(5));
  ok(ws.perk(3).indexOf('通货石掉落几率 +45%') >= 0 && ws.perk(3).indexOf('残晶掉落率 +60%') >= 0,
    '同时保留通货石加成', ws.perk(3));

  const p2 = G.ENT.makePlayer(gS, 'barb');
  ok(Math.abs(G.Town.shardBonus(p2) - 1.2) < 1e-9, '初始 1 级建筑提供 +20%', G.Town.shardBonus(p2));
  p2.town.buildings.workshop = 0;
  ok(Math.abs(G.Town.shardBonus(p2) - 1.2) < 1e-9, '建筑最低按 1 级计（+20%）', G.Town.shardBonus(p2));
  p2.town.buildings.workshop = 5;
  ok(Math.abs(G.Town.shardBonus(p2) - 2) < 1e-9, '满级秘法工坊让残晶掉落率翻倍', G.Town.shardBonus(p2));
  ok(Math.abs(G.Town.orbBonus(p2) - 1.75) < 1e-9, '通货石加成不受影响', G.Town.orbBonus(p2));

  // 城镇面板会把这条加成显示出来
  G.UI.game = gS;
  gS.player = p2;
  G.UI.dirty.town = true;
  G.UI.renderTown();
  const cards = G.el('town-buildings').children;
  ok(cards.some((c) => c.innerHTML.indexOf('深渊残晶掉落率') >= 0), '城镇建设面板显示残晶加成');
  ok(cards.some((c) => c.innerHTML.indexOf('通货石掉落几率') >= 0), '同时也显示通货石加成');

  report('残晶掉落、拾取与秘法工坊加成校验通过');
}

/* ============================================================ */
section('16p. 特效渲染：NaN 不会再打崩光照层');
{
  const gR = new G.Game(31415);
  G.GAME = gR; G.UI.game = gR;
  gR.player = G.ENT.makePlayer(gR, 'barb');
  gR.started = true;
  gR.diffIdx = 1;                     // 噩梦难度下第 10 层的 BOSS 才是焰喉
  gR.enterFloor(10);
  const pR = gR.player;
  G.Render.init(G.el('game'));

  // 假 canvas 现在与浏览器一致：非有限数会抛错
  let ctxThrew = false;
  try { G.el('game').getContext('2d').createRadialGradient(0, 0, 0, 0, 0, NaN); } catch (e) { ctxThrew = true; }
  ok(ctxThrew, '测试用的 canvas 会拒绝 NaN 参数（与浏览器一致）');

  // 锥形特效（焰喉的吐息）：光照层必须用 radius，而不是不存在的 r
  G.FX.cone(gR, pR.x + 60, pR.y, 0, 280, 1.4, '#ff9a3c');
  const coneFx = gR.fx.filter((f) => f.type === 'cone')[0];
  ok(coneFx && isFinite(coneFx.r) && coneFx.r === 280 && coneFx.radius === 280,
    '锥形特效同时带 r 与 radius 且都是有限数', coneFx && String(coneFx.r));
  let drew = true;
  try { G.Render.draw(gR); } catch (e) { drew = false; ok(false, '带锥形特效渲染崩溃：' + e.message); }
  ok(drew, '锥形吐息 + 光照层渲染不崩溃');

  // 各种异常数据也不该把渲染打崩（NaN 坐标 / 缺字段）
  gR.fx.push({ type: 'cone', x: NaN, y: 0, radius: 100, arc: 1, color: '#fff', life: 0.4, max: 0.4 });
  gR.fx.push({ type: 'cone', x: 0, y: 0, arc: 1, color: '#fff', life: 0.4, max: 0.4 });   // 没有 radius / r
  gR.grounds.push({ kind: 'ground', x: NaN, y: NaN, r: NaN, dur: 1, tick: 0.5, timer: 0, elem: 'fire', comps: { fire: 1 }, from: 'monster', color: '#f00', telegraph: 0.5, once: true });
  let drew2 = true;
  try { G.Render.draw(gR); } catch (e) { drew2 = false; ok(false, '异常数据渲染崩溃：' + e.message); }
  ok(drew2, '坐标 / 半径异常时渲染自动跳过而不是崩溃');

  // 真实打一场：焰喉连放吐息
  const bossR = gR.monsters.filter((m) => m.isBoss)[0];
  ok(bossR && bossR.name === '焰喉', '第 10 层噩梦 BOSS 是焰喉', bossR && bossR.name);
  const coneAtk = bossR.def.attacks.filter((a) => a.type === 'cone')[0];
  ok(!!coneAtk, '焰喉有锥形吐息技能');
  let phaseErr = null;
  for (let f = 0; f < 900 && !phaseErr; f++) {
    try {
      pR.life = pR.stats.maxLife;
      pR.x = bossR.x - 180; pR.y = bossR.y;
      if (f % 25 === 0 && coneAtk) G.Combat.bossAttack(gR, bossR, coneAtk);
      gR.update(1 / 60);
      G.Render.draw(gR);
    } catch (e) { phaseErr = e.message; }
  }
  ok(!phaseErr, '焰喉持续吐息 900 帧不崩溃', phaseErr || '');

  report('特效渲染的 NaN 防护校验通过');
}

/* ============================================================ */
section('18. 版本号与变更记录');
{
  const cl = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  const m = cl.match(/^v(\d+\.\d+\.\d+)$/m);
  ok(!!m, 'CHANGELOG.md 有版本行（vX.Y.Z）', m ? m[0] : '未找到');
  ok(m && G.VERSION === m[1], 'G.VERSION 与 CHANGELOG 最新版本一致',
    G.VERSION + ' vs ' + (m ? m[1] : '-'));
  ok(G.VERSION_TAG === 'v' + G.VERSION, '版本标签带 v 前缀', G.VERSION_TAG);
  ok(/^\d+\.\d+\.\d+$/.test(G.VERSION), '版本号符合语义化版本', G.VERSION);

  // 版本号要能在界面上看到
  const idxHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ok(idxHtml.indexOf('id="ss-version"') >= 0 && idxHtml.indexOf('id="menu-version"') >= 0,
    '起始界面与暂停界面都有版本号位置');
  const txt = G.UI.versionText();
  ok(txt.indexOf(G.VERSION_TAG) >= 0, '版本文案包含版本号', txt);
  G.UI.showStart();
  ok(G.el('ss-version').textContent.indexOf(G.VERSION_TAG) >= 0, '起始界面会显示版本号',
    G.el('ss-version').textContent);
  G.UI.setPaused(true);
  ok(G.el('menu-version').textContent.indexOf(G.VERSION_TAG) >= 0, '暂停界面会显示版本号');
  G.UI.fatal(new Error('测试'));
  ok(G.el('fatal').textContent.indexOf(G.VERSION_TAG) >= 0, '错误覆盖层带版本号');
  G.el('fatal').hidden = true;
  G.UI.setPaused(false);

  // 变更记录本身：新格式 = 版本行 + 分类行（--xx）+ 条目行（-xx），块之间空两行，版本之间用 ==== 分区
  ok(cl.indexOf('v0.0.1') >= 0, 'CHANGELOG 保留了首个版本');
  ok(/^--[^\s-]/m.test(cl), 'CHANGELOG 使用 --分类 的排版');
  ok(/^-/m.test(cl), 'CHANGELOG 的条目以 - 开头');
  ok(cl.indexOf('v' + G.VERSION) < cl.indexOf('v0.0.1'), '最新版本排在旧版本之前');
  const und = cl.indexOf('未发布');
  ok(und < 0 || und < cl.indexOf('v' + G.VERSION), '未发布的改动写在最新版本之前');
  ok(/\n\n\n/.test(cl), 'CHANGELOG 的块之间留有空行');
  ok(/^={10,}$/m.test(cl), 'CHANGELOG 用长串 = 分区不同版本');
  // 旧格式的完整历史归档（放在 filebackup/ 下，根目录也认）
  const oldPath = ['filebackup/changelog-old.md', 'changelog-old.md']
    .map((p) => path.join(__dirname, '..', p))
    .filter((p) => fs.existsSync(p))[0];
  ok(!!oldPath, '旧版变更记录归档为 filebackup/changelog-old.md');

  report('版本号与变更记录校验通过');
}

/* ============================================================ */
section('19. Todo 改造：难度分离 / 掉落曲线 / 层缓存 / 布局 / 技能收益 / 过滤器');
{
  const D = G.DATA, L = G.Loot, S = G.Stats;

  /* ---------- 第 10 条：技能窗口显示升级收益 ---------- */
  {
    const g = new G.Game(90101);
    G.GAME = g; G.UI.game = g;
    g.player = G.ENT.makePlayer(g, 'barb');
    const p = g.player;
    p.level = 40; p.skillPoints = 20; p.skills.barb_rend = 6;
    S.derive(p);
    const sk = D.SKILLS.barb_rend;
    const html = G.UI.skillGainHTML(p, sk, 6, 6);
    ok(html.indexOf('投入下一点') >= 0, '技能窗口有「投入下一点」的收益行');
    ok(html.indexOf('→') >= 0 && html.indexOf('基础伤害') >= 0, '显示基础伤害的当前 → 下一级', 
      html.replace(/<[^>]*>/g, '').slice(0, 60));
    ok(/\+[\d.]+%/.test(html), '给出提升百分比');
    const before = G.UI.skillDamageAt(p, sk, 6);
    const after = G.UI.skillDamageAt(p, sk, 7);
    ok(after > before, '数值确实随等级提升', Math.round(before) + ' → ' + Math.round(after));
    const maxed = G.UI.skillGainHTML(p, sk, sk.maxLevel, sk.maxLevel);
    ok(maxed.indexOf('已满级') >= 0, '满级时提示已满级');
    const locked = G.UI.skillGainHTML(Object.assign({}, p, { level: 1 }), D.SKILLS.barb_leap, 0, 0);
    ok(locked.indexOf('需要角色等级') >= 0, '未达等级要求时提示需求');

    // 渲染到窗口里
    G.UI.openSkillWindow('barb_rend');
    ok(G.el('sk-hstats').innerHTML.indexOf('skgain') >= 0, '技能窗口渲染出升级收益区块');
    ok(G.el('sk-hstats').innerHTML.indexOf('投入下一点') >= 0, '窗口中能看到收益数字');
    G.UI.togglePanel('panel-skill', false);
    // 增益类技能（战吼）显示增益数值变化
    const shout = D.SKILLS.barb_shout;
    const sh = G.UI.skillGainHTML(p, shout, 3, 3);
    ok(sh.indexOf('护甲') >= 0 && sh.indexOf('→') >= 0, '增益技能显示增益与护甲的变化');
  }

  /* ---------- 第 8 条：层数与难度分离 ---------- */
  {
    ok(D.DIFFICULTIES.length === 6, '难度共 6 档', D.DIFFICULTIES.length);
    ok(D.DIFFICULTIES[1].name === '专家' && D.DIFFICULTIES[2].name === '噩梦', '难度顺序为 普通→专家→噩梦',
      D.DIFFICULTIES.map((d) => d.name).join('→'));
    ok(D.diffUnlock(1).floor === 5 && D.diffUnlock(1).diff === 0, '第 2 档需要在普通难度打第 5 层');
    ok(D.diffUnlock(2).floor === 10 && D.diffUnlock(2).diff === 1, '第 3 档需要在专家难度打第 10 层');
    ok(D.DIFFICULTIES.every((d) => typeof d.quality === 'number'), '每档难度都有掉落品质加成');

    // 层数只提升怪物等级，难度只加一点点
    const lv0 = G.mlvlOf(10, 0), lv5 = G.mlvlOf(10, 5);
    ok(lv5 - lv0 <= 5, '难度对怪物等级的影响很小（层数才是主项）', lv0 + ' → ' + lv5);
    ok(G.mlvlOf(20, 0) - G.mlvlOf(10, 0) > lv5 - lv0, '层数对怪物等级的影响远大于难度');

    const g = new G.Game(90102);
    G.GAME = g; G.UI.game = g;
    g.player = G.ENT.makePlayer(g, 'barb');
    const p = g.player;
    p.level = 40; S.derive(p);
    g.toDungeon(5);
    ok(g.maxUnlockedDiff() === 0, '新角色只有普通难度', g.maxUnlockedDiff());
    ok(g.setDiff(1).ok === false, '未解锁的难度不能选');
    // 在普通难度击败第 5 层领主
    const boss = g.monsters.filter((m) => m.isBoss)[0];
    ok(boss && g.floor === 5, '第 5 层有领主', boss && boss.name);
    const diffBefore = g.diffIdx;
    G.Combat.killMonster(g, boss, true);
    ok(g.diffIdx === diffBefore, '击杀领主不再自动提升难度', g.diffIdx);
    ok(p.diffUnlocked === 1, '普通难度通关第 5 层 → 解锁专家', p.diffUnlocked);
    ok(g.maxUnlockedDiff() === 1, '最高可选难度变成专家');
    ok(g.setDiff(1).ok === true && g.diffIdx === 1, '可以切到专家难度');
    ok(g.setDiff(2).ok === false, '噩梦仍未解锁');
    ok(g.setDiff(0).ok === true, '可以切回普通');
    g.setDiff(1);
    // 专家难度打第 10 层领主
    g.enterFloor(10);
    const boss2 = g.monsters.filter((m) => m.isBoss)[0];
    ok(boss2 && boss2.name === '焰喉', '专家难度第 10 层是焰喉', boss2 && boss2.name);
    const hpNormal = (function () {
      const tmp = new G.Game(1); tmp.player = G.ENT.makePlayer(tmp, 'barb'); tmp.diffIdx = 0; tmp.enterFloor(10);
      const b = tmp.monsters.filter((m) => m.isBoss)[0];
      return b.maxLife;
    })();
    ok(boss2.maxLife > hpNormal, '专家难度怪物血量更高', Math.round(hpNormal) + ' → ' + Math.round(boss2.maxLife));
    G.Combat.killMonster(g, boss2, true);
    ok(p.diffUnlocked === 2, '专家难度通关第 10 层 → 解锁噩梦', p.diffUnlocked);
    // 存读档保留解锁进度
    g.area = 'town'; g.save();
    const g2 = new G.Game(1);
    G.GAME = g2; G.UI.game = g2;
    ok(g2.load(g.slot) === true, '读档成功');
    ok((g2.player.diffUnlocked | 0) === 2, '难度解锁进度随存档保留', g2.player.diffUnlocked);
    // 深渊之门面板里能选难度
    G.GAME = g; G.UI.game = g;
    UI_clearUpCache();
    G.UI.dirty.rift = true;
    G.UI.renderRift();
    const cards = G.el('rift-diffs').children;
    ok(cards.length === D.DIFFICULTIES.length, '深渊之门列出全部难度', cards.length + ' 张');
    ok(cards.filter((c) => c.dataset.on === '1').length === 1, '只有一个难度被标为当前');
    ok(cards[g.diffIdx].dataset.on === '1', '标出的正是当前难度', '当前 ' + g.diffIdx);
    ok(cards.filter((c) => c.dataset.locked === '1').length === D.DIFFICULTIES.length - (p.diffUnlocked + 1),
      '未解锁的难度标为锁定', cards.filter((c) => c.dataset.locked === '1').length + ' 个');
  }

  /* ---------- 第 9 条：掉落品质曲线 ---------- */
  {
    const sample = (floor, q, n) => {
      const rng = G.RNG(777);
      const out = { common: 0, magic: 0, rare: 0, unique: 0 };
      for (let i = 0; i < n; i++) {
        const st = L.rarityStage(floor, q);
        out[L.rollRarity(rng, { ilvl: Math.round(1 + floor * 1.2), stage: st })]++;
      }
      return out;
    };
    const N = 4000;
    const e = sample(5, 0, N);      // 前期
    const m = sample(20, 1, N);     // 中期
    const l = sample(45, 2, N);     // 后期
    const x = sample(70, 3, N);     // 终盘
    const pct = (o, k) => o[k] / N;
    ok(pct(e, 'common') > 0.55, '前期以白装为主', (pct(e, 'common') * 100).toFixed(0) + '%');
    ok(pct(e, 'unique') < 0.05, '前期暗金极少（惊喜掉落）', (pct(e, 'unique') * 100).toFixed(1) + '%');
    ok(pct(m, 'magic') > pct(m, 'common') && pct(m, 'rare') > pct(e, 'rare'),
      '中期蓝装为主、黄装变多', '白' + (pct(m, 'common') * 100).toFixed(0) + '% 蓝' + (pct(m, 'magic') * 100).toFixed(0) + '%');
    ok(pct(l, 'rare') > 0.4, '后期黄装为主', (pct(l, 'rare') * 100).toFixed(0) + '%');
    ok(pct(l, 'common') < 0.06, '后期基本不掉白装', (pct(l, 'common') * 100).toFixed(1) + '%');
    ok(pct(x, 'rare') + pct(x, 'unique') > 0.85, '终盘以黄装与暗金为主',
      ((pct(x, 'rare') + pct(x, 'unique')) * 100).toFixed(0) + '%');
    ok(pct(x, 'unique') > pct(l, 'unique') && pct(l, 'unique') > pct(e, 'unique'),
      '暗金率随进度提升', [e, l, x].map((o) => (pct(o, 'unique') * 100).toFixed(1) + '%').join(' → '));
    // 阶段越高，黄装词缀越多（越接近满词缀）
    const avgAffix = (floor, q) => {
      const rng = G.RNG(31337);
      let sum = 0, n = 0;
      for (let i = 0; i < 300; i++) {
        const it = L.makeItem(rng, { ilvl: Math.round(1 + floor * 1.2), rarity: 'rare', slot: 'chest', stage: L.rarityStage(floor, q) });
        sum += it.affixes.length; n++;
      }
      return sum / n;
    };
    const a1 = avgAffix(5, 0), a2 = avgAffix(60, 4);
    ok(a2 > a1, '阶段越高，黄装词缀越多', a1.toFixed(2) + ' → ' + a2.toFixed(2));
    ok(a2 > 5.2, '终盘以多词缀黄装为主', a2.toFixed(2) + ' 条');
    // 掉落入口把层数与难度品质传了下去
    const g = new G.Game(5150);
    G.GAME = g; G.UI.game = g;
    g.player = G.ENT.makePlayer(g, 'barb');
    g.player.level = 40; S.derive(g.player);
    g.diffIdx = 4; g.enterFloor(60);
    const drops = L.rollDrops(g.rng, { mlvl: g.mlvl, kind: 'elite', mult: 1, floor: g.floor, diffQuality: D.diffOf(g.diffIdx).quality, cls: 'barb' });
    const eq = drops.filter((d) => d.cat === 'equip');
    ok(eq.length > 0 && eq.every((it) => it.rarity !== 'common'), '高层高难度不掉白装',
      eq.map((it) => it.rarity).join(','));
  }

  /* ---------- 第 6 条：深渊布局 ---------- */
  {
    let bad = [], totalCorr = 0, totalRooms = 0, totalCorrLen = 0, corrSpawnTotal = 0, corrSpawnFloors = 0, totalMonAll = 0, totalDia = 0, themeSeen = {};
    for (let floor = 1; floor <= 25; floor++) {
      const rng = G.RNG(9000 + floor);
      const m = G.Dungeon.generate(rng, { floor, diffIdx: Math.min(5, floor % 6) });
      const rooms = m.rooms;
      totalRooms += rooms.length;
      totalCorr += m.corridors.length;
      // 房间不重叠
      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          const a = rooms[i], b = rooms[j];
          if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) bad.push('第' + floor + '层房间重叠');
        }
      }
      // 房间都在图内
      rooms.forEach((r) => {
        if (r.x < 1 || r.y < 1 || r.x + r.w > m.w - 1 || r.y + r.h > m.h - 1) bad.push('第' + floor + '层房间越界');
      });
      // 房间数：跟着格子数走 —— 小地图（9 格）4~6 间，最大的图（16 格）9~11 间
      if (rooms.length !== m.targetRooms) bad.push('第' + floor + '层房间数不等于目标 ' + rooms.length + '/' + m.targetRooms);
      if (m.targetRooms < 4 || m.targetRooms > 12) bad.push('第' + floor + '层目标房间数越界 ' + m.targetRooms);
      if (m.cells <= 9 && m.targetRooms > 6) bad.push('第' + floor + '层小地图房间过多 ' + m.targetRooms);
      // 区域风格：合法性 + 装饰与发光物都要符合该风格
      const th = G.DATA.themeById(m.theme);
      themeSeen[m.theme] = (themeSeen[m.theme] || 0) + 1;
      if (!G.DATA.ABYSS_THEMES.some((x) => x.id === m.theme)) bad.push('第' + floor + '层区域风格非法 ' + m.theme);
      if (!G.Render.wall[th.wall]) bad.push('第' + floor + '层墙体画法非法 ' + th.wall);
      m.decor.forEach((d) => {
        if (th.decor.indexOf(d.kind) < 0) bad.push('第' + floor + '层装饰 ' + d.kind + ' 不符风格 ' + m.theme);
      });
      if (!m.torches.length) bad.push('第' + floor + '层没有发光物');
      m.torches.forEach((x) => {
        if (x.kind !== th.light) bad.push('第' + floor + '层发光物 ' + x.kind + ' ≠ ' + th.light);
        if (x.hue !== th.lightHue || x.color !== th.lightColor) bad.push('第' + floor + '层发光物配色不符风格');
        if (x.r < th.lightR[0] - 0.01 || x.r > th.lightR[1] + 0.01) bad.push('第' + floor + '层发光物半径越界');
      });
      // 连接结构：不能串成一条长链，要有分叉
      const rk = (r) => r.gx + ',' + r.gy;
      const adj = {};
      rooms.forEach((r) => { adj[rk(r)] = []; });
      (m.links || []).forEach((l) => {
        const A = l.ax + ',' + l.ay, B = l.bx + ',' + l.by;
        if (!adj[A] || !adj[B]) { bad.push('第' + floor + '层连接指向不存在的房间'); return; }
        adj[A].push(B); adj[B].push(A);
      });
      if ((m.links || []).length !== m.corridors.length) bad.push('第' + floor + '层走廊数与连接数不符');
      if (Object.keys(adj).filter((k) => adj[k].length >= 3).length < 1) bad.push('第' + floor + '层连接没有分叉');
      const bfs = (start) => {
        const dist = {}; dist[start] = 0;
        const q = [start];
        while (q.length) {
          const cur = q.shift();
          (adj[cur] || []).forEach((n) => { if (dist[n] === undefined) { dist[n] = dist[cur] + 1; q.push(n); } });
        }
        return dist;
      };
      const d1 = bfs(rk(rooms[0]));
      if (Object.keys(d1).length !== rooms.length) bad.push('第' + floor + '层房间连接图不连通');
      let farKey = rk(rooms[0]), fd = -1;
      Object.keys(d1).forEach((k) => { if (d1[k] > fd) { fd = d1[k]; farKey = k; } });
      const d2 = bfs(farKey);
      let dia = 0;
      Object.keys(d2).forEach((k) => { if (d2[k] > dia) dia = d2[k]; });
      totalDia += dia;
      // 一条链的直径 = 房间数 - 1；有分叉的树会短得多
      if (dia > rooms.length - 1) bad.push('第' + floor + '层连接像一条长链（直径 ' + dia + '/' + rooms.length + '）');
      // 走廊数量与房间数同量级（不再是一堆乱路）
      if (m.corridors.length > rooms.length * 2 + 3) bad.push('第' + floor + '层走廊过多 ' + m.corridors.length);
      if (m.corridors.length < rooms.length - 1) bad.push('第' + floor + '层走廊过少 ' + m.corridors.length);
      // 走廊要短：只挖相邻房间之间那段空隙，不能横穿地图
      m.corridors.forEach((c) => {
        const len = (c.x1 === c.x2 ? Math.abs(c.y2 - c.y1) : Math.abs(c.x2 - c.x1)) + 1;
        totalCorrLen += len;
        if (len < 2) bad.push('第' + floor + '层走廊过短 ' + len);
        if (len > 14) bad.push('第' + floor + '层走廊过长 ' + len);
      });
      // 房间大小要适中：太小走廊会拉长，太大又会占满整个格子
      rooms.forEach((r) => {
        const area = r.w * r.h;
        if (area < 40 || area > 520) bad.push('第' + floor + '层房间面积异常 ' + r.w + 'x' + r.h);
      });
      // 每层怪物总量仍走原来那条曲线（房间变小变多，但总量不变）
      const totalMon = m.spawns.filter((s) => s.kind !== 'prop').length;
      totalMonAll += totalMon;
      if (totalMon < 10 + floor * 0.8 || totalMon > 30 + floor * 2.2) {
        bad.push('第' + floor + '层怪物总量偏离曲线 ' + totalMon);
      }
      // 走廊地砖不能落在房间地板上（走廊与房间不重叠）
      const roomTiles = new Set();
      rooms.forEach((r) => {
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) roomTiles.add(y * m.w + x);
      });
      (m.corridorTiles || []).forEach((i) => { if (roomTiles.has(i)) bad.push('第' + floor + '层走廊压在房间上'); });
      // 走廊两端都必须接在房间里 —— 不留通往空地的死路走廊
      const adjRoom = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some((d) => roomTiles.has((y + d[1]) * m.w + (x + d[0])));
      m.corridors.forEach((c) => {
        if (!adjRoom(c.x1, c.y1) || !adjRoom(c.x2, c.y2)) bad.push('第' + floor + '层走廊端点没接房间');
      });
      // 走廊里会刷少量怪（数量少、而且确实站在走廊地砖上）
      const cs = m.spawns.filter((s) => s.corridor);
      if (cs.length) corrSpawnFloors++;
      corrSpawnTotal += cs.length;
      if (cs.length > 4) bad.push('第' + floor + '层走廊怪过多 ' + cs.length);
      const corrSet = new Set(m.corridorTiles || []);
      cs.forEach((sp) => {
        if (!corrSet.has(sp.ty * m.w + sp.tx)) bad.push('第' + floor + '层走廊怪不在走廊上');
        if (rooms.some((r) => sp.tx >= r.x && sp.tx < r.x + r.w && sp.ty >= r.y && sp.ty < r.y + r.h)) {
          bad.push('第' + floor + '层走廊怪站在房间里');
        }
      });
      // 起点是角落房间，出口是离起点最远的房间
      const st = m.rooms[0];
      let cornerScore = 1e9;
      rooms.forEach((r) => { cornerScore = Math.min(cornerScore, r.gx + r.gy); });
      const startRoom = rooms.filter((r) => Math.abs(r.cx - (m.playerStart.x / 44)) < 1 && Math.abs(r.cy - (m.playerStart.y / 44)) < 1)[0];
      if (startRoom && startRoom.gx + startRoom.gy !== cornerScore) bad.push('第' + floor + '层起点不在角落');
      // 起点能被走到（对地板做一次洪泛，出口必须可达）
      const idx = (x, y) => y * m.w + x;
      const seen = new Uint8Array(m.w * m.h);
      const sx = Math.round(m.playerStart.x / 44), sy = Math.round(m.playerStart.y / 44);
      const ex = Math.round(m.stairs.x / 44), ey = Math.round(m.stairs.y / 44);
      const q = [[sx, sy]];
      seen[idx(sx, sy)] = 1;
      while (q.length) {
        const cur = q.pop();
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (let d = 0; d < dirs.length; d++) {
          const nx = cur[0] + dirs[d][0], ny = cur[1] + dirs[d][1];
          if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
          if (m.tiles[idx(nx, ny)] !== 1 || seen[idx(nx, ny)]) continue;
          seen[idx(nx, ny)] = 1;
          q.push([nx, ny]);
        }
      }
      if (!seen[idx(ex, ey)]) bad.push('第' + floor + '层出口不可达');
      // 所有房间中心都能走到
      rooms.forEach((r) => { if (!seen[idx(r.cx, r.cy)]) bad.push('第' + floor + '层有房间走不到'); });
      // 走廊地砖也都得通（说明走廊两端真的接上了房间）
      (m.corridorTiles || []).forEach((i) => { if (!seen[i]) bad.push('第' + floor + '层有走廊地砖走不到'); });
      // 挖完之后不该有任何走不到的地板砖：不然就是留下一段没人用的死路
      let floorN = 0, seenN = 0;
      for (let i = 0; i < m.tiles.length; i++) if (m.tiles[i] === 1) { floorN++; if (seen[i]) seenN++; }
      if (floorN !== seenN) bad.push('第' + floor + '层有走不到的地板 ' + (floorN - seenN) + ' 格');
      if (rooms.length < 4) bad.push('第' + floor + '层房间过少 ' + rooms.length);
    }
    ok(bad.length === 0, '1-25 层布局：房间不重叠、走廊短且两端接房间、无死路、全连通', bad.slice(0, 3).join(' / '));
    ok(totalCorr / totalRooms < 1.9, '走廊与房间数量比例合理（不是一堆乱路）',
      (totalCorr / totalRooms).toFixed(2) + ' 条/间');
    ok(totalCorrLen / totalCorr <= 7, '走廊平均长度够短（≤7 格）',
      (totalCorrLen / totalCorr).toFixed(1) + ' 格');
    ok(totalMonAll / 25 >= 20 && totalMonAll / 25 <= 70, '每层怪物总量仍在原曲线上',
      (totalMonAll / 25).toFixed(1) + ' 只/层');
    ok(totalDia / 25 <= 6, '房间连接是带分叉的树（平均直径 ≤6，长链会接近房间数）',
      (totalDia / 25).toFixed(1) + ' 跳');
    // 区域风格：多层跑下来应该出现多种
    ok(Object.keys(themeSeen).length >= 3, '多层会随机出现多种区域风格',
      Object.keys(themeSeen).map((k) => G.DATA.themeById(k).name + '×' + themeSeen[k]).join(' '));
    // 四种风格各渲染一遍，不能抛错
    const gt = new G.Game(31415);
    G.GAME = gt; G.UI.game = gt;
    gt.player = G.ENT.makePlayer(gt, 'barb');
    G.Stats.derive(gt.player);
    let themeRenderBad = [];
    G.DATA.ABYSS_THEMES.forEach((th) => {
      let tmap = null;
      for (let i = 0; i < 80 && !tmap; i++) {
        const cand = G.Dungeon.generate(G.RNG(700 + i * 13), { floor: 1 + i, diffIdx: 0 });
        if (cand.theme === th.id) tmap = cand;
      }
      if (!tmap) { themeRenderBad.push(th.id + ' 未抽到'); return; }
      gt.map = tmap; gt.area = 'dungeon';
      try { G.Render.draw(gt); } catch (e) { themeRenderBad.push(th.id + ':' + e.message); }
    });
    ok(themeRenderBad.length === 0, '四种区域风格都能渲染', themeRenderBad.join(' / ') || '无问题');
    // 墙体画法：四种画法都在，每种都能单独跑（石砖 / 密林 / 冰川 / 崎岖岩石）
    ok(['block', 'forest', 'glacier', 'rocky'].every((k) => typeof G.Render.wall[k] === 'function'),
      '四种墙体画法都注册在 R.wall 上', Object.keys(G.Render.wall).join(','));
    let wallBad = [];
    const wallCtx = G.Render.ctx || G.el('game').getContext('2d');
    G.DATA.ABYSS_THEMES.forEach((th) => {
      const pal = G.Render.palette(3, th.id);
      for (let k = 0; k < 4; k++) {
        try { G.Render.wall[th.wall](wallCtx, k * 44, 0, pal, 0.4, { down: k === 3, right: false, left: false, up: false }); }
        catch (e) { wallBad.push(th.wall + ':' + e.message); }
      }
    });
    ok(wallBad.length === 0, '四种墙体画法都能单独绘制', wallBad.join(' / ') || '无问题');
    // 块体要跨过格子边界：不然又会变成「一格一块」的网格感（原来冰川就是这样）
    const recPoly = (fn, pal) => {
      const out = [];
      let cur = null;
      const rc = {
        fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
        beginPath() { cur = []; },
        moveTo(x, y) { if (cur) cur.push([x, y]); },
        lineTo(x, y) { if (cur) cur.push([x, y]); },
        closePath() { },
        arc(x, y, r) { if (cur) cur.push([x - r, y - r], [x + r, y + r]); },
        fill() { if (cur && cur.length) out.push(cur); cur = null; },
        fillRect() { }, stroke() { }, save() { }, restore() { },
      };
      fn(rc, 0, 0, pal, 0.4, { down: false, right: false, left: false, up: false });
      return out;
    };
    const overflow = {};
    G.DATA.ABYSS_THEMES.forEach((th) => {
      if (th.wall === 'block') return;
      const pts = recPoly(G.Render.wall[th.wall], G.Render.palette(3, th.id));
      overflow[th.wall] = pts.some((poly) => poly.some((p) => p[0] < -1 || p[0] > 45 || p[1] < -1 || p[1] > 45));
    });
    ok(Object.keys(overflow).length === 3 && Object.keys(overflow).every((k) => overflow[k]),
      '密林 / 冰川 / 岩石的块体会跨过格子边界（不会退回网格感）',
      Object.keys(overflow).map((k) => k + ':' + (overflow[k] ? '√' : '×')).join(' '));
    ok(G.DATA.ABYSS_THEMES.every((th) => ['block', 'forest', 'glacier', 'rocky'].indexOf(th.wall) >= 0),
      '每种区域风格都指定了墙体画法',
      G.DATA.ABYSS_THEMES.map((th) => th.name + ':' + th.wall).join(' '));
    ok(corrSpawnTotal > 0 && corrSpawnTotal <= 25 * 4, '走廊里会刷少量怪',
      corrSpawnTotal + ' 只 / ' + corrSpawnFloors + ' 层');
    // BOSS 层的竞技场不能压在别的房间上
    let arenaHit = [];
    [5, 10, 15, 20, 25].forEach((floor) => {
      const m = G.Dungeon.generate(G.RNG(555 + floor), { floor, diffIdx: 0 });
      const a = m.arena;
      if (!a) { arenaHit.push('第' + floor + '层没有竞技场'); return; }
      m.rooms.forEach((r) => {
        if (r === m.stairsRoom) return;
        if (a.x <= r.x + r.w - 1 && a.x + a.w - 1 >= r.x && a.y <= r.y + r.h - 1 && a.y + a.h - 1 >= r.y) {
          arenaHit.push('第' + floor + '层竞技场压房间');
        }
      });
    });
    ok(arenaHit.length === 0, 'BOSS 竞技场没有和别的房间重叠', arenaHit.join(' / '));
  }

  /* ---------- 第 7 条：只缓存当前层 ---------- */
  {
    const g = new G.Game(9090);
    G.GAME = g; G.UI.game = g;
    g.player = G.ENT.makePlayer(g, 'barb');
    const p = g.player;
    p.level = 40; S.derive(p);
    g.toDungeon(7);
    const monsters0 = g.monsters.length;
    ok(monsters0 > 0, '第 7 层有怪物', monsters0);
    // 制造一些「进度」：杀几只怪、砸个罐子、留一件掉落、把玩家挪个位置
    for (let i = 0; i < 3; i++) if (g.monsters[i]) G.Combat.killMonster(g, g.monsters[i], true);
    const killedNow = g.killed;
    if (g.props.length) g.props[0].hp = 0;
    g.dropLoot(p.x + 30, p.y, [L.makeItem(g.rng, { ilvl: 20, slot: 'ring' })]);
    const pickups0 = g.pickups.length;
    p.x += 40;
    const px0 = p.x;
    const cache = g.serializeFloor();
    ok(cache && cache.floor === 7, '能序列化当前层', cache && cache.floor);
    ok(typeof cache.map.tiles === 'string' && cache.map.tiles.length === g.map.w * g.map.h, '地图用紧凑字符串保存');
    const theme0 = g.map.theme;
    ok(!!theme0 && cache.map.theme === theme0, '楼层缓存里带着区域风格', theme0 + ' / ' + cache.map.theme);

    // 回城 → 再进同一层：原样恢复
    g.toTown('portal');
    ok(g.area === 'town', '回到城镇');
    ok(g.floorCache && g.floorCache.floor === 7, '城镇里保留着第 7 层的缓存');
    g.enterFloor(7);
    ok(g.area === 'dungeon' && g.floor === 7, '重新进入第 7 层');
    ok(g.monsters.length === monsters0, '怪物数量原样恢复', g.monsters.length + ' / ' + monsters0);
    ok(g.killed === killedNow, '击杀进度恢复', g.killed);
    ok(g.pickups.length === pickups0, '地上的掉落还在', g.pickups.length);
    ok(Math.abs(g.player.x - px0) < 1, '玩家位置恢复', Math.round(g.player.x) + ' vs ' + Math.round(px0));
    ok(g.props.length === cache.props.length, '可破坏物数量一致');
    ok(g.monsters.every((m) => m.def), '恢复出来的怪物定义完整');
    ok(g.map.theme === theme0, '回到同一层，区域风格不变', theme0 + ' → ' + g.map.theme);
    ok(g.monsters.filter((m) => m.dead).length >= 3, '已死的怪物仍然是死的',
      g.monsters.filter((m) => m.dead).length);

    // 进入别的层数 → 缓存作废
    const keep = g.serializeFloor();
    g.enterFloor(8);
    ok(g.floor === 8 && g.floorCache === null, '进入别的层数后旧缓存被丢弃', String(g.floorCache));
    g.enterFloor(7);
    ok(g.monsters.length !== 0, '再回到第 7 层会重新生成');
    ok(g.floorCache === null || g.floorCache.floor === 7, '缓存只跟踪当前层');

    // 存档 → 读档（等同刷新页面）也恢复
    g.toDungeon(9);
    const mon9 = g.monsters.length;
    G.Combat.killMonster(g, g.monsters[0], true);
    const killed9 = g.killed;
    const px9 = g.player.x + 20;
    g.player.x = px9;
    g.save();
    const g2 = new G.Game(4);
    G.GAME = g2; G.UI.game = g2;
    ok(g2.load(g.slot) === true, '读档成功');
    ok(g2.floor === 9 && g2.area === 'dungeon', '回到第 9 层', g2.floor + '/' + g2.area);
    ok(g2.monsters.length === mon9, '刷新后怪物数量一致', g2.monsters.length + ' / ' + mon9);
    ok(g2.killed === killed9, '刷新后击杀进度一致', g2.killed);
    ok(Math.abs(g2.player.x - px9) < 1, '刷新后位置一致');
    G.GAME = g; G.UI.game = g;
  }

  /* ---------- 第 1 条：装备过滤器 ---------- */
  {
    const F = G.Filter;
    ok(!!F, '过滤器模块已加载');
    ok(F.MAX_RULES === 20, '规则上限 20 条', F.MAX_RULES);
    F.clear();
    F.data.enabled = true;

    const g = new G.Game(4321);
    G.GAME = g; G.UI.game = g;
    g.player = G.ENT.makePlayer(g, 'barb');
    const p = g.player;
    p.level = 30; S.derive(p);
    const common = L.makeItem(g.rng, { ilvl: 20, slot: 'chest', rarity: 'common' });
    const rare = L.makeItem(g.rng, { ilvl: 20, slot: 'chest', rarity: 'rare' });
    const rareHi = L.makeItem(g.rng, { ilvl: 50, slot: 'chest', rarity: 'rare' });

    // 空规则 → 全部显示
    ok(F.decide(common, {}).state === 'normal', '没有规则时一切正常显示');

    // 单条规则：普通 → 隐藏
    F.addRule({ action: 'hide', enabled: true, conds: [{ type: 'rarity', op: 'is', value: 'common' }] });
    ok(F.decide(common, {}).state === 'hide', '规则命中：普通装备被隐藏');
    ok(F.decide(rare, {}).state === 'normal', '不命中的装备照常显示');

    // 靠前的规则优先：把「稀有 → 高亮」放到最前面
    F.data.rules.unshift({ action: 'show', enabled: true, conds: [{ type: 'rarity', op: 'is', value: 'rare' }] });
    ok(F.decide(rare, {}).state === 'show', '靠前的规则优先生效（高亮）');
    ok(F.decide(common, {}).state === 'hide', '后面的规则继续对其它物品生效');

    // 多条细则 = 同时满足
    F.clear();
    F.addRule({ action: 'show', enabled: true, conds: [
      { type: 'rarity', op: 'is', value: 'rare' },
      { type: 'ilvl', op: '>=', value: 40 },
    ] });
    ok(F.decide(rareHi, {}).state === 'show', '两条细则都满足才命中', F.ruleText(F.data.rules[0]));
    ok(F.decide(rare, {}).state === 'normal', '只满足一条不算命中');

    // 禁用规则 / 关闭过滤器
    F.data.rules[0].enabled = false;
    ok(F.decide(rareHi, {}).state === 'normal', '禁用后的规则不生效');
    F.data.rules[0].enabled = true;
    F.data.enabled = false;
    ok(F.decide(rareHi, {}).state === 'normal', '关闭过滤器后全部显示');
    F.data.enabled = true;

    // 词缀 / 需求 / 部位 / 可穿戴 等细则
    F.clear();
    rare.affixes = [{ id: 'p_crit', stat: 'crit', value: 5, tier: 1, kind: 'prefix', name: '精准的' }];
    // 「包含词缀」改成勾选 + 「至少包含 N 条」
    F.addRule({ action: 'show', enabled: true, conds: [{ type: 'affix', op: 'has', value: 1, affixIds: ['p_crit'] }] });
    ok(F.decide(rare, {}).state === 'show', '按勾选的词缀匹配');
    ok(F.decide(rareHi, {}).state === 'normal', '没有该词缀就不命中');
    F.data.rules[0].conds[0].value = 2;
    F.data.rules[0].conds[0].affixIds = ['p_crit', 'p_str'];
    ok(F.decide(rare, {}).state === 'normal', '勾两条但「至少 2 条」时只命中一条 → 不通过');
    F.data.rules[0].conds[0].affixIds = [];
    ok(F.decide(rare, {}).state === 'show', '一条词缀都没勾 → 该细则不参与筛选');
    F.clear();
    F.addRule({ action: 'hide', enabled: true, conds: [{ type: 'slot', op: 'is', value: 'chest' }] });
    ok(F.decide(common, {}).state === 'hide', '按部位匹配');
    F.clear();
    F.addRule({ action: 'hide', enabled: true, conds: [{ type: 'canEquip', op: 'is', value: 'false' }] });
    ok(F.decide(common, { canEquip: false }).state === 'hide', '按「当前穿不上」匹配');
    ok(F.decide(common, { canEquip: true }).state === 'normal', '能穿上时不命中');
    F.clear();
    const heavy = L.makeItem(g.rng, { ilvl: 60, slot: 'chest', rarity: 'rare' });
    heavy.req = { level: 40, str: 90 };
    F.addRule({ action: 'hide', enabled: true, conds: [{ type: 'reqAttr', op: '>=', value: 80 }] });
    ok(F.decide(heavy, {}).state === 'hide', '按需求属性匹配（力量 / 敏捷 / 智力取最高）');
    const dexOnly = L.makeItem(g.rng, { ilvl: 40, slot: 'chest', rarity: 'rare' });
    dexOnly.req = { level: 10, dex: 55 };
    ok(F.decide(dexOnly, {}).state === 'hide', '只看敏捷的装备也能被「需求属性」命中');
    F.clear();

    // 细则表：名称包含已移除，力量 / 敏捷 / 智力合并成需求属性
    ok(!F.hasCond('name') && !F.COND_TYPES.some((c) => c.name.indexOf('名称') >= 0), '「名称包含」已移除');
    ok(!F.hasCond('reqStr') && !F.hasCond('reqDex') && !F.hasCond('reqInt'), '力量 / 敏捷 / 智力三条已合并');
    ok(F.hasCond('reqAttr') && F.condType('reqAttr').name === '需求属性', '合并为「需求属性」');
    ok(F.condType('reqAttr').attrPick === true && F.ATTR_OPTIONS.length === 4, '「需求属性」可以选力量 / 敏捷 / 智力');
    ok(F.attrOf({}) === 'any' && F.attrOf({ attr: 'str' }) === 'str', '属性选择的默认值是「任意」');
    ok(F.clampValue('reqAttr', 1e9) === 99999, '需求属性的范围到 99999', String(F.condType('reqAttr').max));
    // 选中具体属性时只看那一项
    const strGuy = L.makeItem(g.rng, { ilvl: 30, slot: 'chest', rarity: 'rare' });
    strGuy.req = { level: 10, str: 90 };
    const dexGuy = L.makeItem(g.rng, { ilvl: 30, slot: 'chest', rarity: 'rare' });
    dexGuy.req = { level: 10, dex: 90 };
    F.clear();
    F.addRule({ action: 'hide', enabled: true, conds: [{ type: 'reqAttr', attr: 'str', op: '>=', value: 80 }] });
    ok(F.decide(strGuy, {}).state === 'hide' && F.decide(dexGuy, {}).state === 'normal',
      '选中「力量」时只看力量，不看敏捷');
    ok(F.ruleText(F.data.rules[0]).indexOf('力量') >= 0, '规则摘要会写清选中的属性', F.ruleText(F.data.rules[0]));
    F.clear();
    F.addRule({ action: 'hide', enabled: true, conds: [{ type: 'reqAttr', attr: 'any', op: '>=', value: 80 }] });
    ok(F.decide(strGuy, {}).state === 'hide' && F.decide(dexGuy, {}).state === 'hide',
      '选「任意」时三项取最高');
    F.clear();
    // 数值细则：默认 0 + 带取值范围
    const numConds = F.COND_TYPES.filter((c) => c.value === 'number');
    ok(numConds.length >= 6, '数值细则数量', numConds.length);
    ok(numConds.every((c) => c.min === 0 && c.max > 0), '数值细则都带 0 ~ 上限的范围',
      numConds.map((c) => c.name + ':' + c.min + '-' + c.max).join(' '));
    ok(F.NUM_DEFAULT === 0, '数值细则默认值是 0', F.NUM_DEFAULT);
    ok(F.clampValue('sockets', 99) === 4 && F.clampValue('sockets', -3) === 0, '孔位数被夹在 0~4',
      F.clampValue('sockets', 99) + '/' + F.clampValue('sockets', -3));
    ok(F.clampValue('quality', 250) === 100 && F.clampValue('affixCount', 9) === 6, '品质 / 词缀条数也被夹住');
    ok(F.clampValue('ilvl', 'abc') === 0, '输入不是数字时回到默认值 0', F.clampValue('ilvl', 'abc'));
    ok(F.clampValue('rarity', 'rare') === 'rare', '非数值细则不受影响');
    // 老数据迁移：力量 / 敏捷 / 智力 → 需求属性，名称包含丢弃
    const migrated = F.migrateConds([
      { type: 'reqStr', op: '>=', value: 80 },
      { type: 'name', op: 'has', value: '剑' },
      { type: 'sockets', op: '>=', value: 99 },
    ]);
    ok(migrated.length === 2 && migrated[0].type === 'reqAttr' && migrated[0].value === 80,
      '老细则 reqStr 迁移成 reqAttr');
    ok(migrated[1].type === 'sockets' && migrated[1].value === 4, '迁移时顺手把越界数值夹回范围');
    ok(F.importText(JSON.stringify({ rules: [{ action: 'hide', conds: [{ type: 'reqDex', op: '>=', value: 30 }] }] })).ok === true &&
      F.data.rules[0].conds[0].type === 'reqAttr', '导入老格式的过滤器也能用');
    F.clear();
    F.addRule({ action: 'show', enabled: true, conds: [{ type: 'sockets', op: '>=', value: 2 }] });
    const socked = L.makeItem(g.rng, { ilvl: 30, slot: 'chest', rarity: 'rare' });
    socked.sockets = 2; socked.gems = [null, null];
    ok(F.decide(socked, {}).state === 'show', '按孔位数匹配');

    // 规则管理：上限、删除、排序
    F.clear();
    let ruleAdded = 0;
    for (let i = 0; i < F.MAX_RULES; i++) if (F.addRule(F.newRule('hide')) === true) ruleAdded++;
    ok(ruleAdded === F.MAX_RULES, '能连续添加满 ' + F.MAX_RULES + ' 条规则', ruleAdded);
    ok(F.data.rules.length === F.MAX_RULES, '规则数量达到上限');
    ok(F.addRule(F.newRule('hide')) === false, '超过 20 条时添加失败');
    F.removeRule(0);
    ok(F.data.rules.length === F.MAX_RULES - 1, '可以删除规则');
    const first = F.data.rules[0];
    F.moveRule(0, 1);
    ok(F.data.rules[1] === first, '可以调整规则顺序（优先级）');

    // 导出 / 导入
    F.clear();
    F.addRule({ action: 'hide', enabled: true, conds: [{ type: 'rarity', op: 'is', value: 'common' }] });
    F.addRule({ action: 'show', enabled: true, conds: [{ type: 'ilvl', op: '>=', value: 60 }] });
    const txt = F.exportText();
    ok(txt.indexOf('"rules"') >= 0 && JSON.parse(txt).rules.length === 2, '导出为 JSON 文本');
    F.clear();
    ok(F.data.rules.length === 0, '清空成功');
    const imp = F.importText(txt);
    ok(imp.ok && F.data.rules.length === 2, '导入成功', imp.ok ? imp.rules + ' 条' : imp.why);
    ok(F.data.rules[0].action === 'hide' && F.data.rules[1].conds[0].value === 60, '导入后内容正确');
    ok(F.importText('{不是 json').ok === false, '坏文本导入会失败但不崩');
    ok(F.importText('{"rules":[]}').ok === true, '空规则集也能导入');

    // 界面：格子渲染出隐藏 / 高亮状态
    F.clear();
    F.addRule({ action: 'hide', enabled: true, conds: [{ type: 'rarity', op: 'is', value: 'common' }] });
    F.addRule({ action: 'show', enabled: true, conds: [{ type: 'rarity', op: 'is', value: 'rare' }] });
    UI_clearUpCache();
    G.UI.refreshFilterViews();
    ok(G.UI.cellClass(common).indexOf('flt-hide') >= 0, '被隐藏的格子带 flt-hide 类', G.UI.cellClass(common));
    ok(G.UI.cellInner(common).indexOf('flt-hidden') < 0 && G.UI.cellInner(common).indexOf('✕') < 0,
      '被隐藏的格子不再画叉');
    ok(/<span/.test(G.UI.cellInner(common)), '被隐藏的格子照常显示装备图标');
    ok(G.UI.filterHidden(common) === true && G.UI.filterHidden(rare) === false,
      'filterHidden 只认「隐藏」的装备');
    ok(G.UI.cellClass(rare).indexOf('flt-show') >= 0, '高亮的格子带 flt-show 类');
    ok(G.UI.cellInner(rare).indexOf('flt-mark') >= 0, '高亮的格子有标记');
    ok(G.UI.cellClass(null).indexOf('empty') >= 0, '空格子不受影响');

    // 长按「显示全部装备」（默认 X，可改键）：按住期间才算显示状态，松手立刻恢复
    const holdReveal = () => G.input.simulate(G.Settings.getBind('revealFilter'));
    const releaseReveal = () => G.input.simulateUp(G.Settings.getBind('revealFilter'));
    releaseReveal();
    ok(G.UI.revealHeld() === false, '没按住时不处于显示状态');
    holdReveal();
    ok(G.UI.revealHeld() === true, '按住显示键时进入显示状态');
    ok(G.UI.filterHidden(common) === true, '长按状态不改变过滤器本身的判定');
    ok(G.UI.cellClass(common).indexOf('flt-hide') >= 0, '长按期间背包格子仍是暗色边框');
    releaseReveal();
    ok(G.UI.revealHeld() === false, '松手后恢复普通状态');

    // 地面掉落：平时既不画也不捡；长按显示键才画出来、才点得到，但 F 照样不捡
    const hiddenDrop = L.makeItem(g.rng, { ilvl: 20, slot: 'chest', rarity: 'common' });
    const shownDrop = L.makeItem(g.rng, { ilvl: 20, slot: 'chest', rarity: 'rare' });
    const pkHidden = { kind: 'pickup', x: p.x, y: p.y, item: hiddenDrop, bob: 0, life: 600, r: 10 };
    const pkShown = { kind: 'pickup', x: p.x, y: p.y, item: shownDrop, bob: 0, life: 600, r: 10 };
    g.pickups.push(pkHidden, pkShown);
    ok(G.UI.filterHidden(hiddenDrop) === true, '地面上的隐藏装备会被拦下');
    ok(g.pickupAt(p.x, p.y, 40) === pkShown, '平时点不到被隐藏的掉落（只点得到留下的那件）');
    g.pickupNearby();
    ok(g.pickups.indexOf(pkHidden) >= 0, 'F 拾取不会捡起被隐藏的装备');
    ok(g.pickups.indexOf(pkShown) < 0, '没被隐藏的装备照常捡起');
    ok(p.inventory.filter((x) => x && x.uid === hiddenDrop.uid).length === 0, '隐藏装备没进背包');
    ok(g.collectPickup(pkHidden) === false, '直接调 collectPickup 也不捡隐藏装备');

    holdReveal();
    ok(g.pickupAt(p.x, p.y, 40) === pkHidden, '长按显示键后能点中被隐藏的掉落');
    ok(g.collectPickup(pkHidden) === false, '长按期间 F / 自动吸取仍然不捡隐藏装备');
    releaseReveal();
    ok(g.collectPickup(pkHidden) === false, '松手后点击路径也不再捡');
    holdReveal();
    ok(g.collectPickup(pkHidden, true) === true, '长按显示键时鼠标点过来的那一次才捡得起来');
    releaseReveal();
    ok(p.inventory.some((x) => x && x.uid === hiddenDrop.uid), '被点起来的隐藏装备进了背包');
    g.pickups.length = 0;
    ok(G.UI.revealHeld() === false, '测试结束回到「没按住」状态');

    // 导入 / 导出：文本框平时藏在小窗里，点按钮才弹出
    const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const ioAt = htmlSrc.indexOf('id="filter-io"');
    const taAt = htmlSrc.indexOf('id="filter-json"');
    ok(ioAt >= 0 && taAt > ioAt, '文本框放在「导入 / 导出」小窗里');
    ok(htmlSrc.slice(taAt, htmlSrc.indexOf('</section>', taAt)).indexOf('btn-filter-io-ok') >= 0,
      '小窗里有确认按钮');
    ok(/id="filter-io" hidden/.test(htmlSrc), '小窗默认是隐藏的');
    ok(htmlSrc.indexOf('id="btn-filter-copy"') < 0, '面板上不再直接摆一个文本框和一个复制按钮');
    ok(htmlSrc.indexOf('id="btn-filter-reveal"') < 0, '过滤器面板里不再有「临时显示被隐藏的物品」按钮');
    ok(htmlSrc.indexOf('id="ubtn-reveal"') < 0 && htmlSrc.indexOf('data-act="revealFilter"') < 0,
      '右下角功能栏的「全显」按钮已移除');
    ok(htmlSrc.indexOf('data-key="revealFilter"') >= 0, '帮助面板里保留长按说明');
    const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui.js'), 'utf8');
    ok(uiSrc.indexOf('toggleFilterReveal') < 0 && uiSrc.indexOf('已显示全部装备') < 0,
      '按 X 不再弹出开关式文字提示');
    G.UI.openFilterIO('export');
    ok(G.el('filter-io').hidden === false, '点「导出」弹出小窗');
    ok(G.el('filter-json').value.indexOf('"rules"') >= 0, '小窗里是当前过滤器的 JSON 文本');
    ok(G.el('btn-filter-io-ok').textContent === '复制', '导出时确认按钮是「复制」');
    ok(G.UI.filterIOConfirm() === true, '导出确认不会出错');
    ok(G.UI.closeFilterIO() === true && G.el('filter-io').hidden === true, '关掉小窗');
    ok(G.UI.closeFilterIO() === false, '已经关掉的小窗再关一次不会出问题');
    G.UI.openFilterIO('import');
    ok(G.el('btn-filter-io-ok').textContent === '导入' && G.el('filter-json').value === '',
      '导入小窗是空文本框，确认按钮是「导入」');
    G.el('filter-json').value = '{"rules":[]}';
    ok(G.UI.filterIOConfirm() === true && F.data.rules.length === 0, '小窗里能直接导入');
    ok(G.el('filter-io').hidden === true, '导入成功后小窗自动关闭');
    // 导入会把规则整份换掉，这里恢复成上面那两条，后面还要用
    F.clear();
    F.addRule({ action: 'hide', enabled: true, conds: [{ type: 'rarity', op: 'is', value: 'common' }] });
    F.addRule({ action: 'show', enabled: true, conds: [{ type: 'rarity', op: 'is', value: 'rare' }] });
    ok(F.data.rules.length === 2, '导入测试后恢复规则');

    // 面板渲染
    G.UI.togglePanel('panel-filter', true);
    ok(G.el('filter-rules').children.length === 2, '面板列出全部规则', G.el('filter-rules').children.length);
    ok(G.el('filter-rules').children[0].innerHTML.indexOf('flt-hide') < 0, '规则卡片正常渲染');
    ok(G.el('filter-rules').children[0].innerHTML.indexOf('<select') >= 0, '规则里有下拉控件');
    ok(G.el('filter-count').textContent.indexOf('2 / 20') >= 0, '显示规则数量', G.el('filter-count').textContent);
    // 通过界面改动作 → 数据跟着变
    G.UI.filterEdit({ target: { dataset: { rule: '0', field: 'action' }, value: 'show' } });
    ok(F.data.rules[0].action === 'show', '面板改动作会写回数据');
    G.UI.filterClick({ target: { dataset: { rule: '1', act: 'up' } } });
    ok(F.data.rules[0].conds[0].value === 'rare', '面板上移规则生效');
    G.UI.filterClick({ target: { dataset: { rule: '0', act: 'del' } } });
    ok(F.data.rules.length === 1, '面板删除规则生效');

    // 每一种细则类型都要能渲染出输入控件（「装备类型」曾因数据表没导出把整个面板弄崩）
    F.clear();
    F.COND_TYPES.forEach((ct) => F.addRule({
      action: 'hide', enabled: true,
      conds: [{ type: ct.id, op: ct.ops[0].id, value: ct.value === 'number' ? 0 : 'true' }],
    }));
    let condErr = null;
    try { G.UI.renderFilter(); } catch (e) { condErr = e.message; }
    ok(condErr === null, '所有细则类型都能渲染出输入控件', condErr || '');
    const cards = Array.prototype.slice.call(G.el('filter-rules').children);
    ok(cards.length === F.COND_TYPES.length, '每种细则各有一张规则卡', cards.length);
    // 数值细则的输入框带 min / max（越界会被浏览器 + clamp 双重拦住）
    const numCard = cards.filter((c) => String(c.innerHTML).indexOf('flt-num') >= 0);
    ok(numCard.length === F.COND_TYPES.filter((c) => c.value === 'number').length,
      '数值细则都渲染成数字输入框', numCard.length + ' 个');
    ok(numCard.every((c) => /min="0"/.test(String(c.innerHTML)) && /max="\d+"/.test(String(c.innerHTML)) &&
      /step="1"/.test(String(c.innerHTML))), '数字输入框都带 min / max / step');
    ok(numCard.some((c) => /max="4"/.test(String(c.innerHTML))), '孔位数的输入框上限是 4');
    // 「需求属性」除了数字框，还带一个属性下拉（用它自己那张卡来查）
    const reqCard = cards.filter((c) => String(c.innerHTML).indexOf('value="reqAttr" selected') >= 0)[0];
    ok(!!reqCard && /data-field="attr"/.test(String(reqCard.innerHTML)) &&
      String(reqCard.innerHTML).indexOf('>力量<') >= 0 && String(reqCard.innerHTML).indexOf('>智力<') >= 0,
      '「需求属性」细则里有力量 / 敏捷 / 智力的下拉');
    // 面板上把越界数值写回数据时会被夹住
    G.UI.filterEdit({ target: { dataset: { rule: '0', cond: '0', field: 'value' }, value: '99999' } });
    ok(F.data.rules[0].conds[0].value <= 100, '面板写入越界数值会被夹回范围',
      F.data.rules[0].conds[0].type + '=' + F.data.rules[0].conds[0].value);
    // 「装备类型」那条：武器 / 副手 / 护甲三张表都要列出来（副手是盾牌、护甲是头盔、武器是剑）
    const typeCard = cards.filter((c) => String(c.innerHTML).indexOf('value="shield"') >= 0)[0];
    ok(!!typeCard, '「装备类型」下拉里有副手项（盾牌）');
    ok(!!typeCard && typeCard.innerHTML.indexOf('>盾牌<') >= 0 &&
      typeCard.innerHTML.indexOf('>头盔<') >= 0 && typeCard.innerHTML.indexOf('>剑<') >= 0,
      '「装备类型」下拉同时含武器 / 副手 / 护甲三类');
    ok(!!(G.DATA.WEAPON_TYPES && G.DATA.OFFHAND_TYPES && G.DATA.ARMOR_TYPES), '武器 / 副手 / 护甲三张类型表都已导出');

    G.UI.togglePanel('panel-filter', false);
    F.clear();
    F.save();
  }

  /* ---------- 第 2 条：按键提示随改键更新 ---------- */
  {
    const g = new G.Game(90202);
    G.GAME = g; G.UI.game = g;
    g.player = G.ENT.makePlayer(g, 'barb');
    const p = g.player;
    p.level = 20; S.derive(p);

    // 标签读取当前绑定
    G.Settings.setBind('craft', 'KeyG');
    ok(G.Settings.actionLabel('craft') === 'G', '快捷键标签读当前绑定', G.Settings.actionLabel('craft'));
    G.Settings.setBind('craft', 'KeyY');
    ok(G.Settings.actionLabel('craft') === 'Y', '改键后标签跟着变', G.Settings.actionLabel('craft'));
    ok(G.Settings.actionLabel('nope') === '未绑定', '没绑定的动作显示未绑定');

    // 操作模式说明里的按键也跟着变
    G.Settings.setBind('attack', 'KeyY');
    const d1 = G.UI.modeDesc('mouse');
    ok(d1.indexOf('Y') >= 0 && d1.indexOf('普通攻击') >= 0, '模式说明使用当前绑定（普攻键）', d1.slice(0, 40));
    G.Settings.setBind('attack', 'MouseRight');
    ok(G.UI.modeDesc('mouse').indexOf('鼠标右键') >= 0, '改回去后说明也回退');
    G.Settings.setBind('craft', 'KeyG');

    // 「显示全部装备」：长按动作 + 默认 X + 可改键 + 设置面板里有这一行
    const rf = G.Settings.ACTIONS.filter((a) => a.id === 'revealFilter')[0];
    ok(!!rf, '动作表里有「长按显示全部装备（过滤器）」');
    ok(G.Settings.getBind('revealFilter') === 'KeyX', '默认绑定 X', G.Settings.getBind('revealFilter'));
    G.Settings.setBind('revealFilter', 'KeyZ');
    ok(G.Settings.actionLabel('revealFilter') === 'Z', '改成 Z 后标签跟着变');
    G.UI.renderSettings();
    const rows = Array.prototype.slice.call(G.el('bind-list').children);
    ok(rows.some((r) => String(r.innerHTML).indexOf('显示全部装备') >= 0),
      '设置面板的按键列表里有这一行', rows.length + ' 行');
    G.Settings.setBind('revealFilter', 'KeyX');
    ok(G.Settings.actionLabel('revealFilter') === 'X', '改回 X');

    // 技能栏角标
    G.Settings.setMode('mouse');
    G.UI.buildSkillbar();
    ok(G.UI.slotRefs.length >= 5, '技能栏有 5 格', G.UI.slotRefs.length);
    ok(G.UI.slotRefs[0].slot.innerHTML.indexOf('鼠标右键') >= 0, '鼠标模式普攻角标是右键',
      G.UI.slotRefs[0].slot.innerHTML.replace(/<[^>]*>/g, ' ').trim().slice(0, 30));
    G.Settings.setBind('skill1', 'KeyZ');
    G.UI.buildSkillbar();
    ok(G.UI.slotRefs[1].slot.innerHTML.indexOf('Z') >= 0, '改键后技能栏角标更新',
      G.UI.slotRefs[1].slot.innerHTML.replace(/<[^>]*>/g, ' ').trim().slice(0, 30));
    G.Settings.setBind('skill1', 'Digit1');

    // 帮助面板两行
    G.UI.refreshKeyHints();
    ok(G.el('help-mode-mouse').innerHTML.indexOf(G.Settings.actionLabel('attack')) >= 0,
      '帮助面板的鼠标模式行使用当前绑定');
    ok(G.el('help-mode-wasd').innerHTML.indexOf(G.Settings.actionLabel('moveUp')) >= 0,
      '帮助面板的 WASD 行使用当前绑定');

    // 任务提示行（站在 NPC 旁边）
    g.enterTown({ silent: true });
    const npc = g.map.npcs[0];
    p.x = npc.x; p.y = npc.y + 20;
    G.Settings.setBind('pickup', 'KeyX');
    G.UI.updateHUD();
    const obj = G.el('objective').innerHTML;
    ok(obj.indexOf('X') >= 0 && obj.indexOf('交谈') >= 0, '任务行里的交互按键使用当前绑定',
      obj.replace(/<[^>]*>/g, ' ').trim().slice(0, 40));
    G.Settings.setBind('pickup', 'KeyF');
    G.UI.updateHUD();
    ok(G.el('objective').innerHTML.indexOf('F') >= 0, '改回 F 后提示也跟着回退');
    G.Settings.save();
  }

  /* ---------- 第 3 条：精简冗余描述 ---------- */
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    ok(src.indexOf('想重新分配属性') < 0, '深渊之门面板不再写「洗点找深渊向导」');
    ok(src.indexOf('分支 5 / 10 / 15 / 20 / 25 级解锁<br>') < 0, '技能窗口不再写两行重复提示');
    ok(src.indexOf('id="rift-diffs"') >= 0, '深渊之门面板改放难度选择');
    const tip = G.Loot.tooltipHTML(G.Loot.makeItem(G.RNG(7), { ilvl: 40, slot: 'weapon', baseId: 'w_greatsword_4' }), null, {});
    ok(tip.indexOf('双手武器：占主手') < 0 && tip.indexOf('孔位上限') < 0, '双手武器提示框不再重复解释规则');
  }

  /* ---------- 第 5 条：装备界面布局（参考图：头盔居中 + 三行） ---------- */
  {
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
    ok(/\.gear-doll\{[^}]*grid-template-columns:repeat\(3,1fr\)/.test(css), '装备栏是 3 列网格');
    ok(/\.slot-equip\{[^}]*aspect-ratio:1 \/ 1/.test(css), '背包装备栏格子接近正方形（aspect-ratio 1:1）');
    ok(!/\.slot-equip\{[^}]*min-height:64px/.test(css), '不再用固定高度把格子拉成长方形');
    ok(/\.gear-doll\{[^}]*max-width/.test(css), '装备栏限宽，保证格子是方的');
    ok(/\.craft-gear \.slot-equip\.bench-on/.test(css) && css.indexOf('.cg-slot') < 0,
      '做装工坊的装备栏复用同一套 .slot-equip（旧的 .cg-slot 已移除）');
    const want = { helm: [1, 2], gloves: [2, 1], chest: [2, 2], amulet: [2, 3], weapon: [3, 1], belt: [3, 2], offhand: [3, 3], ring1: [4, 1], boots: [4, 2], ring2: [4, 3] };
    let missing = [];
    Object.keys(want).forEach((slot) => {
      const r = want[slot];
      const re = new RegExp('\\.gear-doll>\\[data-slot="' + slot + '"\\]\\{grid-area:' + r[0] + '/' + r[1] + '/' + (r[0] + 1) + '/' + (r[1] + 1) + '\\}');
      if (!re.test(css)) missing.push(slot + '→' + r.join('/'));
    });
    ok(missing.length === 0, '10 个部位按参考图定位（头盔居中、其余三行）', missing.join(' '));

    // 两个装备栏都挂上 .gear-doll，并且每个格子都带 data-slot
    const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    ok(src.indexOf('class="doll gear-doll" id="equip-doll"') >= 0, '背包装备栏使用新布局容器');
    ok(src.indexOf('id="craft-gear" class="craft-gear gear-doll"') >= 0, '做装工坊装备栏使用同一布局');

    const g = new G.Game(90505);
    G.GAME = g; G.UI.game = g;
    g.player = G.ENT.makePlayer(g, 'barb');
    const p = g.player;
    p.level = 20; p.gear.helm = G.Loot.makeItem(g.rng, { ilvl: 20, slot: 'helm', rarity: 'rare' });
    p.gear.weapon = G.Loot.makeItem(g.rng, { ilvl: 20, slot: 'weapon', rarity: 'magic' });
    p.gear.offhand = G.Loot.makeItem(g.rng, { ilvl: 20, slot: 'offhand', rarity: 'common' });
    S.derive(p);
    G.UI.dirty.char = true;
    G.UI.refreshEquipDoll();
    const doll = G.el('equip-doll');
    const cells = Array.prototype.slice.call(doll.children);
    const slotsSeen = cells.map((c) => c.dataset.slot).join(',');
    const missSlots = Object.keys(want).filter((slot) => slotsSeen.indexOf(slot) < 0);
    ok(cells.length === D.SLOTS.length && missSlots.length === 0 && cells.every((c) => c.dataset.slot),
      '装备栏 10 个格子齐全且都带 data-slot（供布局定位）', missSlots.join(','));
    const helmCell = cells.filter((c) => c.dataset.slot === 'helm')[0];
    ok(helmCell.innerHTML.indexOf(L.displayName(p.gear.helm)) >= 0, '头盔格子显示装备名');
    ok(helmCell.title.indexOf(L.displayName(p.gear.helm)) >= 0, '格子 title 是完整名称（省略号时也能看全）');
    const emptyCell = cells.filter((c) => c.className.indexOf('empty') >= 0)[0];
    ok(emptyCell && emptyCell.className.indexOf('empty') >= 0, '空槽位带 empty 类（虚线边框）');
    ok(emptyCell.innerHTML.indexOf(' · 空') >= 0, '空槽位显示「部位 · 空」');
    // 做装工坊的装备栏：同一套方形格子（.slot-equip）+ data-slot
    G.UI.togglePanel('panel-craft', true);
    const cg = G.el('craft-gear');
    const cgCells = Array.prototype.slice.call(cg.children);
    ok(cgCells.length === D.SLOTS.length, '做装工坊装备栏格子数一致', cgCells.length);
    ok(cgCells.every((c) => c.dataset.slot), '做装工坊装备栏也带 data-slot');
    ok(cgCells.every((c) => c.className.indexOf('slot-equip') >= 0 &&
      c.innerHTML.indexOf('class="g"') >= 0 && c.innerHTML.indexOf('class="nm"') >= 0),
      '做装工坊装备栏与背包是同一套方形格子（部位图标 + 名称）',
      cgCells[0] && cgCells[0].className);
    G.UI.togglePanel('panel-craft', false);
  }

  /* ---------- 第 5b 条：过滤器面板的导入 / 导出小窗与暗色边框 ---------- */
  {
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
    ok(/\.flt-io\{[^}]*position:absolute/.test(css) && /\.flt-io\[hidden\]\{display:none\}/.test(css),
      '导入 / 导出小窗是盖在面板上的一层，隐藏时不占位');
    const ioBox = css.match(/\.flt-io-box\{[^}]*\}/);
    ok(ioBox && ioBox[0].indexOf('max-width') >= 0, '小窗里的文本框有固定宽度',
      ioBox ? ioBox[0].slice(0, 60) : 'none');
    const fh = css.match(/\.cell\.flt-hide\{[^}]*\}/);
    ok(fh && /border-color:#[0-9a-f]{6}/i.test(fh[0]) && fh[0].indexOf('opacity') < 0,
      '被隐藏的格子改成暗色边框，不再整体淡化', fh ? fh[0] : 'none');
    ok(css.indexOf('.flt-hidden') < 0, '删掉了画叉用的样式');
    ok(css.indexOf('.cell.cant-equip .up-mark') < 0, '红框不再藏起绿色上三角');
    ok(css.indexOf('.ubtn.on') < 0, '「全显」按钮的高亮样式已随按钮一起移除');
    ok(css.indexOf('.cell.cant-equip{') > css.indexOf('.cell.upgrade{'),
      '红框规则排在绿框之后：同时命中时以红框为准');
  }

  report('Todo 改造：难度分离 / 掉落曲线 / 层缓存 / 布局 / 技能收益 / 过滤器 / 按键提示 全部通过');
}

/* ============================================================ */
section('20. 装备对比：秒伤（含附加元素伤害）与坚韧');
{
  const L = G.Loot, S = G.Stats;

  const g = new G.Game(90210);
  G.GAME = g; G.UI.game = g;
  g.player = G.ENT.makePlayer(g, 'barb');
  const p = g.player;
  p.level = 45;
  g.mlvl = 45;
  S.derive(p);

  /* ---------- 秒伤：孤立的武器数值 ---------- */
  const w1 = L.makeItem(g.rng, { ilvl: 40, slot: 'weapon', rarity: 'common' });
  w1.affixes = []; w1.implicit = []; w1.gems = [];
  w1.min = 20; w1.max = 30; w1.aps = 1.2; w1.two = false;
  const dpsPlain = L.itemDps(w1);
  ok(Math.abs(dpsPlain - 30) < 0.01, '无词缀武器秒伤 = 均值 × 攻速', dpsPlain.toFixed(2));

  // 附加元素伤害必须计入（之前漏算）
  w1.affixes = [{ stat: 'addFire', value: 20 }];
  const dpsFire = L.itemDps(w1);
  ok(dpsFire > dpsPlain, '附加火焰伤害会提高秒伤', dpsPlain.toFixed(2) + ' → ' + dpsFire.toFixed(2));
  ok(Math.abs(dpsFire - (dpsPlain + 20 * 0.9 * 1.2)) < 0.01, '附加元素按 0.9 折算并吃攻速',
    (dpsFire - dpsPlain).toFixed(2));

  // 攻速词缀也算进去
  w1.affixes = [{ stat: 'aps', value: 20 }];
  ok(Math.abs(L.itemDps(w1) - 25 * 1.44) < 0.01, '武器自身的攻速词缀计入秒伤', L.itemDps(w1).toFixed(2));
  w1.affixes = [];

  /* ---------- 秒伤对比：两件武器的差值互为相反数 ---------- */
  const w2 = L.makeItem(g.rng, { ilvl: 40, slot: 'weapon', rarity: 'common' });
  w2.affixes = []; w2.implicit = []; w2.gems = [];
  w2.min = 40; w2.max = 60; w2.aps = 1.5; w2.two = false;
  p.gear.weapon = w2;
  S.derive(p);
  const vs = G.UI.compareVersus(p, w1, [{ slot: 'weapon', label: '主手', item: w2 }]);
  const dNew = vs.byItem[w1.uid].dps, dOld = vs.byItem[w2.uid].dps;
  ok(dNew != null && dOld != null, '两把武器都有秒伤差值');
  ok(Math.abs(dNew + dOld) < 0.01, '两个窗口的秒伤差值互为相反数', dNew.toFixed(1) + ' / ' + dOld.toFixed(1));
  ok(dNew < 0 && dOld > 0, '更差的武器显示为负、更好的显示为正', dNew.toFixed(1) + ' / ' + dOld.toFixed(1));
  ok(Math.abs(dOld - (L.itemDps(w2) - L.itemDps(w1))) < 0.01, '差值 = 两件武器各自的秒伤之差');

  // 没有对照武器时不编造差值
  const solo = G.UI.compareVersus(p, w1, null);
  ok(solo.byItem[w1.uid] && solo.byItem[w1.uid].dps == null, '空槽位不显示秒伤差值');
  ok(L.cmpBadge(null) === '' && L.cmpBadge(0).indexOf('＝') > 0 &&
    L.cmpBadge(5).indexOf('up') > 0 && L.cmpBadge(-5).indexOf('down') > 0,
    '对比徽章：空 / 持平 / 提升 / 下降');

  // 提示框里真的出现秒伤与徽章
  const tNew = L.tooltipHTML(w1, p, { compare: false, versus: vs.byItem[w1.uid] });
  ok(tNew.indexOf('每秒伤害') >= 0, '武器提示框显示每秒伤害');
  ok(tNew.indexOf('cmp down') >= 0, '武器提示框带下降徽章');
  const tElem = L.tooltipHTML(Object.assign({}, w1, { affixes: [{ stat: 'addFire', value: 20 }] }), p, { compare: false });
  ok(tElem.indexOf('火焰伤害') >= 0, '武器提示框列出附加元素伤害', '');

  /* ---------- 坚韧：公式与不减血 ---------- */
  p.gear.weapon = null; S.derive(p);
  const st = p.stats;
  const tough = S.toughness(p, g.mlvl);
  const mitP = S.armorMitigation(st.armor, g.mlvl);
  const dodge = Math.max(0.05, 1 - st.dodge / 100);
  const reduce = Math.max(0.05, 1 - (st.dmgReduce || 0) / 100);
  ok(Math.abs(tough.byType.physical - st.maxLife / (1 - mitP) / dodge / reduce) < 0.5,
    '物理坚韧 = 生命 ÷（1−护甲减伤）÷（1−闪避）', Math.round(tough.byType.physical));
  const mitF = S.resistMitigation(st.res.fire);
  ok(Math.abs(tough.byType.fire - st.maxLife / (1 - mitF) / dodge / reduce) < 0.5,
    '火焰坚韧按火抗计算', Math.round(tough.byType.fire));
  const mean = S.TOUGH_TYPES.reduce((a, k) => a + tough.byType[k], 0) / S.TOUGH_TYPES.length;
  ok(Math.abs(tough.total - mean) < 0.01, '总坚韧 = 五系平均', Math.round(tough.total));
  ok(tough.total >= st.maxLife * 0.99, '坚韧不小于生命上限（减伤只会放大）');

  // 换装试算不能改到玩家的血量 / 法力
  p.life = Math.round(p.stats.maxLife * 0.6);
  p.mana = Math.round(p.stats.maxMana * 0.5);
  const life0 = p.life, mana0 = p.mana;
  const chest = L.makeItem(g.rng, { ilvl: 60, slot: 'chest', rarity: 'rare' });
  chest.affixes = [{ stat: 'armor', value: 400 }, { stat: 'maxLife', value: 200 }];
  const tAfter = S.toughnessWith(p, chest, 'chest', g.mlvl);
  ok(p.life === life0 && p.mana === mana0, '试算坚韧不会动到当前生命 / 法力',
    p.life + '|' + p.mana + ' vs ' + life0 + '|' + mana0);
  ok(!p.gear.chest || p.gear.chest.uid !== chest.uid, '试算后装备栏已还原');
  ok(tAfter.total > tough.total, '换上更好的胸甲坚韧提升', Math.round(tough.total) + ' → ' + Math.round(tAfter.total));

  /* ---------- 坚韧对比：徽章方向 ---------- */
  const chestOld = L.makeItem(g.rng, { ilvl: 20, slot: 'chest', rarity: 'common' });
  chestOld.affixes = []; chestOld.implicit = []; chestOld.gems = [];
  p.gear.chest = chestOld; S.derive(p);
  const vsC = G.UI.compareVersus(p, chest, [{ slot: 'chest', label: '胸甲', item: chestOld }]);
  const cNew = vsC.byItem[chest.uid].tough, cOld = vsC.byItem[chestOld.uid].tough;
  ok(cNew && cOld, '两件护甲都有坚韧数据');
  ok(cNew.delta > 0 && cOld.delta < 0 && Math.abs(cNew.delta + cOld.delta) < 1,
    '坚韧差值方向正确且两侧互为相反数', Math.round(cNew.delta) + ' / ' + Math.round(cOld.delta));
  const tChest = L.tooltipHTML(chest, p, { compare: false, tough: cNew });
  ok(tChest.indexOf('坚韧') >= 0 && tChest.indexOf('cmp up') >= 0, '护甲提示框显示坚韧与提升徽章');
  const tWeaponHasTough = L.tooltipHTML(w2, p, { compare: false, tough: cNew });
  ok(tWeaponHasTough.indexOf('坚韧') < 0, '武器不显示坚韧（只看秒伤）');

  // 角色面板：只显示总坚韧，悬停才展开分项
  const th = G.UI.toughnessHTML(tough);
  ok(th.indexOf('坚韧总计') >= 0 && S.TOUGH_TYPES.every((k) => th.indexOf(S.TOUGH_NAME[k]) >= 0),
    '坚韧明细包含总计与五类伤害');
  ok(th.indexOf('闪避') >= 0 && th.indexOf('护甲') >= 0, '坚韧明细列出计算输入');

  /* ---------- 面板里的迷你属性也带坚韧 ---------- */
  G.UI.togglePanel('panel-inventory', true);
  const mini = G.el('mini-stats');
  ok(mini && mini.innerHTML.indexOf('坚韧') >= 0, '背包装备栏的迷你属性显示坚韧');
  G.UI.togglePanel('panel-inventory', false);

  report('装备对比：秒伤（含附加元素）/ 坚韧（分项与试算）全部通过');
}

/* ============================================================ */
section('17. DOM 引用一致性（index.html ↔ js）');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const htmlIds = new Set();
(html.match(/id="([^"]+)"/g) || []).forEach((m) => htmlIds.add(m.slice(4, -1)));
const jsAll = files.map((f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')).join('\n');
const refs = new Set();
// 注意：前面要挡掉单词字符，否则 actionLabel('x') 里的 "el('x')" 会被误当成 id 引用
(jsAll.match(/(?:^|[^\w$.])el\(\s*'([^']+)'\s*\)/g) || []).forEach((m) => {
  refs.add(m.replace(/^[^\w$.]*el\(\s*'/, '').replace(/'\s*\)$/, ''));
});
(jsAll.match(/G\.text\(\s*'([^']+)'/g) || []).forEach((m) => refs.add(m.replace(/G\.text\(\s*'|'/g, '')));
(jsAll.match(/togglePanel\(\s*'([^']+)'/g) || []).forEach((m) => refs.add(m.replace(/togglePanel\(\s*'|'/g, '')));
(jsAll.match(/data-close="([^"]+)"/g) || []).forEach((m) => refs.add(m.slice(12, -1)));
const dynamicIds = new Set(['ubtn-mana', 'mana-count', 'rs-attr-btn']); // 由 JS 动态创建
const missing = [...refs].filter((id) => !htmlIds.has(id) && !dynamicIds.has(id));
ok(missing.length === 0, 'JS 引用的 DOM id 都存在于 index.html', missing.join(', '));
// 反向：HTML 中被 UI 使用的关键 id 是否都被引用（避免拼写后失效）
const mustHave = ['game', 'hud', 'skillbar', 'minimap', 'orb-life', 'orb-mana', 'xpfill', 'xptext',
  'inv-grid', 'equip-doll', 'mini-stats', 'attr-list', 'derived-list', 'skill-list', 'vendor-list',
  'vendor-inv', 'tooltip', 'ctxmenu', 'log', 'start-screen', 'class-pick', 'panel-menu', 'fatal',
  'hud-floor', 'hud-difficulty', 'hud-mlvl', 'gold-val', 'hud-killed', 'hud-total', 'objective',
  'levelup-toast', 'buffbar', 'utilitybar',
  'slot-list', 'btn-back-slots', 'panel-craft', 'craft-inv', 'craft-gear', 'craft-bench', 'craft-log',
  'panel-stash', 'stash-inv', 'stash-grid', 'stash-cap', 'panel-blacksmith', 'bs-grid', 'bs-shards',
  'bs-sum', 'btn-salvage-all', 'btn-sell-all', 'inv-cap',
  'panel-confirm', 'confirm-title', 'confirm-text', 'btn-confirm-ok', 'btn-confirm-cancel',
  'affix-pick', 'affix-list', 'affix-pick-count', 'affix-pick-hint', 'affix-hide-conflict',
  'btn-affix-ok', 'btn-affix-close', 'btn-affix-none', 'affix-msg',
  'panel-training', 'training-modes', 'btn-training-town',
  'dps-box', 'dps-now', 'dps-peak', 'dps-total', 'dps-detail', 'dps-mode',
  'panel-town', 'town-buildings', 'town-gold', 'town-shards', 'panel-jeweler', 'jeweler-list',
  'panel-rift', 'rift-floor', 'rift-enter', 'rift-diff', 'btn-slots',
  'panel-settings', 'mode-pick', 'mode-desc', 'bind-list', 'bind-mode-label',
  'bind-warn', 'btn-bind-reset', 'btn-sound', 'btn-menu-settings',
  'held-gem', 'gem-pull-list', 'gem-pull-count', 'btn-gem-pull-all', 'held-orb', 'panel-respec',
  'panel-skill', 'sk-tree', 'guide-say', 'rift-diffs', 'panel-filter', 'filter-rules', 'filter-json',
  'filter-enabled', 'filter-count', 'btn-filter',
  'btn-hpbar', 'btn-manabar', 'btn-dodgebar'];
const missing2 = mustHave.filter((id) => !htmlIds.has(id));
ok(missing2.length === 0, 'HTML 关键元素齐全', missing2.join(', '));
// CSS 引用的类是否在 JS/HTML 中出现过（粗查）
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const cssClasses = new Set();
(css.match(/\.[a-z][a-z0-9-]*/gi) || []).forEach((m) => cssClasses.add(m.slice(1)));
const usedInHtml = html + jsAll;
const unused = [...cssClasses].filter((c) => usedInHtml.indexOf(c) < 0);
ok(unused.length < 30, 'CSS 类基本都有使用（未使用 ' + unused.length + ' 个）', unused.slice(0, 12).join(', '));
report('DOM 引用一致：' + htmlIds.size + ' 个 id，JS 引用 ' + refs.size + ' 个，全部匹配');

/* ============================================================ */
section('21. 闪避充能 / 替换基础闪避 / 头顶状态条');
{
  /* ---- 两个新后缀 ---- */
  const ac = D.affixById.s_dodgeCharges, ar = D.affixById.s_dodgeRecharge;
  ok(!!ac && !!ar, '新增后缀「闪避充能次数」「闪避恢复时间」');
  ok(ac.kind === 'suffix' && ar.kind === 'suffix' && ac.stat === 'dodgeCharges' && ar.stat === 'dodgeRecharge',
    '两个后缀的类型与属性键正确', ac.stat + ' / ' + ar.stat);
  ok(ac.slots.join() === 'boots' && ar.slots.join() === 'boots' && ac.noRing === true && ar.noRing === true,
    '只出现在靴子上（戒指也不会补上）', ac.slots + ' / ' + ar.slots);
  ok(D.affixesForSlot('boots', 'suffix').indexOf(ac) >= 0 && D.affixesForSlot('ring', 'suffix').indexOf(ac) < 0 &&
    D.affixesForSlot('chest', 'suffix').indexOf(ar) < 0, '靴子后缀池有它们，戒指 / 胸甲没有');
  ok(ac.tiers.every((t) => Math.round(t.min) === Math.round(t.max)),
    '充能档位取整后稳定（掷出的数值不会被抹成前一档）', ac.tiers.map((t) => t.min + '~' + t.max).join(' '));
  ok(ac.tiers.every((t) => 1 + Math.round(t.max) <= 4) && 1 + Math.round(ac.tiers[ac.tiers.length - 1].max) === 4,
    '充能格数最高 4（基础 1 + 词缀 3）', ac.tiers.map((t) => 1 + Math.round(t.max)).join(','));
  ok(ar.tiers[0].max === 6 && ar.tiers[ar.tiers.length - 1].max === 30, '恢复时间档位 6% → 30%');
  ok(D.statText('dodgeCharges', 2) === '闪避充能 +2 次', '充能词缀的说明文本', D.statText('dodgeCharges', 2));
  ok(D.statText('dodgeRecharge', 18.3).indexOf('-18.3%') >= 0, '恢复时间词缀写成「减少」', D.statText('dodgeRecharge', 18.3));
  ok(D.STATS.dodgeCharges.kind === 'flat' && D.STATS.dodgeRecharge.kind === 'pct', '两条属性已登记进 D.STATS');

  /* ---- 三个位移技能的 25 级分支 ---- */
  [['barb', 'barb_leap'], ['sorc', 'sorc_teleport'], ['rogue', 'rogue_shadow']].forEach(([cls, sid]) => {
    const br = D.skillBranches(sid)[25];
    const sw = br.filter((b) => b.mods && b.mods.swapDodge)[0];
    ok(br.length === 3 && !!sw && sw.name === '替换基础闪避', cls + ' 的位移技能 25 级分支含「替换基础闪避」',
      br.map((b) => b.name).join(' / '));
    ok(!!sw && sw.text.length > 0 && sw.text[0].indexOf('闪避键') >= 0 && sw.icon === '⤢',
      cls + ' 的分支说明与图标完整', sw && (sw.text[0] + ' | ' + sw.icon));
  });

  /* ---- 充能数学（走真实装备，验证 词缀 → S.derive → 充能） ---- */
  const g = new G.Game(20240607);
  G.GAME = g; G.UI.game = g;
  g.startClass('rogue', 0);
  const giveBoots = (pl, ch, rc) => {
    pl.gear.boots = {
      cat: 'equip', slot: 'boots', name: '测试之靴', rarity: 'rare', ilvl: 80, implicit: [], gems: [],
      affixes: [
        { id: 's_dodgeCharges', stat: 'dodgeCharges', value: ch == null ? 3.4 : ch },
        { id: 's_dodgeRecharge', stat: 'dodgeRecharge', value: rc == null ? 18 : rc },
      ],
    };
    S.derive(pl);
  };
  const p = g.player;
  ok(p.dodgeCharge === null, '新建角色还没有充能（首次更新补满）');
  ok(S.dodgeMax(p) === 1 && Math.abs(S.dodgeRechargeTime(p) - 2) < 0.001, '默认 1 格、2 秒回满', S.dodgeRechargeTime(p));
  ok(S.dodgeSwapSkill(p) === null, '没选分支时闪避键不替换');
  giveBoots(p);
  ok(S.dodgeMax(p) === 4, '词缀 +3 → 4 格充能', S.dodgeMax(p));
  ok(Math.abs(p.stats.dodgeRechargeMul - 0.82) < 0.001, '恢复时间 -18% → 系数 0.82', p.stats.dodgeRechargeMul);
  ok(Math.abs(S.dodgeRechargeTime(p) - 2 * 0.82) < 0.001, '基础闪避回充 = 2 × 0.82', S.dodgeRechargeTime(p));
  p.gear.boots.affixes[1].value = 999;
  S.derive(p);
  ok(Math.abs(p.stats.dodgeRechargeMul - 0.4) < 0.001, '恢复时间最多只减 60%', p.stats.dodgeRechargeMul);
  p.gear.boots.affixes[1].value = 18;

  const sid = 'rogue_shadow';
  p.skills[sid] = 25;
  p.skillBranches = {};
  p.skillBranches[sid] = { 25: sid + ':25:1' };
  S.derive(p);
  ok(S.dodgeSwapSkill(p) === sid, '选了「替换基础闪避」→ 闪避键替换成影袭');
  ok(Math.abs(S.dodgeRechargeTime(p) - 5 * 0.82) < 0.01, '回充时间改用技能冷却（5 秒）', S.dodgeRechargeTime(p));
  p.gear.amulet = {
    cat: 'equip', slot: 'amulet', name: '测试护符', rarity: 'rare', ilvl: 80, implicit: [], gems: [],
    affixes: [{ id: 's_cdr', stat: 'cdr', value: 20 }],
  };
  S.derive(p);
  ok(Math.abs(S.dodgeRechargeTime(p) - 5 * 0.8 * 0.82) < 0.01, '技能冷却受冷却缩减影响', S.dodgeRechargeTime(p));
  p.gear.amulet = null;
  S.derive(p);
  p.skills[sid] = 20;
  ok(S.dodgeSwapSkill(p) === null, '技能等级掉下 25 → 分支失效、恢复翻滚');
  p.skills[sid] = 25;

  /* ---- 冷却绕行 + 闪避键真的改放技能 ---- */
  g.enterFloor(1);
  const p2 = g.player;
  giveBoots(p2);
  p2.skills[sid] = 25;
  p2.skillBranches = {};
  p2.skillBranches[sid] = { 25: sid + ':25:1' };
  p2.mana = 999;
  S.derive(p2);
  p2.cds[sid] = 5;
  const aimPt = { x: p2.x + 200, y: p2.y };
  ok(G.Skills.cast(g, p2, sid, aimPt) === false, '冷却中：技能栏施放被拦下');
  ok(G.Skills.cast(g, p2, sid, aimPt, { ignoreCd: true }) === true, '冷却中：闪避键（ignoreCd）能放出来');
  ok(p2.cds[sid] > 0, '放完照样进冷却（技能栏照常显示）');

  const key = G.Settings.getBind('dodge');
  const aimFn = g.aimWorld;
  g.aimWorld = () => ({ x: p2.x + 150, y: p2.y });
  p2.dodgeCharge = 2; p2.cds[sid] = 0; p2.dodgeTimer = 0;
  const from = { x: p2.x, y: p2.y };
  G.input.simulate(key);
  g.update(1 / 60);
  G.input.simulateUp(key);
  ok(p2.dodgeTimer <= 0, '替换后按闪避不再走翻滚位移', p2.dodgeTimer);
  ok(Math.abs(p2.dodgeCharge - 1) < 0.05, '释放消耗 1 格充能并开始回充', p2.dodgeCharge);
  ok(G.dist(from.x, from.y, p2.x, p2.y) > 20 || p2.cds[sid] > 0, '影袭确实被释放出来了',
    '位移 ' + G.dist(from.x, from.y, p2.x, p2.y).toFixed(1));

  /* 没选分支 → 依旧是翻滚；充能不足 → 按了没反应 */
  const p3 = g.player;
  giveBoots(p3);
  p3.skillBranches = {};
  S.derive(p3);
  p3.dodgeCharge = 2; p3.dodgeTimer = 0;
  G.input.simulate(key);
  g.update(1 / 60);
  G.input.simulateUp(key);
  ok(p3.dodgeTimer > 0, '没选分支时闪避键仍是翻滚');
  ok(Math.abs(p3.dodgeCharge - 1) < 0.05, '翻滚同样消耗 1 格充能', p3.dodgeCharge);
  p3.dodgeTimer = 0; p3.dodgeCharge = 0.2;
  G.input.simulate(key);
  g.update(1 / 60);
  G.input.simulateUp(key);
  ok(p3.dodgeTimer <= 0, '充能不足时按闪避没有反应');
  /* 充能会随时间回满 */
  p3.dodgeCharge = 0;
  p3.invuln = 60;                    // 免得练功房里的怪把小号打死、充能停在半路
  const dmax3 = S.dodgeMax(p3);
  for (let i = 0; i < Math.ceil(S.dodgeRechargeTime(p3) * dmax3 * 60) + 4; i++) g.update(1 / 60);
  ok(p3.dodgeCharge >= dmax3 - 0.001, '时间过后充能回满', p3.dodgeCharge + ' / ' + dmax3);
  g.aimWorld = aimFn;

  /* ---- 头顶血条 / 蓝条 + 脚下闪避条 ---- */
  const shot = [];
  const recCtx = {
    fillStyle: '#000', strokeStyle: '#000', shadowColor: '#000', shadowBlur: 0, globalAlpha: 1,
    fillRect(x, y, w, h) {
      [x, y, w, h].forEach((v) => { if (!Number.isFinite(v)) throw new Error('状态条画出了非有限数'); });
      shot.push([x, y, w, h]);
    },
  };
  G.Settings.data.hpBar = true; G.Settings.data.manaBar = true; G.Settings.data.dodgeBar = true;
  G.Render.drawPlayerBars(recCtx, p2);
  const head = shot.filter((r) => r[1] < p2.y), feet = shot.filter((r) => r[1] > p2.y);
  ok(head.length === 6, '头顶两根条（各含底槽、内槽与填充）', head.length);
  const pipX = new Set(feet.filter((r) => r[3] === 4).map((r) => Math.round(r[0] * 100) / 100));
  ok(pipX.size === 4, '脚下按充能格数画出 4 格', pipX.size);
  ok(feet.filter((r) => r[3] === 6).length === 1, '脚下闪避条带 1 条整体底槽');
  p2.dodgeCharge = 0.5;
  shot.length = 0;
  G.Render.drawPlayerBars(recCtx, p2);
  const half = shot.filter((r) => Math.abs(r[3] - 4) < 0.001 && r[2] < 7);
  ok(half.length === 1 && Math.abs(half[0][2] - 4) < 0.001, '正在回充的格子按比例填充',
    half.length + ' 块 / ' + (half[0] && half[0][2]));
  p2.dodgeCharge = p2.stats.dodgeMax;
  const hp = head[0], mana = head[4];
  const barY = p2.y - (p2.jumpHeight || 0);
  ok(hp[1] < mana[1], '血条在上、蓝条在下', hp[1] + ' < ' + mana[1]);
  ok(Math.abs(hp[0] + hp[2] / 2 - p2.x) < 0.001 && Math.abs(mana[1] + mana[3] - (barY - 26)) < 0.001,
    '状态条水平居中并贴在人物头顶上方', mana[1] + '~' + (mana[1] + mana[3]));
  G.Settings.data.hpBar = false; G.Settings.data.manaBar = false; G.Settings.data.dodgeBar = false;
  shot.length = 0;
  G.Render.drawPlayerBars(recCtx, p2);
  ok(shot.length === 0, '三个开关全关后什么都不画');
  G.Settings.data.hpBar = true; G.Settings.data.manaBar = true; G.Settings.data.dodgeBar = true;
  p2.life = 1;
  shot.length = 0;
  G.Render.drawPlayerBars(recCtx, p2);
  const hpFill = shot[2];
  ok(hpFill[2] < 6 && hpFill[2] >= 1, '残血时血条只剩一小截（且至少 1 像素）', hpFill[2].toFixed(2));
  p2.life = p2.stats.maxLife;

  /* ---- 设置项本身 ---- */
  ok(G.Settings.SHOWS.map((s) => s.name).join('|') ===
    '在人物头顶显示血条|在人物头顶显示蓝条|在人物脚下显示闪避条', '设置面板的三项名称正确',
    G.Settings.SHOWS.map((s) => s.name).join('|'));
  const dflt = G.Settings.defaults();
  ok(dflt.hpBar === true && dflt.manaBar === true && dflt.dodgeBar === true, '三项默认开启');
  G.Settings.setShow('hpBar', false);
  G.Settings.save();
  ok(G.Settings.load().hpBar === false, '开关会存进 localStorage');
  G.UI.renderSettings();
  ok(G.el('btn-hpbar').textContent.indexOf('关') >= 0 && G.el('btn-manabar').textContent.indexOf('开') >= 0,
    '设置面板上的按钮会显示当前状态', G.el('btn-hpbar').textContent);
  G.Settings.setShow('hpBar', true);
  G.Settings.save();
  ok(G.Settings.show('hpBar') === true && G.Settings.setShow('不存在的项', true) === false,
    '开关可以改回来，非法键被拒绝');
  report('闪避充能：1 格基础 + 词缀最多 3 格，回充受「闪避恢复时间」与技能冷却影响，闪避键可改放位移技能');

/* ============================================================ */
section('22. 一键卖/分解 · 背包扩容 · 过滤器改版 · 训练场 · 武器攻速归一');
{
  const tb = new G.Game(515150);
  G.GAME = tb; G.UI.game = tb;
  tb.startClass('barb', 0);
  const p = tb.player;
  const mkE = (r, ilvl) => G.Loot.makeItem(tb.rng, { ilvl: ilvl || 30, slot: 'helm', rarity: r || 'rare' });
  const gemItem = (r) => { const it = mkE(r); it.sockets = 1; it.gems = [{ gem: 'ruby', tier: 0 }]; return it; };

  /* ---- 背包扩容：仓库每级 +5 格 ---- */
  ok(G.DATA.BUILDING_BAG_CAP(1) === 60 && G.DATA.BUILDING_BAG_CAP(3) === 70 && G.DATA.BUILDING_BAG_CAP(5) === 80,
    '背包容量 60 / 70 / 80', [1, 3, 5].map(G.DATA.BUILDING_BAG_CAP).join(','));
  ok(G.Town.bagCap(p) === 60, '1 级仓库 = 60 格');
  p.town.buildings.vault = 3;
  ok(G.Town.growBag(p) === 10 && p.inventory.length === 70, '仓库升级把背包补到 70 格', p.inventory.length);
  G.UI.refreshInventory();
  ok(G.el('inv-grid').children.length === 70 && G.el('inv-cap').textContent === '背包 70 格',
    '背包格子与容量提示同步', G.el('inv-grid').children.length);
  p.inventory[5] = mkE('common', 20);
  G.UI.sortInventory();
  ok(p.inventory.length === 70, '整理背包不会把仓库扩容换来的格子吃掉', p.inventory.length);
  p.town.buildings.vault = 1;
  p.inventory = new Array(60).fill(null);

  /* ---- 一键分解 / 一键卖出：跳过镶宝石的、宝石与通货不动 ---- */
  for (let i = 0; i < 5; i++) p.inventory[i] = mkE('common', 20 + i);
  p.inventory[5] = mkE('unique', 40);
  const keep = gemItem('rare');
  p.inventory[6] = keep;
  p.inventory[7] = { cat: 'gem', name: '碎裂的红宝石', gem: 'ruby', tier: 0, count: 2 };
  p.inventory[8] = { cat: 'orb', orb: 'chaos', name: '混沌石', count: 1 };
  p.shards = 0; p.gold = 500;
  G.UI.salvageAll();
  ok(G.el('panel-confirm').hidden === false && G.el('confirm-text').textContent.indexOf('6 件') >= 0,
    '一键分解先弹确认框并报件数', G.el('confirm-text').textContent.slice(0, 40));
  G.UI.salvageAllRun();
  ok(p.shards > 0 && p.inventory.filter(Boolean).length === 3, '一键分解拿走全部装备（含暗金）', p.inventory.filter(Boolean).length);
  ok(p.inventory[6] === keep && p.inventory[7] && p.inventory[8], '镶宝石装备 / 宝石 / 通货石都留着');
  p.inventory[9] = mkE('rare', 35);
  const gold0 = p.gold;
  G.UI.sellAllEquip();
  ok(G.el('panel-confirm').hidden === false, '一键卖出先弹确认框');
  G.UI.confirmResolve(true);
  ok(p.gold > gold0 && p.inventory[9] === null, '一键卖出把装备换成金币', p.gold - gold0);
  ok(p.inventory[7] && p.inventory[8] && p.inventory[6] === keep, '一键卖出不碰宝石 / 通货 / 镶宝石装备');

  /* ---- 单件操作先询问 ---- */
  p.inventory[10] = gemItem('magic');
  const shards1 = p.shards, gold1 = p.gold;
  G.UI.salvageAt(10);
  ok(p.inventory[10] && p.shards === shards1 && G.el('panel-confirm').hidden === false, '点分解镶宝石装备先问一次');
  G.UI.closeConfirm();
  ok(p.inventory[10] && G.UI._confirmCb === null, '取消后装备还在、回调不残留');
  G.UI.sellInv(10);
  ok(p.inventory[10] && p.gold === gold1, '点卖镶宝石装备也先问一次');
  G.UI.confirmResolve(true);
  ok(p.inventory[10] === null && p.gold > gold1, '确认后才真的卖掉', p.gold - gold1);

  /* ---- 分解界面 = 背包网格 ---- */
  G.UI.renderBlacksmith();
  ok(G.el('bs-grid').children.length === p.inventory.length, '分解界面铺的是整个背包', G.el('bs-grid').children.length);
  ok(G.el('bs-sum').textContent.indexOf('可分解') >= 0, '有可分解件数与残晶合计', G.el('bs-sum').textContent.slice(0, 24));

  /* ---- 装备栏不会被长名字撑大 ---- */
  const dollRules = css.split('.gear-doll{').slice(1).map((r) => r.slice(0, 220));
  ok(dollRules.some((r) => r.indexOf('min-width:0') >= 0 && r.indexOf('overflow:hidden') >= 0),
    '装备栏限制最小宽度 / 溢出（不会被长文本撑开）', dollRules.length + ' 条规则');
  const slotRules = css.split('.gear-doll>.slot-equip{').slice(1).map((r) => r.slice(0, 140));
  ok(slotRules.length > 0 && slotRules.every((r) => r.indexOf('min-width:0') >= 0),
    '装备格子自身也允许收缩', slotRules.join(' | '));

  /* ---- 过滤器：新规则置顶 / 拖拽 / 勾选词缀 ---- */
  const F = G.Filter;
  F.data.rules = [];
  F.insertRule({ action: 'hide', enabled: true, conds: [{ type: 'rarity', op: 'is', value: 'common' }] });
  F.insertRule({ action: 'show', enabled: true, conds: [{ type: 'ilvl', op: '>=', value: 50 }] });
  ok(F.data.rules[0].action === 'show', '新规则放在第 1 条');
  ok(F.moveRuleTo(0, 1) && F.data.rules[0].action === 'hide' && F.moveRuleTo(1, 0) && F.data.rules[0].action === 'show',
    '拖拽排序生效（moveRuleTo）');
  ok(F.moveRuleTo(9, 0) === false, '越界拖动不处理');
  const c1 = { type: 'affix', op: 'has', value: 2, affixIds: ['p_str', 'p_dex', 's_life'] };
  const withAffixes = (ids) => ({ cat: 'equip', slot: 'helm', affixes: ids.map((id) => ({ id: id, stat: 'str', value: 1, kind: 'prefix', name: 'x' })) });
  ok(F.matchCond(withAffixes(['p_str', 'p_dex']), c1, {}) === true, '命中 2 条 → 通过');
  ok(F.matchCond(withAffixes(['p_str']), c1, {}) === false, '只命中 1 条 → 不通过');
  ok(F.matchCond(withAffixes([]), { type: 'affix', op: 'has', value: 1, affixIds: [] }, {}) === true, '未勾选时不参与筛选');
  ok(F.migrateConds([{ type: 'affix', op: 'has', value: '暴击' }]).length === 0, '老的文字词缀条件被清空');
  const poolHelm = F.affixPool([{ type: 'slot', op: 'is', value: 'helm' }], true).map((a) => a.id);
  const poolBoots = F.affixPool([{ type: 'slot', op: 'is', value: 'boots' }], true).map((a) => a.id);
  ok(poolHelm.indexOf('s_dodgeCharges') < 0 && poolBoots.indexOf('s_dodgeCharges') >= 0,
    '冲突隐藏：头盔里看不到靴子专属词缀，靴子里能看到');
  ok(F.affixPool([{ type: 'slot', op: 'is', value: 'helm' }], false).length === G.DATA.AFFIXES.length,
    '关掉开关后列出全部词缀');
  F.data.rules = [{ action: 'hide', enabled: true, conds: [c1] }];
  G.UI.renderFilter();
  const card = G.el('filter-rules').children[0];
  ok(!!card && card.draggable === true, '规则卡片可拖拽');
  ok(String(card.innerHTML).indexOf('data-act="pickAffix"') >= 0 && String(card.innerHTML).indexOf('至少包含') >= 0,
    '细则里有「选择词缀」按钮与「至少包含 N 条」输入框');
  G.UI.openAffixPick(0, 0);
  ok(G.el('affix-pick').hidden === false && G.UI.affixSel.length === 3, '勾选面板打开并带入已选词缀');
  G.UI.toggleAffix('p_str', false);
  G.UI.confirmAffixPick();
  ok(F.data.rules[0].conds[0].affixIds.length === 2 && G.el('affix-pick').hidden === true, '确定后写回规则并关闭');
  F.data.rules = [];

  /* ---- 训练场 ---- */
  const gm = G.Dungeon.makeTraining(tb.rng, { mode: 'multi' });
  ok(gm.w === 30 && gm.h === 20 && gm.dummySpots.length === 3 && !!gm.townPortal, '训练场地图生成正常');
  ok(G.Dungeon.solidAtWorld(gm, gm.playerStart.x, gm.playerStart.y) === false &&
    G.Dungeon.solidAtWorld(gm, 22, 22) === true, '出生点空地、四周是墙');
  tb.enterFloor(3);
  const floorMonsters = tb.monsters.length;
  ok(tb.enterTraining('multi') === true && tb.area === 'training' && tb.monsters.length === 3, '进入训练场并刷出 3 个假人');
  ok(tb.floorCache && tb.floorCache.floor === 3 && tb.floorCache.monsters.length === floorMonsters,
    '进练功房前先把深渊这一层存好', tb.floorCache && tb.floorCache.monsters.length);
  const dummy = tb.monsters[0];
  ok(dummy.dummy === true && dummy.maxLife > 1e11 && dummy.dmg === 0 && dummy.aggro === false, '假人血厚 / 无伤 / 不仇恨');
  const dpos = { x: dummy.x, y: dummy.y };
  for (let i = 0; i < 120; i++) tb.update(1 / 60);
  ok(Math.abs(dummy.x - dpos.x) < 0.01 && Math.abs(dummy.y - dpos.y) < 0.01, '假人原地不动');
  const comps = G.Stats.attackComponents(p, G.Stats.skillShape(p, G.DATA.SKILLS.barb_rend), 5);
  let dealt = 0;
  for (let i = 0; i < 10; i++) dealt += G.Combat.hitMonster(tb, dummy, comps, {});
  for (let i = 0; i < 3; i++) tb.update(1 / 60);
  ok(dealt > 0 && dummy.dead === false && dummy.life === dummy.maxLife, '假人打不死', Math.round(dealt));
  ok(tb.killed === 0 && tb.portalOpen === false, '训练场不计击杀、不开传送门');
  ok(tb.train && tb.train.total > 0 && tb.trainDps(5) > 0, 'DPS 统计在跑', tb.train && Math.round(tb.train.total));
  G.UI.updateHUD();
  ok(G.el('dps-box').hidden === false && G.el('hud-floor').textContent.indexOf('训练场') >= 0, '训练场显示 DPS 面板与顶栏');
  ok(G.UI.TOWN_ONLY.indexOf('panel-training') >= 0, '训练场面板限城镇打开');
  ok(tb.toTown('recall') === true && tb.area === 'town', '按 T 回城（假人不拦路）');
  G.UI.updateHUD();
  ok(G.el('dps-box').hidden === true, '离开训练场后 DPS 面板收起');
  ok(tb.floorCache && tb.floorCache.floor === 3, '层缓存仍然是深渊那一层');

  /* ---- 技能伤害按武器秒伤归一 ---- */
  const wpn = (min, max, aps) => ({
    cat: 'equip', slot: 'weapon', name: '测试武器', rarity: 'rare', ilvl: 60, base: 'x',
    min: min, max: max, aps: aps, kind: 'melee', two: false, affixes: [], implicit: [], gems: [], sockets: 0,
  });
  const total = (c) => c.physical + c.fire + c.cold + c.lightning + c.poison;
  const sk = G.Stats.skillShape(p, G.DATA.SKILLS.barb_rend);
  p.gear.weapon = wpn(15, 17, 1.0); G.Stats.derive(p);
  const slowDps = p.stats.weaponDps;
  const slowSkill = total(G.Stats.attackComponents(p, sk, 5));
  const slowBasic = total(G.Stats.attackComponents(p, G.DATA.SKILLS.barb_basic, 5));
  p.gear.weapon = wpn(9, 11, 1.6); G.Stats.derive(p);
  const fastDps = p.stats.weaponDps;
  const fastSkill = total(G.Stats.attackComponents(p, sk, 5));
  const fastBasic = total(G.Stats.attackComponents(p, G.DATA.SKILLS.barb_basic, 5));
  ok(Math.abs(slowDps - fastDps) < 0.01, '两把武器秒伤相同', slowDps.toFixed(2) + ' / ' + fastDps.toFixed(2));
  ok(Math.abs(slowSkill - fastSkill) < 0.001, '同秒伤 → 技能伤害一致（慢武器不再白赚）',
    slowSkill.toFixed(2) + ' / ' + fastSkill.toFixed(2));
  ok(slowBasic > fastBasic * 1.4, '普通攻击仍是慢武器单发更高', slowBasic.toFixed(1) + ' / ' + fastBasic.toFixed(1));
  ok(G.BALANCE.skillRefAps === 1.16, '基准攻速写在 G.BALANCE 里（可调）');
  p.gear.weapon = null; G.Stats.derive(p);
  /* ---- 界面细节：分解按钮排成一行 / 弹窗居中 / 确认框不关原界面 / 商人批量卖 ---- */
  const bsAt = html.indexOf('<div class="bs-btns">');
  const bsRow = bsAt < 0 ? '' : html.slice(bsAt, html.indexOf('</div>', bsAt));
  ok(bsAt > 0 && (bsRow.match(/<button/g) || []).length === 4, '四个分解按钮在同一个按钮行里',
    (bsRow.match(/<button/g) || []).length + ' 个');
  ok(html.slice(html.indexOf('<div class="bs-head">'), bsAt).indexOf('<button') < 0, '信息行里不再混按钮');
  const bsCss = css.slice(css.indexOf('.bs-btns{'), css.indexOf('.bs-btns{') + 180);
  ok(bsCss.indexOf('flex-wrap:nowrap') >= 0 && bsCss.indexOf('overflow-x:auto') >= 0, '按钮行不换行（窄窗口横向滚动）');
  const cfAt = css.indexOf('#panel-confirm{');
  const cfCss = cfAt < 0 ? '' : css.slice(cfAt, cfAt + 220);
  ok(cfCss.indexOf('left:50%') >= 0 && cfCss.indexOf('translate(-50%,-50%)') >= 0 && cfCss.indexOf('z-index:70') >= 0,
    '确认框居中且盖在面板之上', cfCss.slice(0, 56));
  const trAt = css.indexOf('#panel-training{');
  ok(trAt > 0 && css.slice(trAt, trAt + 120).indexOf('translate(-50%,-50%)') >= 0, '训练场面板居中');
  ok(html.indexOf('卖出白装') >= 0 && html.indexOf('卖出魔法及以下') >= 0 && html.indexOf('一键卖出所有装备') >= 0,
    '商人面板有白装 / 魔法及以下 / 所有装备三个按钮');
  const sellBtns = html.slice(html.indexOf('<footer class="inv-foot sell-btns">'), html.indexOf('</footer>', html.indexOf('inv-foot sell-btns')));
  ok(sellBtns.indexOf('btn-sell-junk') < sellBtns.indexOf('btn-sell-magic') &&
    sellBtns.indexOf('btn-sell-magic') < sellBtns.indexOf('btn-sell-all'),
    '按钮顺序：白装 → 魔法及以下 → 所有装备');
  ok(/\.inv-foot\.sell-btns\{[^}]*flex-wrap:nowrap/.test(css) &&
    /\.inv-foot\.sell-btns \.btn\{[^}]*white-space:nowrap/.test(css), '卖出按钮排成一行且文字不折行');

  p.inventory = new Array(60).fill(null);
  for (let i = 0; i < 3; i++) p.inventory[i] = mkE('common', 20);
  p.inventory[3] = mkE('magic', 25);
  p.inventory[4] = mkE('rare', 30);
  p.inventory[5] = gemItem('magic');
  p.gear.helm = G.Loot.makeItem(tb.rng, { ilvl: 70, slot: 'helm', rarity: 'rare' });
  G.Stats.derive(p);
  G.UI.togglePanel('panel-vendor', true);
  G.UI.sellAllEquip();
  ok(G.el('panel-confirm').hidden === false && G.UI.open === 'panel-vendor' && G.el('panel-vendor').hidden === false,
    '一键卖出的确认框不会把商人界面关掉', G.UI.open);
  G.UI.confirmResolve(true);
  ok(G.UI.open === 'panel-vendor' && G.el('panel-vendor').hidden === false, '确认之后商人界面依旧开着');
  p.gold = 0;
  p.inventory[6] = mkE('common', 22);
  p.inventory[7] = mkE('magic', 26);
  p.inventory[8] = gemItem('magic');
  G.UI.sellJunkRarities(['common'], false);
  ok(p.inventory[6] === null && p.inventory[7] && p.inventory[8], '「卖出白装」只卖白装，宝石件留下');
  G.UI.sellJunkRarities(['common', 'magic'], true);
  ok(p.inventory[7] === null && p.inventory[8] && p.gold > 0, '「魔法及以下」卖掉比身上差的，保留镶宝石的');
  G.UI.togglePanel('panel-vendor', false);
  ok(G.el('panel-confirm').hidden === true, '关掉商人界面时确认框一并收起');
  F.data.rules = [{ action: 'hide', enabled: true, conds: [{ type: 'affix', op: 'has', value: 1, affixIds: [] }] }];
  G.UI.openAffixPick(0, 0);
  ok(G.UI.closeAffixPick() === true && G.UI.closeAffixPick() === false, '词缀面板的关闭函数返回 true / 重复关闭返回 false');

  /* ---- 过滤器细则下拉 / 冲突隐藏 / 词缀文案 ---- */
  ok(F.condType('affix').ops.length === 1 && F.condType('type').ops.length === 1 &&
    F.condType('twoHand').ops.length === 1 && F.condType('canEquip').ops.length === 1,
    '只有一种判定方式的细则不再显示比较方式下拉');
  ok(F.condType('ilvl').ops.length === 3 && F.condType('slot').ops.length === 2, '其它细则仍有多个选项');
  F.data.rules = [{
    action: 'hide', enabled: true, conds: [
      { type: 'type', op: 'is', value: 'dagger' },
      { type: 'affix', op: 'has', value: 1, affixIds: ['p_str'] },
      { type: 'ilvl', op: '>=', value: 50 },
    ],
  }];
  G.UI.renderFilter();
  ok((String(G.el('filter-rules').children[0].innerHTML).match(/data-field="op"/g) || []).length === 1,
    '三个细则里只剩一个带比较方式下拉',
    (String(G.el('filter-rules').children[0].innerHTML).match(/data-field="op"/g) || []).length + ' 个');
  const poolType = F.affixPool([{ type: 'type', op: 'is', value: 'dagger' }], true);
  ok(poolType.length > 0 && poolType.length < G.DATA.AFFIXES.length,
    '选了装备类型后仍有可选词缀（不会再全被隐藏）', poolType.length + ' / ' + G.DATA.AFFIXES.length);
  const unlimAffix = G.DATA.AFFIXES.filter((a) => !a.slots || !a.slots.length)[0];
  ok(poolType.some((a) => a.id === unlimAffix.id), '不限部位的词缀留在可选池里', unlimAffix.id);
  const lblOf = (id) => F.affixLabel(G.DATA.affixById[id]);
  ok(lblOf('p_skill') === '+技能等级', '「专精之」显示 +技能等级', lblOf('p_skill'));
  ok(lblOf('p_armor') === '+护甲' && lblOf('p_armorPct') === '护甲%', '固定护甲 / 百分比护甲区分开',
    lblOf('p_armor') + ' | ' + lblOf('p_armorPct'));
  const addFireA = G.DATA.AFFIXES.filter((a) => a.stat === 'addFire')[0];
  const fireDmgA = G.DATA.AFFIXES.filter((a) => a.stat === 'fireDmg')[0];
  ok(F.affixLabel(addFireA) === '+火焰伤害' && F.affixLabel(fireDmgA) === '火焰伤害%',
    '附加火焰伤害 / 火焰伤害% 区分开', F.affixLabel(addFireA) + ' | ' + F.affixLabel(fireDmgA));
  F.data.rules = [];

  report('一键卖/分解、背包扩容、过滤器改版、训练场、攻速归一均已覆盖');
}

}


/* 源码编码检查：防止编辑器/脚本把中文写坏成乱码 */
const encFiles = fs.readdirSync(path.join(__dirname, '..', 'js')).map((f) => 'js/' + f)
  .concat(['index.html', 'styles.css', 'README.md'])
  .concat(fs.readdirSync(__dirname).filter((f) => /\.js$/.test(f)).map((f) => 'tools/' + f));
const corrupted = encFiles.filter((f) => {
  const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  return s.indexOf('\uFFFD') >= 0;
});
ok(corrupted.length === 0, '源码全部是合法 UTF-8（无乱码字符）', corrupted.join(', '));
report('编码检查：' + encFiles.length + ' 个文件均为合法 UTF-8');

/* 结构检查：重复 id / CSS 括号平衡 / section 配对 */
const idList = (html.match(/id="([^"]+)"/g) || []).map((s) => s.slice(4, -1));
const dupIds = idList.filter((x, i) => idList.indexOf(x) !== i);
ok(dupIds.length === 0, 'index.html 没有重复 id', dupIds.join(', '));
let depth = 0, cssBad = 0;
for (let i = 0; i < css.length; i++) {
  if (css[i] === '{') depth++;
  else if (css[i] === '}') { depth--; if (depth < 0) { cssBad++; break; } }
}
ok(depth === 0 && cssBad === 0, 'styles.css 括号平衡', 'depth=' + depth);
const secOpen = (html.match(/<section/g) || []).length;
const secClose = (html.match(/<\/section>/g) || []).length;
ok(secOpen === secClose, '<section> 标签配对', secOpen + ' / ' + secClose);
report('结构检查：' + idList.length + ' 个 id 无重复，' + secOpen + ' 个面板标签配对');

/* ============================================================ */
console.log('\n' + '='.repeat(58));
console.log('  通过 ' + pass + ' 项　失败 ' + fail + ' 项');
if (fail) {
  console.log('\n\x1b[31m失败明细：\x1b[0m');
  failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
}
console.log('='.repeat(58));
process.exit(fail ? 1 : 0);
