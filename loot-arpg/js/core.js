/* ============================================================
 *  暗影深渊 · core.js
 *  基础工具：命名空间 / 随机数 / 数学 / 输入 / 音效 / 存档
 *  所有模块挂载在全局 G 上（classic script，无需打包）
 * ============================================================ */
(function (root) {
  'use strict';
  const G = (root.G = root.G || {});
  /* 版本号：与根目录 CHANGELOG.md 里最新的一条保持一致（tools/smoke.js 会校验） */
  G.VERSION = '0.0.1';
  G.VERSION_TAG = 'v' + G.VERSION;
  G.HEADLESS = !!root.__HEADLESS__;

  /* ---------------- 数学 ---------------- */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
  const ang = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  const approach = (cur, target, step) => (cur < target ? Math.min(cur + step, target) : Math.max(cur - step, target));
  const smooth = (cur, target, t) => cur + (target - cur) * t;
  const sign = (v) => (v < 0 ? -1 : 1);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const fmt = (n) => {
    n = Math.round(n);
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  };
  const pct = (v) => (Math.round(v * 10) / 10) + '%';

  /* ---------------- 随机数（可复现） ---------------- */
  function RNG(seed) {
    let s = (seed >>> 0) || 1;
    const r = {
      seed: s,
      next() { // mulberry32
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      // 与 next 等价，语义化别名
      float() { return r.next(); },
      range(a, b) { return a + r.next() * (b - a); },
      int(a, b) { return Math.floor(a + r.next() * (b - a + 1)); },
      chance(p) { return r.next() < p; },
      pick(arr) { return arr[Math.floor(r.next() * arr.length)]; },
      pickN(arr, n) {
        const c = arr.slice();
        const out = [];
        n = Math.min(n, c.length);
        for (let i = 0; i < n; i++) out.push(c.splice(Math.floor(r.next() * c.length), 1)[0]);
        return out;
      },
      weighted(list, wfn) {
        let total = 0;
        for (let i = 0; i < list.length; i++) total += Math.max(0, wfn(list[i], i));
        if (total <= 0) return list[Math.floor(r.next() * list.length)];
        let roll = r.next() * total;
        for (let i = 0; i < list.length; i++) {
          roll -= Math.max(0, wfn(list[i], i));
          if (roll <= 0) return list[i];
        }
        return list[list.length - 1];
      },
      shuffle(a) {
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
        return a;
      },
      normal(mean, sd) {
        let u = 0, v = 0;
        while (u === 0) u = r.next();
        while (v === 0) v = r.next();
        return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
      },
      fork(salt) { return RNG((s * 2654435761 + (salt || 1) * 40503) >>> 0); },
    };
    return r;
  }

  let uidCounter = 1;
  const uid = () => 'i' + (uidCounter++).toString(36) + Math.floor(Math.random() * 1296).toString(36);
  G.uid = uid;
  G.RNG = RNG;
  // 全局非确定性随机（用于特效抖动等）
  G.rng = RNG((Date.now() ^ 0x9e3779b9) >>> 0);

  G.TAU = TAU;
  Object.assign(G, {
    clamp, lerp, dist, dist2, ang, angDiff, approach, smooth, sign, easeOut, fmt, pct,
    rand(a, b) { return G.rng.range(a, b); },
    randInt(a, b) { return G.rng.int(a, b); },
    chance(p) { return G.rng.chance(p); },
    pick(arr) { return G.rng.pick(arr); },
  });

  /* ---------------- 事件总线 ---------------- */
  const listeners = {};
  G.bus = {
    on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return fn; },
    off(evt, fn) { const l = listeners[evt]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    emit(evt, payload) {
      const l = listeners[evt];
      if (!l) return;
      for (let i = 0; i < l.length; i++) {
        try { l[i](payload); } catch (e) { console.error('[bus:' + evt + ']', e); }
      }
    },
  };

  /* ---------------- DOM 便捷 ---------------- */
  const el = (id) => (root.document ? root.document.getElementById(id) : null);
  G.el = el;
  G.text = (id, txt) => { const n = el(id); if (n) n.textContent = txt; };
  G.show = (id, on) => { const n = el(id); if (n) n.hidden = !on; };

  /* ---------------- 输入 ---------------- */
  const keysDown = Object.create(null);
  const keysPressed = Object.create(null);
  const keysReleased = Object.create(null);
  const Input = {
    mouse: { x: 0, y: 0, wx: 0, wy: 0, left: false, right: false, middle: false, leftPressed: false, rightPressed: false, middlePressed: false, wheel: 0 },
    enabled: true,
    ws: 0, hs: 0,
    init(canvas) {
      if (!root.document) return;
      const doc = root.document;
      doc.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        // 面板输入时不拦截
        if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
        keysDown[e.code] = true; keysPressed[e.code] = true;
        const bound = G.Settings && G.Settings.isBound(e.code);
        if (bound || ['Space', 'Tab', 'KeyF', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].indexOf(e.code) >= 0) e.preventDefault();
      });
      doc.addEventListener('keyup', (e) => { keysDown[e.code] = false; keysReleased[e.code] = true; });
      const move = (e) => {
        Input.mouse.x = e.clientX; Input.mouse.y = e.clientY;
      };
      root.addEventListener('mousemove', move);
      const target = canvas || root;
      target.addEventListener('mousedown', (e) => {
        move(e);
        if (e.button === 0) { Input.mouse.left = true; Input.mouse.leftPressed = true; }
        if (e.button === 1) { Input.mouse.middle = true; Input.mouse.middlePressed = true; }
        if (e.button === 2) { Input.mouse.right = true; Input.mouse.rightPressed = true; }
        e.preventDefault();
      });
      root.addEventListener('mouseup', (e) => {
        if (e.button === 0) Input.mouse.left = false;
        if (e.button === 1) Input.mouse.middle = false;
        if (e.button === 2) Input.mouse.right = false;
      });
      root.addEventListener('contextmenu', (e) => e.preventDefault());
      root.addEventListener('wheel', (e) => { Input.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
      root.addEventListener('blur', () => { for (const k in keysDown) keysDown[k] = false; Input.mouse.left = Input.mouse.right = Input.mouse.middle = false; });
    },
    down(code) { return !!keysDown[code]; },
    pressed(code) { return !!keysPressed[code]; },
    released(code) { return !!keysReleased[code]; },
    // 移动轴：读取当前操作模式下绑定的方向键
    axis() {
      let x = 0, y = 0;
      const S = G.Settings;
      if (S) {
        if (S.down('moveLeft')) x -= 1;
        if (S.down('moveRight')) x += 1;
        if (S.down('moveUp')) y -= 1;
        if (S.down('moveDown')) y += 1;
      }
      if (x && y) { const k = Math.SQRT1_2; x *= k; y *= k; }
      return { x, y };
    },
    anyKeyPressed(list) { for (let i = 0; i < list.length; i++) if (keysPressed[list[i]]) return list[i]; return null; },
    /* 供自动化测试使用 */
    simulate(code) { keysDown[code] = true; keysPressed[code] = true; },
    simulateUp(code) { keysDown[code] = false; keysReleased[code] = true; },
    endFrame() {
      for (const k in keysPressed) delete keysPressed[k];
      for (const k in keysReleased) delete keysReleased[k];
      Input.mouse.leftPressed = false;
      Input.mouse.rightPressed = false;
      Input.mouse.middlePressed = false;
      Input.mouse.wheel = 0;
    },
    clear() { for (const k in keysDown) keysDown[k] = false; Input.mouse.left = Input.mouse.right = Input.mouse.middle = false; },
  };
  G.input = Input;

  /* ---------------- 音效（WebAudio 合成，无外部资源） ---------------- */
  const Audio = {
    ctx: null, master: null, enabled: true, ready: false,
    init() {
      if (this.ready) return;
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.22;
        this.master.connect(this.ctx.destination);
        this.ready = true;
      } catch (e) { this.enabled = false; }
    },
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
    setEnabled(v) { this.enabled = !!v; if (this.master) this.master.gain.value = this.enabled ? 0.22 : 0; },
    _tone(freq, dur, type, vol, slideTo, delay) {
      if (!this.enabled || !this.ready) return;
      const t0 = this.ctx.currentTime + (delay || 0);
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol == null ? 0.3 : vol), t0 + Math.min(0.02, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(this.master);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    },
    _noise(dur, vol, filterFreq, delay) {
      if (!this.enabled || !this.ready) return;
      const t0 = this.ctx.currentTime + (delay || 0);
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = filterFreq || 1200;
      const g = this.ctx.createGain(); g.gain.value = vol == null ? 0.3 : vol;
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start(t0);
    },
    play(name, opt) {
      if (!this.enabled) return;
      if (!this.ready) this.init();
      if (!this.ready) return;
      const r = G.rng;
      switch (name) {
        case 'hit': this._noise(0.09, 0.24, r.range(900, 1800)); this._tone(r.range(150, 230), 0.07, 'square', 0.12, 60); break;
        case 'hitBig': this._noise(0.18, 0.4, 700); this._tone(110, 0.22, 'sawtooth', 0.22, 40); break;
        case 'crit': this._noise(0.14, 0.36, 2600); this._tone(880, 0.12, 'square', 0.16, 300); this._tone(1320, 0.14, 'triangle', 0.12, 500, 0.03); break;
        case 'swing': this._noise(0.13, 0.16, 2400); break;
        case 'arrow': this._noise(0.1, 0.14, 3400); this._tone(700, 0.06, 'triangle', 0.07, 1500); break;
        case 'fire': this._noise(0.34, 0.3, 900); this._tone(180, 0.3, 'sawtooth', 0.14, 60); break;
        case 'ice': this._tone(1500, 0.22, 'triangle', 0.15, 500); this._noise(0.24, 0.16, 5000); break;
        case 'bolt': this._tone(1800, 0.09, 'square', 0.13, 400); this._noise(0.13, 0.2, 4200); break;
        case 'explode': this._noise(0.5, 0.45, 500); this._tone(90, 0.45, 'sawtooth', 0.24, 30); break;
        case 'die': this._tone(220, 0.3, 'sawtooth', 0.16, 60); this._noise(0.26, 0.2, 800); break;
        case 'dieBig': this._tone(120, 0.8, 'sawtooth', 0.26, 35); this._noise(0.8, 0.35, 600); break;
        case 'levelup': [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.28, 'triangle', 0.2, null, i * 0.09)); break;
        case 'loot': this._tone(880, 0.09, 'triangle', 0.12, 1200); break;
        case 'lootRare': [660, 880, 1320].forEach((f, i) => this._tone(f, 0.2, 'triangle', 0.16, null, i * 0.07)); break;
        case 'gold': this._tone(1400, 0.07, 'square', 0.08, 1900); break;
        case 'potion': this._tone(400, 0.2, 'sine', 0.16, 900); break;
        case 'ui': this._tone(520, 0.05, 'square', 0.07); break;
        case 'portal': [300, 420, 560, 760].forEach((f, i) => this._tone(f, 0.4, 'sine', 0.14, f * 2, i * 0.1)); break;
        case 'shout': this._tone(180, 0.5, 'sawtooth', 0.2, 320); break;
        case 'boss': this._tone(70, 1.4, 'sawtooth', 0.3, 45); this._noise(1.2, 0.3, 400); break;
        case 'hurt': this._noise(0.16, 0.3, 900); this._tone(180, 0.14, 'square', 0.14, 90); break;
        case 'dodge': this._noise(0.16, 0.2, 1600); break;
        case 'noskill': this._tone(200, 0.08, 'square', 0.1, 140); break;
        default: this._tone(600, 0.06, 'square', 0.08); break;
      }
    },
  };
  G.audio = Audio;

  /* ---------------- 存档（多存档位） ---------------- */
  const KEY_LEGACY = 'shadow-abyss-save-v1';
  const KEY_BASE = 'shadow-abyss-slot';
  G.SAVE_SLOTS = 3;
  const slotKey = (slot) => KEY_BASE + '-' + (slot | 0);

  function lsGet(k) { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { if (root.localStorage) { root.localStorage.setItem(k, v); return true; } return false; } catch (e) { console.warn('存档失败', e); return false; } }
  function lsDel(k) { try { if (root.localStorage) root.localStorage.removeItem(k); } catch (e) { } }

  G.storage = {
    KEY_BASE,
    save(obj, slot) { return lsSet(slotKey(slot || 0), JSON.stringify(obj)); },
    load(slot) {
      const s = lsGet(slotKey(slot || 0));
      if (!s) return null;
      try { return JSON.parse(s); } catch (e) { return null; }
    },
    clear(slot) { lsDel(slotKey(slot || 0)); },
    exists(slot) { return !!lsGet(slotKey(slot || 0)); },
    /* 存档摘要（不加载完整数据，用于存档列表） */
    meta(slot) {
      const d = G.storage.load(slot);
      if (!d || !d.cls) return null;
      return {
        slot: slot | 0, cls: d.cls, level: d.level || 1, xp: d.xp || 0,
        floor: d.floor || 1, diffIdx: d.diffIdx || 0, gold: Math.round(d.gold || 0),
        playTime: d.playTime || 0, ts: d.ts || 0, kills: d.kills || 0,
        area: d.area || 'dungeon', name: d.name || '',
      };
    },
    list() {
      const out = [];
      for (let i = 0; i < G.SAVE_SLOTS; i++) out.push(G.storage.meta(i));
      return out;
    },
    usedSlots() { let n = 0; for (let i = 0; i < G.SAVE_SLOTS; i++) if (G.storage.exists(i)) n++; return n; },
    /* 旧版单存档 -> 存档位 0 */
    migrate() {
      const legacy = lsGet(KEY_LEGACY);
      if (!legacy) return false;
      if (!lsGet(slotKey(0))) lsSet(slotKey(0), legacy);
      lsDel(KEY_LEGACY);
      return true;
    },
    clearAll() { for (let i = 0; i < G.SAVE_SLOTS; i++) lsDel(slotKey(i)); },
  };
  G.storage.migrate();

  /* ---------------- 设置：操作模式 / 按键绑定 / 音效 ----------------
   * 两种操作模式各自维护一套按键绑定：
   *   mouse 鼠标模式：左键移动，右键普攻，1-4 释放 4 个主动技能
   *   wasd  键盘模式：WASD 移动，左键普攻，右键技能1，1/2/3 释放技能 2/3/4
   */
  const SETTINGS_KEY = 'shadow-abyss-settings-v1';

  // 可重新绑定的动作（顺序即设置面板中的显示顺序）
  const ACTIONS = [
    { id: 'attack', name: '普通攻击', group: '战斗' },
    { id: 'skill1', name: '技能 1', group: '战斗' },
    { id: 'skill2', name: '技能 2', group: '战斗' },
    { id: 'skill3', name: '技能 3', group: '战斗' },
    { id: 'skill4', name: '技能 4', group: '战斗' },
    { id: 'dodge', name: '翻滚闪避', group: '战斗' },
    { id: 'potionLife', name: '生命药水', group: '战斗' },
    { id: 'potionMana', name: '法力药水', group: '战斗' },
    { id: 'pickup', name: '拾取 / 交互', group: '战斗' },
    { id: 'moveUp', name: '向上移动', group: '移动' },
    { id: 'moveDown', name: '向下移动', group: '移动' },
    { id: 'moveLeft', name: '向左移动', group: '移动' },
    { id: 'moveRight', name: '向右移动', group: '移动' },
    { id: 'inventory', name: '背包', group: '界面' },
    { id: 'character', name: '角色', group: '界面' },
    { id: 'vendor', name: '商人', group: '界面' },
    { id: 'craft', name: '做装工坊', group: '界面' },
    { id: 'stash', name: '仓库', group: '界面' },
    { id: 'town', name: '城镇建设', group: '界面' },
    { id: 'map', name: '大地图', group: '界面' },
    { id: 'recall', name: '往返城镇 / 深渊', group: '界面' },
    { id: 'help', name: '帮助', group: '界面' },
    { id: 'settings', name: '设置', group: '界面' },
  ];

  const COMMON_BINDS = {
    dodge: 'Space', potionLife: 'KeyQ', potionMana: 'KeyE', pickup: 'KeyF',
    inventory: 'KeyI', character: 'KeyC', vendor: 'KeyV', help: 'KeyH',
    map: 'KeyM', craft: 'KeyG', stash: 'KeyK', town: 'KeyB',
    recall: 'KeyT', settings: 'KeyO',
  };

  const MODE_DEFS = [
    {
      id: 'mouse', name: '鼠标操作', glyph: '🖱',
      desc: '左键移动（按住可持续走位），右键普通攻击，1 / 2 / 3 / 4 释放四个主动技能。',
    },
    {
      id: 'wasd', name: 'WASD 操作', glyph: '⌨',
      desc: 'W A S D 移动，左键普通攻击（不会自动移动），右键释放技能 1，1 / 2 / 3 释放技能 2 / 3 / 4。',
    },
  ];

  function defaultBinds() {
    return {
      mouse: Object.assign({
        attack: 'MouseRight',
        skill1: 'Digit1', skill2: 'Digit2', skill3: 'Digit3', skill4: 'Digit4',
        moveUp: null, moveDown: null, moveLeft: null, moveRight: null,
      }, COMMON_BINDS),
      wasd: Object.assign({
        attack: 'MouseLeft',
        skill1: 'MouseRight', skill2: 'Digit1', skill3: 'Digit2', skill4: 'Digit3',
        moveUp: 'KeyW', moveDown: 'KeyS', moveLeft: 'KeyA', moveRight: 'KeyD',
      }, COMMON_BINDS),
    };
  }

  const KEY_LABELS = {
    Space: '空格', Escape: 'Esc', Tab: 'Tab', Enter: '回车', Backspace: '退格',
    ShiftLeft: '左 Shift', ShiftRight: '右 Shift', ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl',
    AltLeft: '左 Alt', AltRight: '右 Alt', CapsLock: '大写锁定',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    MouseLeft: '鼠标左键', MouseRight: '鼠标右键', MouseMiddle: '鼠标中键',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  };
  const MOUSE_CODES = ['MouseLeft', 'MouseMiddle', 'MouseRight'];

  const Settings = {
    ACTIONS, MODES: MODE_DEFS, KEY_LABELS, MOUSE_CODES,
    data: null,

    init() {
      Settings.data = Settings.load();
      return Settings.data;
    },
    defaults() {
      return { mode: 'mouse', audio: true, binds: defaultBinds() };
    },
    load() {
      const d = Settings.defaults();
      const raw = lsGet(SETTINGS_KEY);
      if (!raw) return d;
      try {
        const saved = JSON.parse(raw);
        if (saved && (saved.mode === 'mouse' || saved.mode === 'wasd')) d.mode = saved.mode;
        if (saved && typeof saved.audio === 'boolean') d.audio = saved.audio;
        if (saved && saved.binds) {
          ['mouse', 'wasd'].forEach((m) => {
            if (!saved.binds[m]) return;
            ACTIONS.forEach((a) => {
              const v = saved.binds[m][a.id];
              // null 代表“未绑定”，必须保留；undefined 表示没有存过 → 用默认值
              if (v !== undefined) d.binds[m][a.id] = v;
            });
          });
        }
      } catch (e) { console.warn('设置读取失败', e); }
      return d;
    },
    save() {
      const ok = lsSet(SETTINGS_KEY, JSON.stringify(Settings.data));
      if (!ok) console.warn('设置保存失败');
      return ok;
    },
    reset() {
      const mode = Settings.data ? Settings.data.mode : 'mouse';
      const audio = Settings.data ? Settings.data.audio : true;
      Settings.data = Settings.defaults();
      Settings.data.mode = mode;
      Settings.data.audio = audio;
      Settings.save();
      return Settings.data;
    },
    mode() { return Settings.data ? Settings.data.mode : 'mouse'; },
    modeDef(id) { return MODE_DEFS.filter((m) => m.id === (id || Settings.mode()))[0] || MODE_DEFS[0]; },
    setMode(id) {
      if (id !== 'mouse' && id !== 'wasd') return false;
      Settings.data.mode = id;
      Settings.save();
      return true;
    },
    binds(mode) { return Settings.data.binds[mode || Settings.mode()]; },
    getBind(action, mode) { const b = Settings.binds(mode); return b ? (b[action] || null) : null; },
    setBind(action, code, mode) {
      const b = Settings.binds(mode);
      if (!b) return;
      b[action] = code || null;
    },
    isMouseCode(code) { return MOUSE_CODES.indexOf(code) >= 0; },
    isBound(code, mode) {
      if (!code) return false;
      const b = Settings.binds(mode);
      for (const k in b) if (b[k] === code) return true;
      return false;
    },
    actionOf(code, mode) {
      const b = Settings.binds(mode);
      for (const k in b) if (b[k] === code) return k;
      return null;
    },
    keyLabel(code) {
      if (!code) return '未绑定';
      if (KEY_LABELS[code]) return KEY_LABELS[code];
      if (/^Key[A-Z]$/.test(code)) return code.slice(3);
      if (/^Digit[0-9]$/.test(code)) return code.slice(5);
      if (/^Numpad[0-9]$/.test(code)) return '小键盘' + code.slice(6);
      if (/^F[0-9]{1,2}$/.test(code)) return code;
      return code;
    },
    /* 统一的“按下 / 按住”查询（同时处理键盘与鼠标绑定） */
    down(action) {
      const c = Settings.getBind(action);
      if (!c) return false;
      if (c === 'MouseLeft') return !!G.input.mouse.left;
      if (c === 'MouseRight') return !!G.input.mouse.right;
      if (c === 'MouseMiddle') return !!G.input.mouse.middle;
      return G.input.down(c);
    },
    pressed(action) {
      const c = Settings.getBind(action);
      if (!c) return false;
      if (c === 'MouseLeft') return !!G.input.mouse.leftPressed;
      if (c === 'MouseRight') return !!G.input.mouse.rightPressed;
      if (c === 'MouseMiddle') return !!G.input.mouse.middlePressed;
      return G.input.pressed(c);
    },
    /* 该动作是否绑定了鼠标键 */
    isMouseAction(action) { return Settings.isMouseCode(Settings.getBind(action)); },
  };
  G.Settings = Settings;
  Settings.init();
  if (G.audio && Settings.data) G.audio.enabled = !!Settings.data.audio;

  /* ---------------- 共享仓库：通货石与宝石（跨存档位共用） ----------------
   * 与角色存档分开存储，删除某个存档位不会影响这里；每种最多堆叠 MAX 个。
   */
  const SHARED_KEY = 'shadow-abyss-shared-v1';
  const Shared = {
    KEY: SHARED_KEY,
    MAX: 9999,
    data: { orbs: {}, gems: {} },
    _dirty: false,
    gemKey: (gem, tier) => gem + '_' + (tier | 0),
    parseGemKey(k) { const i = k.lastIndexOf('_'); return { gem: k.slice(0, i), tier: parseInt(k.slice(i + 1), 10) || 0 }; },
    load() {
      Shared.data = { orbs: {}, gems: {} };
      const raw = lsGet(SHARED_KEY);
      if (!raw) return Shared.data;
      try {
        const s = JSON.parse(raw);
        if (s && s.orbs) for (const k in s.orbs) { const v = Math.min(Shared.MAX, s.orbs[k] | 0); if (v > 0) Shared.data.orbs[k] = v; }
        if (s && s.gems) for (const k in s.gems) { const v = Math.min(Shared.MAX, s.gems[k] | 0); if (v > 0) Shared.data.gems[k] = v; }
      } catch (e) { console.warn('共享仓库读取失败', e); }
      return Shared.data;
    },
    save() { return lsSet(SHARED_KEY, JSON.stringify(Shared.data)); },
    /* 存入：返回真正存进去的数量（受上限限制） */
    addOrb(id, n) {
      if (!id || !(n > 0)) return 0;
      const cur = Shared.data.orbs[id] | 0;
      const put = Math.min(n, Shared.MAX - cur);
      if (put > 0) { Shared.data.orbs[id] = cur + put; Shared._dirty = true; }
      return put;
    },
    countOrb(id) { return Shared.data.orbs[id] | 0; },
    takeOrb(id, n) {
      const cur = Shared.data.orbs[id] | 0;
      const take = Math.min(cur, Math.max(0, n));
      if (take > 0) {
        if (cur - take > 0) Shared.data.orbs[id] = cur - take; else delete Shared.data.orbs[id];
        Shared._dirty = true;
      }
      return take;
    },
    addGem(gem, tier, n) {
      const k = Shared.gemKey(gem, tier);
      const cur = Shared.data.gems[k] | 0;
      const put = Math.min(n, Shared.MAX - cur);
      if (put > 0) { Shared.data.gems[k] = cur + put; Shared._dirty = true; }
      return put;
    },
    countGem(gem, tier) { return Shared.data.gems[Shared.gemKey(gem, tier)] | 0; },
    takeGem(gem, tier, n) {
      const k = Shared.gemKey(gem, tier);
      const cur = Shared.data.gems[k] | 0;
      const take = Math.min(cur, Math.max(0, n));
      if (take > 0) {
        if (cur - take > 0) Shared.data.gems[k] = cur - take; else delete Shared.data.gems[k];
        Shared._dirty = true;
      }
      return take;
    },
    totalOrbs() { let t = 0; for (const k in Shared.data.orbs) t += Shared.data.orbs[k]; return t; },
    totalGems() { let t = 0; for (const k in Shared.data.gems) t += Shared.data.gems[k]; return t; },
    flush() { if (Shared._dirty) { Shared._dirty = false; Shared.save(); } },
    clear() { Shared.data = { orbs: {}, gems: {} }; Shared.save(); },
  };
  G.Shared = Shared;
  Shared.load();

  /* ---------------- 日志（UI 接管输出） ---------------- */
  G.logLines = [];
  G.log = function (msg, cls) {
    G.logLines.push({ msg, cls: cls || '' });
    if (G.logLines.length > 60) G.logLines.shift();
    G.bus.emit('log', { msg, cls: cls || '' });
  };

  /* ---------------- 颜色 ---------------- */
  G.RARITY_COLOR = { common: '#d6d2cc', magic: '#7f9dff', rare: '#ffe45c', unique: '#d98b2b' };
  G.RARITY_NAME = { common: '普通', magic: '魔法', rare: '稀有', unique: '暗金' };
  G.ELEM_COLOR = { physical: '#e8e0d0', fire: '#ff9a3c', cold: '#7fd8ff', lightning: '#ffe45c', poison: '#8ce07a' };
})(typeof globalThis !== 'undefined' ? globalThis : this);
