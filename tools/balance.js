/* ============================================================
 *  数值平衡探针（多抽样平均，消除随机装备带来的噪声）
 *  用法：node tools/balance.js [职业] [抽样次数]
 * ============================================================ */
'use strict';
const path = require('path');
require(path.join(__dirname, 'smoke-shim.js'));
const G = globalThis.G;
const D = G.DATA;
const S = G.Stats;
const C = G.Combat;

const clsId = process.argv[2] || 'barb';
const SAMPLES = parseInt(process.argv[3] || '24', 10);
const rng = G.RNG(20240701);

/* 装备模型：
 *  realistic = 按真实掉落概率随机（mf=0），代表普通玩家的实际强度
 *  best      = 全身稀有，代表刷到好装备后的上限
 */
const GEAR_MODE = process.argv[4] || 'realistic';
function buildPlayer(level, floor, diffIdx) {
  const p = G.ENT.makePlayer({ rng, mlvl: 1, diffIdx: 0 }, clsId);
  p.level = level;
  const cls = D.classById(clsId);
  p.alloc = { str: 0, dex: 0, int: 0, vit: 0 };
  const pts = 3 * (level - 1);
  p.alloc[cls.primary] = Math.floor(pts * 0.6);
  p.alloc.vit = Math.floor(pts * 0.4);
  const actives = D.activeSkills(clsId);
  p.skills[actives[0]] = Math.min(25, Math.max(1, Math.floor(level / 3)));
  p.skills[actives[1]] = Math.min(25, Math.max(1, Math.floor(level / 4)));
  const mf = Math.min(250, level * 4);
  /* 装备按当前层数 / 难度的掉落阶段生成，代表这个进度下真实能捡到的东西 */
  const stage = G.Loot.rarityStage(floor, D.diffOf(diffIdx).quality);
  D.gearSlots().forEach((slot) => {
    const s = (slot === 'ring1' || slot === 'ring2') ? 'ring' : slot;
    const opts = { ilvl: level + 2, slot: s, cls: clsId, mf, stage };
    if (GEAR_MODE === 'best') opts.rarity = rng.chance(0.22) ? 'unique' : 'rare';
    p.gear[slot] = G.Loot.makeItem(rng, opts);
  });
  S.derive(p);
  p.life = p.stats.maxLife;
  return p;
}
function dpsOf(p, skillId) {
  const sk = D.SKILLS[skillId];
  const lv = Math.max(1, p.skills[skillId] | 0);
  const comps = C.attackComponents(p, sk, lv);
  let total = 0;
  for (const k in comps) total += comps[k];
  total *= 1 + p.stats.crit / 100 * (p.stats.critDmg / 100 - 1);
  return total / Math.max(0.25, (sk.cd || 0) * (1 - p.stats.cdr / 100) + 1 / p.stats.attackSpeed);
}
function monsterHp(mlvl, diffIdx, kind) {
  const def = D.monsterById.skeleton;
  const diff = D.diffOf(diffIdx);
  let hp = def.life * Math.pow(G.BALANCE.monsterLifeExp, mlvl) * diff.hp;
  if (kind === 'elite') hp *= G.BALANCE.eliteLife;
  return hp;
}
function bossHp(mlvl, diffIdx) {
  const diff = D.diffOf(diffIdx);
  return D.BOSSES[0].life * Math.pow(G.BALANCE.monsterLifeExp, mlvl) * diff.hp * (G.BALANCE.bossLife || 1.35);
}

console.log('职业: ' + D.classById(clsId).name + '　抽样 ' + SAMPLES + ' 次/采样点（装备按该进度的掉落阶段生成，等级=怪物等级）');
console.log('');
console.log(' 层数 |  难度  | mlvl |  生命  |  护甲  | 普攻DPS | 技能DPS | 小怪HP | 秒杀小怪 | 精英HP | 秒精英 | BOSS_HP | 秒BOSS | 小怪单次伤害 | 可承受次数');
console.log('-'.repeat(150));

/* 采样点：6 档难度 × 若干层数，怪物等级完全由 G.mlvlOf 决定 */
const POINTS = [
  { floor: 2, diff: 0 }, { floor: 9, diff: 0 }, { floor: 16, diff: 0 }, { floor: 24, diff: 0 },
  { floor: 5, diff: 1 }, { floor: 15, diff: 1 }, { floor: 28, diff: 1 },
  { floor: 10, diff: 2 }, { floor: 25, diff: 2 }, { floor: 38, diff: 2 },
  { floor: 15, diff: 3 }, { floor: 32, diff: 3 }, { floor: 46, diff: 3 },
  { floor: 25, diff: 4 }, { floor: 42, diff: 4 }, { floor: 56, diff: 4 },
  { floor: 35, diff: 5 }, { floor: 52, diff: 5 }, { floor: 70, diff: 5 }, { floor: 88, diff: 5 },
];
const rows = [];
POINTS.forEach((pt) => {
  const diffIdx = pt.diff;
  const diff = D.diffOf(diffIdx);
  const mlvl = G.mlvlOf(pt.floor, diffIdx);
  let life = 0, armor = 0, basic = 0, skill = 0, taken = 0, hits = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const p = buildPlayer(mlvl, pt.floor, diffIdx);
    const b = dpsOf(p, clsId + '_basic');
    let best = 0;
    D.activeSkills(clsId).forEach((id) => { const d = dpsOf(p, id); if (d > best) best = d; });
    const mDmg = D.monsterById.skeleton.dmg * Math.pow(G.BALANCE.monsterDmgExp, mlvl) * diff.dmg;
    const mit = S.armorMitigation(p.stats.armor, mlvl);
    const tk = Math.max(1, mDmg * (1 - mit) * (1 - p.stats.dmgReduce / 100));
    life += p.stats.maxLife; armor += p.stats.armor; basic += b; skill += best;
    taken += tk; hits += p.stats.maxLife / tk;
  }
  life /= SAMPLES; armor /= SAMPLES; basic /= SAMPLES; skill /= SAMPLES; taken /= SAMPLES; hits /= SAMPLES;
  const pdps = Math.max(basic, skill);
  const trashHp = monsterHp(mlvl, diffIdx, 'normal');
  const eliteHp = monsterHp(mlvl, diffIdx, 'elite');
  const bHp = bossHp(mlvl, diffIdx);
  const row = {
    floor: pt.floor, mlvl, life, armor, basic, skill, trashHp, trashTtk: trashHp / pdps,
    eliteHp, eliteTtk: eliteHp / pdps, bHp, bossTtk: bHp / pdps, taken, hits, diff: diff.name,
  };
  rows.push(row);
  console.log(
    String(pt.floor).padStart(5) + ' |' + diff.name.padStart(6) + '  |' +
    String(mlvl).padStart(5) + ' |' + String(Math.round(life)).padStart(8) + ' |' + String(Math.round(armor)).padStart(7) + ' |' +
    String(Math.round(basic)).padStart(8) + ' |' + String(Math.round(skill)).padStart(8) + ' |' +
    String(Math.round(trashHp)).padStart(7) + ' |' + row.trashTtk.toFixed(2).padStart(9) + ' |' +
    String(Math.round(eliteHp)).padStart(7) + ' |' + row.eliteTtk.toFixed(2).padStart(7) + ' |' +
    String(Math.round(bHp)).padStart(8) + ' |' + row.bossTtk.toFixed(1).padStart(7) + ' |' +
    String(Math.round(taken)).padStart(13) + ' |' + hits.toFixed(1).padStart(11));
});

/* ---- 判定：曲线是否平滑、是否落在可玩区间 ---- */
let bad = 0;
const check = (cond, msg) => { if (!cond) { console.log('  ! ' + msg); bad++; } };
/* 平滑度检查要按怪物等级递增来比较（采样点是按难度排的，等级并不单调） */
const byMlvl = rows.slice().sort((a, b) => a.mlvl - b.mlvl);
let prev = null;
byMlvl.forEach((r) => {
  const dps = Math.max(r.basic, r.skill);
  if (r.mlvl >= 8) {
    check(r.trashTtk > 0.1 && r.trashTtk < 4, 'mlvl ' + r.mlvl + ' 小怪击杀 ' + r.trashTtk.toFixed(2) + 's（目标 0.1-4）');
    check(r.eliteTtk > 0.3 && r.eliteTtk < 16, 'mlvl ' + r.mlvl + ' 精英击杀 ' + r.eliteTtk.toFixed(2) + 's（目标 0.3-16）');
    check(r.bossTtk > 5 && r.bossTtk < 95, 'mlvl ' + r.mlvl + ' BOSS 击杀 ' + r.bossTtk.toFixed(1) + 's（目标 5-95）');
    check(r.hits > 3 && r.hits < 45, 'mlvl ' + r.mlvl + ' 可承受 ' + r.hits.toFixed(1) + ' 次小怪攻击（目标 3-45）');
  }
  if (prev && r.mlvl - prev.mlvl >= 6) {
    const jump = Math.max(dps / prev.dps, prev.dps / dps);
    check(jump < 2.6, 'mlvl ' + prev.mlvl + '→' + r.mlvl + ' 伤害跳变 ' + jump.toFixed(2) + 'x（应 < 2.6x）');
  }
  prev = { mlvl: r.mlvl, dps: Math.max(1, dps) };
});
console.log('');
console.log(bad === 0 ? '✓ 曲线平滑且在可玩区间内' : ('✗ ' + bad + ' 项未通过'));
