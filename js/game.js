/* ============================================================
 *  暗影深渊 · game.js
 *  游戏主控：世界状态 / 楼层推进 / 刷怪 / 拾取 / 存档
 * ============================================================ */
(function (root) {
  'use strict';
  const G = root.G;
  const D = G.DATA;
  const L = G.Loot;
  const S = G.Stats;
  const C = G.Combat;
  const ENT = G.ENT;
  const R = G.Render;
  const TILE = 44;

  function Game(seed) {
    this.rng = G.RNG(seed || (Date.now() ^ 0x5f3a1c) >>> 0);
    this.player = null;
    this.map = null;
    this.explored = null;
    this.floor = 1;
    this.diffIdx = 0;
    this.mlvl = 1;
    this.killed = 0;
    this.totalMonsters = 0;
    this.portalOpen = false;
    this.bossAlive = false;
    this.paused = false;
    this.time = 0;
    this.frame = 0;
    this.autosaveTimer = 0;
    this.deathTimer = 0;
    this.damageVignette = 0;
    this.phoenixUsed = false;
    this.started = false;
    this.slot = 0;             // 存档位
    this.area = 'dungeon';     // 'dungeon' | 'town'
    this.townMap = null;       // 缓存的城镇地图
    this.lastTownAt = 0;
    this.floorCache = null;    // 当前层深渊的快照（只保留一层）

    this.monsters = [];
    this.projectiles = [];
    this.grounds = [];
    this.pickups = [];
    this.props = [];
    this.particles = [];
    this.texts = [];
    this.fx = [];

    this.busKill = (m) => {
      if (this.player) this.player.kills++;
      this.checkFloorClear();
    };
  }
  G.Game = Game;

  Game.prototype.log = function (msg, cls) { G.log(msg, cls); };

  Game.prototype.shake = function (v) { R.cam.shake = Math.max(R.cam.shake, v); };

  Game.prototype.aimWorld = function () {
    if (!this.player) return { x: 0, y: 0 };
    if (G.HEADLESS) return { x: this.player.x + Math.cos(this.player.facing) * 120, y: this.player.y + Math.sin(this.player.facing) * 120 };
    const w = R.screenToWorld(G.input.mouse.x, G.input.mouse.y);
    return w;
  };

  Game.prototype.uiCapturing = function () {
    // 只有暂停时屏蔽世界输入；打开面板时用 DOM 自身拦截鼠标，
    // 键盘仍可操作角色（与暗黑类游戏一致）
    return this.paused;
  };

  /* ============================================================
   *  开局
   * ============================================================ */
  Game.prototype.startClass = function (clsId, slot) {
    this.slot = slot == null ? 0 : (slot | 0);
    this.player = ENT.makePlayer(this, clsId);
    this.floor = 1;
    this.diffIdx = 0;
    this.phoenixUsed = false;
    this.started = true;
    this.area = 'town';
    this.enterTown({ first: true, silent: true });
    if (G.UI.game === this) G.UI.onNewPlayer();
    this.log('欢迎来到暗影深渊。你在余烬营地醒来 —— 深渊之门就在营地南侧。', 'c-rare');
    this.log('提示：走近 NPC 按 ' + G.Settings.actionLabel('pickup', 'F') + ' 交谈；站上深渊之门按 ' + G.Settings.actionLabel('pickup', 'F') + ' 进入地牢。', 'dim');
    this.save();
  };

  Game.prototype.resetToStart = function () {
    this.player = null;
    this.monsters = []; this.projectiles = []; this.grounds = []; this.pickups = [];
    this.props = []; this.particles = []; this.texts = []; this.fx = [];
    this.floor = 1; this.diffIdx = 0; this.started = false;
    this.area = 'town'; this.townMap = null;
    this.floorCache = null;
    G.UI.showStart();
    G.UI.buildStart(this);
  };

  /* ============================================================
   *  城镇
   * ============================================================ */
  Game.prototype.enterTown = function (opts) {
    opts = opts || {};
    this.area = 'town';
    if (!this.townMap) this.townMap = G.Town.generate(this.rng);
    this.map = this.townMap;
    this.explored = this.exploredTown || (this.exploredTown = new Uint8Array(this.map.w * this.map.h));
    this.killed = 0;
    this.totalMonsters = 0;
    this.portalOpen = false;
    this.bossAlive = false;
    this.monsters = [];
    this.projectiles = [];
    this.grounds = [];
    this.pickups = [];
    this.props = this.map.props.map((pr) => ENT.makeProp(this, pr.x, pr.y, pr.type));
    this.particles = [];
    this.texts = [];
    this.fx = [];

    const p = this.player;
    if (p) {
      const spawn = opts.atGate === false ? this.map.playerStart : { x: this.map.gate.x, y: this.map.gate.y - 54 };
      const free = G.Dungeon.findFree(this.map, spawn.x, spawn.y, p.r);
      p.x = free.x; p.y = free.y;
      p.moveTarget = null; p.attackTarget = null; p.pendingPickup = null; p.pendingNpc = null;
      p.aimAttack = false; p.forceAim = false; p.jump = null; p.dots = []; p.invuln = 1.5;
      p.life = Math.max(p.life, p.stats.maxLife * 0.5);
      p.mana = Math.max(p.mana, p.stats.maxMana * 0.5);
    }
    if (G.UI.game === this) G.UI.anchor = null;   // 换场景时不再追踪之前的 NPC
    this.lastTownAt = this.time;
    if (!opts.silent) this.log('你回到了【余烬营地】。', 'c-rare');
    this.autosaveTimer = 0;
    if (G.UI.game === this) {
      G.UI.dirty.vendor = true;
      G.UI.dirty.inv = true;
      G.UI.rollVendorStock();
    }
    this.save();
  };

  Game.prototype.nearGate = function (radius) {
    if (this.area !== 'town' || !this.map || !this.map.gate || !this.player) return false;
    return G.dist(this.player.x, this.player.y, this.map.gate.x, this.map.gate.y) < (radius || 70);
  };

  Game.prototype.interactGate = function () {
    if (this.area !== 'town') return;
    G.UI.openRift(this.map.gate ? { x: this.map.gate.x, y: this.map.gate.y, r: 130, name: '深渊之门' } : null);
  };

  Game.prototype.interactNpc = function (npc) {
    if (!npc) return;
    if (G.UI && G.UI.openNpcPanel) G.UI.openNpcPanel(npc);
  };

  // 地牢入口处 / 训练场的回城传送门
  Game.prototype.townPortalAt = function (x, y, r) {
    if ((this.area !== 'dungeon' && this.area !== 'training') || !this.map || !this.map.townPortal) return false;
    return G.dist(x, y, this.map.townPortal.x, this.map.townPortal.y) < (r || 46);
  };

  Game.prototype.toTown = function (reason) {
    if (this.area === 'town' || !this.player) return false;
    /* 战斗中不能直接回城（避免用回城躲避死亡） */
    if (reason === 'recall') {
      let near = null;
      for (let i = 0; i < this.monsters.length; i++) {
        const m = this.monsters[i];
        if (m.dead || m.spawnT > 0) continue;
        if (m.def && m.def.dummy) continue;               // 训练假人拦不住回城
        if (G.dist(m.x, m.y, this.player.x, this.player.y) < 300) { near = m; break; }
      }
      if (near) { this.log('附近还有敌人，无法使用回城（先脱离战斗）。', 'c-boss'); G.audio.play('noskill'); return false; }
    }
    const left = this.pickups.filter((pk) => pk.item && pk.item.cat === 'equip' &&
      !G.UI.filterHidden(pk.item)).length;
    if (left) this.log('你离开了地牢，地上遗留的 ' + left + ' 件装备被深渊吞没了。', 'dim');
    // 只有从深渊里出来才需要记住这一层；从训练场出来别把练功房当成地牢缓存
    if (this.area === 'dungeon') this.floorCache = this.serializeFloor();
    this.enterTown({});
    return true;
  };

  Game.prototype.toDungeon = function (floor) {
    if (!this.player) return false;
    this.enterFloor(Math.max(1, Math.round(floor || 1)));
    this.save();
    return true;
  };

  Game.prototype.maxUnlockedFloor = function () {
    return Math.max(1, this.player ? (this.player.maxFloor || 1) : 1);
  };

  /* ============================================================
   *  楼层
   * ============================================================ */
  /* ============================================================
   *  当前层的深渊缓存
   *  ------------------------------------------------------------
   *  只保留「当前这一层」：回城 / 刷新页面后再进同一层，怪物、掉落、
   *  已破坏的物件与探索进度都会原样恢复；一旦进入别的层数，旧缓存作废。
   * ============================================================ */
  const u8ToStr = (arr) => {
    let s = '';
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return s;
  };
  const strToU8 = (s, len) => {
    const out = new Uint8Array(len);
    for (let i = 0; i < len && i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
    return out;
  };

  Game.prototype.serializeFloor = function () {
    if (this.area !== 'dungeon' || !this.map || !this.player) return null;
    const m = this.map;
    const p = this.player;
    return {
      floor: this.floor, diffIdx: this.diffIdx, mlvl: this.mlvl,
      map: {
        w: m.w, h: m.h, floor: m.floor, isBoss: m.isBoss, theme: m.theme || null,
        tiles: u8ToStr(m.tiles), variant: u8ToStr(m.variant),
        rooms: m.rooms, corridors: m.corridors, torches: m.torches, decor: m.decor,
        wallTiles: m.wallTiles, spawns: m.spawns,
        playerStart: m.playerStart, stairs: m.stairs, stairsRoom: m.stairsRoom || null,
        arena: m.arena || null, bossPos: m.bossPos || null, townPortal: m.townPortal || null,
        area: 'dungeon', totalMonsters: this.totalMonsters,
      },
      state: {
        killed: this.killed, totalMonsters: this.totalMonsters,
        portalOpen: this.portalOpen, bossAlive: this.bossAlive,
        playerX: p.x, playerY: p.y, life: p.life, mana: p.mana,
      },
      monsters: this.monsters.map((mo) => {
        const o = Object.assign({}, mo);
        delete o.def;
        o.defId = mo.id;
        o.dots = (mo.dots || []).map((d) => Object.assign({}, d));
        return o;
      }),
      props: this.props.map((pr) => ({ x: pr.x, y: pr.y, type: pr.type, hp: pr.hp, r: pr.r, broken: !!pr.broken })),
      pickups: this.pickups.map((pk) => ({ x: pk.x, y: pk.y, item: pk.item, bob: pk.bob, life: pk.life, r: pk.r })),
      explored: u8ToStr(this.explored || new Uint8Array(m.w * m.h)),
    };
  };

  Game.prototype.restoreFloor = function (cache) {
    if (!cache || !cache.map) return false;
    const m = cache.map;
    m.tiles = strToU8(m.tiles, m.w * m.h);
    m.variant = strToU8(m.variant, m.w * m.h);
    m.area = 'dungeon';
    this.area = 'dungeon';
    this.floor = cache.floor;
    this.diffIdx = G.clamp(cache.diffIdx | 0, 0, D.MAX_DIFF);
    this.mlvl = cache.mlvl || G.mlvlOf(this.floor, this.diffIdx);
    m.theme = m.theme || (D.ABYSS_THEMES[0] && D.ABYSS_THEMES[0].id);   // 老缓存没有风格字段时兜底
    this.map = m;

    this.explored = strToU8(cache.explored || '', m.w * m.h);
    const st = cache.state || {};
    this.killed = st.killed | 0;
    this.totalMonsters = st.totalMonsters | 0;
    this.portalOpen = !!st.portalOpen;
    this.portalOpenAt = 0;
    this.phoenixUsed = false;
    this.bossAlive = !!st.bossAlive;
    this.autosaveTimer = 0;

    this.monsters = (cache.monsters || []).map((saved) => {
      const mo = Object.assign({}, saved);
      mo.def = D.defById ? D.defById(mo.defId) : null;
      delete mo.defId;
      if (!mo.def) return null;
      mo.dots = mo.dots || [];
      if (mo.slow === undefined) mo.slow = null;
      // 抗性是按怪物等级 / 难度算出来的，老缓存里没有 → 这里补上
      mo.res = G.monsterResists(mo.mlvl || this.mlvl, this.diffIdx);
      return mo;
    }).filter(Boolean);
    this.props = (cache.props || []).map((pr) => ({
      kind: 'prop', x: pr.x, y: pr.y, type: pr.type, hp: pr.hp == null ? 1 : pr.hp,
      r: pr.r || 12, broken: !!pr.broken, hitFlash: 0,
    }));
    this.pickups = (cache.pickups || []).map((pk) => ({
      kind: 'pickup', x: pk.x, y: pk.y, item: pk.item, bob: pk.bob || 0, life: pk.life || 600, r: pk.r || 10,
    }));
    this.projectiles = [];
    this.grounds = [];
    this.particles = [];
    this.texts = [];
    this.fx = [];

    const p = this.player;
    if (p) {
      p.x = st.playerX != null ? st.playerX : m.playerStart.x;
      p.y = st.playerY != null ? st.playerY : m.playerStart.y;
      p.moveTarget = null; p.attackTarget = null; p.pendingPickup = null; p.pendingNpc = null;
      p.aimAttack = false; p.forceAim = false; p.jump = null;
      p.invuln = 1.2;
      p.dots = [];
      if (st.life != null) p.life = Math.min(p.stats.maxLife, Math.max(1, st.life));
      if (st.mana != null) p.mana = Math.min(p.stats.maxMana, Math.max(0, st.mana));
    }
    return true;
  };

  Game.prototype.enterFloor = function (floor, opts) {
    opts = opts || {};
    /* 同一层且有缓存 → 原样恢复（回城再回来 / 刷新页面） */
    const cache = opts.ignoreCache ? null : this.floorCache;
    if (cache && cache.floor === floor && !opts.fresh) {
      if (this.restoreFloor(cache)) {
        this.floorCache = cache;
        this.log('回到深渊第 ' + floor + ' 层，这里的一切都还在。', 'c-rare');
        G.audio.play('portal');
        if (G.UI.game === this) { G.UI.anchor = null; G.UI.onAreaChanged(); }
        this.save();
        return;
      }
    }
    this.floorCache = null;           // 换了层数 → 旧缓存作废
    this.area = 'dungeon';
    this.floor = floor;
    if (this.player) this.player.maxFloor = Math.max(this.player.maxFloor || 1, floor);
    this.mlvl = G.mlvlOf(floor, this.diffIdx);
    const map = G.Dungeon.generate(this.rng, { floor, diffIdx: this.diffIdx });
    this.map = map;
    this.explored = new Uint8Array(map.w * map.h);
    this.killed = 0;
    this.portalOpen = false;
    this.portalOpenAt = 0;
    this.phoenixUsed = false;
    this.bossAlive = false;

    this.monsters = [];
    this.projectiles = [];
    this.grounds = [];
    this.pickups = [];
    this.props = [];
    this.particles = [];
    this.texts = [];
    this.fx = [];

    const p = this.player;
    p.x = map.playerStart.x;
    p.y = map.playerStart.y;
    p.moveTarget = null;
    p.attackTarget = null;
    p.pendingPickup = null;
    p.pendingNpc = null;
    p.aimAttack = false;
    p.forceAim = false;
    p.jump = null;
    p.invuln = 2;
    p.life = Math.max(p.life, p.stats.maxLife * 0.5);
    p.mana = Math.max(p.mana, p.stats.maxMana * 0.5);
    p.dots = [];

    /* 入口处的回城传送门：站上去按 F 就能把战利品带回城镇 */
    const tpPos = G.Dungeon.findFree(map, map.playerStart.x - 56, map.playerStart.y, 14);
    map.townPortal = { x: tpPos.x, y: tpPos.y };

    // 刷怪
    let count = 0;
    map.spawns.forEach((sp) => {
      const pos = G.Dungeon.tileCenter(sp.tx, sp.ty);
      const free = G.Dungeon.findFree(map, pos.x, pos.y, 14);
      if (sp.kind === 'monster') {
        if (this.monsters.length > 150) return;
        const mo = ENT.makeMonster(this, sp.mob, free.x, free.y, { thrall: sp.thrall });
        if (mo) { this.monsters.push(mo); count++; }
      } else if (sp.kind === 'elite') {
        const mo = ENT.makeMonster(this, sp.mob, free.x, free.y, { elite: true });
        if (mo) { this.monsters.push(mo); count++; }
      } else if (sp.kind === 'boss') {
        const bo = ENT.makeBoss(this, sp.boss, free.x, free.y);
        this.monsters.push(bo);
        this.bossAlive = true;
        count++;
        this.log('⚠ ' + bo.name + ' 苏醒了！', 'c-boss');
        G.audio.play('boss');
      }
    });
    this.totalMonsters = count;
    // 可破坏物
    map.props.forEach((pr) => this.props.push(ENT.makeProp(this, pr.x, pr.y, pr.type)));

    const diff = D.diffOf(this.diffIdx);
    this.log('—— 深渊第 ' + floor + ' 层　·　' + diff.name + '　·　怪物等级 ' + this.mlvl + ' ——', map.isBoss ? 'c-boss' : 'c-rare');
    G.audio.play('portal');
    this.autosaveTimer = 0;
    if (G.UI.game === this) { G.UI.anchor = null; G.UI.rollVendorStock(); G.UI.dirty.vendor = true; }
    this.save();
  };

  Game.prototype.nextFloor = function () {
    this.enterFloor(this.floor + 1);
  };

  /* ============================================================
   *  训练场（戈登）
   *  ------------------------------------------------------------
   *  独立场景：不刷怪、不掉落、不算进度；假人不会还手也打不死，
   *  用来测伤害。进来时保留原本的深渊层缓存，走出去（传送门 / 回城）
   *  就回营地，再进深渊还是原来那一层。
   * ============================================================ */
  Game.prototype.resetTrain = function () {
    const t = this.clock || 0;
    this.train = { total: 0, hits: 0, crits: 0, peak: 0, session: t, last: t, log: [] };
  };

  Game.prototype.trainHit = function (dmg, crit) {
    if (!(dmg > 0)) return;
    if (!this.train) this.resetTrain();
    const t = this.train;
    const now = this.clock || 0;
    if (now - t.last > 3) { t.session = now; t.log.length = 0; }   // 停手超过 3 秒 → 重新算一段
    t.total += dmg;
    t.hits++;
    if (crit) t.crits++;
    t.last = now;
    t.log.push({ t: now, d: dmg });
    if (t.log.length > 800) t.log.splice(0, t.log.length - 800);
  };

  // 最近 win 秒的平均 DPS（会顺手记录峰值）
  Game.prototype.trainDps = function (win) {
    const t = this.train;
    if (!t || !t.log.length) return 0;
    const now = this.clock || 0, w = win || 5;
    let sum = 0;
    for (let i = t.log.length - 1; i >= 0; i--) {
      const e = t.log[i];
      if (now - e.t > w) break;
      sum += e.d;
    }
    const span = G.clamp(now - (t.session || now), 0.5, w);
    const dps = sum / span;
    if (dps > t.peak) t.peak = dps;
    return dps;
  };

  Game.prototype.enterTraining = function (mode) {
    if (!this.player) return false;
    const md = D.trainingModeById ? D.trainingModeById(mode) : { id: 'single', name: '训练场' };
    // 正在深渊里直接进练功房的话，先把这一层记下来，回头还能接着打
    if (this.area === 'dungeon' && this.map) this.floorCache = this.serializeFloor();
    this.area = 'training';
    this.trainingMode = md.id;
    const map = G.Dungeon.makeTraining(this.rng, { mode: md.id });
    this.map = map;
    this.explored = new Uint8Array(map.w * map.h);
    this.explored.fill(1);                       // 练功房不用探索
    this.killed = 0;
    this.totalMonsters = 0;
    this.portalOpen = false;
    this.portalOpenAt = 0;
    this.phoenixUsed = false;
    this.bossAlive = false;
    this.monsters = [];
    this.projectiles = [];
    this.grounds = [];
    this.pickups = [];
    this.props = [];
    this.particles = [];
    this.texts = [];
    this.fx = [];
    this.resetTrain();

    const p = this.player;
    p.x = map.playerStart.x;
    p.y = map.playerStart.y;
    p.moveTarget = null; p.attackTarget = null; p.pendingPickup = null; p.pendingNpc = null;
    p.aimAttack = false; p.forceAim = false; p.jump = null;
    p.invuln = 1.5;
    p.dots = [];

    (map.dummySpots || []).forEach((sp) => {
      const mo = ENT.makeMonster(this, sp.def, sp.x, sp.y);
      if (!mo) return;
      mo.maxLife = mo.life = 1e12;      // 厚到打不死
      mo.dmg = 0;
      mo.aggro = false;
      mo.spawnT = 0;
      mo.dummy = true;
      mo.elite = false;
      if (sp.def === 'dummy_boss') mo.isBoss = true;
      this.monsters.push(mo);
    });

    this.log('—— 训练场 · ' + md.name + ' ——　假人不会还手也打不死，屏幕左下角显示 DPS。', 'c-rare');
    this.log('测完从旁边的传送门按 ' + G.Settings.actionLabel('pickup', 'F') + ' 离开（或脱战后按 ' + G.Settings.actionLabel('recall', 'T') + '）。', 'dim');
    G.audio.play('portal');
    this.autosaveTimer = 0;
    if (G.UI.game === this) { G.UI.anchor = null; G.UI.onAreaChanged(); }
    this.save();
    return true;
  };

  Game.prototype.checkFloorClear = function () {
    if (this.portalOpen) return;
    if (!this.totalMonsters) return;          // 城镇 / 训练场没有怪物，也没传送门要开
    if (this.map && this.map.isBoss) {
      if (!this.bossAlive) {
        this.openPortal();
        this.log('BOSS 已被击败！传送门已在附近开启，按 ' + G.Settings.actionLabel('pickup', 'F') + ' 进入下一层。', 'c-rare');
      }
      return;
    }
    const need = Math.ceil(this.totalMonsters * 0.8);
    if (this.killed >= need) {
      this.openPortal();
      this.log('怪物已被清除，传送门已在附近开启，按 ' + G.Settings.actionLabel('pickup', 'F') + ' 进入下一层。', 'c-rare');
    }
  };

  /* 开启传送门，并把门挪到玩家附近（不再需要满地图找） */
  Game.prototype.openPortal = function () {
    this.portalOpen = true;
    this.portalOpenAt = this.time;
    this.movePortalNearPlayer();
    G.audio.play('portal');
    G.FX.nova(this, this.map.stairs.x, this.map.stairs.y, 90, '#c07aff', 0.6);
  };

  Game.prototype.movePortalNearPlayer = function () {
    const p = this.player;
    if (!p || !this.map) return;
    for (let i = 0; i < 80; i++) {
      const a = G.rand(0, G.TAU);
      const d = G.rand(70, 140);
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (!G.Dungeon.circleBlocked(this.map, x, y, 22)) { this.map.stairs = { x, y }; break; }
    }
    this.portalOpenAt = this.time;
  };

  // 玩家是否站在（本层）传送门旁
  Game.prototype.atPortal = function (r) {
    if (!this.portalOpen || !this.map || !this.map.stairs || !this.player) return false;
    if ((this.time - (this.portalOpenAt || 0)) < 0.6) return false;   // 刚开门的瞬间防止误触
    return G.dist(this.player.x, this.player.y, this.map.stairs.x, this.map.stairs.y) < (r || 60);
  };

  Game.prototype.onBossKilled = function (m) {
    this.bossAlive = false;
    this.phoenixUsed = false;
    const p = this.player;
    this.log('★ 你击败了 ' + m.name + '！', 'c-unique');
    // 大幅奖励
    const drops = L.rollDrops(this.rng, { mlvl: this.mlvl + 6, mf: p.stats.mf + 120, gf: p.stats.gf, plvl: p.level + 2, kind: 'boss', mult: 2.4, cls: p.cls, floor: this.floor, diffQuality: D.diffOf(this.diffIdx).quality, orbBonus: G.Town.orbBonus(p), shardBonus: G.Town.shardBonus(p) });
    this.dropLoot(m.x, m.y, drops);
    for (let i = 0; i < 3; i++) this.dropLoot(m.x, m.y, [L.makeGem(this.rng, this.mlvl + 10)]);
    p.potions.life.count += 2;
    p.potions.mana.count += 2;
    p.life = p.stats.maxLife;
    p.mana = p.stats.maxMana;
    G.FX.nova(this, m.x, m.y, 240, '#ffe45c', 1.0);
    /* 难度不再自动提升：在当前难度打下「下一个 5 的倍数层」的领主才解锁下一档 */
    if (!p.diffCleared) p.diffCleared = {};
    const prev = p.diffCleared[this.diffIdx] | 0;
    if (this.floor > prev) p.diffCleared[this.diffIdx] = this.floor;
    const next = this.diffIdx + 1;
    if (next <= D.MAX_DIFF) {
      const need = D.diffUnlock(next);
      if ((p.diffCleared[this.diffIdx] | 0) >= need.floor && (p.diffUnlocked | 0) < next) {
        p.diffUnlocked = next;
        const nd = D.diffOf(next);
        this.log('☠ 已解锁新难度【' + nd.name + '】！去深渊之门选择它，怪物更强、掉落更好。', 'c-boss');
        G.FX.nova(this, p.x, p.y, 200, nd.color, 0.9);
      } else if ((p.diffCleared[this.diffIdx] | 0) < need.floor) {
        this.log('继续深入：在本难度击败第 ' + need.floor + ' 层的领主即可解锁【' + D.diffOf(next).name + '】。', 'dim');
      }
    } else {
      this.log('已在最高难度，深渊将无限延伸……', 'c-unique');
    }
    this.portalOpen = true;
    this.movePortalNearPlayer();
    this.save();
  };

  /* 某一档难度是否已解锁（存档进度，与当前选择无关） */
  Game.prototype.diffUnlockedAt = function (idx) {
    const p = this.player;
    if (idx <= 0) return true;
    return (p.diffUnlocked | 0) >= idx;
  };
  /* 已解锁的最高难度（用于界面显示与选择上限） */
  Game.prototype.maxUnlockedDiff = function () {
    return G.clamp(this.player.diffUnlocked | 0, 0, D.MAX_DIFF);
  };
  /* 切换当前难度（只在城镇、未进本时允许）。换难度会让缓存的那层数值不再匹配，直接作废 */
  Game.prototype.setDiff = function (idx) {
    const p = this.player;
    const want = G.clamp(idx | 0, 0, D.MAX_DIFF);
    if (want > this.maxUnlockedDiff()) return { ok: false, why: '尚未解锁' };
    if (this.diffIdx === want) return { ok: true, same: true };
    this.diffIdx = want;
    this.floorCache = null;
    this.mlvl = G.mlvlOf(this.floor, this.diffIdx);
    return { ok: true };
  };

  Game.prototype.onPlayerDeath = function () {
    const p = this.player;
    p.kills = p.kills || 0;
    const lost = Math.floor(p.gold * G.BALANCE.deathGoldLoss);
    p.gold -= lost;
    this.deathTimer = 3;
    this.damageVignette = 1;
    this.log('你死了…… 损失了 ' + lost + ' 金币，3 秒后在本层入口复活。', 'c-boss');
    this.save();
  };

  Game.prototype.respawn = function () {
    const p = this.player;
    p.dead = false;
    p.deadT = 0;
    p.x = this.map.playerStart.x;
    p.y = this.map.playerStart.y;
    p.life = p.stats.maxLife * 0.6;
    p.mana = p.stats.maxMana * 0.6;
    p.invuln = 2.5;
    p.dots = [];
    p.buffs = [];
    p.attackTarget = null;
    p.moveTarget = null;
    S.derive(p);
    G.FX.nova(this, p.x, p.y, 120, '#7aa8ff', 0.6);
    this.log('你在入口处重新站起。', 'dim');
  };

  /* ============================================================
   *  世界操作
   * ============================================================ */
  Game.prototype.spawnMonster = function (defId, x, y, opts) {
    if (this.monsters.length > 150) return null;
    const m = ENT.makeMonster(this, defId, x, y, opts || {});
    if (m) {
      m.spawnT = 0.45;
      m.aggro = true;
      this.monsters.push(m);
    }
    return m;
  };

  Game.prototype.dropLoot = function (x, y, items) {
    if (!items) return;
    items.forEach((it) => {
      if (!it) return;
      ENT.makePickup(this, x, y, it);
    });
  };

  Game.prototype.monsterAt = function (x, y, r) {
    let best = null, bd = 1e9;
    for (let i = 0; i < this.monsters.length; i++) {
      const m = this.monsters[i];
      if (m.dead || m.spawnT > 0.3) continue;
      const d = G.dist(x, y, m.x, m.y);
      if (d < m.r + (r || 20) && d < bd) { bd = d; best = m; }
    }
    return best;
  };

  /* 鼠标能点到哪个掉落物：被过滤器隐藏的平时点不到，
   * 但长按「显示全部装备」键时能点（点过去之后也只是「这一次」能捡，见 collectPickup） */
  Game.prototype.pickupAt = function (x, y, r) {
    let best = null, bd = 1e9;
    const reveal = G.UI.revealHeld();
    for (let i = 0; i < this.pickups.length; i++) {
      const pk = this.pickups[i];
      if (!reveal && G.UI.filterHidden(pk.item)) continue;
      const d = G.dist(x, y, pk.x, pk.y);
      if (d < (r || 22) && d < bd) { bd = d; best = pk; }
    }
    return best;
  };

  /* force = true 只由「长按显示键 + 鼠标点地上的装备」这条路径传入 */
  Game.prototype.collectPickup = function (pk, force) {
    const i = this.pickups.indexOf(pk);
    if (i < 0) return false;
    const it = pk.item;
    const p = this.player;
    // 被过滤器判为「隐藏」的装备一律不捡：走近自动吸取、F 拾取都拦在这里
    if (!force && G.UI.filterHidden(it)) return false;
    // 背包空间检查（必须在移除之前，背包满时物品留在地上）
    if (it.cat === 'equip' || it.cat === 'gem') {
      if (G.UI.firstEmpty() < 0) {
        if (!this._bagWarn || this.time - this._bagWarn > 3) {
          this._bagWarn = this.time;
          G.log('背包已满！清理背包后再来拾取。', 'c-boss');
          G.audio.play('noskill');
        }
        return false;
      }
    }
    this.pickups.splice(i, 1);
    if (it.cat === 'gold') {
      p.gold += it.amount;
      G.audio.play('gold');
      return true;
    }
    if (it.cat === 'shard') {
      p.shards = (p.shards || 0) + it.amount;
      G.audio.play('gold');
      G.FX.text(this, pk.x, pk.y - 12, '+' + it.amount + ' 残晶', D.MATERIAL.color, 13);
      G.log('拾取 ' + it.amount + ' 个' + D.MATERIAL.name, 'c-magic');
      return true;
    }
    if (it.cat === 'potion') {
      const cur = p.potions[it.potion];
      p.potions[it.potion] = { tier: Math.max(cur.tier, it.tier), count: (cur.count || 0) + 1 };
      G.audio.play('potion');
      G.log('拾取 ' + it.name, 'dim');
      return true;
    }
    if (!G.UI.addToInv(it)) { this.pickups.splice(i, 0, pk); return false; }
    if (it.cat === 'gem') {
      G.audio.play('loot');
      G.log('拾取 [宝石] ' + L.displayName(it), 'c-gem');
    } else if (it.cat === 'orb') {
      G.audio.play('loot');
      G.log('拾取 [通货] ' + L.displayName(it), 'c-orb');
    } else {
      G.audio.play(it.rarity === 'unique' || it.rarity === 'rare' ? 'lootRare' : 'loot');
      const cls = 'c-' + it.rarity;
      G.log('拾取 [' + G.RARITY_NAME[it.rarity] + '] ' + L.displayName(it), cls);
      if (it.rarity === 'unique' || it.rarity === 'rare') G.FX.nova(this, pk.x, pk.y, 70, G.RARITY_COLOR[it.rarity], 0.5);
    }
    return true;
  };

  /* F / 拾取键：只捡「没被过滤器隐藏」的东西（隐藏的在 collectPickup 里还会再拦一次） */
  Game.prototype.pickupNearby = function () {
    const p = this.player;
    const R2 = p.stats.pickup * 2.4;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      if (G.UI.filterHidden(pk.item)) continue;    // 被过滤器隐藏的装备不会被捡走
      if (G.dist(p.x, p.y, pk.x, pk.y) <= R2) this.collectPickup(pk);
    }
  };

  Game.prototype.usePotion = function (kind) {
    const p = this.player;
    if (p.dead) return;
    if (p.potionCd > 0) { G.audio.play('noskill'); return; }
    const bag = p.potions[kind];
    if (!bag || bag.count <= 0) { G.log('没有' + D.POTIONS[kind].name + '了', 'dim'); G.audio.play('noskill'); return; }
    bag.count--;
    p.potionCd = 4.5;
    if (kind === 'life') {
      const amt = Math.max(D.POTIONS.life.vals[bag.tier], p.stats.maxLife * 0.32);
      C.healPlayer(this, amt);
      G.FX.text(this, p.x, p.y - 30, '+' + Math.round(amt), '#8ce07a', 15);
      G.FX.spark(this, p.x, p.y, 10, '#ff6b6b', 120, 3);
    } else {
      const amt = Math.max(D.POTIONS.mana.vals[bag.tier], p.stats.maxMana * 0.42);
      p.mana = Math.min(p.stats.maxMana, p.mana + amt);
      G.FX.text(this, p.x, p.y - 30, '+' + Math.round(amt), '#7aa8ff', 15);
      G.FX.spark(this, p.x, p.y, 10, '#5da2ff', 120, 3);
    }
    G.audio.play('potion');
  };

  /* ============================================================
   *  主循环
   * ============================================================ */
  Game.prototype.update = function (dtRaw) {
    const dt = Math.min(0.05, Math.max(0.0005, dtRaw));
    this.frame++;
    this.clock = (this.clock || 0) + dt;      // 训练场 DPS 用的累计时间
    if (!this.started || !this.player) return;

    /* 全局按键 */
    const inp = G.input;
    const p = this.player;
    p.potionCd = Math.max(0, (p.potionCd || 0) - dt);
    this.damageVignette = Math.max(0, this.damageVignette - dt * 1.6);

    if (inp.pressed('Escape')) {
      if (G.UI.heldGem) G.UI.releaseGem();
      else if (G.UI.heldOrb) G.UI.releaseOrb();
      else if (G.UI.closeConfirm()) { /* 先关掉确认框：底下的铁匠铺 / 商人界面留着 */ }
      else if (G.UI.closeAffixPick()) { /* 词缀勾选面板同理 */ }
      else if (G.UI.closeFilterIO()) { /* 先关掉过滤器面板里的导入 / 导出小窗 */ }
      else if (G.UI.open) G.UI.togglePanel(G.UI.open, false);
      else G.UI.setPaused(!this.paused);
    }
    if (!this.paused) {
      const SET = G.Settings;
      if (SET.pressed('inventory')) G.UI.togglePanel('panel-inventory');
      else if (SET.pressed('character')) G.UI.togglePanel('panel-character');
      else if (SET.pressed('vendor')) G.UI.togglePanel('panel-vendor');
      else if (SET.pressed('craft')) G.UI.togglePanel('panel-craft');
      else if (SET.pressed('stash')) G.UI.togglePanel('panel-stash');
      else if (SET.pressed('town')) G.UI.togglePanel('panel-town');
      else if (SET.pressed('help')) G.UI.togglePanel('panel-help');
      else if (SET.pressed('settings')) G.UI.togglePanel('panel-settings');
      else if (SET.pressed('map')) G.UI.toggleBigMap();
      else if (SET.pressed('recall')) {
        if (this.area === 'town') G.UI.openRift();
        else this.toTown('recall');
      }
    }

    if (!this.paused) {
      this.time += dt;
      ENT.updatePlayer(this, p, dt);

      /* 怪物 */
      for (let i = this.monsters.length - 1; i >= 0; i--) {
        const m = this.monsters[i];
        ENT.updateMonster(this, m, dt);
        if (m.dead && m.deadT <= 0) this.monsters.splice(i, 1);
      }
      /* 投射物 */
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const pj = this.projectiles[i];
        ENT.updateProjectile(this, pj, dt);
        if (!pj.alive) this.projectiles.splice(i, 1);
      }
      /* 地面效果 */
      for (let i = this.grounds.length - 1; i >= 0; i--) {
        const g = this.grounds[i];
        ENT.updateGround(this, g, dt);
        if (g.dur <= 0) this.grounds.splice(i, 1);
      }
      /* 掉落物 */
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const pk = this.pickups[i];
        ENT.updatePickup(this, pk, dt);
        if (pk.dead) this.pickups.splice(i, 1);
      }
      /* 可破坏物 */
      this.props.forEach((pr) => ENT.updateProp(this, pr, dt));
      ENT.updateParticles(this, dt);

      /* 死亡计时 */
      if (p.dead) {
        this.deathTimer -= dt;
        if (this.deathTimer <= 0) this.respawn();
      }
    }

    /* 摄像机 / 渲染 */
    R.update(this, dt);
    R.draw(this);

    /* HUD（降频） */
    if (this.frame % 3 === 0) { G.UI.updateHUD(); G.UI.checkAnchor(this); }
    if (this.frame % 5 === 0) {
      const mm = G.el('minimap');
      if (mm) R.minimap(this, mm, !!G.UI.bigMap);
      if (G.UI.open === 'panel-inventory' && !G.UI.dirty.inv) G.UI.renderMiniStats();
      if (G.UI.open === 'panel-vendor' && G.UI.dirty.vendor) G.UI.renderVendor();
    }

    /* 自动存档 */
    this.autosaveTimer += dt;
    if (this.autosaveTimer > 20) { this.autosaveTimer = 0; this.save(); }

    G.input.endFrame();
  };

  /* ============================================================
   *  存档
   * ============================================================ */
  Game.prototype.save = function () {
    if (!this.player) return false;
    const p = this.player;
    const data = {
      v: 2, ts: Date.now(), slot: this.slot,
      cls: p.cls, level: p.level, xp: p.xp, gold: p.gold, shards: p.shards || 0,
      alloc: p.alloc, passives: p.passives, skills: p.skills, skillBranches: p.skillBranches || {},
      guideMet: !!p.guideMet,
      diffUnlocked: p.diffUnlocked | 0, diffCleared: p.diffCleared || {},
      skillPoints: p.skillPoints, attrPoints: p.attrPoints, passivePoints: p.passivePoints || 0,
      potions: p.potions, inventory: p.inventory, gear: p.gear,
      stash: p.stash || [], town: p.town || G.Town.defaultTown(),
      buffs: (p.buffs || []).map((b) => ({ id: b.id, name: b.name, icon: b.icon, stats: b.stats, remaining: b.remaining })),
      floor: this.floor, diffIdx: this.diffIdx, playTime: p.playTime, kills: p.kills || 0,
      maxFloor: p.maxFloor || 1,
      life: p.life, mana: p.mana,
      area: this.area,
      floorCache: this.area === 'dungeon' ? this.serializeFloor() : (this.floorCache || null),
    };
    return G.storage.save(data, this.slot);
  };

  Game.prototype.load = function (slot) {
    if (slot != null) this.slot = slot | 0;
    const data = G.storage.load(this.slot);
    if (!data || !data.cls || !D.classById(data.cls)) return false;
    const p = ENT.makePlayer(this, data.cls);
    ['level', 'xp', 'gold', 'shards', 'skillPoints', 'attrPoints', 'playTime', 'kills', 'life', 'mana', 'maxFloor'].forEach((k) => {
      if (data[k] != null) p[k] = data[k];
    });
    p.passivePoints = data.passivePoints || 0;
    p.alloc = Object.assign({ str: 0, dex: 0, int: 0, vit: 0 }, data.alloc || {});
    p.passives = data.passives || {};
    p.skills = Object.assign(p.skills, data.skills || {});
    p.skillBranches = data.skillBranches || {};
    p.guideMet = !!data.guideMet;
    p.diffUnlocked = G.clamp(data.diffUnlocked | 0, 0, D.MAX_DIFF);
    p.diffCleared = data.diffCleared || {};
    p.potions = data.potions || p.potions;
    p.town = Object.assign(G.Town.defaultTown(), data.town || {});
    p.town.buildings = Object.assign(G.Town.defaultTown().buildings, (data.town && data.town.buildings) || {});
    if (data.buffs && data.buffs.length) {
      p.buffs = data.buffs.filter((b) => b && b.remaining > 0).map((b) => Object.assign({}, b));
    }
    if (data.inventory && data.inventory.length) {
      const bagCap = (G.Town && G.Town.bagCap) ? G.Town.bagCap(p) : 60;
      p.inventory = data.inventory.slice(0, bagCap);
      while (p.inventory.length < bagCap) p.inventory.push(null);
    }
    if (data.gear) p.gear = data.gear;
    // 清理失效装备
    D.gearSlots().forEach((s) => {
      const it = p.gear[s];
      if (it && (!it.cat || it.cat !== 'equip' || !D.baseById(it.base))) p.gear[s] = null;
      if (it) L.ensureCaps(it);
    });
    p.inventory = p.inventory.map((it) => {
      if (it && it.cat === 'equip') {
        if (!D.baseById(it.base)) return null;
        L.ensureCaps(it);
      }
      return it;
    });
    // 仓库按建筑等级扩容
    const cap = G.Town.stashCap(p);
    const stash = Array.isArray(data.stash) ? data.stash.slice(0, cap) : [];
    while (stash.length < cap) stash.push(null);
    p.stash = stash;
    this.floor = Math.max(1, data.floor || 1);
    this.diffIdx = G.clamp(data.diffIdx || 0, 0, D.DIFFICULTIES.length - 1);
    this.player = p;
    S.derive(p);
    if (data.life != null) p.life = Math.min(p.stats.maxLife, data.life);
    if (data.mana != null) p.mana = Math.min(p.stats.maxMana, data.mana);
    this.started = true;
    /* 只保留当前层的缓存：层数对得上才用 */
    this.floorCache = (data.floorCache && data.floorCache.floor === this.floor) ? data.floorCache : null;
    if (data.area === 'town' || data.area === 'training') {
      this.enterTown({ silent: true });
      this.log('读档成功：' + G.DATA.classById(p.cls).name + ' Lv.' + p.level + '（余烬营地）', 'c-rare');
    } else {
      this.enterFloor(this.floor, this.floorCache ? {} : { fresh: true });
      this.log('读档成功：第 ' + this.floor + ' 层，等级 ' + p.level, 'c-rare');
    }
    if (G.UI.game === this) {
      G.UI.buildSkillbar();
      G.UI.dirty.inv = true; G.UI.dirty.char = true; G.UI.dirty.vendor = true;
      G.UI.refreshInventory();
      G.UI.renderCharacter();
      G.UI.rollVendorStock();
    }
    return true;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
