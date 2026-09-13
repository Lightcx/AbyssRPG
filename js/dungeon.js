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
    // 区域风格（幽暗墓穴 / 幽林 / 霜原 / 熔岩洞窟）：决定配色、装饰与发光物
    const theme = D.ABYSS_THEMES[rng.int(0, D.ABYSS_THEMES.length - 1)];
    m.theme = theme.id;

    /* 1) 网格化房间布局
     * 格子按「一间房 + 一段走廊」的尺寸来切（约 19 格见方），所以房间不会大到占满格子、
     * 也不会小到让走廊拉长；地图越大格子越多，房间数量跟着楼层涨。
     * 房间在格子里居中偏一点：每一行有一个横向基准、每一列有一个纵向基准 ——
     * 同一行的左右邻居共用横向基准（走廊是直的、短的），行与行 / 列与列之间错开
     * （看起来错落有致，而不是整齐的方阵）。 */
    const pad = 3;
    const cols = G.clamp(Math.round((W - pad * 2) / 19), 3, 4);
    const rows = G.clamp(Math.round((H - pad * 2) / 19), 2, 4);
    const cellW = (W - pad * 2) / cols, cellH = (H - pad * 2) / rows;
    /* 目标房间数：跟着格子数走 —— 小地图（9 格）4~6 间，最大的图（16 格）9~11 间。
     * 摆法：随机挑一格当种子，往四周「长」出 targetRooms 格（每次从边界里随机挑一格）。
     * 长出来的是一块连通、比较紧凑的区域 —— 房间不会串成一条蛇，
     * 在它上面长连接树才会有分叉。没长到的格子就是纯岩石。 */
    const cells = cols * rows;
    const targetRooms = G.clamp(4 + Math.round((cells - 9) * 0.7) + rng.int(0, 2), 4, 12);
    m.cells = cells;
    m.targetRooms = targetRooms;
    const alive = {};
    const cellsAll = [];
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) cellsAll.push([gx, gy]);
    const seedCell = cellsAll[rng.int(0, cellsAll.length - 1)];
    alive[seedCell[0] + ',' + seedCell[1]] = true;
    const frontierCells = () => {
      const out = [];
      Object.keys(alive).forEach((k) => {
        const p = k.split(',');
        const gx = p[0] | 0, gy = p[1] | 0;
        [[gx, gy - 1], [gx + 1, gy], [gx, gy + 1], [gx - 1, gy]].forEach((c) => {
          if (c[0] < 0 || c[1] < 0 || c[0] >= cols || c[1] >= rows) return;
          if (!alive[c[0] + ',' + c[1]]) out.push(c[0] + ',' + c[1]);
        });
      });
      return out;
    };
    while (Object.keys(alive).length < targetRooms) {
      const fr = frontierCells();
      if (!fr.length) break;
      alive[fr[rng.int(0, fr.length - 1)]] = true;
    }
    const rowLane = [], colLane = [];
    for (let gy = 0; gy < rows; gy++) rowLane.push(rng.range(0.22, 0.78));
    for (let gx = 0; gx < cols; gx++) colLane.push(rng.range(0.22, 0.78));
    const rooms = [];
    const cellAt = {};
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        if (!alive[gx + ',' + gy]) continue;                   // 这一格留空 = 纯岩石
        const cw = Math.floor(cellW) - 2, ch = Math.floor(cellH) - 2;
        // 房间占格子的 62%~80%，剩下的就是走廊的余地（走廊宽 2，两端还要顶到房间边上）
        const rw = G.clamp(Math.round(cw * rng.range(0.62, 0.80)), 6, Math.max(6, cw - 3));
        const rh = G.clamp(Math.round(ch * rng.range(0.62, 0.80)), 6, Math.max(6, ch - 3));
        const bx = Math.round(pad + gx * cellW), by = Math.round(pad + gy * cellH);
        const freeX = Math.max(0, cw - rw), freeY = Math.max(0, ch - rh);
        const ox = G.clamp(Math.round(freeX * rowLane[gy]) + rng.int(-1, 1), 0, freeX);
        const oy = G.clamp(Math.round(freeY * colLane[gx]) + rng.int(-1, 1), 0, freeY);
        const room = {
          x: bx + 1 + ox, y: by + 1 + oy, w: rw, h: rh, type: 'normal', gx: gx, gy: gy,
        };
        room.cx = room.x + (rw >> 1);
        room.cy = room.y + (rh >> 1);
        rooms.push(room);
        cellAt[gx + ',' + gy] = room;
      }
    }
    // 只保留与第一间房连通的那一群：被空格隔开的孤立房间会被 DFS 骨架漏掉
    if (rooms.length > 1) {
      const comp = [rooms[0]];
      const inComp = {};
      inComp[rooms[0].gx + ',' + rooms[0].gy] = true;
      for (let i = 0; i < comp.length; i++) {
        const r = comp[i];
        rooms.forEach((o) => {
          const key = o.gx + ',' + o.gy;
          if (inComp[key]) return;
          if (Math.abs(o.gx - r.gx) + Math.abs(o.gy - r.gy) !== 1) return;
          inComp[key] = true;
          comp.push(o);
        });
      }
      for (let i = rooms.length - 1; i >= 0; i--) {
        const key = rooms[i].gx + ',' + rooms[i].gy;
        if (!inComp[key]) { delete cellAt[key]; rooms.splice(i, 1); }
      }
    }
    m.rooms = rooms;
    if (rooms.length < 3) return DG.generate(rng, { floor: 1, diffIdx: 0 });

    // 2) 挖房间
    const carve = (x, y, w, h) => {
      for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) setAt(m, tx, ty, 1);
    };
    rooms.forEach((r) => carve(r.x, r.y, r.w, r.h));

    /* 3) 走廊：只在相邻两间房之间的那段空隙里挖，宽度 2（等于一个门洞），
     * 两端直接顶在两侧房间的边上 —— 走廊既不会横穿别的房间，
     * 也不会和房间并排贴在一起（这就是以前那种“走廊穿房”的根源）。 */
    const corridorTiles = [];      // 走廊地砖（房间地板不算）
    const digTile = (tx, ty) => {
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) return;
      const i = ty * W + tx;
      if (m.tiles[i] === 1) return;            // 已经在房间里 / 已经挖过
      m.tiles[i] = 1;
      corridorTiles.push(i);
    };
    const corridor = (a, b) => {
      const w = 2;
      const digH = (x1, x2, y) => { for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let k = 0; k < w; k++) digTile(x, y + k); };
      const digV = (y1, y2, x) => { for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) for (let k = 0; k < w; k++) digTile(x + k, y); };
      if (a.gy === b.gy) {
        // 左右相邻：在两间房竖直重叠的那一段里开一条横走廊（最短）
        const left = a.x <= b.x ? a : b, right = a.x <= b.x ? b : a;
        const x0 = left.x + left.w, x1 = right.x - 1;
        if (x1 < x0) return;                                  // 两间房贴在一起，不用挖
        const top = Math.max(a.y, b.y), bot = Math.min(a.y + a.h, b.y + b.h);
        if (bot - top >= w) {
          const slack = bot - top - w;
          const y = top + Math.min(slack, Math.max(0, Math.round(slack / 2) + rng.int(-1, 1)));
          digH(x0, x1, y);
          m.corridors.push({ x1: x0, y1: y, x2: x1, y2: y + w - 1 });
        } else {
          // 两间房错开得太多、竖直方向没有重叠：在空隙里拐一下（Z 形），照样不碰任何房间
          const yA = left.cy, yB = right.cy;
          digH(x0, x1, Math.min(yA, yB));
          digV(yA, yB, x1);
          m.corridors.push({ x1: x0, y1: yA, x2: x1, y2: yB });
        }
      } else {
        // 上下相邻：在两间房水平重叠的那一段里开一条竖走廊
        const up = a.y <= b.y ? a : b, down = a.y <= b.y ? b : a;
        const y0 = up.y + up.h, y1 = down.y - 1;
        if (y1 < y0) return;
        const lft = Math.max(a.x, b.x), rgt = Math.min(a.x + a.w, b.x + b.w);
        if (rgt - lft >= w) {
          const slack = rgt - lft - w;
          const x = lft + Math.min(slack, Math.max(0, Math.round(slack / 2) + rng.int(-1, 1)));
          digV(y0, y1, x);
          m.corridors.push({ x1: x, y1: y0, x2: x + w - 1, y2: y1 });
        } else {
          const xA = up.cx, xB = down.cx;
          digV(y0, y1, xA);
          digH(xA, xB, y1);
          m.corridors.push({ x1: xA, y1: y0, x2: xB, y2: y1 });
        }
      }
    };
    const linked = {};
    const links = [];      // 连了哪两间房（供测试检查分叉结构，不参与渲染）
    const linkKey = (a, b) => {
      const ka = a.gx + ',' + a.gy, kb = b.gx + ',' + b.gy;
      return ka < kb ? ka + '|' + kb : kb + '|' + ka;
    };
    const link = (a, b) => {
      if (!a || !b || a === b) return false;
      // 只连相邻格子：斜着 / 隔着两格的连线一定会穿过别人的房间
      if (Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy) !== 1) return false;
      const k = linkKey(a, b);
      if (linked[k]) return false;
      linked[k] = true;
      const before = corridorTiles.length;
      corridor(a, b);
      // 真的挖出地砖才算连上；没挖到（两间房本来就贴着）就退掉这条边，
      // 免得图上记着一条“走廊”却什么都没有，留下死路
      if (corridorTiles.length === before) { delete linked[k]; return false; }
      links.push({ ax: a.gx, ay: a.gy, bx: b.gx, by: b.gy });
      return true;
    };
    const around = (r) => {
      const out = [];
      [[r.gx, r.gy - 1], [r.gx + 1, r.gy], [r.gx, r.gy + 1], [r.gx - 1, r.gy]].forEach((c) => {
        const n = cellAt[c[0] + ',' + c[1]];
        if (n) out.push(n);
      });
      return out;
    };
    /* 3a) 随机 Prim：从第一间房开始，每次从「已连通 → 未连通」的候选边里随机挑一条接上。
     * 长出来的是一棵**有分叉的树**（主干短、岔路多）；以前的深度优先会串成一条长链，
     * 一层走下来像一条直线。 */
    const keyOf = (r) => r.gx + ',' + r.gy;
    const visited = {};
    const frontier = [];
    const addEdges = (r) => around(r).forEach((n) => { if (!visited[keyOf(n)]) frontier.push([r, n]); });
    visited[keyOf(rooms[0])] = true;
    addEdges(rooms[0]);
    while (frontier.length) {
      const pick = frontier.splice(rng.int(0, frontier.length - 1), 1)[0];
      if (visited[keyOf(pick[1])]) continue;
      if (link(pick[0], pick[1])) {
        visited[keyOf(pick[1])] = true;
        addEdges(pick[1]);
      } else {
        visited[keyOf(pick[1])] = true;      // 两间房本来就贴着，算已连通
      }
    }
    // 3b) 再补少量环路（不然整层是一棵树，来回都得走同一条走廊）
    const candEdges = [];
    rooms.forEach((r) => {
      const right = cellAt[(r.gx + 1) + ',' + r.gy];
      const down = cellAt[r.gx + ',' + (r.gy + 1)];
      if (right) candEdges.push([r, right]);
      if (down) candEdges.push([r, down]);
    });
    for (let i = candEdges.length - 1; i > 0; i--) {          // 洗牌
      const j = rng.int(0, i);
      const t = candEdges[i]; candEdges[i] = candEdges[j]; candEdges[j] = t;
    }
    const maxExtra = Math.max(1, Math.round(rooms.length * 0.3));
    for (let i = 0, added = 0; i < candEdges.length && added < maxExtra; i++) {
      if (link(candEdges[i][0], candEdges[i][1])) added++;
    }

    // 4) 起点 = 最靠左上角的房间，出口 = 距离最远的房间
    let startRoom = rooms[0];
    rooms.forEach((r) => {
      const score = r.gx + r.gy;
      const best = startRoom.gx + startRoom.gy;
      if (score < best || (score === best && r.gx < startRoom.gx)) startRoom = r;
    });
    let far = rooms[rooms.length - 1], farD = -1;
    rooms.forEach((r) => {
      const d = G.dist2(r.cx, r.cy, startRoom.cx, startRoom.cy);
      if (d > farD) { farD = d; far = r; }
    });
    m.playerStart = DG.tileCenter(startRoom.cx, startRoom.cy);
    // BOSS 层：把最远房间扩大成竞技场，但四周至少要给别的房间留 2 格岩石，不能把别人的墙啃掉
    if (m.isBoss) {
      const grow = 3, keep = 2;
      let ax0 = far.x, ay0 = far.y, ax1 = far.x + far.w - 1, ay1 = far.y + far.h - 1;
      rooms.forEach((r) => {
        if (r === far) return;
        const rx1 = r.x + r.w - 1, ry1 = r.y + r.h - 1;
        // 竖直方向的邻居：x 范围有交集
        if (r.x <= ax1 + keep && rx1 >= ax0 - keep) {
          if (ry1 < far.y) ay0 = Math.max(ay0 - grow, ry1 + keep + 1);
          if (r.y > far.y + far.h - 1) ay1 = Math.min(ay1 + grow, r.y - keep - 1);
        }
        // 水平方向的邻居：y 范围有交集
        if (r.y <= ay1 + keep && ry1 >= ay0 - keep) {
          if (rx1 < far.x) ax0 = Math.max(ax0 - grow, rx1 + keep + 1);
          if (r.x > far.x + far.w - 1) ax1 = Math.min(ax1 + grow, r.x - keep - 1);
        }
      });
      ax0 = G.clamp(ax0, 2, W - 4); ay0 = G.clamp(ay0, 2, H - 4);
      ax1 = G.clamp(ax1, ax0 + 5, W - 3); ay1 = G.clamp(ay1, ay0 + 5, H - 3);
      const big = { x: ax0, y: ay0, w: ax1 - ax0 + 1, h: ay1 - ay0 + 1 };
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
    // 竞技场会吞掉一部分走廊地砖：这些砖现在算竞技场，从走廊列表里划掉（走廊刷怪 / 测试都靠它）
    if (m.isBoss && m.arena) {
      const a = m.arena;
      for (let i = corridorTiles.length - 1; i >= 0; i--) {
        const tx = corridorTiles[i] % W, ty = Math.floor(corridorTiles[i] / W);
        if (tx >= a.x && tx < a.x + a.w && ty >= a.y && ty < a.y + a.h) corridorTiles.splice(i, 1);
      }
    }
    m.corridorTiles = corridorTiles;
    m.links = links;

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

    // 6) 火把（房间角落附近的墙上；房间多了每间就少点几支，总量和以前差不多）
    const roomScale = G.clamp(6 / rooms.length, 0.4, 1);
    rooms.forEach((r) => {
      const n = Math.max(1, Math.round(rng.int(2, 4) * roomScale));
      for (let i = 0; i < n; i++) {
        const side = rng.int(0, 3);
        let tx, ty;
        if (side === 0) { tx = rng.int(r.x, r.x + r.w - 1); ty = r.y - 1; }
        else if (side === 1) { tx = rng.int(r.x, r.x + r.w - 1); ty = r.y + r.h; }
        else if (side === 2) { tx = r.x - 1; ty = rng.int(r.y, r.y + r.h - 1); }
        else { tx = r.x + r.w; ty = rng.int(r.y, r.y + r.h - 1); }
        if (at(m, tx, ty) === 1) continue;
        const c = DG.tileCenter(tx, ty);
        m.torches.push({
          x: c.x, y: c.y, r: rng.range(theme.lightR[0], theme.lightR[1]),
          phase: rng.range(0, 6.28), hue: theme.lightHue,
          kind: theme.light, color: theme.lightColor,
        });
      }
    });

    // 7) 地面装饰（数量跟着房间大小走；种类按当前区域风格挑）
    rooms.forEach((r) => {
      const areaK = G.clamp((r.w * r.h) / 110, 1, 2.2);
      const n = Math.round(rng.int(3, 9) * areaK);
      for (let i = 0; i < n; i++) {
        const tx = rng.int(r.x, r.x + r.w - 1), ty = rng.int(r.y, r.y + r.h - 1);
        m.decor.push({ x: tx * DG.TILE + rng.range(6, DG.TILE - 6), y: ty * DG.TILE + rng.range(6, DG.TILE - 6), kind: rng.pick(theme.decor), s: rng.range(0.6, 1.5), a: rng.range(0, 6.28) });
      }
    });

    // 8) 陶罐 / 木桶 / 宝箱（同样按房间数摊平，房间多了每间少放一点）
    rooms.forEach((r) => {
      const n = Math.round(rng.int(0, 4) * roomScale);
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

    /* 9) 刷怪
     * 房间变小、变多以后，每层的怪物总量仍然走原来那条曲线（约 16 + 层数×1.6），
     * 只是摊到更多房间里 —— 房间更密，总量不变。 */
    const freeRooms = rooms.filter((r) => r !== startRoom);
    const mlvl = G.mlvlOf(floor, diff);
    const totalWant = Math.round(16 + floor * 1.6);
    const pool = D.monstersForFloor(floor);
    // 把总量摊到各房间：每间先分 1 只，剩下的按份额撒 —— 房间再多、再少，总量都走同一条曲线
    let left = Math.max(0, totalWant - freeRooms.length);
    let elitesLeft = Math.max(1, Math.round(rooms.length / 5));      // 每层精英小队数量也设个上限
    freeRooms.forEach((r, ri) => {
      const share = G.clamp(Math.round(left / (freeRooms.length - ri) + rng.range(-0.6, 0.6)), 0, left);
      left -= share;
      const isStairsRoom = r === far;
      let count = 1 + share;
      if (m.isBoss && isStairsRoom) count = rng.int(3, 6);
      else if (isStairsRoom) count += 2;
      for (let i = 0; i < count; i++) {
        const tx = rng.int(r.x, r.x + r.w - 1), ty = rng.int(r.y, r.y + r.h - 1);
        const mob = rng.weighted(pool, (mo) => mo.weight * (mo.minFloor <= floor ? 1 : 0.25));
        m.spawns.push({ kind: 'monster', mob: mob.id, tx, ty });
      }
      // 精英小队：房间多了就把出现率压低 + 每层封顶，免得精英数量爆炸
      const eliteChance = G.clamp((0.22 + Math.min(0.35, floor * 0.014)) * 6 / Math.max(4, freeRooms.length), 0.04, 0.5);
      if (elitesLeft > 0 && !(m.isBoss && isStairsRoom) && rng.chance(eliteChance)) {
        elitesLeft--;
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

    /* 9b) 走廊里也蹲几只（少量）：只在走廊中段刷，不堵门口、也不贴着出生点 */
    if (corridorTiles.length >= 8 && !m.isBoss) {
      const pool = D.monstersForFloor(floor);
      const want = G.clamp(1 + Math.floor(floor / 8) + rng.int(0, 1), 1, 4);
      const spots = [];
      for (let tries = 0; tries < 60 && spots.length < want; tries++) {
        const i = rng.pick(corridorTiles);
        const tx = i % W, ty = Math.floor(i / W);
        if (spots.some((sp) => Math.abs(sp.tx - tx) + Math.abs(sp.ty - ty) < 6)) continue;   // 互相隔开
        // 离最近的房间边至少 1 格（别站在门口）
        if (rooms.some((r) => tx >= r.x - 1 && tx < r.x + r.w + 1 && ty >= r.y - 1 && ty < r.y + r.h + 1)) continue;
        if (G.dist2(tx, ty, startRoom.cx, startRoom.cy) < 100) continue;                    // 别在出生点旁边
        spots.push({ tx: tx, ty: ty });
      }
      spots.forEach((sp) => {
        const mob = rng.weighted(pool, (mo) => mo.weight * (mo.minFloor <= floor ? 1 : 0.25));
        m.spawns.push({ kind: 'monster', mob: mob.id, tx: sp.tx, ty: sp.ty, corridor: true });
      });
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
