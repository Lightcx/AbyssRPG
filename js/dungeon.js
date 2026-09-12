/* ============================================================
 *  暗影深渊 · dungeon.js
 *  程序化地牢：房间 / 走廊 / 出生点 / 刷怪点 / 装饰 / 光照
 * ============================================================ */
(function (root) {
  'use strict';
  const G = root.G;
  const D = G.DATA;
  const DG = (G.Dungeon = {});
  DG.TILE = 44;

  const solidTile = (v) => v === 0;

  function makeGrid(w, h) {
    return {
      w, h,
      tiles: new Uint8Array(w * h),
      variant: new Uint8Array(w * h),
      rooms: [], corridors: [], torches: [], decor: [], wallTiles: [],
      spawns: [], props: [], playerStart: { x: 0, y: 0 }, stairs: { x: 0, y: 0 }, isBoss: false,
    };
  }

  const at = (m, tx, ty) => (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h ? 0 : m.tiles[ty * m.w + tx]);
  const setAt = (m, tx, ty, v) => { if (tx >= 0 && ty >= 0 && tx < m.w && ty < m.h) m.tiles[ty * m.w + tx] = v; };
  DG.at = at;

  DG.worldToTile = (x, y) => [Math.floor(x / DG.TILE), Math.floor(y / DG.TILE)];
  DG.tileCenter = (tx, ty) => ({ x: tx * DG.TILE + DG.TILE / 2, y: ty * DG.TILE + DG.TILE / 2 });

  DG.solidAtWorld = function (m, x, y) {
    const tx = Math.floor(x / DG.TILE), ty = Math.floor(y / DG.TILE);
    return solidTile(at(m, tx, ty));
  };

  // 圆形碰撞：采样 8 个方向
  const COS = [], SIN = [];
  for (let i = 0; i < 8; i++) { COS.push(Math.cos(i / 8 * G.TAU)); SIN.push(Math.sin(i / 8 * G.TAU)); }
  DG.circleBlocked = function (m, x, y, r) {
    if (DG.solidAtWorld(m, x, y)) return true;
    for (let i = 0; i < 8; i++) {
      if (DG.solidAtWorld(m, x + COS[i] * r, y + SIN[i] * r)) return true;
    }
    return false;
  };

  // 直线可达（粗粒度可视判定）
  DG.lineOfSight = function (m, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const steps = Math.ceil(len / (DG.TILE * 0.45));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (DG.solidAtWorld(m, x0 + dx * t, y0 + dy * t)) return false;
    }
    return true;
  };

  // 从 (x,y) 沿方向前进，返回撞墙前的有效位置
  DG.slideMove = function (m, x, y, dx, dy, r) {
    let nx = x, ny = y;
    if (dx) {
      const tx = nx + dx;
      if (!DG.circleBlocked(m, tx, ny, r)) nx = tx;
      else {
        // 沿墙滑动
        const s = Math.sign(dx) * 0.35;
        if (!DG.circleBlocked(m, nx + s, ny, r)) nx += s;
      }
    }
    if (dy) {
      const ty = ny + dy;
      if (!DG.circleBlocked(m, nx, ty, r)) ny = ty;
      else {
        const s = Math.sign(dy) * 0.35;
        if (!DG.circleBlocked(m, nx, ny + s, r)) ny += s;
      }
    }
    return { x: nx, y: ny, blocked: nx === x && ny === y };
  };

  DG.findFree = function (m, x, y, r, tries) {
    r = r || 14; tries = tries || 40;
    if (!DG.circleBlocked(m, x, y, r)) return { x, y };
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * G.TAU, d = DG.TILE * (0.6 + Math.random() * 3.5);
      const nx = x + Math.cos(a) * d, ny = y + Math.sin(a) * d;
      if (!DG.circleBlocked(m, nx, ny, r)) return { x: nx, y: ny };
    }
    return { x, y };
  };

  /* ---------------- 主生成函数 ---------------- */
  DG.generate = function (rng, opts) {
    const floor = opts.floor || 1;
    const diff = opts.diffIdx || 0;
    const W = G.clamp(62 + floor * 2, 62, 96);
    const H = G.clamp(58 + floor * 2, 58, 92);
    const m = makeGrid(W, H);
    m.isBoss = floor % 5 === 0;
    m.floor = floor;

    // 1) 房间
    const roomCount = G.clamp(7 + Math.floor(floor * 0.4), 7, 13) + (m.isBoss ? 1 : 0);
    const rooms = [];
    const maxTries = 260;
    for (let t = 0; t < maxTries && rooms.length < roomCount; t++) {
      const rw = rng.int(7, 15), rh = rng.int(6, 13);
      const rx = rng.int(3, W - rw - 4), ry = rng.int(3, H - rh - 4);
      let ok = true;
      for (let i = 0; i < rooms.length; i++) {
        const o = rooms[i];
        if (rx < o.x + o.w + 3 && rx + rw + 3 > o.x && ry < o.y + o.h + 3 && ry + rh + 3 > o.y) { ok = false; break; }
      }
      if (!ok) continue;
      rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: Math.floor(rx + rw / 2), cy: Math.floor(ry + rh / 2), type: 'normal' });
    }
    m.rooms = rooms;
    if (!rooms.length) return DG.generate(rng, { floor: 1, diffIdx: 0 });

    // 2) 挖房间
    const carve = (x, y, w, h) => {
      for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) setAt(m, tx, ty, 1);
    };
    rooms.forEach((r) => carve(r.x, r.y, r.w, r.h));

    // 3) 走廊（顺序连接 + 额外环路）
    const corridor = (a, b, width) => {
      width = width || 2;
      let x = a.cx, y = a.cy;
      const hFirst = rng.chance(0.5);
      const digH = (from, to, yy) => { for (let tx = Math.min(from, to); tx <= Math.max(from, to); tx++) for (let k = 0; k < width; k++) setAt(m, tx, yy + k, 1); };
      const digV = (from, to, xx) => { for (let ty = Math.min(from, to); ty <= Math.max(from, to); ty++) for (let k = 0; k < width; k++) setAt(m, xx + k, ty, 1); };
      if (hFirst) { digH(x, b.cx, y); digV(y, b.cy, b.cx); }
      else { digV(y, b.cy, x); digH(x, b.cx, b.cy); }
      m.corridors.push({ x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy });
    };
    for (let i = 1; i < rooms.length; i++) corridor(rooms[i - 1], rooms[i], rng.int(2, 3));
    const extra = rng.int(1, 3);
    for (let i = 0; i < extra; i++) {
      const a = rng.pick(rooms), b = rng.pick(rooms);
      if (a !== b) corridor(a, b, 2);
    }

    // 4) 起点 = 第一个房间，出口 = 距离最远的房间
    const startRoom = rooms[0];
    let far = rooms[rooms.length - 1], farD = -1;
    rooms.forEach((r) => {
      const d = G.dist2(r.cx, r.cy, startRoom.cx, startRoom.cy);
      if (d > farD) { farD = d; far = r; }
    });
    m.playerStart = DG.tileCenter(startRoom.cx, startRoom.cy);
    // BOSS 层：把最远房间扩大成竞技场，传送门放在角落，BOSS 在中央
    if (m.isBoss) {
      const big = { x: Math.max(3, far.x - 3), y: Math.max(3, far.y - 3), w: Math.min(W - 6, far.w + 6), h: Math.min(H - 6, far.h + 6) };
      carve(big.x, big.y, big.w, big.h);
      far = Object.assign(far, big, { cx: Math.floor(big.x + big.w / 2), cy: Math.floor(big.y + big.h / 2) });
      far.type = 'boss';
      m.bossPos = { x: big.x + Math.floor(big.w / 2), y: big.y + Math.floor(big.h / 2) };
      m.arena = big;
    }
    m.stairs = DG.tileCenter(far.cx, far.cy);
    if (m.isBoss && m.arena) {
      // 传送门移到竞技场下方角落，避免 BOSS 死亡瞬间把玩家送走
      const sx = G.clamp(m.arena.x + m.arena.w - 2, 1, W - 2);
      const sy = G.clamp(m.arena.y + m.arena.h - 2, 1, H - 2);
      m.stairs = DG.tileCenter(sx, sy);
    }
    m.stairsRoom = far;

    // 5) 墙与装饰
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        m.variant[ty * W + tx] = rng.int(0, 255);
        if (at(m, tx, ty) === 0) {
          let nearFloor = false;
          for (let dy = -1; dy <= 1 && !nearFloor; dy++) for (let dx = -1; dx <= 1; dx++) { if (at(m, tx + dx, ty + dy) === 1) { nearFloor = true; break; } }
          if (nearFloor) m.wallTiles.push(tx + ty * W);
        }
      }
    }

    // 6) 火把（房间角落附近的墙上）
    rooms.forEach((r) => {
      const n = rng.int(2, 4);
      for (let i = 0; i < n; i++) {
        const side = rng.int(0, 3);
        let tx, ty;
        if (side === 0) { tx = rng.int(r.x, r.x + r.w - 1); ty = r.y - 1; }
        else if (side === 1) { tx = rng.int(r.x, r.x + r.w - 1); ty = r.y + r.h; }
        else if (side === 2) { tx = r.x - 1; ty = rng.int(r.y, r.y + r.h - 1); }
        else { tx = r.x + r.w; ty = rng.int(r.y, r.y + r.h - 1); }
        if (at(m, tx, ty) === 1) continue;
        const c = DG.tileCenter(tx, ty);
        m.torches.push({ x: c.x, y: c.y, r: rng.range(120, 185), phase: rng.range(0, 6.28), hue: rng.chance(0.25) ? 200 : 32 });
      }
    });

    // 7) 地面装饰
    rooms.forEach((r) => {
      const n = rng.int(3, 9);
      for (let i = 0; i < n; i++) {
        const tx = rng.int(r.x, r.x + r.w - 1), ty = rng.int(r.y, r.y + r.h - 1);
        m.decor.push({ x: tx * DG.TILE + rng.range(6, DG.TILE - 6), y: ty * DG.TILE + rng.range(6, DG.TILE - 6), kind: rng.pick(['crack', 'crack', 'blood', 'bone', 'moss', 'rubble']), s: rng.range(0.6, 1.5), a: rng.range(0, 6.28) });
      }
    });

    // 8) 陶罐 / 木桶 / 宝箱
    rooms.forEach((r) => {
      const n = rng.int(0, 4);
      for (let i = 0; i < n; i++) {
        const p = DG.tileCenter(rng.int(r.x, r.x + r.w - 1), rng.int(r.y, r.y + r.h - 1));
        if (m.isBoss && r === far && G.dist(p.x, p.y, m.stairs.x, m.stairs.y) < 140) continue;
        m.props.push({ x: p.x + rng.range(-8, 8), y: p.y + rng.range(-8, 8), type: rng.chance(0.65) ? 'urn' : 'barrel', hp: 1 });
      }
    });
    // 宝库
    if (!m.isBoss && rooms.length > 4 && rng.chance(0.32)) {
      const vault = rng.pick(rooms.slice(1));
      vault.type = 'vault';
      const c = DG.tileCenter(vault.cx, vault.cy);
      m.props.push({ x: c.x, y: c.y, type: 'chest', hp: 1 });
      for (let i = 0; i < 4; i++) m.props.push({ x: c.x + rng.range(-70, 70), y: c.y + rng.range(-70, 70), type: 'urn', hp: 1 });
    }

    // 9) 刷怪
    const freeRooms = rooms.filter((r) => r !== startRoom);
    const mlvl = G.mlvlOf(floor, diff);
    const perRoomBase = 3 + Math.floor(floor * 0.3);
    freeRooms.forEach((r) => {
      const isStairsRoom = r === far;
      let count = rng.int(perRoomBase - 1, perRoomBase + 2);
      if (m.isBoss && isStairsRoom) count = rng.int(3, 6);
      else if (isStairsRoom) count += 2;
      const pool = D.monstersForFloor(floor);
      for (let i = 0; i < count; i++) {
        const tx = rng.int(r.x, r.x + r.w - 1), ty = rng.int(r.y, r.y + r.h - 1);
        const mob = rng.weighted(pool, (mo) => mo.weight * (mo.minFloor <= floor ? 1 : 0.25));
        m.spawns.push({ kind: 'monster', mob: mob.id, tx, ty });
      }
      // 精英小队
      const eliteChance = 0.22 + Math.min(0.35, floor * 0.014);
      if (!(m.isBoss && isStairsRoom) && rng.chance(eliteChance)) {
        const mob = rng.weighted(pool, (mo) => mo.weight * (mo.minFloor <= floor ? 1 : 0.25));
        m.spawns.push({ kind: 'elite', mob: mob.id, tx: r.cx, ty: r.cy });
        const n = rng.int(2, 4);
        for (let i = 0; i < n; i++) m.spawns.push({ kind: 'monster', mob: mob.id, tx: r.cx + rng.int(-2, 2), ty: r.cy + rng.int(-2, 2), thrall: true });
      }
    });
    if (m.isBoss) {
      m.spawns.push({ kind: 'boss', boss: D.bossForFloor(floor, diff).id, tx: far.cx, ty: far.cy });
      for (let i = 0; i < rng.int(0, 3); i++) m.spawns.push({ kind: 'elite', mob: rng.pick(D.monstersForFloor(floor)).id, tx: far.cx + rng.int(-3, 3), ty: far.cy + rng.int(-3, 3) });
    }
    m.mlvl = mlvl;
    m.totalMonsters = m.spawns.filter((s) => s.kind !== 'prop').length;
    return m;
  };

  /* ---------------- 顶部小地图 / 大地图绘制数据 ---------------- */
  DG.buildMinimapImage = function (m, scale) {
    // 返回一个离屏 canvas（headless 下返回 null）
    if (!root.document || !root.document.createElement) return null;
    const c = root.document.createElement('canvas');
    c.width = m.w * scale; c.height = m.h * scale;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, c.width, c.height);
    for (let ty = 0; ty < m.h; ty++) {
      for (let tx = 0; tx < m.w; tx++) {
        const v = at(m, tx, ty);
        if (v === 1) { ctx.fillStyle = '#3b352b'; ctx.fillRect(tx * scale, ty * scale, scale, scale); }
      }
    }
    return c;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
