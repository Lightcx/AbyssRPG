/* 无头环境垫片：被 tools/smoke.js 与调试脚本复用 */
'use strict';
const path = require('path');
const fs = require('fs');
process.chdir(path.join(__dirname, '..'));

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

const files = ['core.js', 'data.js', 'loot.js', 'stats.js', 'dungeon.js', 'town.js', 'combat.js', 'entities.js', 'render.js', 'filter.js', 'ui.js', 'game.js', 'main.js'];
files.forEach((f) => require(path.join(__dirname, '..', 'js', f)));
module.exports = globalThis.G;
