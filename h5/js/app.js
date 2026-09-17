/**
 * app.js — 极简路由与启动入口
 */
(function () {
  const root = () => document.getElementById('screen-root');

  NG.app = {
    stack: [],

    go(name, params) {
      const scr = NG.screens[name];
      if (!scr) return console.warn('未知屏幕:', name);
      if (name === 'home') this.stack = ['home'];
      else if (this.stack[this.stack.length - 1] !== name) this.stack.push(name);
      else if (this.stack.length > 1) this.stack[this.stack.length - 1] = name; // 同名刷新
      const r = root();
      r.scrollTop = 0;
      scr.render(r, params);
    },

    back() {
      if (this.stack.length > 1) this.stack.pop();
      this.go(this.stack[this.stack.length - 1] || 'home');
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
