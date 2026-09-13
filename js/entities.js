/* ============================================================
 *  暗影深渊 · entities.js
 *  玩家 / 怪物 AI / 投射物 / 地面效果 / 掉落物 / 粒子 / 特效
 * ============================================================ */
(function (root) {
  'use strict';
  const G = root.G;
  const D = G.DATA;
  const S = G.Stats;
  const L = G.Loot;
  const C = G.Combat;
  const ENT = (G.ENT = {});
  const FX = (G.FX = {});
  const B = G.BALANCE;
  /* 鼠标移动死区：鼠标模式下按住左键走位时，
   * 光标落在这个半径内角色就停下（略大于角色身体），移出后立刻恢复移动。 */
  const MOUSE_DEAD_ZONE = 34;
  ENT.MOUSE_DEAD_ZONE = MOUSE_DEAD_ZONE;

  /* ============================================================
   *  粒子 / 特效
   * ============================================================ */
  function pushP(game, p) {
    if (game.particles.length > 900) return;
    game.particles.push(p);
  }
  FX.spark = function (game, x, y, n, color, speed, size) {
    for (let i = 0; i < n; i++) {
      const a = G.rand(0, G.TAU), sp = G.rand(speed * 0.4, speed);
      pushP(game, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: G.rand(0.18, 0.42), max: 0.42, size: size || G.rand(1.4, 2.8), color, type: 'spark', drag: 3.2 });
    }
  };
  FX.blood = function (game, x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = G.rand(0, G.TAU), sp = G.rand(40, 240);
      pushP(game, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: G.rand(0.3, 0.8), max: 0.8, size: G.rand(1.6, 3.6), color: color || '#8e1d20', type: 'blood', drag: 1.6, grav: 320 });
    }
  };
  FX.fire = function (game, x, y, n) {
    for (let i = 0; i < n; i++) {
      pushP(game, { x: x + G.rand(-8, 8), y: y + G.rand(-8, 8), vx: G.rand(-30, 30), vy: G.rand(-70, -20), life: G.rand(0.3, 0.7), max: 0.7, size: G.rand(3, 7), color: G.chance(0.5) ? '#ff9a3c' : '#ffd24a', type: 'smoke', drag: 1.4 });
    }
  };
  FX.frost = function (game, x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = G.rand(0, G.TAU), sp = G.rand(30, 130);
      pushP(game, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: G.rand(0.4, 0.9), max: 0.9, size: G.rand(2, 4.5), color: '#9fe8ff', type: 'shard', drag: 2, rot: G.rand(0, 6.28), vr: G.rand(-6, 6) });
    }
  };
  FX.smoke = function (game, x, y, n, color) {
    for (let i = 0; i < n; i++) {
      pushP(game, { x: x + G.rand(-10, 10), y: y + G.rand(-10, 10), vx: G.rand(-30, 30), vy: G.rand(-45, -8), life: G.rand(0.4, 1.0), max: 1.0, size: G.rand(4, 10), color: color || '#5a5a5a', type: 'smoke', drag: 1.1 });
    }
  };
  FX.hit = function (game, x, y, elem, amount) {
    const col = G.ELEM_COLOR[elem] || '#ffe9a8';
    FX.spark(game, x, y, elem === 'physical' ? 4 : 6, col, elem === 'physical' ? 170 : 220, 2.4);
    if (elem !== 'physical') FX.spark(game, x, y, 3, col, 90, 4);
    if (elem === 'fire') FX.fire(game, x, y, 3);
    if (elem === 'cold') FX.frost(game, x, y, 3);
  };
  FX.nova = function (game, x, y, r, color, dur) {
    game.fx.push({ type: 'nova', x, y, r, color, life: dur || 0.4, max: dur || 0.4 });
  };
  FX.ring = function (game, x, y, r, color) {
    game.fx.push({ type: 'ring', x, y, r, color, life: 0.5, max: 0.5 });
  };
  FX.beam = function (game, x1, y1, x2, y2, color) {
    game.fx.push({ type: 'beam', x1, y1, x2, y2, color, life: 0.22, max: 0.22, seed: G.rand(0, 100) });
  };
  FX.slash = function (game, x, y, angle, radius, arc) {
    game.fx.push({ type: 'slash', x, y, angle, radius, arc: arc || 1.5, life: 0.2, max: 0.2, color: '#ffe9c0' });
  };
  FX.cone = function (game, x, y, angle, radius, arc, color) {
    // r 与 radius 都写上：光照层按 r 取半径，绘制层按 radius 取
    game.fx.push({ type: 'cone', x, y, angle, radius, r: radius, arc, color, life: 0.45, max: 0.45 });
  };
  FX.afterimage = function (game, x, y, color) {
    pushP(game, { x, y, vx: 0, vy: 0, life: 0.3, max: 0.3, size: 13, color: color || '#ffffff', type: 'ghost', drag: 0 });
  };
  FX.shatter = function (game, x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = G.rand(0, G.TAU), sp = G.rand(60, 200);
      pushP(game, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: G.rand(0.4, 0.9), max: 0.9, size: G.rand(2, 5), color: color || '#9c8f77', type: 'shard', drag: 1.4, grav: 260, rot: G.rand(0, 6.28), vr: G.rand(-8, 8) });
    }
  };
  FX.text = function (game, x, y, text, color, size, crit) {
    if (game.texts.length > 120) game.texts.shift();
    game.texts.push({ x, y, vx: G.rand(-14, 14), vy: crit ? -66 : -48, life: crit ? 1.0 : 0.75, max: crit ? 1.0 : 0.75, text: String(text), color: color || '#fff', size: size || 14, crit: !!crit });
  };

  ENT.updateParticles = function (game, dt) {
    const arr = game.particles;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) { arr.splice(i, 1); continue; }
      if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; }
      if (p.grav) p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.vr) p.rot = (p.rot || 0) + p.vr * dt;
    }
    const fxs = game.fx;
    for (let i = fxs.length - 1; i >= 0; i--) {
      fxs[i].life -= dt;
      if (fxs[i].life <= 0) fxs.splice(i, 1);
    }
    const tx = game.texts;
    for (let i = tx.length - 1; i >= 0; i--) {
      const t = tx[i];
      t.life -= dt;
      if (t.life <= 0) { tx.splice(i, 1); continue; }
      t.x += t.vx * dt; t.y += t.vy * dt; t.vy += 60 * dt;
    }
  };

  /* ============================================================
   *  玩家
   * ============================================================ */
  ENT.makePlayer = function (game, clsId) {
    const cls = D.classById(clsId);
    const p = {
      kind: 'player', cls: clsId, color: cls.color, r: 13,
      level: 1, xp: 0, gold: 120, shards: 0,
      diffUnlocked: 0, diffCleared: {},
      attrPoints: 0, skillPoints: 0, passivePoints: 0,
      skillBranches: {}, guideMet: false,
      alloc: { str: 0, dex: 0, int: 0, vit: 0 },
      passives: {}, skills: {}, gear: {}, inventory: new Array(60).fill(null),
      stash: new Array(G.Town ? G.Town.stashCap(null) : 40).fill(null),
      town: G.Town ? G.Town.defaultTown() : { buildings: {} },
      maxFloor: 1,
      potions: { life: { tier: 0, count: 3 }, mana: { tier: 0, count: 2 } },
      cds: {}, buffs: [], dots: [],
      x: 0, y: 0, vx: 0, vy: 0, facing: 0,
      attackTimer: 0, dodgeTimer: 0, dodgeCd: 0, dodgeX: 0, dodgeY: 0, dodgeCharge: null,
      invuln: 0, hurtFlash: 0, animT: 0, walkT: 0, attackAnim: 0, castAnim: 0,
      moveTarget: null, attackTarget: null, pendingPickup: null, pendingNpc: null,
      aimAttack: false, forceAim: false, jump: null,
      life: null, mana: null, dead: false, deadT: 0, kills: 0, playTime: 0,
    };
    // 初始技能
    const list = cls.skills;
    list.forEach((id, i) => {
      const sk = D.SKILLS[id];
      p.skills[id] = (i <= 1) ? 1 : 0;
      if (sk.cd) p.cds[id] = 0;
    });
    // 起始武器
    const startBase = { barb: 'w_axe_0', sorc: 'w_wand_0', rogue: 'w_bow_0' }[clsId] || 'w_sword_0';
    const w = L.makeItem(game.rng, { ilvl: 1, slot: 'weapon', baseId: startBase, rarity: 'common' });
    p.gear.weapon = w;
    S.derive(p);
    p.life = p.stats.maxLife;
    p.mana = p.stats.maxMana;
    p.skills[list[2]] = 0;
    return p;
  };

  ENT.updatePlayer = function (game, p, dt) {
    p.animT += dt;
    p.hurtFlash = Math.max(0, p.hurtFlash - dt);
    p.attackAnim = Math.max(0, p.attackAnim - dt);
    p.castAnim = Math.max(0, p.castAnim - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    if (p.dead) { p.deadT += dt; return; }
    if (game.paused) return;
    p.playTime += dt;
    const st = p.stats;
    G.Skills.tickCooldowns(p, dt);
    C.tickDots(game, p, dt);

    /* buff 处理 */
    if (p.buffs && p.buffs.length) {
      let changed = false;
      for (let i = p.buffs.length - 1; i >= 0; i--) {
        p.buffs[i].remaining -= dt;
        if (p.buffs[i].remaining <= 0) { p.buffs.splice(i, 1); changed = true; }
      }
      if (changed) S.derive(p);
    }

    /* 回复 */
    p.life = Math.min(st.maxLife, p.life + st.lifeRegen * dt);
    p.mana = Math.min(st.maxMana, p.mana + st.manaRegen * dt);

    /* 跃击落地 */
    if (p.jump) {
      p.jump.t -= dt;
      const t = 1 - Math.max(0, p.jump.t) / p.jump.dur;
      p.x = G.lerp(p.jump.fromX, p.jump.toX, Math.min(1, t));
      p.y = G.lerp(p.jump.fromY, p.jump.toY, Math.min(1, t));
      p.jumpHeight = Math.sin(Math.min(1, t) * Math.PI) * 46;
      if (p.jump.t <= 0) {
        const j = p.jump;
        p.jump = null;
        p.jumpHeight = 0;
        game.shake(8);
        G.audio.play('explode');
        G.FX.nova(game, p.x, p.y, j.radius, '#e8c07a', 0.5);
        G.FX.ring(game, p.x, p.y, j.radius, '#ffd9a0');
        game.monsters.forEach((m) => {
          if (!m.dead && G.dist(p.x, p.y, m.x, m.y) < j.radius + m.r) {
            C.hitMonster(game, m, j.comps, { skill: j.skill, elem: j.elem, knockback: 60, mods: j.mods });
            C.applyStun(game, m, j.stun);
          }
        });
        ENT.breakProps(game, p.x, p.y, j.radius);
      }
      return;
    }

    /* 翻滚 */
    if (p.dodgeTimer > 0) {
      p.dodgeTimer -= dt;
      const sp = 470;
      const mv = G.Dungeon.slideMove(game.map, p.x, p.y, p.dodgeX * sp * dt, p.dodgeY * sp * dt, p.r);
      p.x = mv.x; p.y = mv.y;
      if (G.chance(0.7)) G.FX.afterimage(game, p.x, p.y, p.color);
      return;
    }
    // 闪避充能：按「回满一格所需时间」持续积攒，满了就停
    const dmax = S.dodgeMax(p);
    const dregen = S.dodgeRechargeTime(p);
    if (p.dodgeCharge == null) p.dodgeCharge = dmax;
    p.dodgeCharge = Math.min(dmax, p.dodgeCharge + dt / dregen);
    // 距离下一格可用还有多久（仅界面显示；满格为 0）
    p.dodgeCd = p.dodgeCharge >= dmax ? 0 : (1 - (p.dodgeCharge % 1)) * dregen;

    /* ---- 输入：移动 ---- */
    const inp = G.input;
    const SET = G.Settings;
    const wasdMode = SET.mode() === 'wasd';
    const ax = inp.axis();
    const aim = game.aimWorld();
    let moveX = 0, moveY = 0;
    const speed = st.moveSpeed * (p.slow && p.slow.remaining > 0 ? 1 - p.slow.pct : 1);
    const overUI = game.uiCapturing();
    const shift = inp.down('ShiftLeft') || inp.down('ShiftRight');
    const ctrl = inp.down('ControlLeft') || inp.down('ControlRight');
    const inTown = game.area === 'town';
    /* 攻击键：鼠标模式下 = 右键，WASD 模式下 = 左键（可重新绑定） */
    const atkDown = SET.down('attack');
    const atkPressed = SET.pressed('attack');
    const lmbIsAttack = SET.getBind('attack') === 'MouseLeft';

    /* ============ 左键职责（按操作模式分工） ============
     * 鼠标模式：左键 = 纯移动（点击掉落物 / NPC / 深渊之门仍可交互）
     * WASD 模式：左键 = 普通攻击，绝不产生任何自动移动
     * 两种模式下：Ctrl + 左键 = 强制移动到该点；Shift + 左键 = 朝该方向普攻
     */
    if (inp.mouse.leftPressed && !overUI) {
      const pick = game.pickupAt(aim.x, aim.y, 22);
      const npc = inTown ? G.Town.npcAt(game.map, aim.x, aim.y, 20) : null;
      const gate = !!(inTown && game.nearGate && game.nearGate(60));
      if (shift) {
        // Shift + 左键 = 朝该方向强制普攻（每帧按按住状态刷新，见下方 p.forceAim）
      } else if (ctrl || !lmbIsAttack) {
        // 鼠标模式左键 / 任意模式 Ctrl+左键 → 只移动
        p.attackTarget = null;
        p.aimAttack = false;
        if (pick) { p.pendingPickup = pick; p.moveTarget = null; p.pendingNpc = null; }
        else if (npc) { p.pendingNpc = npc; p.moveTarget = null; p.pendingPickup = null; }
        else if (gate) { p.moveTarget = null; p.pendingPickup = null; p.pendingNpc = null; game.interactGate(); }
        else { p.moveTarget = { x: aim.x, y: aim.y }; p.pendingPickup = null; p.pendingNpc = null; }
      }
      // WASD 模式下未按修饰键的左键：什么都不做，交给下面的攻击逻辑
    }
    // Shift + 左键按住时持续朝准星方向普攻
    p.forceAim = !!(shift && inp.mouse.left && !overUI);

    if (!overUI) {
      /* 鼠标模式下按住左键 = 一直跟着光标走。
       * 角色周围有一个「鼠标死区」：光标进入死区就停下，
       * 但只要光标再移出死区就会立刻恢复移动。 */
      const holdMove = !wasdMode && inp.mouse.left && !lmbIsAttack && !p.pendingPickup && !p.pendingNpc;
      if (ax.x || ax.y) {
        moveX = ax.x; moveY = ax.y;
        p.moveTarget = null; p.pendingNpc = null;
        if (!wasdMode) p.attackTarget = null;   // 鼠标模式下手动走位 = 取消锁定
      } else if (p.moveTarget || holdMove) {
        if (holdMove) p.moveTarget = { x: aim.x, y: aim.y };
        const d = G.dist(p.x, p.y, p.moveTarget.x, p.moveTarget.y);
        if (d < MOUSE_DEAD_ZONE) {
          // 死区内：不跟随。按住时保留目标点，光标移开即可继续；松手后则清除
          if (!holdMove) p.moveTarget = null;
        } else {
          moveX = (p.moveTarget.x - p.x) / d; moveY = (p.moveTarget.y - p.y) / d;
        }
      }

      // 攻击目标失效则清除
      if (p.attackTarget && (p.attackTarget.dead || !game.monsters.includes(p.attackTarget))) p.attackTarget = null;
      /* 追击 / 保持距离：只在鼠标模式且锁定了目标时生效（WASD 模式的走位完全交给玩家） */
      if (!wasdMode && p.attackTarget) {
        const m = p.attackTarget;
        const reach = basicRange(p);
        const d = G.dist(p.x, p.y, m.x, m.y);
        const ranged = st.weaponKind && st.weaponKind !== 'melee';
        if (d > reach + m.r - 6) {
          moveX = (m.x - p.x) / d; moveY = (m.y - p.y) / d;
        } else if (ranged && d < keepDistance(p)) {
          moveX = -(m.x - p.x) / d; moveY = -(m.y - p.y) / d;
        }
      }
      if (p.pendingPickup) {
        const it = p.pendingPickup;
        if (!game.pickups.includes(it)) { p.pendingPickup = null; }
        else {
          const d = G.dist(p.x, p.y, it.x, it.y);
          if (d > st.pickup * 0.6) { moveX = (it.x - p.x) / d; moveY = (it.y - p.y) / d; }
          else {
            // 长按「显示全部装备」时用鼠标点过来的隐藏装备：允许捡起这一次
            game.collectPickup(it, G.UI.revealHeld());
            p.pendingPickup = null;
          }
        }
      }
      if (p.pendingNpc && inTown) {
        const n = p.pendingNpc;
        const d = G.dist(p.x, p.y, n.x, n.y);
        if (d > 46) { moveX = (n.x - p.x) / d; moveY = (n.y - p.y) / d; }
        else { p.pendingNpc = null; game.interactNpc(n); }
      } else if (p.pendingNpc) p.pendingNpc = null;
    }

    if (moveX || moveY) {
      const mv = G.Dungeon.slideMove(game.map, p.x, p.y, moveX * speed * dt, moveY * speed * dt, p.r);
      p.x = mv.x; p.y = mv.y;
      p.walkT += dt * 8;
      if (moveX || moveY) p.facing = Math.atan2(moveY, moveX);
    }

    /* ---- 输入：战斗 ---- */
    p.attackTimer = Math.max(0, p.attackTimer - dt);
    if (!overUI) {
      const basic = D.SKILLS[p.cls + '_basic'];
      const actives = D.activeSkills(p.cls);
      // 城镇是安全区：不能攻击
      if (!inTown) {
        if (wasdMode) {
          /* WASD 模式：攻击键直接朝准星方向出手，不会自动靠近目标 */
          if (p.attackTimer <= 0 && (atkDown || p.forceAim)) {
            const near = game.monsterAt(aim.x, aim.y, 36);
            const at = near ? { x: near.x, y: near.y } : aim;
            p.facing = G.ang(p.x, p.y, at.x, at.y);
            G.Skills.cast(game, p, basic.id, at);
            p.attackTimer = S.basicAttackInterval(p);
          }
        } else {
          /* 鼠标模式：点中敌人 = 锁定并持续攻击（远程会保持距离）；
           * 点空地 = 按住攻击键朝该方向连续射击，松开即停 */
          if (atkPressed) {
            const m = game.monsterAt(aim.x, aim.y, 30);
            if (m) { p.attackTarget = m; p.aimAttack = false; }
            else { p.attackTarget = null; p.aimAttack = true; }
          }
          if (!atkDown) p.aimAttack = false;
          if (p.attackTimer <= 0 && p.attackTarget) {
            const m = p.attackTarget;
            const reach = basicRange(p) + m.r;
            if (G.dist(p.x, p.y, m.x, m.y) <= reach && G.Dungeon.lineOfSight(game.map, p.x, p.y, m.x, m.y)) {
              p.facing = G.ang(p.x, p.y, m.x, m.y);
              G.Skills.cast(game, p, basic.id, { x: m.x, y: m.y });
              p.attackTimer = S.basicAttackInterval(p);
            }
          } else if (p.attackTimer <= 0 && ((p.aimAttack && atkDown) || p.forceAim)) {
            p.facing = G.ang(p.x, p.y, aim.x, aim.y);
            G.Skills.cast(game, p, basic.id, aim);
            p.attackTimer = S.basicAttackInterval(p);
          }
        }
      }
      /* 技能 1-4（按键与顺序由操作模式决定，可在设置里重新绑定）：
       * 鼠标模式 skill1-4 = 1/2/3/4
       * WASD 模式 skill1 = 右键，skill2-4 = 1/2/3 */
      for (let i = 0; i < 4; i++) {
        if (!SET.pressed('skill' + (i + 1))) continue;
        const id = actives[i];
        if (id && S.skillLevel(p, id) > 0) { p.facing = G.ang(p.x, p.y, aim.x, aim.y); G.Skills.cast(game, p, id, aim); }
        else { G.audio.play('noskill'); G.log('技能未解锁或不可用', 'dim'); }
      }
      // 翻滚 / 替换基础闪避：两者都消耗闪避充能
      if (SET.pressed('dodge') && S.dodgeCharges(p) >= 1) {
        const swapId = S.dodgeSwapSkill(p);
        if (swapId) {
          // 选了「替换基础闪避」：闪避键改为释放该位移技能，冷却当作充能回复时间；
          // 放不出来（法力不足 / 眩晕中）就不扣充能
          if (G.Skills.cast(game, p, swapId, dodgeAim(game, p, aim), { ignoreCd: true })) {
            p.dodgeCharge = S.dodgeCharges(p) - 1;
          }
        } else {
          let dx = moveX, dy = moveY;
          if (!dx && !dy) { dx = Math.cos(p.facing); dy = Math.sin(p.facing); }
          const l = Math.hypot(dx, dy) || 1;
          p.dodgeX = dx / l; p.dodgeY = dy / l;
          p.dodgeTimer = 0.24; p.invuln = Math.max(p.invuln, 0.42);
          p.dodgeCharge = S.dodgeCharges(p) - 1;
          G.audio.play('dodge');
          G.FX.smoke(game, p.x, p.y, 5, '#2c2620');
        }
      }
      // 药水
      if (SET.pressed('potionLife')) game.usePotion('life');
      if (SET.pressed('potionMana')) game.usePotion('mana');
      // 交互 / 拾取
      if (SET.pressed('pickup')) {
        if (inTown) {
          if (game.nearGate(80)) game.interactGate();
          else {
            const n = G.Town.nearestNpc(game.map, p.x, p.y, 95);
            if (n) game.interactNpc(n); else G.log('附近没有可以交谈的人。', 'dim');
          }
        } else if (game.atPortal(64) && !p.dead) {
          game.nextFloor();                       // 站在传送门旁按 F 进入下一层
        } else if (game.townPortalAt && game.townPortalAt(p.x, p.y, 46)) {
          game.toTown('portal');
        } else game.pickupNearby();
      }
    }

    /* ---- 拾取范围自动吸取 ---- */
    for (let i = game.pickups.length - 1; i >= 0; i--) {
      const pk = game.pickups[i];
      const d = G.dist(p.x, p.y, pk.x, pk.y);
      if (d > st.pickup) continue;
      const it = pk.item;
      const auto = it.cat === 'gold' || it.cat === 'shard' || it.cat === 'potion' || it.cat === 'gem' || (st.powers && st.powers.has('greed'));
      if (auto) game.collectPickup(pk);
    }

    /* ---- 荆棘光环 ---- */
    if (st.powers && st.powers.has('thornsAura') && C.POWERS.thornsAura.tick) C.POWERS.thornsAura.tick(game, p, dt);
  };

  function basicRange(p) {
    const st = p.stats;
    if (st.weaponKind === 'melee' || !st.weaponKind) return 46;
    return 420;
  }
  ENT.basicRange = basicRange;

  /* 闪避键改放位移技能时的瞄准点：
   *   1. 有攻击目标 → 直接冲脸
   *   2. 否则用准心位置；离自己太近（鼠标压在身上）就朝正前方推出去，免得原地小跳
   */
  const DODGE_AIM_MIN = 130;
  function dodgeAim(game, p, aim) {
    const t = p.attackTarget;
    if (t && !t.dead) return { x: t.x, y: t.y };
    const a = aim || game.aimWorld();
    if (G.dist(p.x, p.y, a.x, a.y) >= DODGE_AIM_MIN) return a;
    return { x: p.x + Math.cos(p.facing) * DODGE_AIM_MIN, y: p.y + Math.sin(p.facing) * DODGE_AIM_MIN };
  }
  ENT.dodgeAim = dodgeAim;

  // 远程职业希望维持的最小距离：敌人贴脸时后撤，而不是继续前进
  function keepDistance(p) {
    const st = p.stats;
    if (!st.weaponKind || st.weaponKind === 'melee') return 0;
    return Math.min(240, basicRange(p) * 0.5);
  }
  ENT.keepDistance = keepDistance;

  /* ============================================================
   *  怪物
   * ============================================================ */
  ENT.makeMonster = function (game, defId, x, y, opts) {
    opts = opts || {};
    const def = D.monsterById[defId];
    if (!def) return null;
    const mlvl = opts.mlvl || game.mlvl || 1;
    const diff = D.diffOf(game.diffIdx);
    const elite = !!opts.elite;
    const lifeMul = Math.pow(B.monsterLifeExp, mlvl) * diff.hp * (elite ? B.eliteLife : 1);
    const dmgMul = Math.pow(B.monsterDmgExp, mlvl) * diff.dmg * (elite ? B.eliteDmg : 1);
    const m = {
      kind: 'monster', id: def.id, def, shape: def.shape, color: def.color,
      x, y, homeX: x, homeY: y, r: def.size, size: def.size,
      mlvl, elite, isBoss: false,
      maxLife: Math.round(def.life * lifeMul), life: 0,
      dmg: def.dmg * dmgMul, armor: def.armor * Math.pow(1.06, mlvl),
      speed: def.speed * (1 + Math.min(0.35, mlvl * 0.004)),
      atkKind: def.kind, range: def.range, atkCd: def.cd * G.rand(0.85, 1.15),
      cdTimer: G.rand(0.2, 0.9), aggro: false, aggroRange: 380 + mlvl * 2,
      hitFlash: 0, spawnT: 0.55, dead: false, deadT: 0, facing: G.rand(0, G.TAU),
      wanderT: 0, wanderDir: G.rand(0, G.TAU), kx: 0, ky: 0, stun: 0, slow: null, vuln: null,
      dots: [], chargeCd: def.charge ? G.rand(1, 3) : 0, summonCd: def.summon ? G.rand(2, 5) : 0,
      res: {}, dodgeChance: 0, onHitElem: null, deathNova: null, lifesteal: 0, aura: null,
      affixes: [], animT: G.rand(0, 10), dmgTaken: 0, hpVisible: false,
    };
    m.life = m.maxLife;
    if (elite) {
      const n = mlvl > 30 && G.chance(0.4) ? 3 : 2;
      const pool = D.ELITE_AFFIXES.slice();
      for (let i = 0; i < n; i++) {
        const a = G.rng.pick(pool);
        if (m.affixes.indexOf(a) >= 0) continue;
        m.affixes.push(a);
        if (a.mod && a.mod.life) m.maxLife = Math.round(m.maxLife * a.mod.life), m.life = m.maxLife;
        if (a.mod && a.mod.dmg) m.dmg *= a.mod.dmg;
        if (a.mod && a.mod.armor) m.armor *= a.mod.armor;
        if (a.stats && a.stats.moveSpeed) m.speed *= 1 + a.stats.moveSpeed / 100;
        if (a.stats && a.stats.dodge) m.dodgeChance = a.stats.dodge;
        if (a.stats && a.stats.thornsPct) m.thornsPct = a.stats.thornsPct;
        if (a.onHitElem) m.onHitElem = a.onHitElem;
        if (a.deathNova) m.deathNova = a.deathNova;
        if (a.lifesteal) m.lifesteal = a.lifesteal;
        if (a.aura) m.aura = a.aura;
      }
      m.size = m.r = def.size * 1.22;
      m.xpMul = 3.4;
    }
    return m;
  };

  ENT.makeBoss = function (game, bossId, x, y) {
    const def = D.bossForFloor(game.floor, game.diffIdx);
    const bd = D.BOSSES.filter((b) => b.id === bossId)[0] || def;
    const mlvl = game.mlvl;
    const diff = D.diffOf(game.diffIdx);
    const m = {
      kind: 'monster', id: bd.id, def: bd, shape: bd.shape, color: bd.color,
      x, y, homeX: x, homeY: y, r: bd.size, size: bd.size, mlvl, elite: true, isBoss: true,
      maxLife: Math.round(bd.life * Math.pow(B.monsterLifeExp, mlvl) * diff.hp * (B.bossLife || 1.35)),
      life: 0, dmg: bd.dmg * Math.pow(B.monsterDmgExp, mlvl) * diff.dmg,
      armor: bd.armor * Math.pow(1.07, mlvl), speed: bd.speed,
      atkKind: 'melee', range: bd.range, atkCd: bd.cd, cdTimer: 1.2,
      aggro: true, aggroRange: 900, hitFlash: 0, spawnT: 1.4, dead: false, deadT: 0,
      facing: Math.PI / 2, wanderT: 0, wanderDir: 0, kx: 0, ky: 0, stun: 0, slow: null, vuln: null,
      dots: [], chargeCd: 0, summonCd: 0, res: {}, dodgeChance: 0, onHitElem: null, deathNova: null,
      lifesteal: 0, aura: null, affixes: [], animT: 0, dmgTaken: 0, hpVisible: true,
      atkCds: (bd.attacks || []).map((a) => ({ atk: a, t: a.cd * G.rand(0.4, 0.9) })),
      enraged: false, name: bd.name,
    };
    // BOSS 也带 2 条精英词缀，增加变数
    const pool = D.ELITE_AFFIXES.slice();
    for (let i = 0; i < 2; i++) {
      const a = G.rng.pick(pool);
      if (m.affixes.indexOf(a) >= 0) continue;
      m.affixes.push(a);
      if (a.mod && a.mod.dmg) m.dmg *= a.mod.dmg;
      if (a.onHitElem && !m.onHitElem) m.onHitElem = a.onHitElem;
      if (a.deathNova && !m.deathNova) m.deathNova = a.deathNova;
    }
    m.life = m.maxLife;
    return m;
  };

  ENT.updateMonster = function (game, m, dt) {
    m.animT += dt;
    m.hitFlash = Math.max(0, m.hitFlash - dt);
    if (m.dead) { m.deadT -= dt; return; }
    if (m.spawnT > 0) { m.spawnT -= dt; return; }
    C.tickDots(game, m, dt);
    if (m.dead) return;
    if (m.slow) { m.slow.remaining -= dt; if (m.slow.remaining <= 0) m.slow = null; }
    if (m.vuln) { m.vuln.remaining -= dt; if (m.vuln.remaining <= 0) m.vuln = null; }
    if (m.stun > 0) { m.stun -= dt; return; }
    if (m.kx || m.ky) {
      const mv = G.Dungeon.slideMove(game.map, m.x, m.y, m.kx * dt, m.ky * dt, m.r);
      m.x = mv.x; m.y = mv.y;
      const dr = Math.max(0, 1 - 9 * dt);
      m.kx *= dr; m.ky *= dr;
      if (Math.abs(m.kx) < 4) m.kx = 0;
      if (Math.abs(m.ky) < 4) m.ky = 0;
    }
    const p = game.player;
    if (p.dead) { m.aggro = false; return; }
    const d = G.dist(m.x, m.y, p.x, p.y);
    const slowMul = m.slow ? 1 - Math.min(0.8, m.slow.pct) : 1;
    const speed = m.speed * slowMul;

    /* 光环 */
    if (m.aura) {
      if (m.aura.kind === 'heal') {
        const hps = m.aura.hps;
        game.monsters.forEach((o) => {
          if (!o.dead && G.dist(m.x, m.y, o.x, o.y) < m.aura.radius) o.life = Math.min(o.maxLife, o.life + o.maxLife * hps * dt);
        });
      }
    }
    /* 冲锋中 */
    if (m.charge) {
      const c = m.charge;
      c.t -= dt;
      const mv = G.Dungeon.slideMove(game.map, m.x, m.y, c.vx * dt, c.vy * dt, m.r);
      if (mv.blocked) c.t = 0;
      m.x = mv.x; m.y = mv.y;
      G.FX.smoke(game, m.x, m.y, 1, 'rgba(120,120,120,0.5)');
      if (!c.hit && G.dist(m.x, m.y, p.x, p.y) < m.r + p.r + 6) {
        c.hit = true;
        C.hitPlayer(game, c.comps, { source: m });
        game.shake(6);
      }
      if (c.t <= 0) m.charge = null;
      return;
    }

    if (!m.aggro && (d < m.aggroRange || m.dmgTaken > 0)) m.aggro = true;

    if (!m.aggro) {
      // 闲逛
      m.wanderT -= dt;
      if (m.wanderT <= 0) { m.wanderT = G.rand(1.4, 3.4); m.wanderDir = G.rand(0, G.TAU); }
      const dx = Math.cos(m.wanderDir) * speed * 0.35 * dt, dy = Math.sin(m.wanderDir) * speed * 0.35 * dt;
      const mv = G.Dungeon.slideMove(game.map, m.x, m.y, dx, dy, m.r);
      if (mv.blocked) m.wanderDir += 2.2;
      m.x = mv.x; m.y = mv.y;
      m.facing = m.wanderDir;
      return;
    }

    /* 分离（避免堆叠） */
    let sx = 0, sy = 0;
    for (let i = 0; i < game.monsters.length; i++) {
      const o = game.monsters[i];
      if (o === m || o.dead) continue;
      const dd = G.dist2(m.x, m.y, o.x, o.y);
      const minD = (m.r + o.r) * 0.95;
      if (dd < minD * minD && dd > 0.01) {
        const dl = Math.sqrt(dd);
        sx += (m.x - o.x) / dl; sy += (m.y - o.y) / dl;
      }
    }

    const toP = { x: (p.x - m.x) / (d || 1), y: (p.y - m.y) / (d || 1) };
    let mvx = 0, mvy = 0;
    const los = G.Dungeon.lineOfSight(game.map, m.x, m.y, p.x, p.y);
    const pref = m.def.kind === 'ranged' || m.def.kind === 'caster' ? Math.min(m.range * 0.7, 240) : m.range * 0.8;

    if (m.isBoss) {
      /* BOSS：远程保持中距离，近战贴身 */
      const want = m.range > 200 ? 200 : m.r + 26;
      if (d > want + 20) { mvx = toP.x; mvy = toP.y; }
      else if (d < want - 60) { mvx = -toP.x; mvy = -toP.y; }
      else if (m.range <= 200) { mvx = toP.x * 0.35; mvy = toP.y * 0.35; }
      // 技能
      m.atkCds.forEach((s) => {
        s.t -= dt;
        if (s.t <= 0 && los) {
          const a = s.atk;
          // 远程技能需要一定距离
          if (a.type === 'nova' && d > (a.radius || 190)) return;
          if (a.type === 'cone' && d > (a.radius || 260)) return;
          if (a.type === 'charge' && d < 80) return;
          s.t = a.cd * (m.enraged ? 0.65 : 1) * G.rand(0.85, 1.2);
          C.bossAttack(game, m, a);
        }
      });
      if (!m.enraged && m.life / m.maxLife < 0.4) {
        m.enraged = true;
        m.speed *= 1.25; m.dmg *= 1.2;
        G.FX.nova(game, m.x, m.y, 200, '#ff4a4a', 0.7);
        G.audio.play('boss');
        G.log(m.name + ' 陷入狂怒！', 'c-unique');
      }
    } else if (m.atkKind === 'melee' || m.atkKind === 'brute' || m.atkKind === 'charger') {
      if (d > pref + m.r) { mvx = toP.x; mvy = toP.y; }
      else if (los) {
        m.facing = Math.atan2(toP.y, toP.x);
        m.cdTimer -= dt;
        if (m.cdTimer <= 0 && d < m.range + m.r + p.r + 6) {
          m.cdTimer = m.atkCd;
          C.monsterAttack(game, m);
        }
      }
      // 冲锋
      if (m.def.charge) {
        m.chargeCd -= dt;
        if (m.chargeCd <= 0 && d < 380 && d > 90 && los) {
          m.chargeCd = m.def.charge.cd * G.rand(0.8, 1.3);
          const a = G.ang(m.x, m.y, p.x, p.y);
          const comps = { physical: m.dmg * m.def.charge.dmg };
          if (m.onHitElem) comps[m.onHitElem] = m.dmg * 0.5;
          m.charge = { t: 0.8, vx: Math.cos(a) * m.def.charge.speed, vy: Math.sin(a) * m.def.charge.speed, comps, hit: false };
          G.audio.play('shout');
        }
      }
    } else {
      /* 远程 / 施法者 */
      const wanted = Math.min(m.range * 0.8, 300);
      if (d > wanted) { mvx = toP.x; mvy = toP.y; }
      else if (d < wanted * 0.55) { mvx = -toP.x; mvy = -toP.y; }
      if (los) {
        m.facing = Math.atan2(toP.y, toP.x);
        m.cdTimer -= dt;
        if (m.cdTimer <= 0 && d < m.range) {
          m.cdTimer = m.atkCd;
          C.monsterAttack(game, m);
        }
        if (m.def.summon) {
          m.summonCd -= dt;
          if (m.summonCd <= 0) {
            m.summonCd = m.def.summonCd;
            for (let i = 0; i < 2; i++) {
              const pos = G.Dungeon.findFree(game.map, m.x + G.rand(-60, 60), m.y + G.rand(-60, 60), 14);
              game.spawnMonster(m.def.summon, pos.x, pos.y, {});
            }
            G.FX.nova(game, m.x, m.y, 80, '#b06fd8', 0.5);
            G.audio.play('portal');
          }
        }
      }
      // 血蝠等 erratic 怪会乱飞
      if (m.def.erratic) {
        m.wanderT -= dt;
        if (m.wanderT <= 0) { m.wanderT = G.rand(0.4, 1.0); m.wanderDir = G.rand(0, G.TAU); }
        mvx += Math.cos(m.wanderDir) * 0.7; mvy += Math.sin(m.wanderDir) * 0.7;
      }
    }

    mvx += sx * 0.9; mvy += sy * 0.9;
    const ml = Math.hypot(mvx, mvy);
    if (ml > 0.05) {
      mvx /= ml; mvy /= ml;
      const step = speed * dt;
      const mv = G.Dungeon.slideMove(game.map, m.x, m.y, mvx * step, mvy * step, m.r);
      if (mv.blocked) {
        // 卡墙时侧移
        const px = -mvy, py = mvx;
        const mv2 = G.Dungeon.slideMove(game.map, m.x, m.y, px * step, py * step, m.r);
        m.x = mv2.x; m.y = mv2.y;
      } else { m.x = mv.x; m.y = mv.y; }
      if (!m.isBoss) m.facing = Math.atan2(mvy, mvx);
    }
    // 受伤时血条可见
    if (m.dmgTaken > 0) m.hpVisible = true;
    if (m.hpVisible) {
      m.hpTimer = (m.hpTimer || 0) + dt;
      if (m.hpTimer > 6 && m.life >= m.maxLife) m.hpVisible = false;
    }
  };

  /* ============================================================
   *  投射物
   * ============================================================ */
  ENT.makeProjectile = function (game, o) {
    const pj = {
      kind: 'projectile', x: o.x, y: o.y, vx: o.vx, vy: o.vy,
      from: o.from, owner: o.owner, elem: o.elem || 'physical', comps: o.comps || {},
      size: o.size || 6, color: o.color || '#ffe9a8', arrow: !!o.arrow, length: o.length || 0,
      explode: o.explode || 0, pierce: o.pierce || 0, life: o.life || 2,
      homing: o.homing || 0, slow: o.slow || 0, dot: o.dot || null, skill: o.skill || null,
      hits: [], rot: Math.atan2(o.vy, o.vx), alive: true, trail: 0, knockback: o.knockback || 0,
      ignite: o.ignite || null, radius: o.explode || 0, mods: o.mods || null,
    };
    game.projectiles.push(pj);
    return pj;
  };

  ENT.updateProjectile = function (game, pj, dt) {
    pj.life -= dt;
    if (pj.life <= 0) { pj.alive = false; return; }
    const p = game.player;

    /* 追踪 */
    if (pj.homing) {
      let target = null, bd = 1e9;
      if (pj.from === 'player') {
        game.monsters.forEach((m) => { if (!m.dead) { const d = G.dist2(pj.x, pj.y, m.x, m.y); if (d < bd) { bd = d; target = m; } } });
      } else if (!p.dead) target = p;
      if (target) {
        const want = Math.atan2(target.y - pj.y, target.x - pj.x);
        const cur = Math.atan2(pj.vy, pj.vx);
        const na = cur + G.clamp(G.angDiff(cur, want), -pj.homing * dt, pj.homing * dt);
        const sp = Math.hypot(pj.vx, pj.vy);
        pj.vx = Math.cos(na) * sp; pj.vy = Math.sin(na) * sp;
      }
    }
    pj.rot = Math.atan2(pj.vy, pj.vx);
    const steps = Math.max(1, Math.ceil(Math.hypot(pj.vx, pj.vy) * dt / 14));
    for (let s = 0; s < steps; s++) {
      pj.x += pj.vx * dt / steps;
      pj.y += pj.vy * dt / steps;
      // 撞墙
      if (G.Dungeon.solidAtWorld(game.map, pj.x, pj.y)) {
        pj.alive = false;
        if (pj.explode) ENT.explode(game, pj);
        else { G.FX.spark(game, pj.x, pj.y, 4, pj.color, 90, 2); }
        return;
      }
      // 命中判定
      if (pj.from === 'player') {
        for (let i = 0; i < game.monsters.length; i++) {
          const m = game.monsters[i];
          if (m.dead || pj.hits.indexOf(m) >= 0) continue;
          if (G.dist(pj.x, pj.y, m.x, m.y) < m.r + pj.size) {
            pj.hits.push(m);
            C.hitMonster(game, m, pj.comps, { skill: pj.skill, elem: pj.elem, knockback: pj.knockback, dot: pj.dot, mods: pj.mods });
            if (pj.ignite) C.applyDot(game, m, { key: 'ignite', elem: 'fire', dps: (pj.ignite.dps || 20), dur: pj.ignite.dur }, true);
            if (pj.slow) C.applySlow(game, m, pj.slow, 2.5);
            if (pj.explode) { ENT.explode(game, pj); return; }
            if (pj.hits.length > pj.pierce) { pj.alive = false; return; }
            break;
          }
        }
      } else if (!p.dead) {
        if (G.dist(pj.x, pj.y, p.x, p.y) < p.r + pj.size) {
          C.hitPlayer(game, pj.comps, { source: pj.owner });
          if (pj.slow) C.applySlow(game, p, pj.slow, 2);
          if (pj.dot) C.applyDot(game, p, { key: 'poison', elem: 'poison', dps: pj.dot.dps, dur: pj.dot.dur }, false);
          if (pj.explode) { ENT.explode(game, pj); return; }
          pj.alive = false;
          return;
        }
      }
    }
    // 拖尾
    pj.trail -= dt;
    if (pj.trail <= 0 && (pj.elem !== 'physical' || pj.size > 8)) {
      pj.trail = 0.03;
      game.particles.push({ x: pj.x, y: pj.y, vx: G.rand(-12, 12), vy: G.rand(-12, 12), life: 0.24, max: 0.24, size: pj.size * 0.7, color: pj.color, type: 'spark', drag: 3 });
    }
  };

  ENT.explode = function (game, pj) {
    const R = pj.explode;
    G.FX.nova(game, pj.x, pj.y, R, pj.color, 0.42);
    G.FX.ring(game, pj.x, pj.y, R, pj.color);
    G.audio.play('explode');
    game.shake(5);
    if (pj.from === 'player') {
      game.monsters.forEach((m) => {
        if (m.dead || pj.hits.indexOf(m) >= 0) return;
        if (G.dist(pj.x, pj.y, m.x, m.y) < R + m.r) {
          pj.hits.push(m);
          C.hitMonster(game, m, pj.comps, { skill: pj.skill, elem: pj.elem, knockback: 40, dot: pj.dot, mods: pj.mods });
          if (pj.ignite) C.applyDot(game, m, { key: 'ignite', elem: 'fire', dps: pj.ignite.dps, dur: pj.ignite.dur }, true);
        }
      });
    } else {
      const p = game.player;
      if (!p.dead && G.dist(pj.x, pj.y, p.x, p.y) < R + p.r) C.hitPlayer(game, pj.comps, { source: pj.owner });
    }
    ENT.breakProps(game, pj.x, pj.y, R);
  };

  /* ============================================================
   *  地面效果
   * ============================================================ */
  ENT.updateGround = function (game, g, dt) {
    g.dur -= dt;
    if (g.telegraph != null && g.telegraph > 0) {
      g.telegraph -= dt;
      if (g.telegraph <= 0 && g.once) {
        G.FX.nova(game, g.x, g.y, g.r, g.color, 0.45);
        G.audio.play('explode');
        game.shake(6);
        if (g.from === 'monster') {
          const p = game.player;
          if (!p.dead && G.dist(g.x, g.y, p.x, p.y) < g.r + p.r) C.hitPlayer(game, g.comps, {});
        } else {
          game.monsters.forEach((m) => { if (!m.dead && G.dist(g.x, g.y, m.x, m.y) < g.r + m.r) C.hitMonster(game, m, g.comps, { elem: g.elem, skill: g.skill, mods: g.mods }); });
        }
        ENT.breakProps(game, g.x, g.y, g.r);
        // 落地后只保留视觉，不再重复造成伤害
        g.once = false;
        g.telegraph = null;
        g.comps = {};
        g.dur = Math.min(g.dur, 0.45);
      }
      return;
    }
    g.timer -= dt;
    if (g.timer <= 0) {
      g.timer += g.tick;
      if (g.from === 'player') {
        game.monsters.forEach((m) => {
          if (!m.dead && G.dist(g.x, g.y, m.x, m.y) < g.r + m.r) C.hitMonster(game, m, g.comps, { elem: g.elem, skill: g.skill, isDot: true, canCrit: false, mods: g.mods });
        });
      } else {
        const p = game.player;
        if (!p.dead && G.dist(g.x, g.y, p.x, p.y) < g.r + p.r) C.hitPlayer(game, g.comps, {});
      }
    }
    if (g.tick <= 0.34 && G.chance(0.35)) {
      game.particles.push({
        x: g.x + G.rand(-g.r, g.r) * 0.85, y: g.y + G.rand(-g.r, g.r) * 0.85,
        vx: G.rand(-10, 10), vy: G.rand(-26, -6), life: G.rand(0.4, 0.9), max: 0.9,
        size: G.rand(4, 9), color: g.color || '#8ce07a', type: 'smoke', drag: 1.2,
      });
    }
    if (g.dur <= 0 && g.telegraph == null) ENT.breakProps(game, g.x, g.y, g.r * 0.5);
  };

  /* ============================================================
   *  掉落物
   * ============================================================ */
  ENT.makePickup = function (game, x, y, item) {
    const pos = G.Dungeon.findFree(game.map, x + G.rand(-14, 14), y + G.rand(-14, 14), 8, 12);
    const pk = { kind: 'pickup', x: pos.x, y: pos.y, item, bob: G.rand(0, 6.28), life: 600, r: 10 };
    game.pickups.push(pk);
    return pk;
  };
  ENT.updatePickup = function (game, pk, dt) {
    pk.bob += dt * 3;
    pk.life -= dt;
    if (pk.life <= 0) pk.dead = true;
  };

  /* ============================================================
   *  可破坏物
   * ============================================================ */
  ENT.makeProp = function (game, x, y, type) {
    return { kind: 'prop', x, y, type, r: type === 'chest' ? 16 : 12, hp: type === 'chest' ? 2 : 1, hitFlash: 0 };
  };
  ENT.updateProp = function (game, pr, dt) {
    pr.hitFlash = Math.max(0, pr.hitFlash - dt);
  };
  ENT.breakProps = function (game, x, y, radius) {
    for (let i = game.props.length - 1; i >= 0; i--) {
      const pr = game.props[i];
      if (G.dist(x, y, pr.x, pr.y) > radius + pr.r) continue;
      pr.hp--;
      pr.hitFlash = 0.15;
      if (pr.hp > 0) continue;
      game.props.splice(i, 1);
      const isChest = pr.type === 'chest';
      G.FX.shatter(game, pr.x, pr.y, isChest ? 16 : 9, isChest ? '#c8a45c' : '#8a7a5c');
      G.audio.play(isChest ? 'lootRare' : 'hit');
      const mlvl = game.mlvl;
      const drops = L.rollDrops(game.rng, {
        mlvl: isChest ? mlvl + 4 : mlvl, mf: game.player.stats.mf, gf: game.player.stats.gf,
        plvl: game.player.level,
        kind: isChest ? 'elite' : 'normal', mult: isChest ? 3.2 : 0.55, cls: game.player.cls,
        floor: game.floor, diffQuality: D.diffOf(game.diffIdx).quality,
        orbBonus: G.Town.orbBonus(game.player),
        shardBonus: G.Town.shardBonus(game.player),
      });
      game.dropLoot(pr.x, pr.y, drops);
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
