/* ============================================================
 *  暗影深渊 · render.js
 *  世界渲染：地砖 / 光线 / 实体 / 掉落 / 伤害数字 / 小地图
 * ============================================================ */
(function (root) {
  'use strict';
  const G = root.G;
  const D = G.DATA;
  const S = G.Stats;
  const R = (G.Render = {});
  const TILE = 44;
  const VIEW_H = 840;

  R.cam = { x: 0, y: 0, sx: 0, sy: 0, shake: 0, shakeT: 0 };
  R.ctx = null;
  R.canvas = null;
  R.light = null;
  R.lightCtx = null;
  R.scale = 1;
  R.w = 0; R.h = 0;
  R.time = 0;
  R.miniCache = { map: null, canvas: null };

  /* 半径 / 坐标可能来自任何地方（特效、地面、怪物、弹道），一旦是 NaN / Infinity
   * 浏览器的 createRadialGradient 会直接抛错并让整个渲染循环挂掉，
   * 所以统一走这里：参数不合法就返回 null，调用方跳过这一层光晕即可。 */
  const finiteNum = (v) => typeof v === 'number' && Number.isFinite(v);
  R.radial = function (ctx, x, y, r0, r1) {
    if (!finiteNum(x) || !finiteNum(y) || !finiteNum(r0) || !finiteNum(r1)) return null;
    if (r1 <= 0) return null;
    if (r0 < 0) r0 = 0;
    if (r0 >= r1) r0 = r1 * 0.5;
    return ctx.createRadialGradient(x, y, r0, x, y, r1);
  };

  R.init = function (canvas) {    R.canvas = canvas;
    if (!canvas) return;
    R.ctx = canvas.getContext('2d');
    if (root.document && root.document.createElement) {
      R.light = root.document.createElement('canvas');
      R.lightCtx = R.light.getContext('2d');
    }
    R.resize();
    if (root.addEventListener) root.addEventListener('resize', R.resize);
  };

  R.resize = function () {
    const c = R.canvas;
    if (!c || !c.getContext) return;
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const w = root.innerWidth || 1280, h = root.innerHeight || 720;
    R.w = w; R.h = h;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    R.dpr = dpr;
    R.scale = G.clamp(h / VIEW_H, 0.72, 2.0);
    if (R.light) { R.light.width = Math.floor(w * 0.5); R.light.height = Math.floor(h * 0.5); }
  };

  R.screenToWorld = function (sx, sy) {
    return {
      x: (sx - R.w / 2) / R.scale + R.cam.x,
      y: (sy - R.h / 2) / R.scale + R.cam.y,
    };
  };

  /* ---------------- 每帧更新摄像机 ---------------- */
  R.update = function (game, dt) {
    R.time += dt;
    const p = game.player;
    const cx = p ? p.x : 0, cy = p ? p.y : 0;
    const aim = game.aimWorld ? game.aimWorld() : { x: cx, y: cy };
    // 摄像机略微朝准星偏移
    const tx = cx + G.clamp((aim.x - cx) * 0.18, -110, 110);
    const ty = cy + G.clamp((aim.y - cy) * 0.18, -110, 110);
    R.cam.x = G.smooth(R.cam.x, tx, Math.min(1, dt * 9));
    R.cam.y = G.smooth(R.cam.y, ty, Math.min(1, dt * 9));
    if (R.cam.shake > 0) {
      R.cam.shake = Math.max(0, R.cam.shake - dt * 34);
      R.cam.shakeT += dt * 40;
      R.cam.sx = Math.cos(R.cam.shakeT * 2.7) * R.cam.shake;
      R.cam.sy = Math.sin(R.cam.shakeT * 3.3) * R.cam.shake;
    } else { R.cam.sx = R.cam.sy = 0; }
    // 探索记录
    if (game.map && p) {
      const m = game.map;
      const tx0 = Math.floor(p.x / TILE), ty0 = Math.floor(p.y / TILE);
      const rad = 8;
      for (let ty = ty0 - rad; ty <= ty0 + rad; ty++) {
        for (let tx = tx0 - rad; tx <= tx0 + rad; tx++) {
          if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) continue;
          if (G.dist2(tx * TILE, ty * TILE, p.x, p.y) < (rad * TILE) * (rad * TILE)) game.explored[ty * m.w + tx] = 1;
        }
      }
    }
  };

  /* ---------------- 调色板 ---------------- */
  const DEPTH_TINTS = [
    [40, 34, 27], [38, 33, 32], [33, 32, 38], [31, 36, 34], [40, 30, 28],
    [34, 30, 42], [42, 32, 34], [28, 36, 42], [44, 36, 24], [30, 28, 40],
  ];
  function palette(floor, themeId) {
    if (floor === -1) {
      // 城镇「余烬营地」：温暖的黄昏色调
      return { floor: [56, 48, 40], wall: [30, 25, 21], wallTop: [88, 74, 56], accent: [96, 76, 48] };
    }
    const t = DEPTH_TINTS[(Math.max(1, floor) - 1) % DEPTH_TINTS.length];
    // 区域风格的底色（幽暗墓穴 / 幽林 / 霜原 / 熔岩洞窟）+ 一点点深度色调
    const base = (themeId && D.themeById(themeId) ? D.themeById(themeId) : D.ABYSS_THEMES[0]).base;
    const k = 0.18;
    return {
      floor: [Math.round(base.floor[0] + t[0] * k), Math.round(base.floor[1] + t[1] * k), Math.round(base.floor[2] + t[2] * k)],
      wall: [Math.round(base.wall[0] + t[0] * k * 0.5), Math.round(base.wall[1] + t[1] * k * 0.5), Math.round(base.wall[2] + t[2] * k * 0.5)],
      wallTop: [Math.round(base.wallTop[0] + t[0] * k), Math.round(base.wallTop[1] + t[1] * k), Math.round(base.wallTop[2] + t[2] * k)],
      accent: t,
    };
  }
  R.palette = palette;
  function hash2(x, y) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* ---------------- 墙体画法（按区域风格） ----------------
   * 暴露成 R.wall[style]：R.draw 按 m.theme 挑一种，预览页与测试也能直接调。
   * 注意：块体故意画得比一格大、会压到隔壁格上（这样才「层层叠叠」），
   * 所以调用方要先把整片墙的暗色底层铺好、再按墙体格子裁剪，最后才逐格画块体。
   * 全用纯色填充 + 简单形状，避免每格新建渐变（墙体格子很多，渐变会拖慢帧率）。 */
  const shade = (c, k, add) => {
    const f = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return 'rgb(' + f(c[0] * k + (add || 0)) + ',' + f(c[1] * k + (add || 0)) + ',' + f(c[2] * k + (add || 0)) + ')';
  };
  /* 石砖（默认）：自己铺一格方块 + 面向地板的一侧描边 */
  function wallBlock(ctx, px, py, pal, hv, open) {
    ctx.fillStyle = 'rgb(' + pal.wall.join(',') + ')';
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = shade(pal.wallTop, 1, hv * 10);
    ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 5);
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.fillRect(px + 1, py + TILE - 6, TILE - 2, 5);
    ctx.strokeStyle = 'rgba(255,220,160,0.10)';
    ctx.lineWidth = 1;
    if (open.down) { ctx.beginPath(); ctx.moveTo(px, py + TILE - 6); ctx.lineTo(px + TILE, py + TILE - 6); ctx.stroke(); }
    if (open.right) { ctx.beginPath(); ctx.moveTo(px + TILE - 1, py); ctx.lineTo(px + TILE - 1, py + TILE); ctx.stroke(); }
    if (open.left) { ctx.beginPath(); ctx.moveTo(px + 1, py); ctx.lineTo(px + 1, py + TILE); ctx.stroke(); }
    if (open.up) { ctx.beginPath(); ctx.moveTo(px, py + 1); ctx.lineTo(px + TILE, py + 1); ctx.stroke(); }
  }
  /* 一串带抖动的多边形顶点：中心可以偏离本格，半径也各不相同 */
  function blobPath(ctx, cx, cy, r, sides, rot, seed) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * G.TAU;
      const rr = r * (0.66 + hash2(seed + i * 7, seed * 3 - i * 5) * 0.6);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.94;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  /* 密林：一层层叠起来的树冠（就是你觉得好看的那版：暗底 + 三团树冠 + 叶尖高光） */
  function wallForest(ctx, px, py, pal, hv, open) {
    ctx.fillStyle = shade(pal.wall, 0.75);
    ctx.fillRect(px, py, TILE, TILE);
    const blobs = [[0.30, 0.36, 0.62, 0.95], [0.74, 0.30, 0.54, 1.15], [0.50, 0.66, 0.58, 0.72]];
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const jx = (hash2(Math.round(px) + i * 7, Math.round(py) + i * 13) - 0.5) * 10;
      const jy = (hash2(Math.round(py) + i * 23, Math.round(px) + i * 3) - 0.5) * 10;
      ctx.fillStyle = shade(pal.wallTop, b[3] * (0.75 + hv * 0.3));
      ctx.beginPath();
      ctx.arc(px + TILE * b[0] + jx, py + TILE * b[1] + jy, TILE * b[2], 0, G.TAU);
      ctx.fill();
    }
    // 叶尖高光
    ctx.fillStyle = 'rgba(190,240,160,0.16)';
    ctx.beginPath();
    ctx.arc(px + TILE * (0.3 + hv * 0.45), py + TILE * (0.26 + hv * 0.3), 3.2, 0, G.TAU);
    ctx.arc(px + TILE * (0.68 - hv * 0.3), py + TILE * (0.58 + hv * 0.25), 2.4, 0, G.TAU);
    ctx.fill();
  }
  /* 冰川：暗底 + 三块冰体互相压着（位置 / 大小 / 亮度跟密林那三团一致，只是带棱角） */
  function wallGlacier(ctx, px, py, pal, hv, open) {
    ctx.fillStyle = shade(pal.wall, 0.72);
    ctx.fillRect(px, py, TILE, TILE);
    const slabs = [[0.30, 0.36, 0.62, 0.78], [0.74, 0.30, 0.54, 1.2], [0.50, 0.66, 0.58, 0.96]];
    for (let i = 0; i < slabs.length; i++) {
      const s = slabs[i];
      const jx = (hash2(Math.round(px) + i * 7, Math.round(py) + i * 13) - 0.5) * 10;
      const jy = (hash2(Math.round(py) + i * 23, Math.round(px) + i * 3) - 0.5) * 10;
      ctx.fillStyle = shade(pal.wallTop, s[3] * (0.8 + hv * 0.3));
      blobPath(ctx, px + TILE * s[0] + jx, py + TILE * s[1] + jy, TILE * s[2] * (0.86 + hv * 0.12),
        6, (i * 1.1 + hv * 2), Math.round(px) * 3 + Math.round(py) + i * 37);
    }
    // 冰面棱线 + 一点高光
    ctx.strokeStyle = 'rgba(240,252,255,' + (0.14 + hv * 0.2) + ')';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(px + TILE * (0.2 + hv * 0.2), py + TILE * (0.22 + hv * 0.22));
    ctx.lineTo(px + TILE * (0.52 + hv * 0.2), py + TILE * (0.62 + hv * 0.2));
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,' + (0.1 + hv * 0.16) + ')';
    ctx.fillRect(px + TILE * (0.18 + hv * 0.3), py + TILE * (0.14 + hv * 0.2), TILE * 0.2, TILE * 0.09);
  }
  /* 崎岖岩石：暗底 + 三块碎石互相挤压（同一套位置，五边形、更暗更硬），缝里透熔岩光 */
  function wallRocky(ctx, px, py, pal, hv, open) {
    ctx.fillStyle = shade(pal.wall, 0.62);
    ctx.fillRect(px, py, TILE, TILE);
    const chunks = [[0.30, 0.36, 0.62, 0.8], [0.74, 0.30, 0.54, 1.18], [0.50, 0.66, 0.58, 1.0]];
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const jx = (hash2(Math.round(px) + i * 7, Math.round(py) + i * 13) - 0.5) * 10;
      const jy = (hash2(Math.round(py) + i * 23, Math.round(px) + i * 3) - 0.5) * 10;
      ctx.fillStyle = shade(pal.wallTop, c[3] * (0.76 + hv * 0.34));
      blobPath(ctx, px + TILE * c[0] + jx, py + TILE * c[1] + jy, TILE * c[2] * (0.84 + hv * 0.14),
        5, (i * 1.3 + hv * 2), Math.round(px) * 5 + Math.round(py) + i * 41);
    }
    // 石缝
    ctx.strokeStyle = 'rgba(0,0,0,0.38)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(px + TILE * (0.06 + hv * 0.14), py + TILE * (0.5 + hv * 0.16));
    ctx.lineTo(px + TILE * (0.46 + hv * 0.12), py + TILE * (0.62 + hv * 0.14));
    ctx.lineTo(px + TILE * 0.94, py + TILE * (0.46 + hv * 0.18));
    ctx.stroke();
    // 缝里的熔岩微光
    if (hv > 0.45) {
      ctx.strokeStyle = 'rgba(255,138,60,' + (0.16 + hv * 0.24) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px + TILE * (0.5 + hv * 0.08), py + TILE * 0.62);
      ctx.lineTo(px + TILE * (0.66 + hv * 0.1), py + TILE * (0.84 + hv * 0.06));
      ctx.stroke();
    }
  }

  /* ---------------- 世界绘制 ---------------- */
  R.wall = { block: wallBlock, forest: wallForest, glacier: wallGlacier, rocky: wallRocky };
  R.draw = function (game) {
    const ctx = R.ctx;
    if (!ctx) return;
    const m = game.map;
    if (!m) return;
    const pal = palette(m.area === 'town' ? -1 : game.floor, m.theme);
    const cs = Math.cos(R.cam.sx * 0.02) * R.cam.sx, sn = R.cam.sy;
    ctx.save();
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    ctx.clearRect(0, 0, R.w, R.h);
    ctx.translate(R.w / 2 + cs, R.h / 2 + sn);
    ctx.scale(R.scale, R.scale);
    ctx.translate(-R.cam.x, -R.cam.y);

    const halfW = R.w / 2 / R.scale + TILE, halfH = R.h / 2 / R.scale + TILE;
    const x0 = Math.max(0, Math.floor((R.cam.x - halfW) / TILE));
    const x1 = Math.min(m.w - 1, Math.ceil((R.cam.x + halfW) / TILE));
    const y0 = Math.max(0, Math.floor((R.cam.y - halfH) / TILE));
    const y1 = Math.min(m.h - 1, Math.ceil((R.cam.y + halfH) / TILE));

    /* --- 地面 --- */
    ctx.fillStyle = 'rgb(' + pal.floor.join(',') + ')';
    ctx.fillRect(x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const v = G.Dungeon.at(m, tx, ty);
        if (v !== 1) continue;
        const hv = hash2(tx, ty);
        const d = (hv - 0.5) * 12;
        ctx.fillStyle = 'rgb(' + (pal.floor[0] + d) + ',' + (pal.floor[1] + d) + ',' + (pal.floor[2] + d) + ')';
        ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
        if (hv > 0.93) {
          ctx.fillStyle = 'rgba(255,255,255,0.028)';
          ctx.fillRect(tx * TILE + 2, ty * TILE + 2, TILE - 4, TILE - 4);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.16)';
        ctx.strokeRect(tx * TILE + 0.5, ty * TILE + 0.5, TILE, TILE);
      }
    }
    /* --- 装饰 --- */
    m.decor.forEach((d) => {
      if (d.x < R.cam.x - halfW || d.x > R.cam.x + halfW || d.y < R.cam.y - halfH || d.y > R.cam.y + halfH) return;
      ctx.save();
      ctx.translate(d.x, d.y); ctx.rotate(d.a);
      if (d.kind === 'crack') {
        ctx.strokeStyle = 'rgba(0,0,0,0.38)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-9 * d.s, 0); ctx.lineTo(0, 3 * d.s); ctx.lineTo(9 * d.s, -2 * d.s); ctx.stroke();
      } else if (d.kind === 'blood') {
        ctx.fillStyle = 'rgba(88,14,16,0.42)';
        ctx.beginPath(); ctx.ellipse(0, 0, 11 * d.s, 7 * d.s, 0, 0, G.TAU); ctx.fill();
      } else if (d.kind === 'bone') {
        ctx.fillStyle = 'rgba(190,184,160,0.4)';
        ctx.fillRect(-7 * d.s, -1.4, 14 * d.s, 2.8);
        ctx.beginPath(); ctx.arc(-7 * d.s, 0, 2.2, 0, G.TAU); ctx.arc(7 * d.s, 0, 2.2, 0, G.TAU); ctx.fill();
      } else if (d.kind === 'moss') {
        ctx.fillStyle = 'rgba(58,92,50,0.4)';
        ctx.beginPath(); ctx.ellipse(0, 0, 10 * d.s, 6 * d.s, 0, 0, G.TAU); ctx.fill();
      } else if (d.kind === 'grass') {
        // 草丛：几根草叶
        ctx.strokeStyle = 'rgba(96,150,74,0.55)'; ctx.lineWidth = 1.6;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 3.4 * d.s, 2 * d.s);
          ctx.quadraticCurveTo(i * 3.4 * d.s + 1.5, -3 * d.s, i * 3.4 * d.s + (i % 2 ? 2.6 : -2.6), -7 * d.s);
          ctx.stroke();
        }
      } else if (d.kind === 'root') {
        // 树根 / 藤蔓
        ctx.strokeStyle = 'rgba(72,58,36,0.5)'; ctx.lineWidth = 2.4 * d.s;
        ctx.beginPath();
        ctx.moveTo(-11 * d.s, 3 * d.s);
        ctx.quadraticCurveTo(0, -6 * d.s, 11 * d.s, 1 * d.s);
        ctx.stroke();
      } else if (d.kind === 'snow') {
        // 雪堆：一层柔白的隆起
        ctx.fillStyle = 'rgba(226,238,248,0.5)';
        ctx.beginPath(); ctx.ellipse(0, 0, 12 * d.s, 7 * d.s, 0, 0, G.TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.ellipse(-2 * d.s, -2 * d.s, 7 * d.s, 4 * d.s, 0, 0, G.TAU); ctx.fill();
      } else if (d.kind === 'ice') {
        // 冰块：半透明的蓝色棱块
        ctx.fillStyle = 'rgba(150,214,238,0.42)';
        ctx.beginPath();
        ctx.moveTo(0, -9 * d.s); ctx.lineTo(7 * d.s, -1 * d.s); ctx.lineTo(3 * d.s, 7 * d.s);
        ctx.lineTo(-4 * d.s, 6 * d.s); ctx.lineTo(-7 * d.s, -2 * d.s); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(226,246,255,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, -9 * d.s); ctx.lineTo(1, 5 * d.s); ctx.stroke();
      } else if (d.kind === 'spike') {
        // 石椎：从地里戳出来的尖石
        ctx.fillStyle = 'rgba(96,74,66,0.6)';
        ctx.beginPath();
        ctx.moveTo(-6 * d.s, 6 * d.s); ctx.lineTo(0, -12 * d.s); ctx.lineTo(6 * d.s, 6 * d.s); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,150,90,0.22)';
        ctx.beginPath();
        ctx.moveTo(-2 * d.s, 6 * d.s); ctx.lineTo(0, -12 * d.s); ctx.lineTo(2 * d.s, 6 * d.s); ctx.closePath(); ctx.fill();
      } else if (d.kind === 'rock') {
        // 石块：一堆棱角分明的小石头
        ctx.fillStyle = 'rgba(126,120,110,0.42)';
        [[-7, 1, 5], [1, -2, 6], [6, 3, 4]].forEach((p) => {
          ctx.beginPath();
          ctx.moveTo((p[0] - p[2]) * d.s, (p[1] + p[2] * 0.7) * d.s);
          ctx.lineTo((p[0] - p[2] * 0.3) * d.s, (p[1] - p[2]) * d.s);
          ctx.lineTo((p[0] + p[2]) * d.s, (p[1] - p[2] * 0.2) * d.s);
          ctx.lineTo((p[0] + p[2] * 0.5) * d.s, (p[1] + p[2] * 0.8) * d.s);
          ctx.closePath(); ctx.fill();
        });
      } else {
        ctx.fillStyle = 'rgba(120,110,95,0.35)';
        [[-6, -4], [4, 2], [7, -5]].forEach((p) => { ctx.beginPath(); ctx.arc(p[0] * d.s, p[1] * d.s, 2.4, 0, G.TAU); ctx.fill(); });
      }
      ctx.restore();
    });

    /* --- 墙（按区域风格换画法：石块 / 密林 / 冰川 / 崎岖岩石） ---
     * 每格先铺一层暗色底，再把「树冠 / 冰体 / 碎石」压上去 —— 块体互相重叠，
     * 没被盖住的暗底就成了缝，所以看上去是层层叠叠的一大片而不是方阵。
     * 不做裁剪：裁切会在墙面与地板的交界处切出直线，反而难看。 */
    const wallStyle = (D.themeById(m.theme) || D.ABYSS_THEMES[0]).wall || 'block';
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (G.Dungeon.at(m, tx, ty) !== 0) continue;
        const hv = hash2(tx, ty);
        const px = tx * TILE, py = ty * TILE;
        const wf = R.wall[wallStyle] || R.wall.block;
        wf(ctx, px, py, pal, hv, {
          down: G.Dungeon.at(m, tx, ty + 1) === 1,
          right: G.Dungeon.at(m, tx + 1, ty) === 1,
          left: G.Dungeon.at(m, tx - 1, ty) === 1,
          up: G.Dungeon.at(m, tx, ty - 1) === 1,
        });
      }
    }

    /* --- 发光物（火把 / 荧光蘑菇 / 冰晶 / 熔岩）：颜色与形状跟着区域风格走 --- */
    for (let i = 0; i < m.torches.length; i++) {
      const t = m.torches[i];
      if (Math.abs(t.x - R.cam.x) > halfW + 90 || Math.abs(t.y - R.cam.y) > halfH + 90) continue;
      R.drawLightSource(ctx, t);
    }

    /* --- 城镇建筑 --- */
    if (m.area === 'town' && m.buildings) m.buildings.forEach((b) => R.drawBuilding(ctx, b));

    /* --- 传送门 --- */
    if (game.area !== 'town' && game.portalOpen) R.drawPortal(ctx, m.stairs.x, m.stairs.y, game);
    /* --- 回城传送门（地牢入口） --- */
    if (game.area !== 'town' && m.townPortal) R.drawTownPortal(ctx, m.townPortal.x, m.townPortal.y);
    /* --- 深渊之门（城镇） --- */
    if (m.area === 'town' && m.gate) R.drawGate(ctx, m.gate, game);

    /* --- 掉落物 --- */
    game.pickups.forEach((pk) => {
      if (!R.visible(pk, halfW, halfH)) return;
      // 被过滤器隐藏的掉落平时不画，长按「显示全部装备」键时照常画出来
      if (G.UI.filterHidden(pk.item) && !G.UI.revealHeld()) return;
      R.drawPickup(ctx, pk, game);
    });

    /* --- 可破坏物 --- */
    game.props.forEach((pr) => { if (R.visible(pr, halfW, halfH)) R.drawProp(ctx, pr); });

    /* --- 地面效果 --- */
    game.grounds.forEach((g) => {
      if (!R.visible(g, halfW, halfH)) return;
      if (!(g.r > 0)) return;
      ctx.save();
      const a = g.telegraph != null && g.telegraph > 0 ? 0.22 : 0.34;
      const grd = R.radial(ctx, g.x, g.y, 0, g.r);
      if (!grd) { ctx.restore(); return; }
      grd.addColorStop(0, (g.color || '#8ce07a') + 'aa');
      grd.addColorStop(0.65, (g.color || '#8ce07a') + '55');
      grd.addColorStop(1, (g.color || '#8ce07a') + '00');
      ctx.globalAlpha = a;
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, G.TAU); ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = g.color || '#8ce07a';
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r * (g.telegraph != null ? 1 - Math.max(0, g.telegraph) : 1), 0, G.TAU); ctx.stroke();
      ctx.restore();
    });

    /* --- 实体（按 y 排序）--- */
    const ents = [];
    game.monsters.forEach((mo) => { if (R.visible(mo, halfW + 60, halfH + 60) || mo.dead) if (mo.spawnT < 0.55 || mo.deadT > 0) ents.push(mo); });
    if (m.area === 'town' && m.npcs) m.npcs.forEach((n) => { if (R.visible(n, halfW + 80, halfH + 80)) ents.push(n); });
    if (game.player) ents.push(game.player);
    ents.sort((a, b) => a.y - b.y);
    ents.forEach((e) => {
      if (e.kind === 'player') R.drawPlayer(ctx, e, game);
      else if (e.kind === 'npc') R.drawNpc(ctx, e, game);
      else R.drawMonster(ctx, e, game);
    });

    /* --- 投射物 --- */
    game.projectiles.forEach((pj) => {
      if (!R.visible(pj, halfW, halfH)) return;
      ctx.save();
      ctx.translate(pj.x, pj.y);
      ctx.rotate(pj.rot);
      ctx.shadowColor = pj.color;
      ctx.shadowBlur = 14;
      if (pj.arrow) {
        ctx.strokeStyle = pj.color; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(-(pj.length || 14), 0); ctx.lineTo(6, 0); ctx.stroke();
        ctx.fillStyle = pj.color;
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(2, -4); ctx.lineTo(2, 4); ctx.closePath(); ctx.fill();
      } else {
        const grd = R.radial(ctx, 0, 0, 0, pj.size * 1.6);
        if (!grd) { ctx.restore(); return; }
        grd.addColorStop(0, '#ffffff');
        grd.addColorStop(0.35, pj.color);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(0, 0, pj.size * 1.6, 0, G.TAU); ctx.fill();
      }
      ctx.restore();
    });

    /* --- 粒子 --- */
    game.particles.forEach((p) => {
      if (p.x < R.cam.x - halfW || p.x > R.cam.x + halfW || p.y < R.cam.y - halfH || p.y > R.cam.y + halfH) return;
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      if (p.type === 'ghost') {
        ctx.globalAlpha = a * 0.35;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, G.TAU); ctx.fill();
      } else if (p.type === 'shard') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.8);
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.type === 'smoke' ? a : 1), 0, G.TAU); ctx.fill();
      }
    });
    ctx.globalAlpha = 1;

    /* --- 特效 --- */
    game.fx.forEach((f) => {
      const t = 1 - f.life / f.max;
      ctx.save();
      if (f.type === 'nova') {
        ctx.globalAlpha = (1 - t) * 0.55;
        const grd = R.radial(ctx, f.x, f.y, f.r * 0.2, f.r * (0.6 + t * 0.5));
        if (!grd) { ctx.restore(); return; }
        grd.addColorStop(0, 'rgba(255,255,255,0.5)');
        grd.addColorStop(0.5, f.color);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.7 + t * 0.4), 0, G.TAU); ctx.fill();
      } else if (f.type === 'ring') {
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = f.color; ctx.lineWidth = 4 * (1 - t) + 1;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.25 + t * 0.85), 0, G.TAU); ctx.stroke();
      } else if (f.type === 'beam') {
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = f.color; ctx.lineWidth = 3;
        ctx.shadowColor = f.color; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.moveTo(f.x1, f.y1);
        const segs = 6;
        for (let i = 1; i <= segs; i++) {
          const k = i / segs;
          const jx = i === segs ? 0 : Math.sin(f.seed + i * 2.3) * 12 * (1 - Math.abs(k - 0.5) * 2);
          const jy = i === segs ? 0 : Math.cos(f.seed + i * 1.7) * 12 * (1 - Math.abs(k - 0.5) * 2);
          ctx.lineTo(G.lerp(f.x1, f.x2, k) + jx, G.lerp(f.y1, f.y2, k) + jy);
        }
        ctx.stroke();
      } else if (f.type === 'slash') {
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.strokeStyle = f.color; ctx.lineWidth = 8 * (1 - t) + 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.radius * 0.8, f.angle - f.arc / 2 + t * f.arc, f.angle + f.arc / 2);
        ctx.stroke();
      } else if (f.type === 'cone') {
        ctx.globalAlpha = (1 - t) * 0.55;
        const cr = f.radius != null ? f.radius : f.r;
        const grd = R.radial(ctx, f.x, f.y, 10, cr);
        if (!grd) { ctx.restore(); return; }
        grd.addColorStop(0, 'rgba(255,255,255,0.55)');
        grd.addColorStop(0.6, f.color);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.moveTo(f.x, f.y);
        ctx.arc(f.x, f.y, f.radius * (0.5 + t * 0.6), f.angle - f.arc / 2, f.angle + f.arc / 2);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    });
    ctx.globalAlpha = 1;

    /* --- 光照 --- */
    R.drawLighting(ctx, game, halfW, halfH);

    /* --- 掉落物名称 / 标签 --- */
    ctx.font = '600 12px "Noto Sans SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    const showAll = G.input.down('AltLeft') || G.input.down('AltRight');
    game.pickups.forEach((pk) => {
      if (!R.visible(pk, halfW, halfH)) return;
      if (G.UI.filterHidden(pk.item) && !G.UI.revealHeld()) return;   // 隐藏的掉落平时连名字也不显示
      const dist = game.player ? G.dist(pk.x, pk.y, game.player.x, game.player.y) : 0;
      if (!showAll && (pk.item.cat === 'gold' || pk.item.cat === 'shard')) return;
      if (!showAll && dist > 190 && pk.item.cat === 'equip' && pk.item.rarity === 'common') return;
      const col = pk.item.cat === 'equip' ? G.RARITY_COLOR[pk.item.rarity] : (pk.item.color || '#ffe9a8');
      const nm = pk.item.cat === 'equip' ? G.Loot.displayName(pk.item)
        : (pk.item.cat === 'gold' ? pk.item.amount + ' 金币'
        : (pk.item.cat === 'shard' ? pk.item.amount + ' ' + D.MATERIAL.name : pk.item.name));
      const yy = pk.y - 22 + Math.sin(pk.bob) * 2;
      ctx.font = pk.item.cat === 'equip' && pk.item.rarity !== 'common' ? '700 12px "Noto Sans SC",sans-serif' : '12px "Noto Sans SC",sans-serif';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(nm, pk.x, yy);
      ctx.fillStyle = col;
      ctx.fillText(nm, pk.x, yy);
    });

    /* --- 伤害数字 --- */
    game.texts.forEach((t) => {
      const a = Math.min(1, t.life / t.max * 1.6);
      ctx.globalAlpha = a;
      ctx.font = (t.crit ? '800 ' : '700 ') + t.size + 'px "Noto Sans SC",sans-serif';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    });
    ctx.globalAlpha = 1;

    /* --- 交互提示 --- */
    if (game.player) {
      const p = game.player;
      if (game.area !== 'town' && game.portalOpen) {
        const d = G.dist(p.x, p.y, m.stairs.x, m.stairs.y);
        if (d < 110) R.prompt(ctx, m.stairs.x, m.stairs.y - 86, '按 ' + G.Settings.actionLabel('pickup', 'F') + ' 进入下一层', '#ffe9a8');
      }
      if (game.area !== 'town' && m.townPortal && G.dist(p.x, p.y, m.townPortal.x, m.townPortal.y) < 90) {
        R.prompt(ctx, m.townPortal.x, m.townPortal.y - 78, '按 ' + G.Settings.actionLabel('pickup', 'F') + ' 返回城镇', '#9fd8ff');
      }
      if (game.area === 'town') {
        if (m.gate && G.dist(p.x, p.y, m.gate.x, m.gate.y) < 110) {
          R.prompt(ctx, m.gate.x, m.gate.y - 96, '按 ' + G.Settings.actionLabel('pickup', 'F') + ' 进入深渊', '#c9a4ff');
        }
        let near = null, nd = 1e9;
        (m.npcs || []).forEach((n) => {
          const d = G.dist(p.x, p.y, n.x, n.y);
          if (d < 120 && d < nd) { nd = d; near = n; }
        });
        if (near) R.prompt(ctx, near.x, near.y - 58, '按 ' + G.Settings.actionLabel('pickup', 'F') + ' 与「' + near.name + '」交谈', '#ffe9a8');
      }
    }

    /* --- BOSS 血条 --- */
    const boss = game.monsters.filter((mo) => mo.isBoss && !mo.dead)[0];
    if (boss && boss.aggro) {
      const w = Math.min(560, R.w - 80), h = 14;
      const bx = R.cam.x - w / 2, by = R.cam.y - halfH + 40;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(bx - 2, by - 20, w + 4, h + 26);
      ctx.fillStyle = '#2a1214';
      ctx.fillRect(bx, by, w, h);
      ctx.fillStyle = boss.enraged ? '#ff4a4a' : '#a3242a';
      ctx.fillRect(bx, by, w * G.clamp(boss.life / boss.maxLife, 0, 1), h);
      ctx.strokeStyle = '#7d6533'; ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, w, h);
      ctx.font = '700 14px "Noto Sans SC",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText(boss.name + (boss.enraged ? '（狂怒）' : '') + '　Lv.' + boss.mlvl, bx + w / 2, by - 6);
    }
    ctx.restore();

    /* --- 屏幕覆盖效果 --- */
    R.drawOverlay(ctx, game);
  };

  /* ---------------- 城镇：建筑 / NPC / 深渊之门 ---------------- */
  R.prompt = function (ctx, x, y, text, color) {
    ctx.save();
    ctx.font = '600 14px "Noto Sans SC",sans-serif';
    ctx.textAlign = 'center';
    const w = Math.max(120, (text.length * 13) + 22);
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(x - w / 2, y, w, 26);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - w / 2 + 0.5, y + 0.5, w, 25);
    ctx.fillStyle = color || '#ffe9a8';
    ctx.fillText(text, x, y + 18);
    ctx.restore();
  };

  R.drawBuilding = function (ctx, b) {
    const T2 = TILE;
    const px = b.x * T2, py = b.y * T2, pw = b.w * T2, ph = b.h * T2;
    ctx.save();
    // 地基阴影
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(px - 4, py + 6, pw + 8, ph + 8);
    // 墙体
    ctx.fillStyle = b.wall;
    ctx.fillRect(px, py, pw, ph);
    // 屋顶
    const rh = ph * 0.62;
    const grd = ctx.createLinearGradient(px, py, px, py + rh);
    grd.addColorStop(0, b.roof);
    grd.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = grd;
    ctx.fillRect(px + 3, py + 3, pw - 6, rh);
    // 屋顶瓦片线
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    for (let yy = py + 14; yy < py + rh; yy += 12) {
      ctx.beginPath(); ctx.moveTo(px + 4, yy); ctx.lineTo(px + pw - 4, yy); ctx.stroke();
    }
    // 墙裙
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(px + 3, py + rh, pw - 6, ph - rh - 3);
    // 边框
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);

    /* 门 */
    const dx = b.door.tx * T2 + T2 / 2;
    const dy = b.door.ty * T2 + T2 / 2;
    const outward = b.doorSide === 'north' ? -1 : 1;
    const doorY = b.doorSide === 'north' ? py + 2 : py + ph - 2;
    ctx.fillStyle = '#1b1208';
    ctx.fillRect(dx - 14, doorY - (outward < 0 ? 0 : 22), 28, 22);
    ctx.strokeStyle = b.roof;
    ctx.lineWidth = 2;
    ctx.strokeRect(dx - 14, doorY - (outward < 0 ? 0 : 22), 28, 22);
    ctx.strokeStyle = 'rgba(255,220,160,0.35)';
    ctx.beginPath();
    ctx.moveTo(dx - 6, doorY - (outward < 0 ? 2 : 20));
    ctx.lineTo(dx + 6, doorY - (outward < 0 ? 2 : 20));
    ctx.stroke();

    /* 招牌 */
    ctx.font = '700 15px "Noto Sans SC",sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    const label = b.glyph + ' ' + b.name;
    const ly = b.doorSide === 'north' ? py - 10 : py + ph + 26;
    ctx.strokeText(label, b.cx * T2, ly);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(label, b.cx * T2, ly);
    ctx.restore();
  };

  R.drawNpc = function (ctx, n, game) {
    const t = R.time;
    const p = game.player;
    ctx.save();
    ctx.translate(n.x, n.y);
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath(); ctx.ellipse(0, 8, 14, 6, 0, 0, G.TAU); ctx.fill();
    // 交互圈
    if (p && G.dist(p.x, p.y, n.x, n.y) < 110) {
      ctx.strokeStyle = 'rgba(255,233,168,0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 6]);
      ctx.beginPath(); ctx.arc(0, 2, 24 + Math.sin(t * 3 + n.bob) * 1.5, 0, G.TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    const bob = Math.sin(t * 1.6 + n.bob) * 1.2;
    // 身体
    ctx.fillStyle = n.color;
    ctx.beginPath(); ctx.ellipse(0, bob * 0.4, 11, 13, 0, 0, G.TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(0, 5 + bob * 0.3, 11, 7, 0, 0, G.TAU); ctx.fill();
    // 头
    ctx.fillStyle = '#e8d5b5';
    ctx.beginPath(); ctx.arc(0, -12 + bob * 0.5, 7, 0, G.TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.arc(0, -14 + bob * 0.5, 7.6, Math.PI, G.TAU); ctx.fill();
    // 头顶标记
    ctx.font = '700 15px "Noto Sans SC",sans-serif';
    ctx.textAlign = 'center';
    const my = -34 + Math.sin(t * 2.4 + n.bob) * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.arc(0, my - 5, 13, 0, G.TAU); ctx.fill();
    ctx.fillStyle = n.color;
    ctx.fillText(n.glyph, 0, my);
    // 名字
    ctx.font = '700 11px "Noto Sans SC",sans-serif';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(n.name, 0, -46);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(n.name, 0, -46);
    ctx.restore();
  };

  R.drawGate = function (ctx, gate, game) {
    const t = R.time;
    ctx.save();
    ctx.translate(gate.x, gate.y);
    // 石台
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(0, 10, 52, 22, 0, 0, G.TAU); ctx.fill();
    ctx.fillStyle = '#3a3129';
    ctx.beginPath(); ctx.ellipse(0, 6, 50, 21, 0, 0, G.TAU); ctx.fill();
    ctx.strokeStyle = '#6b5a3c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, 6, 50, 21, 0, 0, G.TAU); ctx.stroke();
    // 石柱
    [-44, 44].forEach((ox) => {
      ctx.fillStyle = '#4a4038';
      ctx.fillRect(ox - 9, -60, 18, 66);
      ctx.fillStyle = '#5c5044';
      ctx.fillRect(ox - 11, -66, 22, 10);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2;
      ctx.strokeRect(ox - 9, -60, 18, 66);
    });
    // 漩涡
    const grd = ctx.createRadialGradient(0, -22, 2, 0, -22, 46);
    grd.addColorStop(0, 'rgba(230,190,255,0.95)');
    grd.addColorStop(0.45, 'rgba(140,80,220,0.6)');
    grd.addColorStop(1, 'rgba(30,8,60,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.ellipse(0, -22, 46, 44, 0, 0, G.TAU); ctx.fill();
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = 'rgba(200,150,255,' + (0.55 - i * 0.11) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, -22, 18 + i * 8 + Math.sin(t * 2 + i) * 2, 16 + i * 8, 0, t * (1 + i * 0.4), t * (1 + i * 0.4) + 4.4);
      ctx.stroke();
    }
    ctx.font = '700 13px "Noto Sans SC",sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText('深渊之门', 0, -84);
    ctx.fillStyle = '#c9a4ff';
    ctx.fillText('深渊之门', 0, -84);
    ctx.restore();
  };

  R.drawTownPortal = function (ctx, x, y) {
    const t = R.time;
    ctx.save();
    ctx.translate(x, y);
    const grd = ctx.createRadialGradient(0, 0, 2, 0, 0, 38);
    grd.addColorStop(0, 'rgba(190,230,255,0.9)');
    grd.addColorStop(0.5, 'rgba(70,140,220,0.5)');
    grd.addColorStop(1, 'rgba(10,30,70,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(0, 0, 38, 0, G.TAU); ctx.fill();
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = 'rgba(150,210,255,' + (0.5 - i * 0.12) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 14 + i * 8 + Math.sin(t * 2.4 + i) * 2, -t * (1 + i * 0.5), -t * (1 + i * 0.5) + 4.2);
      ctx.stroke();
    }
    ctx.font = '700 11px "Noto Sans SC",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9fd8ff';
    ctx.fillText('回城传送门', 0, -46);
    ctx.restore();
  };

  R.visible = function (e, hw, hh) {
    return e.x > R.cam.x - hw && e.x < R.cam.x + hw && e.y > R.cam.y - hh && e.y < R.cam.y + hh;
  };

  R.drawPortal = function (ctx, x, y, game) {
    const t = R.time;
    ctx.save();
    ctx.translate(x, y);
    const grd = ctx.createRadialGradient(0, 0, 2, 0, 0, 42);
    grd.addColorStop(0, 'rgba(200,160,255,0.95)');
    grd.addColorStop(0.5, 'rgba(120,70,200,0.55)');
    grd.addColorStop(1, 'rgba(40,10,80,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(0, 0, 42, 0, G.TAU); ctx.fill();
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = 'rgba(190,140,255,' + (0.5 - i * 0.13) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 16 + i * 9 + Math.sin(t * 2 + i) * 2, t * (1 + i * 0.4), t * (1 + i * 0.4) + 4.4);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* 区域风格的发光物：火把 / 荧光蘑菇 / 冰晶 / 熔岩（带一点呼吸般的明暗） */
  R.drawLightSource = function (ctx, t) {
    const kind = t.kind || 'torch';
    const col = t.color || '#ffb060';
    const pulse = 0.86 + Math.sin(R.time * 4 + (t.phase || 0)) * 0.14;
    ctx.save();
    ctx.translate(t.x, t.y);
    // 地面上的光晕
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 26);
    glow.addColorStop(0, col + 'aa');
    glow.addColorStop(1, col + '00');
    ctx.globalAlpha = 0.5 * pulse;
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, G.TAU); ctx.fill();
    ctx.globalAlpha = 1;
    if (kind === 'mushroom') {
      ctx.fillStyle = '#d8e6c8';
      ctx.fillRect(-1.6, -4, 3.2, 9);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(0, -6, 8 * pulse, 5.4 * pulse, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.arc(-2.6, -7.4, 1.1, 0, G.TAU); ctx.arc(2.2, -6.2, 0.9, 0, G.TAU); ctx.fill();
    } else if (kind === 'crystal') {
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.9;
      [[0, -13, 4.4], [-6, -8, 3.2], [6, -9, 3.6]].forEach((c) => {
        ctx.beginPath();
        ctx.moveTo(c[0], c[1] - 5 * pulse);
        ctx.lineTo(c[0] + c[2], c[1] + 4);
        ctx.lineTo(c[0], c[1] + 7);
        ctx.lineTo(c[0] - c[2], c[1] + 4);
        ctx.closePath(); ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(-0.8, -18, 1.6, 8);
    } else if (kind === 'lava') {
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.ellipse(0, 0, 13 * pulse, 8 * pulse, 0, 0, G.TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffe6a8';
      ctx.beginPath(); ctx.ellipse(0, -1, 5 * pulse, 3 * pulse, 0, 0, G.TAU); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(-15, 4); ctx.lineTo(-4, 1); ctx.moveTo(5, -2); ctx.lineTo(16, -5); ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      // 火把：木杆 + 火苗
      ctx.fillStyle = '#4a3520';
      ctx.fillRect(-1.8, -6, 3.6, 14);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(0, -9, 4.4 * pulse, 7 * pulse, 0, 0, G.TAU); ctx.fill();
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath(); ctx.ellipse(0, -9, 2 * pulse, 3.6 * pulse, 0, 0, G.TAU); ctx.fill();
    }
    ctx.restore();
  };

  R.drawProp = function (ctx, pr) {
    ctx.save();
    ctx.translate(pr.x, pr.y);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(0, pr.r * 0.6, pr.r, pr.r * 0.45, 0, 0, G.TAU); ctx.fill();
    const flash = pr.hitFlash > 0;
    if (pr.type === 'chest') {
      ctx.fillStyle = flash ? '#ffe9a8' : '#6b4a22';
      ctx.fillRect(-15, -14, 30, 22);
      ctx.fillStyle = flash ? '#fff' : '#8a6430';
      ctx.fillRect(-15, -20, 30, 8);
      ctx.fillStyle = '#c8a45c';
      ctx.fillRect(-3, -12, 6, 10);
    } else if (pr.type === 'barrel') {
      ctx.fillStyle = flash ? '#e8dcc0' : '#5c4326';
      ctx.beginPath(); ctx.ellipse(0, -6, 11, 15, 0, 0, G.TAU); ctx.fill();
      ctx.strokeStyle = '#3a2a17'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(10, -10); ctx.moveTo(-11, -1); ctx.lineTo(11, -1); ctx.stroke();
    } else {
      ctx.fillStyle = flash ? '#e8dcc0' : '#7a5f38';
      ctx.beginPath();
      ctx.moveTo(-9, 2); ctx.quadraticCurveTo(-12, -12, 0, -14);
      ctx.quadraticCurveTo(12, -12, 9, 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(-9, -3, 18, 3);
    }
    ctx.restore();
  };

  R.drawPickup = function (ctx, pk, game) {
    const it = pk.item;
    const yy = pk.y - 6 + Math.sin(pk.bob) * 3;
    ctx.save();
    ctx.translate(pk.x, yy);
    let col = '#ffe9a8';
    if (it.cat === 'equip') col = G.RARITY_COLOR[it.rarity];
    else if (it.color) col = it.color;
    // 光柱
    if (it.cat === 'equip') {
      const h = it.rarity === 'unique' ? 74 : it.rarity === 'rare' ? 58 : it.rarity === 'magic' ? 40 : 24;
      const grd = ctx.createLinearGradient(0, -h, 0, 8);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, col + (it.rarity === 'unique' ? 'cc' : '88'));
      ctx.fillStyle = grd;
      ctx.fillRect(-1.6, -h, 3.2, h + 8);
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, -4, 12, 0, G.TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.shadowColor = col; ctx.shadowBlur = 10;
    if (it.cat === 'gold') {
      ctx.fillStyle = '#ffd24a';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse((i - 1) * 4, -i * 1.6, 4, 2.6, 0, 0, G.TAU); ctx.fill(); }
    } else if (it.cat === 'potion') {
      ctx.fillStyle = D.POTIONS[it.potion].color;
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(5, -3); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.lineTo(-5, -3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#cbb894';
      ctx.fillRect(-2, -13, 4, 4);
    } else if (it.cat === 'shard') {
      // 深渊残晶：青色晶体，和宝石一样带切面高光
      const k = 1 + Math.min(6, it.amount / 40);
      ctx.fillStyle = it.color || '#9fe8ff';
      ctx.beginPath();
      ctx.moveTo(0, -8 * k); ctx.lineTo(5 * k, -1 * k); ctx.lineTo(2.5 * k, 7 * k);
      ctx.lineTo(-2.5 * k, 7 * k); ctx.lineTo(-5 * k, -1 * k);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.beginPath();
      ctx.moveTo(0, -8 * k); ctx.lineTo(3 * k, -1 * k); ctx.lineTo(0, 1 * k);
      ctx.closePath(); ctx.fill();
    } else if (it.cat === 'gem') {
      // 品质越高，宝石越大、切面越多，方便一眼区分
      const k = 1 + (it.tier | 0) * 0.2;
      ctx.fillStyle = it.color;
      ctx.beginPath();
      ctx.moveTo(0, -7 * k); ctx.lineTo(6 * k, 0); ctx.lineTo(0, 7 * k); ctx.lineTo(-6 * k, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.moveTo(0, -7 * k); ctx.lineTo(3 * k, -k); ctx.lineTo(-3 * k, -k);
      ctx.closePath(); ctx.fill();
      if ((it.tier | 0) >= 3) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-6 * k, 0); ctx.lineTo(6 * k, 0); ctx.stroke();
      }
    } else {
      ctx.fillStyle = col;
      ctx.fillRect(-5, -6, 10, 12);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
      ctx.strokeRect(-5, -6, 10, 12);
    }
    ctx.restore();
  };

  /* ---------------- 光照 ---------------- */
  R.drawLighting = function (ctx, game, halfW, halfH) {
    const lc = R.lightCtx;
    if (!lc) return;
    const lw = R.light.width, lh = R.light.height;
    if (!lw || !lh) return;
    const k = lw / (halfW * 2); // 世界 -> 光照画布
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.clearRect(0, 0, lw, lh);
    // 整体明暗：深渊 0.78 / 城镇 0.46（数值越小越亮）；底色不用纯黑，暗处留一点冷色
    const dark = game.area === 'town' ? 0.46 : 0.78;
    lc.fillStyle = 'rgba(12,13,20,' + dark + ')';
    lc.fillRect(0, 0, lw, lh);
    lc.globalCompositeOperation = 'destination-out';
    const ox = R.cam.x - halfW, oy = R.cam.y - halfH;
    const put = (x, y, r, strength) => {
      // 位置或半径不是有限数时直接跳过：NaN 会让下面的裁剪判断全部失效，
      // 进而把 createRadialGradient 打崩（锥形特效用的是 radius 而不是 r）
      if (!isFinite(x) || !isFinite(y) || !isFinite(r) || r <= 0) return;
      const gx = (x - ox) * k, gy = (y - oy) * k, gr = r * k;
      if (!isFinite(gx) || !isFinite(gy) || !isFinite(gr) || gr <= 0) return;
      if (gx + gr < 0 || gy + gr < 0 || gx - gr > lw || gy - gr > lh) return;
      const g = lc.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, 'rgba(0,0,0,' + strength + ')');
      g.addColorStop(0.45, 'rgba(0,0,0,' + strength * 0.72 + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = g;
      lc.beginPath(); lc.arc(gx, gy, gr, 0, G.TAU); lc.fill();
    };
    // 火把
    const torches = game.map.torches;
    for (let i = 0; i < torches.length; i++) {
      const t = torches[i];
      if (Math.abs(t.x - R.cam.x) > halfW + 240 || Math.abs(t.y - R.cam.y) > halfH + 240) continue;
      const flick = 1 + Math.sin(R.time * 6 + t.phase) * 0.06 + Math.sin(R.time * 13 + t.phase * 2) * 0.03;
      put(t.x, t.y, t.r * flick, 1);
    }
    // 玩家
    const p = game.player;
    // 玩家身上的光：范围大一点，周围不至于全靠火把
    if (p) put(p.x, p.y, 330 + Math.sin(R.time * 3) * 6, 1);
    // 技能 / 投射物 / 地面效果
    game.projectiles.forEach((pj) => put(pj.x, pj.y, pj.elem === 'physical' ? 60 : 130, 0.85));
    game.grounds.forEach((g) => put(g.x, g.y, g.r * 1.5, 0.85));
    game.fx.forEach((f) => {
      if (f.type === 'nova') put(f.x, f.y, f.r * 1.6, 0.9);
      else if (f.type === 'cone') put(f.x, f.y, (f.radius || f.r || 0) * 1.6, 0.9);
      else if (f.type === 'beam') { put(f.x1, f.y1, 90, 0.8); put(f.x2, f.y2, 90, 0.8); }
    });
    game.monsters.forEach((m) => {
      if (m.dead) return;
      if (m.elite) put(m.x, m.y, 150, 0.55);
      if (m.def && m.def.proj && m.def.proj.elem) put(m.x, m.y, 90, 0.5);
    });
    lc.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(R.light, 0, 0, R.w, R.h);
    ctx.restore();
  };

  R.drawOverlay = function (ctx, game) {
    const p = game.player;
    ctx.save();
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    // 暗角（别压太狠，边缘留出可读性）
    const vg = ctx.createRadialGradient(R.w / 2, R.h / 2, Math.min(R.w, R.h) * 0.42, R.w / 2, R.h / 2, Math.max(R.w, R.h) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, R.w, R.h);
    // 受伤红屏
    if (game.damageVignette > 0.01) {
      const d = game.damageVignette;
      const rg = ctx.createRadialGradient(R.w / 2, R.h / 2, Math.min(R.w, R.h) * 0.25, R.w / 2, R.h / 2, Math.max(R.w, R.h) * 0.7);
      rg.addColorStop(0, 'rgba(160,10,10,0)');
      rg.addColorStop(1, 'rgba(180,12,12,' + (0.55 * d) + ')');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, R.w, R.h);
    }
    // 低血量脉冲
    if (p && !p.dead && p.life / p.stats.maxLife < 0.28) {
      const pulse = 0.22 + Math.sin(R.time * 6) * 0.12;
      const rg = ctx.createRadialGradient(R.w / 2, R.h / 2, Math.min(R.w, R.h) * 0.3, R.w / 2, R.h / 2, Math.max(R.w, R.h) * 0.72);
      rg.addColorStop(0, 'rgba(140,0,0,0)');
      rg.addColorStop(1, 'rgba(140,0,0,' + pulse + ')');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, R.w, R.h);
    }
    // 死亡画面
    if (p && p.dead) {
      ctx.fillStyle = 'rgba(48,2,2,0.62)';
      ctx.fillRect(0, 0, R.w, R.h);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffb3ae';
      ctx.font = '700 44px "Noto Sans SC",serif';
      ctx.fillText('你 死 了', R.w / 2, R.h / 2 - 10);
      ctx.font = '16px "Noto Sans SC",sans-serif';
      ctx.fillStyle = '#e0b8b0';
      const secs = Math.max(0, Math.ceil(game.deathTimer));
      ctx.fillText('损失 10% 金币　·　' + secs + ' 秒后在本层入口复活', R.w / 2, R.h / 2 + 26);
    }
    ctx.restore();
  };

  /* ---------------- 玩家 ---------------- */
  /* ---------------- 状态条：头顶血条 / 蓝条，脚下闪避充能格 ----------------
   * 在 drawPlayer 的 translate 之外绘制，免得跟着人物旋转或被闪烁的透明度带着抖。
   * 三块都由设置面板里的开关控制（默认全开）。
   */
  const BAR_W = 34, BAR_H = 5, BAR_GAP = 2;
  R.SHOW_DEFAULT = { hpBar: true, manaBar: true, dodgeBar: true };
  R.showFlag = function (key) {
    const d = G.Settings && G.Settings.data;
    return d ? d[key] !== false : (R.SHOW_DEFAULT[key] !== false);
  };

  // 一根条：底 + 内槽 + 按比例填充的亮色
  function bar(ctx, cx, top, frac, color, back, glow) {
    const w = BAR_W, h = BAR_H;
    ctx.fillStyle = 'rgba(0,0,0,0.68)';
    ctx.fillRect(cx - w / 2 - 1.5, top - 1.5, w + 3, h + 3);
    ctx.fillStyle = back;
    ctx.fillRect(cx - w / 2, top, w, h);
    const f = G.clamp(frac, 0, 1);
    if (f > 0) {
      if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 6; }
      ctx.fillStyle = color;
      ctx.fillRect(cx - w / 2, top, Math.max(1, w * f), h);
      if (glow) ctx.shadowBlur = 0;
    }
  }

  R.drawPlayerBars = function (ctx, p) {
    if (!p || p.dead) return;
    const st = p.stats || {};
    const bx = p.x, by = p.y - (p.jumpHeight || 0);
    /* --- 头顶：血条（上）/ 蓝条（下） --- */
    if (R.showFlag('hpBar')) {
      const maxLife = st.maxLife || p.maxLife || 1;
      bar(ctx, bx, by - 38, (p.life == null ? maxLife : p.life) / Math.max(1, maxLife), '#d94141', '#3a1416', '#ff6a5a');
    }
    if (R.showFlag('manaBar')) {
      const maxMana = st.maxMana || p.maxMana || 1;
      bar(ctx, bx, by - 38 + BAR_H + BAR_GAP, (p.mana == null ? maxMana : p.mana) / Math.max(1, maxMana), '#3f8fd6', '#122130', '#6ab6ff');
    }
    /* --- 脚下：闪避充能格（一格 = 一次闪避） --- */
    if (R.showFlag('dodgeBar')) {
      const n = Math.max(1, (st.dodgeMax) || S.dodgeMax(p));
      const cur = S.dodgeCharges(p);
      const pw = n > 3 ? 8 : 10, gap = 2;
      const total = n * pw + (n - 1) * gap;
      const left = bx - total / 2, top = by + 15, ph = 4;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(left - 1, top - 1, total + 2, ph + 2);
      for (let i = 0; i < n; i++) {
        const px = left + i * (pw + gap);
        ctx.fillStyle = '#16301c';
        ctx.fillRect(px, top, pw, ph);
        const f = G.clamp(cur - i, 0, 1);
        if (f > 0) {
          ctx.fillStyle = f >= 1 ? '#48b04c' : '#2f7a35';
          ctx.fillRect(px, top, Math.max(1, pw * f), ph);
        }
      }
    }
  };

  R.drawPlayer = function (ctx, p, game) {
    const st = p.stats;
    ctx.save();
    ctx.translate(p.x, p.y - (p.jumpHeight || 0));
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(0, 8 + (p.jumpHeight || 0) * 0.2, 13, 6, 0, 0, G.TAU); ctx.fill();
    // buff 光环
    if (p.buffs && p.buffs.length) {
      ctx.strokeStyle = 'rgba(255,210,120,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 2, 20 + Math.sin(R.time * 4) * 2, 0, G.TAU); ctx.stroke();
    }
    if (p.dead) {
      ctx.globalAlpha = Math.max(0, 0.6 - p.deadT * 0.2);
      ctx.fillStyle = '#5a1a1a';
      ctx.beginPath(); ctx.ellipse(0, 4, 18, 8, 0, 0, G.TAU); ctx.fill();
      ctx.restore();
      return;
    }
    if (p.invuln > 0) ctx.globalAlpha = 0.55 + Math.sin(R.time * 40) * 0.25;
    if (p.hurtFlash > 0) { ctx.shadowColor = '#ff5a5a'; ctx.shadowBlur = 18; }
    const f = p.facing;
    // 斗篷
    ctx.save();
    ctx.rotate(f);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(-6, 0, 15, 11, 0, 0, G.TAU); ctx.fill();
    ctx.restore();
    // 身体
    const bob = Math.sin(p.walkT) * 1.6;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.ellipse(0, bob * 0.4, 11, 12, 0, 0, G.TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(0, 4 + bob * 0.3, 11, 7, 0, 0, G.TAU); ctx.fill();
    // 头
    ctx.fillStyle = '#e8d5b5';
    ctx.beginPath(); ctx.arc(0, -11 + bob * 0.5, 7, 0, G.TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(0, -13 + bob * 0.5, 7.4, Math.PI, G.TAU); ctx.fill();
    // 朝向小三角
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(Math.cos(f) * 12, Math.sin(f) * 12 + bob * 0.4);
    ctx.lineTo(Math.cos(f + 2.5) * 9, Math.sin(f + 2.5) * 9 + bob * 0.4);
    ctx.lineTo(Math.cos(f - 2.5) * 9, Math.sin(f - 2.5) * 9 + bob * 0.4);
    ctx.closePath(); ctx.fill();
    // 武器
    const anim = p.attackAnim > 0 ? 1 - p.attackAnim / 0.22 : 0;
    const swing = anim * 1.4 - 0.4;
    ctx.save();
    ctx.rotate(f + swing);
    const wk = st.weaponKind;
    ctx.strokeStyle = '#cfc6b0'; ctx.lineWidth = wk === 'melee' ? 3.4 : 2.6;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(wk === 'melee' ? 30 : 24, 0); ctx.stroke();
    if (wk === 'magic' || wk === 'ranged') {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.arc(wk === 'melee' ? 30 : 24, 0, 5, 0, G.TAU); ctx.fill();
    }
    ctx.restore();
    // 施法光效
    if (p.castAnim > 0) {
      ctx.globalAlpha = p.castAnim / 0.25 * 0.7;
      ctx.strokeStyle = '#c9a4ff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 4, 20 + (1 - p.castAnim / 0.25) * 14, 0, G.TAU); ctx.stroke();
    }
    ctx.restore();
    // 头顶血条 / 蓝条 + 脚下闪避条
    R.drawPlayerBars(ctx, p);
  };

  /* ---------------- 怪物 ---------------- */
  R.drawMonster = function (ctx, m, game) {
    const t = R.time;
    ctx.save();
    ctx.translate(m.x, m.y);
    if (m.dead) {
      const a = Math.max(0, m.deadT / (m.isBoss ? 1.4 : 0.45));
      ctx.globalAlpha = a;
      ctx.scale(1, Math.max(0.15, a));
      ctx.fillStyle = 'rgba(60,10,12,0.55)';
      ctx.beginPath(); ctx.ellipse(0, 4, m.r * 1.5, m.r * 0.7, 0, 0, G.TAU); ctx.fill();
      ctx.restore();
      return;
    }
    if (m.spawnT > 0) {
      const k = 1 - m.spawnT / (m.isBoss ? 1.4 : 0.55);
      ctx.globalAlpha = k;
      ctx.scale(0.6 + k * 0.4, 0.6 + k * 0.4);
    }
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath(); ctx.ellipse(0, m.r * 0.62, m.r * 1.05, m.r * 0.42, 0, 0, G.TAU); ctx.fill();
    // 精英光环
    if (m.elite && !m.isBoss) {
      ctx.strokeStyle = 'rgba(255,120,60,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, m.r + 6 + Math.sin(t * 3) * 1.5, 0, G.TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,120,60,0.09)';
      ctx.beginPath(); ctx.arc(0, 0, m.r + 10, 0, G.TAU); ctx.fill();
    }
    if (m.isBoss) {
      const grd = R.radial(ctx, 0, 0, m.r * 0.3, m.r * 2.1);
      if (grd) {
        grd.addColorStop(0, 'rgba(255,60,40,0.16)');
        grd.addColorStop(1, 'rgba(255,60,40,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(0, 0, m.r * 2.1, 0, G.TAU); ctx.fill();
      }
    }
    const flash = m.hitFlash > 0;
    const body = flash ? '#ffffff' : m.color;
    const r = m.r;
    const f = m.facing;
    const bob = Math.sin(m.animT * 6) * 1.2;
    ctx.save();
    switch (m.shape) {
      case 'imp': {
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.ellipse(0, bob * 0.5, r, r * 1.05, 0, 0, G.TAU); ctx.fill();
        ctx.fillStyle = '#2b1c14';
        ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 0.7); ctx.lineTo(-r * 1.1, -r * 1.6); ctx.lineTo(-r * 0.1, -r * 0.9); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(r * 0.6, -r * 0.7); ctx.lineTo(r * 1.1, -r * 1.6); ctx.lineTo(r * 0.1, -r * 0.9); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffe45c';
        ctx.beginPath(); ctx.arc(-3.4, -2, 1.8, 0, G.TAU); ctx.arc(3.4, -2, 1.8, 0, G.TAU); ctx.fill();
        break;
      }
      case 'skel': {
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.ellipse(0, bob * 0.5, r * 0.75, r * 1.0, 0, 0, G.TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(0, -r * 0.95, r * 0.55, 0, G.TAU); ctx.fill();
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath(); ctx.arc(-r * 0.22, -r * 1.0, r * 0.16, 0, G.TAU); ctx.arc(r * 0.22, -r * 1.0, r * 0.16, 0, G.TAU); ctx.fill();
        ctx.strokeStyle = body; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-r * 0.6, -2 + i * 4); ctx.lineTo(r * 0.6, -2 + i * 4); ctx.stroke(); }
        break;
      }
      case 'zombie': {
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.ellipse(0, bob * 0.4, r * 0.95, r * 1.05, 0, 0, G.TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.25, -r * 0.85, r * 0.5, 0, G.TAU); ctx.fill();
        ctx.fillStyle = 'rgba(90,10,10,0.6)';
        ctx.beginPath(); ctx.arc(-r * 0.3, r * 0.1, r * 0.35, 0, G.TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-r * 0.9, -r * 0.2); ctx.lineTo(r * 0.9, -r * 0.4); ctx.stroke();
        break;
      }
      case 'bat': {
        const wing = Math.sin(t * 16 + m.animT) * 0.5;
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-r * 2.2, -r * (1.2 + wing), -r * 2.4, r * 0.2);
        ctx.quadraticCurveTo(-r * 1.2, -r * 0.1, 0, r * 0.4);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(r * 2.2, -r * (1.2 + wing), r * 2.4, r * 0.2);
        ctx.quadraticCurveTo(r * 1.2, -r * 0.1, 0, r * 0.4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#2b1218';
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.6, r * 0.7, 0, 0, G.TAU); ctx.fill();
        ctx.fillStyle = '#ff6b6b';
        ctx.beginPath(); ctx.arc(-2, -2, 1.4, 0, G.TAU); ctx.arc(2, -2, 1.4, 0, G.TAU); ctx.fill();
        break;
      }
      case 'spider': {
        ctx.strokeStyle = body; ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const a = -0.9 + i * 0.6;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 1.8, Math.sin(a) * r * 1.2 + 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-Math.cos(a) * r * 1.8, Math.sin(a) * r * 1.2 + 2); ctx.stroke();
        }
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.9, r * 0.75, 0, 0, G.TAU); ctx.fill();
        ctx.fillStyle = '#ffd24a';
        ctx.beginPath(); ctx.arc(-2.5, -2, 1.5, 0, G.TAU); ctx.arc(2.5, -2, 1.5, 0, G.TAU); ctx.fill();
        break;
      }
      case 'hound': {
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.ellipse(0, bob * 0.4, r * 1.25, r * 0.72, 0, 0, G.TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(Math.cos(f) * r * 0.95, Math.sin(f) * r * 0.55 - 2, r * 0.5, 0, G.TAU); ctx.fill();
        ctx.strokeStyle = body; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(-r * 1.2, 0); ctx.lineTo(-r * 2, -r * 0.8); ctx.stroke();
        ctx.fillStyle = '#ff9a3c';
        ctx.beginPath(); ctx.arc(Math.cos(f) * r * 1.1, Math.sin(f) * r * 0.5 - 2, 1.6, 0, G.TAU); ctx.fill();
        break;
      }
      case 'wraith': {
        ctx.globalAlpha *= 0.82;
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(-r, r * 0.4);
        ctx.quadraticCurveTo(-r * 0.9, -r * 1.1, 0, -r * 1.15);
        ctx.quadraticCurveTo(r * 0.9, -r * 1.1, r, r * 0.4);
        for (let i = 3; i >= 0; i--) {
          const px = -r + (i / 3) * r * 2;
          ctx.quadraticCurveTo(px + r / 3, r * (0.7 + Math.sin(t * 4 + i) * 0.12), px, r * 0.35);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#0b1a20';
        ctx.beginPath(); ctx.arc(-3, -r * 0.75, 2.2, 0, G.TAU); ctx.arc(3, -r * 0.75, 2.2, 0, G.TAU); ctx.fill();
        break;
      }
      case 'brute': {
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.ellipse(0, bob * 0.3, r * 1.1, r * 1.0, 0, 0, G.TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(0, -r * 0.9, r * 0.5, 0, G.TAU); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(0, r * 0.35, r * 0.95, r * 0.5, 0, 0, G.TAU); ctx.fill();
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.arc(-r * 1.1, 0, r * 0.42, 0, G.TAU); ctx.arc(r * 1.1, 0, r * 0.42, 0, G.TAU); ctx.fill();
        break;
      }
      case 'elemental': {
        const pulse = 1 + Math.sin(t * 4 + m.animT) * 0.08;
        const grd = R.radial(ctx, 0, -r * 0.3, r * 0.2, r * 1.5 * pulse);
        if (!grd) break;
        grd.addColorStop(0, '#ffffff');
        grd.addColorStop(0.4, body);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(0, -r * 0.3, r * 1.5 * pulse, 0, G.TAU); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath(); ctx.arc(-r * 0.28, -r * 0.4, 2.2, 0, G.TAU); ctx.arc(r * 0.28, -r * 0.4, 2.2, 0, G.TAU); ctx.fill();
        for (let i = 0; i < 3; i++) {
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = body;
          ctx.beginPath();
          ctx.arc(Math.sin(t * 3 + i * 2) * r * 1.3, -r * 0.3 + Math.cos(t * 2.4 + i) * r * 0.9, 2.4, 0, G.TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'dummy':
      case 'dummy_boss': {
        // 训练假人：木桩 + 十字横臂 + 草靶；BOSS 假人做成恶魔像
        const big = m.shape === 'dummy_boss';
        ctx.fillStyle = '#6b4a22';
        ctx.fillRect(-r * 0.22, -r * 0.1, r * 0.44, r * 1.5);
        ctx.fillRect(-r * 1.05, -r * 0.35, r * 2.1, r * 0.3);
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.ellipse(0, -r * 0.7, r * 0.62, r * 0.78, 0, 0, G.TAU); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(0, -r * 0.45, r * 0.5, r * 0.3, 0, 0, G.TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(-r * 0.45, -r * 0.85); ctx.lineTo(r * 0.45, -r * 0.55); ctx.stroke();
        if (big) {
          ctx.fillStyle = '#1c0f14';
          ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 1.2); ctx.lineTo(-r * 1.0, -r * 2.0); ctx.lineTo(-r * 0.1, -r * 1.4); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.moveTo(r * 0.5, -r * 1.2); ctx.lineTo(r * 1.0, -r * 2.0); ctx.lineTo(r * 0.1, -r * 1.4); ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = big ? '#ff7a5c' : '#3a2f22';
        ctx.beginPath(); ctx.arc(-r * 0.2, -r * 1.3, 2.2, 0, G.TAU); ctx.arc(r * 0.2, -r * 1.3, 2.2, 0, G.TAU); ctx.fill();
        break;
      }
      default: { // demon
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.ellipse(0, bob * 0.4, r * 0.95, r * 1.05, 0, 0, G.TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(0, -r * 0.9, r * 0.5, 0, G.TAU); ctx.fill();
        ctx.fillStyle = '#1c0f14';
        ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 1.1); ctx.lineTo(-r * 1.0, -r * 2.0); ctx.lineTo(-r * 0.1, -r * 1.3); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(r * 0.5, -r * 1.1); ctx.lineTo(r * 1.0, -r * 2.0); ctx.lineTo(r * 0.1, -r * 1.3); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffe45c';
        ctx.beginPath(); ctx.arc(-3.4, -r * 0.9, 1.9, 0, G.TAU); ctx.arc(3.4, -r * 0.9, 1.9, 0, G.TAU); ctx.fill();
        break;
      }
    }
    ctx.restore();

    /* 血条 / 名字 */
    if (m.hpVisible && (m.life < m.maxLife || m.elite || m.isBoss)) {
      const w = Math.max(24, m.r * 2.4);
      const y = -m.r * (m.isBoss ? 2.4 : 1.9) - 6;
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(-w / 2 - 1, y - 1, w + 2, 5);
      ctx.fillStyle = m.elite ? '#e2884a' : '#b31f26';
      ctx.fillRect(-w / 2, y, w * G.clamp(m.life / m.maxLife, 0, 1), 3);
    }
    if (m.elite && !m.dead) {
      ctx.font = '700 11px "Noto Sans SC",sans-serif';
      ctx.textAlign = 'center';
      const nm = (m.isBoss ? m.name : m.def.name) + '  Lv.' + m.mlvl;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(nm, 0, -m.r * 2.2 - 14);
      ctx.fillStyle = m.isBoss ? '#ff6b4a' : '#ffb861';
      ctx.fillText(nm, 0, -m.r * 2.2 - 14);
      if (m.affixes.length) {
        ctx.font = '10px "Noto Sans SC",sans-serif';
        ctx.fillStyle = '#9fd8ff';
        ctx.fillText(m.affixes.map((a) => a.name).join(' · '), 0, -m.r * 2.2 - 3);
      }
    }
    ctx.restore();
  };

  /* ---------------- 小地图 ---------------- */
  R.minimap = function (game, canvas, big) {
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    const m = game.map;
    if (!m || !ctx) return;
    const size = big ? 420 : 180;
    if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
    const scale = Math.min(size / (m.w * TILE), size / (m.h * TILE));
    const ow = m.w * TILE * scale, oh = m.h * TILE * scale;
    const ox = (size - ow) / 2, oy = (size - oh) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(4,4,4,0.9)';
    ctx.fillRect(0, 0, size, size);
    if (!R.miniCache.canvas || R.miniCache.map !== m) {
      R.miniCache.map = m;
      const step = big ? 1 : 2;
      const c = root.document.createElement('canvas');
      const s = big ? 2 : 1.4;
      c.width = m.w * s; c.height = m.h * s;
      const cx = c.getContext('2d');
      cx.fillStyle = '#000'; cx.fillRect(0, 0, c.width, c.height);
      for (let ty = 0; ty < m.h; ty++) {
        for (let tx = 0; tx < m.w; tx++) {
          if (G.Dungeon.at(m, tx, ty) === 1) {
            cx.fillStyle = '#3a3529';
            cx.fillRect(tx * s, ty * s, s, s);
          }
        }
      }
      R.miniCache.canvas = c;
    }
    ctx.globalAlpha = 0.95;
    ctx.drawImage(R.miniCache.canvas, ox, oy, ow, oh);
    ctx.globalAlpha = 1;
    const toMap = (x, y) => ({ x: ox + x * scale, y: oy + y * scale });
    // 怪物
    game.monsters.forEach((mo) => {
      if (mo.dead) return;
      const tx = Math.floor(mo.x / TILE), ty = Math.floor(mo.y / TILE);
      if (!game.explored[ty * m.w + tx]) return;
      const q = toMap(mo.x, mo.y);
      ctx.fillStyle = mo.isBoss ? '#ff4a4a' : mo.elite ? '#ff8a3c' : '#c86a6a';
      ctx.fillRect(q.x - 1.5, q.y - 1.5, mo.isBoss ? 5 : 3, mo.isBoss ? 5 : 3);
    });
    // 掉落
    if (big) {
      game.pickups.forEach((pk) => {
        if (pk.item.cat !== 'equip') return;
        if (G.UI.filterHidden(pk.item) && !G.UI.revealHeld()) return;   // 小地图上也不标隐藏的掉落
        const q = toMap(pk.x, pk.y);
        ctx.fillStyle = G.RARITY_COLOR[pk.item.rarity];
        ctx.fillRect(q.x - 1, q.y - 1, 2, 2);
      });
    }
    // 传送门
    if (game.portalOpen) {
      const q = toMap(m.stairs.x, m.stairs.y);
      ctx.fillStyle = '#c07aff';
      ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, G.TAU); ctx.fill();
    }
    // 玩家
    const p = game.player;
    if (p) {
      const q = toMap(p.x, p.y);
      ctx.fillStyle = '#8ce07a';
      ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, G.TAU); ctx.fill();
      ctx.strokeStyle = '#0f0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x + Math.cos(p.facing) * 7, q.y + Math.sin(p.facing) * 7); ctx.stroke();
    }
    // 城镇：NPC 与深渊之门
    if (game.area === 'town') {
      (m.npcs || []).forEach((n) => {
        const q = toMap(n.x, n.y);
        ctx.fillStyle = '#ffe45c';
        ctx.beginPath(); ctx.arc(q.x, q.y, 2.4, 0, G.TAU); ctx.fill();
      });
      if (m.gate) {
        const q = toMap(m.gate.x, m.gate.y);
        ctx.fillStyle = '#c07aff';
        ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, G.TAU); ctx.fill();
      }
    }
    // 地牢：回城传送门
    if (game.area !== 'town' && m.townPortal) {
      const q = toMap(m.townPortal.x, m.townPortal.y);
      ctx.fillStyle = '#7fd8ff';
      ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, G.TAU); ctx.fill();
    }
    ctx.font = '10px "Noto Sans SC",sans-serif';
    ctx.fillStyle = '#6f6656';
    ctx.fillText(big ? '关闭 [M]' : '', 4, size - 5);
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
