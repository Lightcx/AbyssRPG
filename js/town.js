/* ============================================================
 *  暗影深渊 · town.js
 *  城镇「余烬营地」：地图生成 / NPC / 建筑加成
 *  —— 玩家把地牢里刷到的金币与装备带回这里，使用各种服务
 * ============================================================ */
(function (root) {
  'use strict';
  const G = root.G;
  const D = G.DATA;
  const T = (G.Town = {});
  const TILE = 44;
  T.TILE = TILE;
  T.W = 46;
  T.H = 36;

  const at = (m, tx, ty) => (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h ? 0 : m.tiles[ty * m.w + tx]);
  const setAt = (m, tx, ty, v) => { if (tx >= 0 && ty >= 0 && tx < m.w && ty < m.h) m.tiles[ty * m.w + tx] = v; };
  const center = (tx, ty) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });

  /* ---------------- 建筑布局（矩形为实心体块，门朝广场） ---------------- */
  T.BUILDINGS = [
    { id: 'forge', name: '铁匠铺', glyph: '⚒', x: 3, y: 3, w: 11, h: 7, doorSide: 'south', roof: '#6b3a24', wall: '#4a3223' },
    { id: 'altar', name: '深渊祭坛', glyph: '⛩', x: 18, y: 2, w: 10, h: 6, doorSide: 'south', roof: '#6b4c1c', wall: '#3b3020' },
    { id: 'workshop', name: '秘法工坊', glyph: '⚗', x: 32, y: 3, w: 11, h: 7, doorSide: 'south', roof: '#2f3f6b', wall: '#272d40' },
    { id: 'trainyard', name: '训练场', glyph: '⚔', x: 3, y: 20, w: 11, h: 7, doorSide: 'north', roof: '#3f3450', wall: '#2e2839' },
    { id: 'vault', name: '仓库', glyph: '▤', x: 32, y: 20, w: 11, h: 7, doorSide: 'north', roof: '#39473a', wall: '#2b352c' },
    { id: 'market', name: '集市', glyph: '⚖', x: 17, y: 23, w: 12, h: 7, doorSide: 'north', roof: '#6b5a24', wall: '#463d26' },
  ];

  T.doorTile = function (b) {
    const dx = b.x + Math.floor(b.w / 2);
    return b.doorSide === 'north' ? { tx: dx, ty: b.y - 1 } : { tx: dx, ty: b.y + b.h };
  };

  T.GATE = { tx: 23, ty: 32 };
  T.SPAWN = { tx: 23, ty: 30 };

  /* ---------------- NPC ---------------- */
  // panel: 打开的界面；building: 城镇建设面板高亮的建筑
  T.NPCS = [
    { id: 'blacksmith', name: '铁匠 布洛克', title: '分解 · 锻造', glyph: '⚒', color: '#e09a4a', panel: 'panel-blacksmith', tx: 8, ty: 12 },
    { id: 'crafter', name: '秘法工匠 维恩', title: '做装工坊', glyph: '⚗', color: '#7aa8ff', panel: 'panel-craft', tx: 37, ty: 12 },
    { id: 'priest', name: '祭司 娜塔', title: '祭坛 · 城镇建设', glyph: '⛩', color: '#d98b2b', panel: 'panel-town', tx: 23, ty: 10 },
    { id: 'keeper', name: '仓库管理员 米尔', title: '仓库', glyph: '▤', color: '#cbb894', panel: 'panel-stash', tx: 37, ty: 17 },
    { id: 'trainer', name: '训练大师 戈登', title: '训练场 · 城镇建设', glyph: '⚔', color: '#9fe06a', panel: 'panel-town', building: 'trainyard', tx: 8, ty: 17 },
    { id: 'vendor', name: '流浪商人 加兹', title: '交易', glyph: '⚖', color: '#ffe45c', panel: 'panel-vendor', tx: 20, ty: 19 },
    { id: 'jeweler', name: '珠宝匠 凯', title: '宝石合成', glyph: '◆', color: '#8ce07a', panel: 'panel-jeweler', tx: 26, ty: 19 },
    { id: 'guide', name: '深渊向导 塞拉', title: '洗点 · 重塑', glyph: '⌂', color: '#c07aff', panel: 'panel-respec', tx: 20, ty: 32 },
  ];

  /* 第一次与深渊向导交谈时的引导（分页对白；全部用「镇里的人」的口吻说，不跳出世界观） */
  T.GUIDE_PAGES = [
    {
      title: '你是谁',
      lines: [
        '又一位从深渊边缘爬回来的人……坐下吧，我是塞拉。',
        '我会指引你在深渊中前进，也能帮你重新分配你的力量。',
        '你想变强，就得深入深渊。旁边立着那座深渊之门，触碰门扉，它便会打开深渊的道路。',
      ],
    },
    {
      title: '怎么变强',
      lines: [
        '积攒足够的战斗经验，你就会变得更强大。',
        '如此变强五次，你还会额外悟出一些天赋。',
        '你的战斗技艺，如果磨练到一定程度，就可以使出特殊的技巧。',
        '只是我听说这些技巧有些是互斥的。具体的选择还要交给你自己。',
      ],
    },
    {
      title: '营地里这些人',
      lines: [
        '铁匠布洛克 —— 他能够为你分解装备，转化为“深渊残晶”。',
        '秘法工匠维恩 —— 他的工作台能通过残晶和通货石，创造出无与伦比的装备。',
        '祭司娜塔 —— 她守在祭坛边，替营地添砖加瓦。营地的设施越好，你在深渊中的收益也会越高。',
        '仓库管理员米尔 —— 暂时无法穿戴的装备可以留在他的仓库里，他还有专门存放宝石和通货石的货仓。',
        '流浪商人加兹和珠宝匠凯 —— 一个只认金币，另一个只管宝石。需要合成宝石，或者从装备上取下宝石就找珠宝匠凯。',
      ],
    },
    {
      title: '深渊里的规矩',
      lines: [
        '深渊一层比一层深，怪物也会越来越强。',
        '每五层便会有一位深渊领主。杀掉它，深渊就会显露出更深邃的黑暗，',
        '不幸战败的话，我会复活你，但一部分金币费用也是必要的。',
        '装备上的菱形镶孔可以嵌入宝石；深渊残晶和通货石都是硬通货，记得顺手多捡些。',
      ],
    },
    {
      title: '重新分配力量',
      lines: [
        '想要重新分配力量就来找我：出一些金币和深渊残晶，我便会帮助你。',
        '好了，去旁边那道门吧。活着回来。',
      ],
    },
  ];
  T.GUIDE_INTRO = [];
  T.GUIDE_PAGES.forEach((p) => { p.lines.forEach((l) => T.GUIDE_INTRO.push(l)); });
  T.GUIDE_SHORT = '想要重新分配力量就来找我；要深入深渊，去旁边那道门。';

  /* ---------------- 地图生成 ---------------- */
  T.generate = function (rng) {
    const W = T.W, H = T.H;
    const m = {
      w: W, h: H, area: 'town',
      tiles: new Uint8Array(W * H).fill(0),
      variant: new Uint8Array(W * H),
      rooms: [], corridors: [], torches: [], decor: [], wallTiles: [],
      spawns: [], props: [], buildings: [], npcs: [],
      playerStart: center(T.SPAWN.tx, T.SPAWN.ty),
      stairs: center(T.GATE.tx, T.GATE.ty),
      gate: center(T.GATE.tx, T.GATE.ty),
      isBoss: false, floor: 0,
    };

    /* 1) 铺出广场 */
    for (let ty = 1; ty < H - 1; ty++) {
      for (let tx = 1; tx < W - 1; tx++) setAt(m, tx, ty, 1);
    }
    m.rooms.push({ x: 1, y: 1, w: W - 2, h: H - 2, cx: Math.floor(W / 2), cy: Math.floor(H / 2), type: 'plaza' });

    /* 2) 建筑变为实心体块 */
    T.BUILDINGS.forEach((b) => {
      for (let ty = b.y; ty < b.y + b.h; ty++) {
        for (let tx = b.x; tx < b.x + b.w; tx++) {
          if (tx <= 1 || ty <= 1 || tx >= W - 2 || ty >= H - 2) continue;
          setAt(m, tx, ty, 0);
        }
      }
      const door = T.doorTile(b);
      m.buildings.push({
        id: b.id, name: b.name, glyph: b.glyph,
        x: b.x, y: b.y, w: b.w, h: b.h, roof: b.roof, wall: b.wall,
        doorSide: b.doorSide, door: door,
        cx: b.x + b.w / 2, cy: b.y + b.h / 2,
      });
    });

    /* 3) 墙体变体 / 墙砖列表 */
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

    /* 4) NPC */
    T.NPCS.forEach((n) => {
      const pos = center(n.tx, n.ty);
      m.npcs.push({
        kind: 'npc',
        id: n.id, name: n.name, title: n.title, glyph: n.glyph, color: n.color,
        panel: n.panel, building: n.building || null, x: pos.x, y: pos.y, r: 15,
        bob: rng.range(0, 6.28),
      });
    });

    /* 5) 火把 / 灯柱：门口与广场 */
    const torchTiles = [];
    m.buildings.forEach((b) => {
      torchTiles.push({ tx: b.door.tx - 2, ty: b.door.ty });
      torchTiles.push({ tx: b.door.tx + 2, ty: b.door.ty });
    });
    torchTiles.push({ tx: 8, ty: 15 }, { tx: 37, ty: 15 }, { tx: 23, ty: 17 }, { tx: 23, ty: 20 });
    torchTiles.push({ tx: 14, ty: 30 }, { tx: 32, ty: 30 }, { tx: 18, ty: 33 }, { tx: 28, ty: 33 });
    torchTiles.forEach((t) => {
      if (at(m, t.tx, t.ty) !== 1) return;
      const c = center(t.tx, t.ty);
      m.torches.push({ x: c.x, y: c.y, r: rng.range(180, 240), phase: rng.range(0, 6.28), hue: rng.chance(0.5) ? 32 : 46 });
    });

    /* 6) 地面装饰（石板 / 草丛 / 车辙） */
    for (let i = 0; i < 260; i++) {
      const tx = rng.int(2, W - 3), ty = rng.int(2, H - 3);
      if (at(m, tx, ty) !== 1) continue;
      const kind = rng.pick(['stone', 'stone', 'crack', 'moss', 'rubble', 'stone']);
      m.decor.push({
        x: tx * TILE + rng.range(4, TILE - 4), y: ty * TILE + rng.range(4, TILE - 4),
        kind, s: rng.range(0.6, 1.4), a: rng.range(0, 6.28),
      });
    }

    /* 7) 广场物件：木箱 / 水桶 / 摊位 */
    for (let i = 0; i < 26; i++) {
      const tx = rng.int(2, W - 3), ty = rng.int(2, H - 3);
      if (at(m, tx, ty) !== 1) continue;
      const c = center(tx, ty);
      if (G.dist(c.x, c.y, m.playerStart.x, m.playerStart.y) < 90) continue;
      if (G.dist(c.x, c.y, m.gate.x, m.gate.y) < 110) continue;
      m.props.push({ x: c.x + rng.range(-8, 8), y: c.y + rng.range(-8, 8), type: rng.chance(0.6) ? 'barrel' : 'urn', hp: 1 });
    }

    m.mlvl = 1;
    m.totalMonsters = 0;
    return m;
  };

  /* ---------------- 城镇状态 ---------------- */
  T.defaultTown = function () {
    const buildings = {};
    D.BUILDINGS.forEach((b) => { buildings[b.id] = 1; });
    return { buildings, level1: true };
  };

  T.level = function (player, id) {
    if (!player || !player.town || !player.town.buildings) return 1;
    return G.clamp(player.town.buildings[id] | 0, 1, (D.buildingById[id] || { max: 5 }).max);
  };

  T.upgradeCost = function (id, level) {
    const b = D.buildingById[id];
    if (!b) return null;
    const target = Math.max(2, level | 0);
    if (target > b.max) return null;
    return b.cost(target);
  };

  T.canUpgrade = function (player, id) {
    const b = D.buildingById[id];
    if (!b) return { ok: false, why: '未知建筑' };
    const lv = T.level(player, id);
    if (lv >= b.max) return { ok: false, why: '已达最高等级' };
    const cost = T.upgradeCost(id, lv + 1);
    if (player.gold < cost.gold) return { ok: false, why: '金币不足', cost };
    if ((player.shards || 0) < cost.shards) return { ok: false, why: '深渊残晶不足', cost };
    return { ok: true, cost };
  };

  T.upgrade = function (player, id) {
    const r = T.canUpgrade(player, id);
    if (!r.ok) return { ok: false, msg: r.why };
    const lv = T.level(player, id);
    player.gold -= r.cost.gold;
    player.shards = (player.shards || 0) - r.cost.shards;
    player.town.buildings[id] = lv + 1;
    return { ok: true, level: lv + 1, cost: r.cost };
  };

  /* ---------------- 建筑加成（服务类） ---------------- */
  T.orbBonus = (player) => 1 + T.level(player, 'workshop') * 0.15;
  T.shardBonus = (player) => 1 + T.level(player, 'workshop') * 0.2;
  T.salvageBonus = (player) => 1 + (T.level(player, 'forge') - 1) * 0.25;
  T.stashCap = (player) => D.BUILDING_VAULT_CAP(T.level(player, 'vault'));

  T.npcAt = function (m, x, y, r) {
    if (!m || !m.npcs) return null;
    r = r || 40;
    let best = null, bd = 1e9;
    for (let i = 0; i < m.npcs.length; i++) {
      const n = m.npcs[i];
      const d = G.dist(x, y, n.x, n.y);
      if (d < (r + n.r) && d < bd) { bd = d; best = n; }
    }
    return best;
  };

  T.nearestNpc = function (m, x, y, r) {
    if (!m || !m.npcs) return null;
    r = r || 90;
    let best = null, bd = 1e9;
    for (let i = 0; i < m.npcs.length; i++) {
      const n = m.npcs[i];
      const d = G.dist(x, y, n.x, n.y);
      if (d < r && d < bd) { bd = d; best = n; }
    }
    return best;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
