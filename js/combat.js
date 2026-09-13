/* ============================================================
 *  暗影深渊 · combat.js
 *  伤害结算 / 状态效果 / 技能释放 / 暗金特效 / BOSS 技能
 * ============================================================ */
(function (root) {
  'use strict';
  const G = root.G;
  const D = G.DATA;
  const S = G.Stats;
  const L = G.Loot;
  const C = (G.Combat = {});
  const SK = (G.Skills = {});
  const rng = () => G.rng;

  /* ---------------- 暗金特效集合 ---------------- */
  C.powers = function (player) {
    const set = new Set();
    if (!player || !player.gear) return set;
    D.gearSlots().forEach((s) => {
      const it = player.gear[s];
      if (!it) return;
      if (it.power) { set.add(it.power); return; }
      if (it.unique) {
        const u = D.uniqueById[it.unique];
        if (u) set.add(u.power);
      }
    });
    return set;
  };

  /* ---------------- 玩家伤害总倍率（含动态特效） ---------------- */
  C.playerDamageMult = function (player) {
    let m = 1;
    const st = player.stats;
    if (st.powers && st.powers.has('berserk') && player.life / st.maxLife < 0.35) m *= 1.6;
    return m;
  };

  C.attackComponents = function (player, skill, level) {
    const comps = S.attackComponents(player, skill, level);
    const sk = skill || {};
    const mods = sk.mods || S.skillMods(player, sk.id);
    // 分支伤害加成（毒云这类地面持续技能把 dot 也算作伤害）
    const dmgPct = (mods.dmg || 0) + (sk.type === 'ground' ? (mods.dot || 0) : 0);
    if (dmgPct) for (const k in comps) comps[k] *= 1 + dmgPct / 100;
    // 元素转化
    if (mods.elem) {
      const main = sk.elem || 'physical';
      let used = 0;
      for (const e in mods.elem) {
        if (e === main) continue;
        const frac = G.clamp(mods.elem[e], 0, 1 - used);
        if (!(frac > 0)) continue;
        used += frac;
        const move = (comps[main] || 0) * frac;
        comps[main] -= move;
        const ratio = (1 + (player.stats.elemBonus[e] || 0)) / (1 + (player.stats.elemBonus[main] || 0));
        comps[e] = (comps[e] || 0) + move * ratio;
      }
    }
    const m = C.playerDamageMult(player);
    if (m !== 1) for (const k in comps) comps[k] *= m;
    return comps;
  };

  C.healPlayer = function (game, amount) {
    const p = game.player;
    if (p.dead || amount <= 0) return;
    p.life = Math.min(p.stats.maxLife, p.life + amount);
  };

  /* ---------------- 对怪物造成伤害 ---------------- */
  C.hitMonster = function (game, m, comps, opts) {
    opts = opts || {};
    if (m.dead) return 0;
    const fromPlayer = opts.source !== 'monster';
    // 闪避
    if (fromPlayer && m.dodgeChance && G.rng.next() * 100 < m.dodgeChance) {
      G.FX.text(game, m.x, m.y - m.r - 10, '闪避', '#cfcfcf', 12);
      return 0;
    }
    let mult = opts.mult || 1;
    let crit = false;
    const md = fromPlayer ? opts.mods : null;      // 技能强化分支修饰符
    if (fromPlayer && !opts.isDot && opts.canCrit !== false) {
      const critChance = game.player.stats.crit + (md && md.crit ? md.crit : 0);
      if (G.rng.next() * 100 < critChance) {
        crit = true;
        mult *= (game.player.stats.critDmg + (md && md.critDmg ? md.critDmg : 0)) / 100;
      }
    }
    if (md && md.vsBoss && m.isBoss) mult *= 1 + md.vsBoss / 100;
    if (md && md.execute && m.maxLife > 0 && m.life / m.maxLife <= md.execute.hp / 100) mult *= 1 + md.execute.dmg / 100;
    if (m.vuln && m.vuln.remaining > 0) mult *= 1 + m.vuln.pct / 100;

    let total = 0;
    for (const k in comps) {
      const raw = comps[k] * mult;
      if (!(raw > 0)) continue;
      let mit;
      if (k === 'physical') mit = S.armorMitigation(m.armor, m.mlvl || 1);
      else mit = Math.max(0, S.resistMitigation((m.res && m.res[k]) || 0));
      total += raw * (1 - mit);
    }
    if (!(total > 0)) return 0;
    total = Math.round(total);

    m.life -= total;
    m.hitFlash = 0.13;
    m.aggro = true;
    m.dmgTaken = (m.dmgTaken || 0) + total;
    m.lastHitBy = fromPlayer ? 'player' : 'other';
    // 训练场：把玩家打出的伤害记进 DPS 统计
    if (fromPlayer && game.area === 'training' && game.trainHit) game.trainHit(total, crit);

    G.FX.hit(game, m.x, m.y - m.r * 0.4, opts.elem || 'physical', total);
    G.FX.text(game, m.x + G.rand(-8, 8), m.y - m.r - 12, total, crit ? '#ffe45c' : (G.ELEM_COLOR[opts.elem] || '#f0e6d2'), crit ? 21 : 14, crit);
    if (crit) G.audio.play('crit'); else if (G.chance(0.5)) G.audio.play('hit');
    if (opts.knockback && !m.isBoss) {
      const a = G.ang(game.player.x, game.player.y, m.x, m.y);
      m.kx = Math.cos(a) * opts.knockback; m.ky = Math.sin(a) * opts.knockback;
    }
    if (opts.slow) C.applySlow(game, m, opts.slow, opts.slowDur || 2);
    if (opts.dot) C.applyDot(game, m, opts.dot, true);

    if (fromPlayer && !opts.isDot) {
      const p = game.player;
      if (p.stats.lifeOnHit) C.healPlayer(game, p.stats.lifeOnHit);
      if (p.stats.lifeSteal) C.healPlayer(game, total * p.stats.lifeSteal / 100);
      // 法力偷取：按造成的伤害回复法力
      if (p.stats.manaSteal) p.mana = Math.min(p.stats.maxMana, p.mana + total * p.stats.manaSteal / 100);
      // 技能强化分支：生命偷取 / 附带元素效果 / 溅射
      if (md) {
        if (md.leech) C.healPlayer(game, total * md.leech / 100);
        if (md.burn) C.applyDot(game, m, { key: 'ignite', elem: 'fire', dps: total * (md.burn.mult || 0.3), dur: md.burn.dur || 3 }, true);
        if (md.chill) C.applySlow(game, m, md.chill.slow || 0.25, md.chill.dur || 2);
        if (md.splash && !opts.noSplash) {
          const R = md.splashRadius || 80;
          const pct = md.splash / 100;
          game.monsters.slice().forEach((o) => {
            if (o === m || o.dead) return;
            if (G.dist(m.x, m.y, o.x, o.y) > R + o.r) return;
            C.hitMonster(game, o, comps, {
              skill: opts.skill, elem: opts.elem, mult: (opts.mult || 1) * pct,
              mods: null, noSplash: true, knockback: 0, canCrit: false,
            });
          });
        }
      }
      if (!opts.noPowers) C.triggerPowers(game, 'onHit', m, { total, crit, skill: opts.skill, elem: opts.elem });
    }
    if (m.life <= 0) {
      C.killMonster(game, m, fromPlayer);
      if (md && md.manaOnKill) {
        const p = game.player;
        p.mana = Math.min(p.stats.maxMana, p.mana + md.manaOnKill);
      }
    }
    return total;
  };

  /* ---------------- 对玩家造成伤害 ---------------- */
  C.hitPlayer = function (game, comps, opts) {
    opts = opts || {};
    const p = game.player;
    if (p.dead || p.invuln > 0) return 0;
    const srcLevel = (opts.source && opts.source.mlvl) || game.mlvl || 1;
    if (G.rng.next() * 100 < p.stats.dodge) {
      G.FX.text(game, p.x, p.y - 26, '闪避', '#cfcfcf', 13);
      return 0;
    }
    let total = 0;
    const parts = {};
    for (const k in comps) {
      const raw = comps[k];
      if (!(raw > 0)) continue;
      const mit = k === 'physical' ? S.armorMitigation(p.stats.armor, srcLevel) : S.resistMitigation(p.stats.res[k] || 0);
      parts[k] = raw * (1 - mit);
      total += parts[k];
    }
    total *= 1 - p.stats.dmgReduce / 100;
    if (!(total > 0)) return 0;
    total = Math.max(1, Math.round(total));
    p.life -= total;
    p.hurtFlash = 0.35;
    game.damageVignette = Math.min(1, (game.damageVignette || 0) + total / Math.max(1, p.stats.maxLife) * 2.2);
    game.shake(Math.min(7, 2 + total / Math.max(1, p.stats.maxLife) * 22));
    G.FX.text(game, p.x + G.rand(-6, 6), p.y - 24, '-' + total, '#ff8f8f', 14);
    G.FX.blood(game, p.x, p.y, 6, '#c0342f');
    G.audio.play('hurt');
    // 玩家「伤害反弹」：近战攻击者受到伤害
    const src = opts.source;
    if (src && src.kind === 'monster' && !src.dead && !opts.isDot && p.stats.thorns > 0) {
      C.hitMonster(game, src, { physical: p.stats.thorns }, { source: 'player', isDot: true, noPowers: true, reflect: true });
    }
    if (p.life <= 0) C.playerDeath(game);
    return total;
  };

  C.playerDeath = function (game) {
    const p = game.player;
    if (p.dead) return;
    // 不死鸟
    if (p.stats.powers && p.stats.powers.has('phoenix') && !game.phoenixUsed) {
      game.phoenixUsed = true;
      p.life = Math.round(p.stats.maxLife * 0.5);
      G.FX.nova(game, p.x, p.y, 160, '#ff9a3c');
      G.log('不死鸟之力将你从死亡边缘拉回！', 'c-unique');
      G.audio.play('explode');
      return;
    }
    p.dead = true;
    p.life = 0;
    G.FX.blood(game, p.x, p.y, 30, '#a3242a');
    G.audio.play('dieBig');
    game.onPlayerDeath();
  };

  /* ---------------- 状态效果 ---------------- */
  C.applySlow = function (game, ent, pct, dur) {
    if (!ent.slow || ent.slow.pct < pct) ent.slow = { pct, remaining: dur };
    else ent.slow.remaining = Math.max(ent.slow.remaining, dur);
  };
  C.applyVuln = function (game, ent, pct, dur) {
    if (!ent.vuln || ent.vuln.pct < pct) ent.vuln = { pct, remaining: dur };
    else ent.vuln.remaining = Math.max(ent.vuln.remaining, dur);
  };
  C.applyStun = function (game, ent, dur) {
    ent.stun = Math.max(ent.stun || 0, dur);
  };
  C.applyDot = function (game, ent, dot, fromPlayer) {
    ent.dots = ent.dots || [];
    // 同名 dot 刷新
    for (let i = 0; i < ent.dots.length; i++) {
      const d = ent.dots[i];
      if (d.key === (dot.key || dot.elem) && d.fromPlayer === fromPlayer) {
        d.remaining = dot.dur; d.dps = Math.max(d.dps, dot.dps); d.tick = 0.5;
        return;
      }
    }
    ent.dots.push({ key: dot.key || dot.elem, elem: dot.elem, dps: dot.dps, remaining: dot.dur, tick: 0.5, interval: 0.5, fromPlayer: !!fromPlayer });
  };
  C.tickDots = function (game, ent, dt) {
    if (!ent.dots || !ent.dots.length) return;
    // 快照数组：结算过程中目标可能死亡（dots 会被清空/替换）
    const arr = ent.dots;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (ent.dots !== arr) return;
      const d = arr[i];
      if (!d) continue;
      d.remaining -= dt;
      d.tick -= dt;
      if (d.tick <= 0) {
        d.tick += d.interval;
        const comps = { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0 };
        comps[d.elem] = d.dps * d.interval;
        if (ent.kind === 'player') C.hitPlayer(game, comps, { isDot: true });
        else C.hitMonster(game, ent, comps, { isDot: true, source: d.fromPlayer ? 'player' : 'monster', elem: d.elem, noPowers: true });
      }
      if (d.remaining <= 0) {
        const k = arr.indexOf(d);
        if (k >= 0) arr.splice(k, 1);
      }
    }
  };

  /* ---------------- 怪物攻击 ---------------- */
  C.monsterAttack = function (game, m) {
    const p = game.player;
    let dmgMul = 1;
    // 狂暴光环：附近精英怪为同伴增伤
    for (let i = 0; i < game.monsters.length; i++) {
      const o = game.monsters[i];
      if (o.dead || !o.aura || o.aura.kind !== 'rage') continue;
      if (G.dist(o.x, o.y, m.x, m.y) < o.aura.radius) dmgMul = Math.max(dmgMul, o.aura.dmg || 1);
    }
    const comps = { physical: m.dmg * dmgMul };
    if (m.onHitElem) comps[m.onHitElem] = (comps[m.onHitElem] || 0) + m.dmg * dmgMul * 0.6;
    const a = G.ang(m.x, m.y, p.x, p.y);
    m.facing = a;
    if (m.kind === 'ranged' || m.kind === 'caster') {
      const pj = m.def.proj || { speed: 280, size: 6, color: m.color };
      G.ENT.makeProjectile(game, {
        x: m.x + Math.cos(a) * (m.r + 4), y: m.y + Math.sin(a) * (m.r + 4),
        vx: Math.cos(a) * pj.speed, vy: Math.sin(a) * pj.speed,
        from: 'monster', owner: m, elem: pj.elem || 'physical',
        comps, size: pj.size || 6, color: pj.color || m.color,
        homing: pj.homing || 0, explode: pj.explode || 0, slow: pj.slow || 0,
        dot: pj.dot ? { elem: pj.elem || 'poison', dps: m.dmg * pj.dot, dur: 4 } : null,
        radius: pj.explode || 0, life: 3.2,
      });
      G.audio.play(pj.elem === 'fire' ? 'fire' : pj.elem === 'cold' ? 'ice' : 'arrow');
    } else {
      // 近战挥击
      G.FX.slash(game, m.x, m.y, a, m.r + 26, m.area || 0);
      G.audio.play('swing');
      const reach = m.r + 22 + (m.area || 0);
      if (G.dist(m.x, m.y, p.x, p.y) <= reach + p.r) {
        C.hitPlayer(game, comps, { source: m });
        if (m.elite && m.onHitElem === 'cold') C.applySlow(game, p, 0.4, 2);
      }
    }
  };

  /* ---------------- BOSS 技能 ---------------- */
  C.bossAttack = function (game, m, atk) {
    const p = game.player;
    const compsBase = { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0 };
    const elem = atk.elem || 'physical';
    const comps = Object.assign({}, compsBase);
    comps[elem] = m.dmg * (atk.mult || 1);
    switch (atk.type) {
      case 'fan': {
        const n = atk.count || 3;
        const base = G.ang(m.x, m.y, p.x, p.y);
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * 0.22;
          G.ENT.makeProjectile(game, {
            x: m.x + Math.cos(a) * (m.r + 6), y: m.y + Math.sin(a) * (m.r + 6),
            vx: Math.cos(a) * (atk.speed || 300), vy: Math.sin(a) * (atk.speed || 300),
            from: 'monster', owner: m, elem, comps, size: 9, color: atk.color || m.color, life: 3,
          });
        }
        G.audio.play('fire');
        break;
      }
      case 'nova': {
        G.FX.nova(game, m.x, m.y, atk.radius || 190, atk.color || m.color, 0.5);
        G.FX.ring(game, m.x, m.y, atk.radius || 190, atk.color || m.color);
        game.shake(9);
        G.audio.play('explode');
        if (G.dist(m.x, m.y, p.x, p.y) <= (atk.radius || 190) + p.r) {
          C.hitPlayer(game, comps, { source: m });
          if (atk.slow) C.applySlow(game, p, atk.slow, 3);
        }
        break;
      }
      case 'cone': {
        const a = G.ang(m.x, m.y, p.x, p.y);
        G.FX.cone(game, m.x, m.y, a, atk.radius || 260, (atk.arc || 0.7) * 2, atk.color || m.color);
        G.audio.play('fire');
        const d = G.dist(m.x, m.y, p.x, p.y);
        if (d <= (atk.radius || 260) && Math.abs(G.angDiff(a, G.ang(m.x, m.y, p.x, p.y))) < (atk.arc || 0.7)) {
          C.hitPlayer(game, comps, { source: m });
        }
        break;
      }
      case 'meteor': {
        const n = atk.count || 3;
        for (let i = 0; i < n; i++) {
          const tx = p.x + G.rand(-160, 160), ty = p.y + G.rand(-160, 160);
          game.grounds.push({
            kind: 'ground', x: tx, y: ty, r: atk.radius || 90, dur: 1.6, tick: 0.5, timer: 0.5,
            elem, comps, from: 'monster', color: atk.color, telegraph: 1.0, playerOwned: false, once: true, knock: 0,
          });
        }
        G.audio.play('boss');
        break;
      }
      case 'chain': {
        let from = { x: m.x, y: m.y };
        let hits = 0;
        const used = [];
        while (hits < (atk.count || 5)) {
          let best = null, bd = 260;
          game.monsters.forEach((o) => {
            if (o === m || o.dead || used.indexOf(o) >= 0) return;
            const d = G.dist(from.x, from.y, o.x, o.y);
            if (d < bd) { bd = d; best = o; }
          });
          if (!best) break;
          used.push(best);
          G.FX.beam(game, from.x, from.y, best.x, best.y, atk.color || '#ffe45c');
          C.hitMonster(game, best, comps, { source: 'monster', elem, noPowers: true });
          from = { x: best.x, y: best.y };
          hits++;
        }
        // 若附近没有小怪则直接打玩家
        if (hits === 0 && G.dist(from.x, from.y, p.x, p.y) < 320) {
          G.FX.beam(game, from.x, from.y, p.x, p.y, atk.color || '#ffe45c');
          C.hitPlayer(game, comps, { source: m });
        }
        G.audio.play('bolt');
        break;
      }
      case 'summon': {
        const n = atk.count || 3;
        for (let i = 0; i < n; i++) {
          const a = G.rand(0, G.TAU), d = G.rand(40, 110);
          const pos = G.Dungeon.findFree(game.map, m.x + Math.cos(a) * d, m.y + Math.sin(a) * d, 14);
          game.spawnMonster(atk.mob, pos.x, pos.y, {});
        }
        G.FX.nova(game, m.x, m.y, 120, '#b06fd8', 0.6);
        G.audio.play('portal');
        break;
      }
      case 'charge': {
        const a = G.ang(m.x, m.y, p.x, p.y);
        m.charge = { t: 0.85, vx: Math.cos(a) * (atk.speed || 480), vy: Math.sin(a) * (atk.speed || 480), comps, hit: false };
        m.facing = a;
        G.audio.play('shout');
        break;
      }
      case 'teleport': {
        const a = G.rand(0, G.TAU), d = G.rand(160, 300);
        const pos = G.Dungeon.findFree(game.map, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, m.r);
        G.FX.nova(game, m.x, m.y, 70, m.color, 0.4);
        m.x = pos.x; m.y = pos.y;
        G.FX.nova(game, m.x, m.y, 70, m.color, 0.4);
        break;
      }
    }
  };

  /* ---------------- 击杀 ---------------- */
  C.killMonster = function (game, m, byPlayer) {
    if (m.dead) return;
    m.dead = true;
    m.deadT = m.isBoss ? 1.4 : 0.45;
    m.dots = [];
    game.killed++;
    game.shake(m.isBoss ? 16 : 3);
    G.FX.blood(game, m.x, m.y, m.isBoss ? 40 : 12, '#8e1d20');
    G.audio.play(m.isBoss ? 'dieBig' : 'die');

    const p = game.player;
    if (byPlayer && !p.dead) {
      const xp = G.xpForMonster(m.mlvl, m.isBoss ? 'boss' : m.elite ? 'elite' : 'normal', game.diffIdx);
      C.gainXp(game, xp);
      C.triggerPowers(game, 'onKill', m, {});
    }
    // 掉落
    const diff = D.diffOf(game.diffIdx);
    const drops = L.rollDrops(game.rng, {
      mlvl: m.mlvl, mf: p.stats.mf, gf: p.stats.gf, plvl: p.level,
      kind: m.isBoss ? 'boss' : m.elite ? 'elite' : 'normal',
      mult: diff.drop, cls: p.cls,
      floor: game.floor, diffQuality: diff.quality,
      orbBonus: G.Town.orbBonus(p),
      shardBonus: G.Town.shardBonus(p),
    });
    game.dropLoot(m.x, m.y, drops);
    // 死亡新星
    if (m.deathNova) {
      const comps = { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0 };
      comps[m.deathNova.elem] = m.dmg * m.deathNova.mult;
      G.FX.nova(game, m.x, m.y, m.deathNova.radius, G.ELEM_COLOR[m.deathNova.elem] || '#ff9a3c');
      if (G.chance(0.5)) G.audio.play('explode');
      if (G.dist(m.x, m.y, p.x, p.y) <= m.deathNova.radius + p.r) C.hitPlayer(game, comps, { source: m });
      game.monsters.forEach((o) => {
        if (o !== m && !o.dead && G.dist(m.x, m.y, o.x, o.y) <= m.deathNova.radius) C.hitMonster(game, o, comps, { source: 'monster', canCrit: false });
      });
    }
    if (m.isBoss) game.onBossKilled(m);
    game.busKill && game.busKill(m);
  };

  C.gainXp = function (game, amount) {
    const p = game.player;
    amount = Math.round(amount * (1 + p.stats.xpBonus / 100));
    p.xp += amount;
    let need = S.xpToNext(p.level);
    let leveled = 0;
    while (p.xp >= need && p.level < 99) {
      p.xp -= need;
      p.level++;
      leveled++;
      p.attrPoints += 3;
      p.skillPoints += 1;
      if (p.level % 5 === 0) p.passivePoints = (p.passivePoints || 0) + 1;
      need = S.xpToNext(p.level);
    }
    if (leveled) {
      p.recalcFull = true;
      S.derive(p);
      G.FX.nova(game, p.x, p.y, 150, '#ffe45a');
      G.audio.play('levelup');
      G.log('等级提升！现在是 ' + p.level + ' 级（+' + (leveled * 3) + ' 属性点，+' + leveled + ' 技能点）', 'c-rare');
      G.bus.emit('levelup', { level: p.level, gained: leveled });
    }
  };

  /* ---------------- 暗金特效触发 ---------------- */
  C.triggerPowers = function (game, hook, m, info) {
    const p = game.player;
    const st = p.stats;
    if (!st.powers || !st.powers.size) return;
    st.powers.forEach((pid) => {
      const pw = C.POWERS[pid];
      if (pw && pw[hook]) pw[hook](game, p, m, info || {}, st);
    });
  };

  C.POWERS = {
    bleed: {
      onHit(game, p, m, info) {
        if (G.chance(0.25)) {
          const b = p.stats.weaponMin;
          C.applyDot(game, m, { key: 'bleed', elem: 'physical', dps: (b + p.stats.weaponMax) / 2 * 0.24, dur: 5 }, true);
        }
      },
    },
    stormcall: {
      onHit(game, p, m, info) {
        if (!G.chance(0.1)) return;
        const comps = { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0 };
        comps.lightning = p.stats.weaponDps * 2.0;
        G.FX.beam(game, m.x, m.y - 260, m.x, m.y, '#ffe45c');
        G.FX.nova(game, m.x, m.y, 70, '#ffe45c');
        G.audio.play('bolt');
        game.monsters.forEach((o) => {
          if (!o.dead && G.dist(o.x, o.y, m.x, m.y) < 70) C.hitMonster(game, o, comps, { elem: 'lightning', noPowers: true });
        });
      },
    },
    thousandcuts: {
      onHit(game, p, m, info) {
        if (!G.chance(0.18)) return;
        const comps = C.attackComponents(p, D.SKILLS[p.cls + '_basic'], S.skillLevel(p, p.cls + '_basic'));
        for (const k in comps) comps[k] *= 0.6;
        G.FX.slash(game, p.x, p.y, G.ang(p.x, p.y, m.x, m.y), 60);
        C.hitMonster(game, m, comps, { noPowers: true, elem: 'physical' });
      },
    },
    quake: {
      onKill(game, p, m) {
        const comps = { physical: p.stats.weaponDps * 2.5, fire: 0, cold: 0, lightning: 0, poison: 0 };
        G.FX.nova(game, m.x, m.y, 140, '#c9a45c');
        game.shake(8);
        game.monsters.forEach((o) => {
          if (!o.dead && G.dist(o.x, o.y, m.x, m.y) < 140) C.hitMonster(game, o, comps, { noPowers: true, elem: 'physical' });
        });
      },
    },
    frostbite: {
      onCrit(game, p, m) { return C.POWERS.frostbite.onHit(game, p, m, {}); },
      onHit(game, p, m, info) {
        if (!info.crit) return;
        C.applySlow(game, m, 0.6, 2);
        C.applyVuln(game, m, 25, 2);
        G.FX.frost(game, m.x, m.y, 10);
      },
    },
    ignite: {
      onHit(game, p, m, info) {
        if (info.elem !== 'fire' && (info.skill && D.SKILLS[info.skill] && D.SKILLS[info.skill].elem !== 'fire')) return;
        C.applyDot(game, m, { key: 'ignite', elem: 'fire', dps: p.stats.weaponDps * 0.3, dur: 5 }, true);
        G.FX.fire(game, m.x, m.y, 8);
      },
    },
    chainlightning: {
      onHit(game, p, m, info) {
        if (!G.chance(0.15)) return;
        const comps = { physical: 0, fire: 0, cold: 0, lightning: info.total * 0.6, poison: 0 };
        let from = { x: m.x, y: m.y };
        const used = [m];
        for (let i = 0; i < 4; i++) {
          let best = null, bd = 240;
          game.monsters.forEach((o) => {
            if (o.dead || used.indexOf(o) >= 0) return;
            const d = G.dist(from.x, from.y, o.x, o.y);
            if (d < bd) { bd = d; best = o; }
          });
          if (!best) break;
          used.push(best);
          G.FX.beam(game, from.x, from.y, best.x, best.y, '#7fd8ff');
          C.hitMonster(game, best, comps, { elem: 'lightning', noPowers: true });
          from = { x: best.x, y: best.y };
        }
        G.audio.play('bolt');
      },
    },
    berserk: {},
    glass: {},
    sage: {},
    greed: {},
    vampiric: {},
    juggernaut: {},
    thornsAura: {
      tick(game, p, dt) {
        p._thornAcc = (p._thornAcc || 0) + dt;
        if (p._thornAcc < 1) return;
        p._thornAcc = 0;
        const dmg = Math.max(10, p.stats.thorns * 1.5);
        const comps = { physical: dmg, fire: 0, cold: 0, lightning: 0, poison: 0 };
        let any = false;
        game.monsters.forEach((o) => {
          if (!o.dead && G.dist(o.x, o.y, p.x, p.y) < 170) { C.hitMonster(game, o, comps, { noPowers: true, elem: 'physical' }); any = true; }
        });
        if (any) G.FX.nova(game, p.x, p.y, 170, '#8ce07a', 0.4);
      },
    },
    lifestorm: {
      onKill(game, p) { C.healPlayer(game, p.stats.maxLife * 0.06); G.FX.nova(game, p.x, p.y, 60, '#e2464a', 0.3); },
    },
    swiftness: {
      onKill(game, p) {
        C.addBuff(game, { id: 'swiftness', name: '疾影', icon: '💨', dur: 3, stats: { moveSpeed: 40 } });
      },
    },
    arcaneEcho: {},
    phoenix: {},
  };

  /* ---------------- Buff ---------------- */
  C.addBuff = function (game, buff) {
    const p = game.player;
    p.buffs = p.buffs || [];
    const ex = p.buffs.filter((b) => b.id === buff.id)[0];
    if (ex) { ex.remaining = buff.dur; return; }
    buff.remaining = buff.dur;
    p.buffs.push(buff);
    S.derive(p);
  };

  /* ============================================================
   *  技能释放
   * ============================================================ */
  SK.canUse = function (game, p, id) {
    const base = D.SKILLS[id];
    if (!base) return false;
    const lv = S.skillLevel(p, id);
    if (lv <= 0) return false;
    if (p.cds[id] > 0) return false;
    if (p.mana < S.skillShape(p, base).cost) return false;
    return true;
  };

  SK.aimPoint = function (game, p) {
    return game.aimWorld();
  };

  // opts.ignoreCd：绕过技能自身冷却（闪避充能体系自己控制释放节奏）
  SK.cast = function (game, p, id, aim, opts) {
    const base = D.SKILLS[id];
    if (!base) return false;
    const sk = S.skillShape(p, base);          // 套用已生效的强化分支
    const mods = sk.mods || {};
    const lv = S.skillLevel(p, id);
    if (lv <= 0) { G.log('技能尚未解锁', 'dim'); return false; }
    if (p.cds[id] > 0 && !(opts && opts.ignoreCd)) return false;
    if (p.mana < sk.cost) { G.audio.play('noskill'); G.log('法力不足！', 'dim'); return false; }
    if (p.stun > 0) return false;
    aim = aim || SK.aimPoint(game, p);
    const facing = G.ang(p.x, p.y, aim.x, aim.y);
    const comps = C.attackComponents(p, sk, lv);
    const st = p.stats;
    const areaMul = 1 + st.areaDmg / 100;
    // 每次命中都带上分支修饰符（斩杀 / 吸取 / 暴击等）
    const hit = (extra) => Object.assign({ skill: id, elem: sk.elem, mods: mods }, extra || {});

    switch (sk.type) {
      case 'basic': {
        if (sk.proj) {
          G.ENT.makeProjectile(game, {
            x: p.x + Math.cos(facing) * 14, y: p.y + Math.sin(facing) * 14,
            vx: Math.cos(facing) * sk.proj.speed, vy: Math.sin(facing) * sk.proj.speed,
            from: 'player', elem: sk.elem, comps, size: sk.proj.size, color: sk.proj.color,
            arrow: sk.proj.arrow, life: 1.6, skill: id, mods: mods, knockback: st.areaDmg > 0 ? 0 : 0,
          });
          G.audio.play('arrow');
        } else {
          SK.coneHit(game, p, comps, facing, (sk.radius || 66) * areaMul, sk.arc || 1.6, hit());
          G.FX.slash(game, p.x, p.y, facing, (sk.radius || 66) * areaMul);
          G.audio.play('swing');
        }
        break;
      }
      case 'cone': {
        SK.coneHit(game, p, comps, facing, (sk.radius || 110) * areaMul, sk.arc || 1.4, hit({
          knockback: 40,
          dot: sk.dot ? { key: 'rend', elem: sk.dot.elem, dps: (st.weaponMin + st.weaponMax) / 2 * sk.dot.mult, dur: sk.dot.dur } : null,
        }));
        G.FX.slash(game, p.x, p.y, facing, (sk.radius || 110) * areaMul, 1.1);
        G.audio.play('swing');
        break;
      }
      case 'around': {
        const R = (sk.radius || 100) * areaMul;
        G.FX.nova(game, p.x, p.y, R, '#e8d0a0', 0.35);
        G.FX.ring(game, p.x, p.y, R, '#ffd9a0');
        G.audio.play('swing');
        game.monsters.forEach((m) => {
          if (!m.dead && G.dist(p.x, p.y, m.x, m.y) < R + m.r) {
            C.hitMonster(game, m, comps, hit({ knockback: 30, canCrit: true }));
          }
        });
        G.ENT.breakProps(game, p.x, p.y, R * 0.8);
        break;
      }
      case 'nova': {
        const R = (sk.radius || 190) * areaMul;
        G.FX.nova(game, p.x, p.y, R, G.ELEM_COLOR[sk.elem] || '#7fd8ff', 0.55);
        G.FX.ring(game, p.x, p.y, R, G.ELEM_COLOR[sk.elem] || '#7fd8ff');
        G.audio.play(sk.elem === 'cold' ? 'ice' : 'explode');
        game.monsters.forEach((m) => {
          if (!m.dead && G.dist(p.x, p.y, m.x, m.y) < R + m.r) {
            C.hitMonster(game, m, comps, hit({ slow: sk.slow, slowDur: sk.slowDur, stun: sk.stun }));
          }
        });
        G.ENT.breakProps(game, p.x, p.y, R * 0.8);
        break;
      }
      case 'projectile': {
        G.ENT.makeProjectile(game, {
          x: p.x + Math.cos(facing) * 16, y: p.y + Math.sin(facing) * 16,
          vx: Math.cos(facing) * sk.proj.speed, vy: Math.sin(facing) * sk.proj.speed,
          from: 'player', elem: sk.elem, comps, size: sk.proj.size, color: sk.proj.color,
          arrow: sk.proj.arrow, length: sk.proj.length, explode: sk.proj.explode ? sk.proj.explode * areaMul : 0,
          pierce: sk.pierce || 0, life: 1.8, skill: id, mods: mods,
          ignite: sk.ignite ? { elem: 'fire', dps: (st.weaponMin + st.weaponMax) / 2 * sk.ignite.mult * D.skillDamageMult(sk, lv), dur: sk.ignite.dur } : null,
        });
        G.audio.play(sk.elem === 'fire' ? 'fire' : sk.elem === 'cold' ? 'ice' : 'arrow');
        break;
      }
      case 'fan': {
        const n = Math.max(1, Math.round(sk.count || 5));
        const spread = sk.spread || 0.9;
        for (let i = 0; i < n; i++) {
          const a = facing + (i - (n - 1) / 2) * (spread / n);
          G.ENT.makeProjectile(game, {
            x: p.x + Math.cos(a) * 14, y: p.y + Math.sin(a) * 14,
            vx: Math.cos(a) * sk.proj.speed, vy: Math.sin(a) * sk.proj.speed,
            from: 'player', elem: sk.elem, comps, size: sk.proj.size, color: sk.proj.color,
            arrow: sk.proj.arrow, life: 1.4, skill: id, mods: mods,
          });
        }
        G.audio.play('arrow');
        break;
      }
      case 'chain': {
        let from = { x: p.x, y: p.y };
        const used = [];
        let count = sk.count || 5;
        while (count-- > 0) {
          let best = null, bd = sk.range || 260;
          game.monsters.forEach((m) => {
            if (m.dead || used.indexOf(m) >= 0) return;
            const d = G.dist(from.x, from.y, m.x, m.y);
            if (d < bd) { bd = d; best = m; }
          });
          if (!best) break;
          used.push(best);
          G.FX.beam(game, from.x, from.y, best.x, best.y, '#ffe45c');
          C.hitMonster(game, best, comps, hit({ noPowers: false }));
          from = { x: best.x, y: best.y };
        }
        if (!used.length) {
          // 没有目标也放出去（打向准星方向的第一个）
          G.FX.beam(game, p.x, p.y, aim.x, aim.y, '#ffe45c');
        }
        G.audio.play('bolt');
        break;
      }
      case 'dash': {
        const d = Math.min(sk.range || 300, G.dist(p.x, p.y, aim.x, aim.y));
        const tx = p.x + Math.cos(facing) * d, ty = p.y + Math.sin(facing) * d;
        const pos = G.Dungeon.findFree(game.map, tx, ty, p.r);
        const steps = 8;
        for (let i = 1; i <= steps; i++) {
          const ix = G.lerp(p.x, pos.x, i / steps), iy = G.lerp(p.y, pos.y, i / steps);
          G.FX.afterimage(game, ix, iy, p.color);
          game.monsters.forEach((m) => {
            if (!m.dead && G.dist(ix, iy, m.x, m.y) < (sk.radius || 64) * areaMul + m.r) {
              C.hitMonster(game, m, comps, hit({ knockback: 40 }));
            }
          });
        }
        p.x = pos.x; p.y = pos.y;
        p.invuln = Math.max(p.invuln, 0.25);
        G.audio.play('dodge');
        break;
      }
      case 'leap': {
        const d = Math.min(sk.range || 380, G.dist(p.x, p.y, aim.x, aim.y));
        const tx = p.x + Math.cos(facing) * d, ty = p.y + Math.sin(facing) * d;
        const pos = G.Dungeon.findFree(game.map, tx, ty, p.r);
        p.jump = {
          t: 0.42, dur: 0.42, fromX: p.x, fromY: p.y, toX: pos.x, toY: pos.y,
          comps, radius: (sk.radius || 120) * areaMul, stun: sk.stun || 1, skill: id, elem: sk.elem, mods: mods,
        };
        G.audio.play('shout');
        break;
      }
      case 'teleport': {
        const d = Math.min(sk.range || 460, G.dist(p.x, p.y, aim.x, aim.y));
        const pos = G.Dungeon.findFree(game.map, p.x + Math.cos(facing) * d, p.y + Math.sin(facing) * d, p.r);
        G.FX.nova(game, p.x, p.y, 50, '#c07aff', 0.35);
        p.x = pos.x; p.y = pos.y;
        p.invuln = Math.max(p.invuln, 0.2);
        if (sk.novaOnLand) {
          const nc = C.attackComponents(p, Object.assign({}, sk, { elem: sk.novaOnLand.elem, base: sk.novaOnLand.mult * 100, per: 0, weaponMult: 1 }), lv);
          const R = sk.novaOnLand.radius * areaMul;
          G.FX.nova(game, p.x, p.y, R, '#c07aff', 0.4);
          game.monsters.forEach((m) => {
            if (!m.dead && G.dist(p.x, p.y, m.x, m.y) < R + m.r) C.hitMonster(game, m, nc, hit({ elem: sk.novaOnLand.elem }));
          });
        }
        G.audio.play('portal');
        break;
      }
      case 'ground': {
        const d = Math.min(400, G.dist(p.x, p.y, aim.x, aim.y));
        const tx = p.x + Math.cos(facing) * d, ty = p.y + Math.sin(facing) * d;
        const total = Object.assign({}, comps);
        // 毒云为持续伤害：把总伤害摊到 tick 上
        const dur = sk.dur || 6;
        const ticks = dur / (sk.tick || 0.5);
        const per = {};
        for (const k in total) per[k] = total[k] / Math.max(1, ticks);
        game.grounds.push({
          kind: 'ground', x: tx, y: ty, r: (sk.radius || 120) * areaMul, dur, tick: sk.tick || 0.5, timer: 0,
          elem: sk.elem, comps: per, from: 'player', color: G.ELEM_COLOR[sk.elem], skill: id, playerOwned: true, mods: mods,
        });
        G.audio.play('ice');
        break;
      }
      case 'buff': {
        const b = sk.buff;
        const bl = D.skillScaleLevel(lv);
        C.addBuff(game, {
          id: b.id, name: b.name, icon: b.icon, dur: b.dur,
          stats: { dmgPct: (b.dmg || 0) + (b.perDmg || 0) * (bl - 1), armor: (b.armor || 0) + (b.perArmor || 0) * (bl - 1) },
        });
        G.FX.nova(game, p.x, p.y, 110, '#ffca6a', 0.5);
        G.audio.play('shout');
        G.log('你发出战吼，士气高涨！', 'c-rare');
        break;
      }
      default: return false;
    }

    // 消耗与冷却
    p.mana -= sk.cost;
    if (mods.manaOnCast) p.mana = Math.min(st.maxMana, p.mana + mods.manaOnCast);
    let cd = (sk.cd || 0) * (1 - st.cdr / 100);
    // 秘法回响
    if (st.powers && st.powers.has('arcaneEcho') && sk.cost > 0 && G.chance(0.25)) {
      p.mana += sk.cost;
      cd = 0;
      G.FX.nova(game, p.x, p.y, 90, '#c07aff', 0.4);
      G.log('秘法回响！技能未消耗法力且冷却重置。', 'c-unique');
    }
    if (cd > 0) p.cds[id] = cd;
    p.attackAnim = 0.22;
    p.castAnim = 0.25;
    return true;
  };

  SK.coneHit = function (game, p, comps, facing, radius, arc, opts) {
    opts = opts || {};
    game.monsters.forEach((m) => {
      if (m.dead) return;
      const d = G.dist(p.x, p.y, m.x, m.y);
      if (d > radius + m.r) return;
      const a = G.ang(p.x, p.y, m.x, m.y);
      if (Math.abs(G.angDiff(facing, a)) > arc / 2 + (m.r / Math.max(40, d)) * 0.6) return;
      C.hitMonster(game, m, comps, {
        skill: opts.skill, elem: opts.elem, knockback: opts.knockback, dot: opts.dot, mods: opts.mods,
      });
    });
    // 也能打碎陶罐 / 木桶
    G.ENT.breakProps(game, p.x, p.y, radius * 0.75);
  };

  SK.tickCooldowns = function (p, dt) {
    for (const k in p.cds) if (p.cds[k] > 0) p.cds[k] = Math.max(0, p.cds[k] - dt);
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
