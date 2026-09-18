/**
 * app.js — 极简路由与启动入口（导航以首页为中心，返回按钮固定回首页）
 */
(function () {
  const root = () => document.getElementById('screen-root');

  NG.app = {
    go(name, params) {
      const scr = NG.screens[name];
      if (!scr) return console.warn('未知屏幕:', name);
      if (NG.audio) NG.audio.cancelSequence();   // 任何屏幕切换都停止朗读
      const r = root();
      r.scrollTop = 0;
      scr.render(r, params);
    },
  };

  // 全局委托：学习/练习退出按钮（一次注册，不依赖单屏绑定时机）
  document.addEventListener('click', (e) => {
    if (e.target.closest('#ls-exit, #q-exit')) {
      NG.sfx.tap();
      NG.audio.cancelSequence();                 // 即时停止朗读，立刻给出反馈
      NG.screens.lesson.confirmExit(document.getElementById('screen-root'));
      return;
    }
  });

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
