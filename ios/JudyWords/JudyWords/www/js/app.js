/**
 * app.js — 极简路由与启动入口（导航以首页为中心，返回按钮固定回首页）
 */
(function () {
  const root = () => document.getElementById('screen-root');

  NG.app = {
    go(name, params) {
      const scr = NG.screens[name];
      if (!scr) return console.warn('未知屏幕:', name);
      const r = root();
      r.scrollTop = 0;
      scr.render(r, params);
    },
  };

  // 全局 data-nav 委托导航
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-nav]');
    if (!el) return;
    NG.sfx.tap();
    NG.app.go(el.dataset.nav);
  });

  // 启动
  NG.state.load();
  NG.app.go(NG.state.s.placementDone ? 'home' : 'placement');
})();
