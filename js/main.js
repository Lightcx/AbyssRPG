/* ============================================================
 *  暗影深渊 · main.js
 *  启动引导与主循环
 * ============================================================ */
(function (root) {
  'use strict';
  const G = root.G;

  G.boot = function () {
    const canvas = G.el('game');
    G.Render.init(canvas);
    G.input.init(canvas);

    const game = new G.Game();
    G.GAME = game;
    G.UI.init(game);
    G.UI.buildStart(game);

    // 日志与升级提示
    G.bus.on('log', (p) => G.UI.log(p.msg, p.cls));
    G.bus.on('levelup', (p) => {
      G.UI.levelUpToast(p.level);
      G.UI.dirty.char = true;
      G.UI.dirty.inv = true;
      if (G.UI.open === 'panel-character') G.UI.renderCharacter();
      if (G.UI.open === 'panel-skill') G.UI.renderSkillWindow();
      G.UI.refreshInventory();
    });
    G.logLines.forEach((l) => G.UI.log(l.msg, l.cls));

    // 首次交互时激活音频
    const kick = () => { G.audio.init(); G.audio.resume(); };
    root.addEventListener('pointerdown', kick, { once: true });
    root.addEventListener('keydown', kick, { once: true });

    // 窗口失焦自动暂停
    root.addEventListener('blur', () => { if (game.started) G.UI.setPaused(true); });

    G.now = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());
    let last = G.now();
    G.TICK = 0;
    function frame() {
      const now = G.now();
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.25) dt = 0.25;
      G.TICK++;
      game.update(dt);
      if (!G.HEADLESS) root.requestAnimationFrame(frame);
    }
    if (G.HEADLESS) G.frameOnce = frame;   // 无头调试钩子：按真实主循环推进一帧
    else root.requestAnimationFrame(frame);

    root.addEventListener('error', (e) => {
      console.error(e.error || e.message);
      G.UI.fatal(e.error || e.message);
    });
    root.addEventListener('unhandledrejection', (e) => {
      G.UI.fatal(e.reason);
    });

    return game;
  };

  if (!G.HEADLESS) {
    if (!root.document) {
      // 无 DOM 环境
    } else if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', () => { try { G.boot(); } catch (e) { console.error(e); G.UI.fatal(e); } });
    } else {
      try { G.boot(); } catch (e) { console.error(e); G.UI.fatal(e); }
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
