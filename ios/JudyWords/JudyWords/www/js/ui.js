/**
 * ui.js — 共享 UI 组件与视觉特效（Confetti / Toast / 漂浮文字 / 模态）
 */
(function () {
  const util = NG.util;

  NG.ui = {
    /** 喇叭发音图标（配合 .q-speak 等按钮使用，currentColor 随主题） */
    speaker() {
      return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor" stroke="none"/>
        <path d="M15.5 8.5a5 5 0 0 1 0 7"/>
        <path d="M18.5 5.5a9 9 0 0 1 0 13"/>
      </svg>`;
    },

    /** 主题：解析 跟随系统/深色/浅色 并落到 <html data-theme>；auto 监听系统切换 */
    applyTheme() {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const apply = () => {
        const t = (NG.state && NG.state.s && NG.state.s.settings.theme) || 'auto';
        document.documentElement.dataset.theme = t === 'auto' ? (mq.matches ? 'dark' : 'light') : t;
      };
      apply();
      if (!NG.ui._themeWatch) {
        NG.ui._themeWatch = true;
        try { mq.addEventListener('change', apply); } catch (e) { /* 旧浏览器忽略 */ }
      }
    },

    /** 朱迪吉祥物（兔子警官 SVG，统一替换各处 🐰 emoji） */
    judy(cls) {
      return `<svg class="judy ${cls || ''}" viewBox="0 0 120 132" xmlns="http://www.w3.org/2000/svg" aria-label="朱迪">
        <g transform="rotate(-9 40 34)">
          <ellipse cx="40" cy="30" rx="12.5" ry="30" fill="#96a3b6"/>
          <ellipse cx="40" cy="34" rx="6.8" ry="20.5" fill="#f5b6c6"/>
        </g>
        <g transform="rotate(9 80 34)">
          <ellipse cx="80" cy="30" rx="12.5" ry="30" fill="#96a3b6"/>
          <ellipse cx="80" cy="34" rx="6.8" ry="20.5" fill="#f5b6c6"/>
        </g>
        <ellipse cx="60" cy="88" rx="35" ry="32" fill="#a9b6c9"/>
        <path d="M30 62 Q60 32 90 62 L90 67 Q60 55 30 67 Z" fill="#31519e"/>
        <rect x="27" y="64" width="66" height="9" rx="4.5" fill="#274383"/>
        <ellipse cx="60" cy="75" rx="24" ry="4.5" fill="#1d3263"/>
        <circle cx="60" cy="61" r="4.6" fill="#f5c542"/>
        <circle cx="60" cy="61" r="1.8" fill="#fff" opacity=".85"/>
        <ellipse cx="45" cy="86" rx="9.5" ry="11.5" fill="#432c78"/>
        <circle cx="48.5" cy="81.5" r="3.6" fill="#fff"/>
        <circle cx="42" cy="90.5" r="1.7" fill="#fff" opacity=".85"/>
        <ellipse cx="75" cy="86" rx="9.5" ry="11.5" fill="#432c78"/>
        <circle cx="78.5" cy="81.5" r="3.6" fill="#fff"/>
        <circle cx="72" cy="90.5" r="1.7" fill="#fff" opacity=".85"/>
        <ellipse cx="60" cy="105" rx="16.5" ry="11" fill="#eef2f7"/>
        <ellipse cx="60" cy="100.5" rx="4.6" ry="3.4" fill="#e2809b"/>
        <path d="M60 104 Q60 109 54.5 110 M60 104 Q60 109 65.5 110" stroke="#8a7a95" stroke-width="1.7" fill="none" stroke-linecap="round"/>
        <ellipse cx="35" cy="101" rx="5.2" ry="3.2" fill="#f2a9b8" opacity=".5"/>
        <ellipse cx="85" cy="101" rx="5.2" ry="3.2" fill="#f2a9b8" opacity=".5"/>
      </svg>`;
    },

    /** 背景云朵装饰 */
    clouds(root) {
      const el = document.createElement('div');
      el.className = 'clouds';
      const spots = [
        { top: '6%', size: 40, dur: 46, delay: 0 },
        { top: '18%', size: 30, dur: 62, delay: 8 },
        { top: '40%', size: 52, dur: 54, delay: 22 },
        { top: '62%', size: 34, dur: 70, delay: 4 },
        { top: '80%', size: 44, dur: 50, delay: 30 },
      ];
      el.innerHTML = spots.map((p) =>
        `<div class="cloud" style="top:${p.top};left:-80px;font-size:${p.size}px;animation-duration:${p.dur}s;animation-delay:-${p.delay}s">☁️</div>`
      ).join('');
      root.prepend(el);
    },

    navbar(title, backTo) {
      return `
        <div class="navbar">
          <button class="icon-btn" data-nav="${backTo || 'home'}">←</button>
          <div class="title">${util.esc(title)}</div>
        </div>`;
    },

    bar(pct, thin) {
      return `<div class="bar${thin ? ' thin' : ''}"><div class="fill" style="width:${util.clamp(pct, 0, 100)}%"></div></div>`;
    },

    /** 每日目标环（conic-gradient） */
    goalRing(pct) {
      const p = util.clamp(pct, 0, 100);
      const color = p >= 100 ? 'var(--emerald)' : 'var(--primary-bright)';
      return `
        <div class="goal-ring" style="background:conic-gradient(${color} ${p * 3.6}deg, var(--ring-track, #e6eef3) 0deg)">
          <div class="pct"><b>${Math.round(p)}%</b><span>今日</span></div>
        </div>`;
    },

    modal(title, body, buttons) {
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML = `
        <div class="modal">
          <h3>${title}</h3>
          <p>${body}</p>
          <div class="modal-btns">
            ${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-mbtn="${i}">${b.label}</button>`).join('')}
          </div>
        </div>`;
      buttons.forEach((b, i) => {
        mask.querySelector(`[data-mbtn="${i}"]`).addEventListener('click', () => {
          mask.remove();
          if (b.onClick) b.onClick(mask);
        });
      });
      document.getElementById('app').appendChild(mask);
      return mask;
    },
  };

  /* ---------------- 视觉特效 ---------------- */
  const fxLayer = () => document.getElementById('fx-layer');

  NG.fx = {
    toast(msg, icon) {
      const t = document.createElement('div');
      t.className = 'toast';
      t.innerHTML = `${icon ? `<span>${icon}</span>` : ''}<span>${msg}</span>`;
      fxLayer().appendChild(t);
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2000);
    },

    /** 从元素位置飘出文字（+8 XP 之类） */
    floatText(anchorEl, text, color) {
      if (!anchorEl) return;
      const r = anchorEl.getBoundingClientRect();
      const appR = document.getElementById('app').getBoundingClientRect();
      const f = document.createElement('div');
      f.className = 'float-txt';
      f.textContent = text;
      if (color) f.style.color = color;
      f.style.left = `${r.left - appR.left + r.width / 2 - 14}px`;
      f.style.top = `${r.top - appR.top - 6}px`;
      fxLayer().appendChild(f);
      setTimeout(() => f.remove(), 950);
    },

    comboBanner(n) {
      const b = document.createElement('div');
      b.className = 'combo-banner';
      b.textContent = `🔥 连对 ${n}  ${util.pick(util.cheer.combo)}`;
      document.getElementById('app').appendChild(b);
      setTimeout(() => b.remove(), 1050);
    },

    /** 五彩纸屑（canvas 粒子，2.4s） */
    confetti(power) {
      const cv = document.getElementById('confetti');
      const dpr = window.devicePixelRatio || 1;
      cv.width = innerWidth * dpr;
      cv.height = innerHeight * dpr;
      const ctx = cv.getContext('2d');
      ctx.scale(dpr, dpr);
      const colors = ['#ffd44d', '#ff8a5e', '#6ee7b0', '#7ccfef', '#c4a6ff', '#ff9db5'];
      const W = innerWidth, H = innerHeight;
      const N = power === 'big' ? 180 : 90;
      const parts = [];
      for (let i = 0; i < N; i++) {
        parts.push({
          x: W / 2 + (Math.random() - 0.5) * 140,
          y: H * 0.35 + (Math.random() - 0.5) * 60,
          vx: (Math.random() - 0.5) * (power === 'big' ? 13 : 9),
          vy: -Math.random() * 11 - 4,
          g: 0.32 + Math.random() * 0.1,
          s: 6 + Math.random() * 6,
          r: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
          c: colors[Math.floor(Math.random() * colors.length)],
        });
      }
      const t0 = performance.now();
      (function frame(t) {
        const dt = t - t0;
        ctx.clearRect(0, 0, W, H);
        for (const p of parts) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += p.g;
          p.vx *= 0.99;
          p.r += p.vr;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.r);
          ctx.fillStyle = p.c;
          ctx.globalAlpha = Math.max(0, 1 - dt / 2400);
          ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.7);
          ctx.restore();
        }
        if (dt < 2400) requestAnimationFrame(frame);
        else ctx.clearRect(0, 0, W, H);
      })(t0);
    },
  };
})();
