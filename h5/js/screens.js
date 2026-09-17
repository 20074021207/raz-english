/**
 * screens.js — 首页 / 定级测试 / 词库浏览 / 徽章墙
 * （课程 screens 在 lesson.js，Boss 战在 boss.js）
 */
(function () {
  const util = NG.util;
  const S = NG.state;
  const D = NG.data;
  NG.screens = NG.screens || {};

  /* ================= 首页 ================= */
  NG.screens.home = {
    render(root) {
      const s = S.s;
      const mastered = S.masteredInLevel(s.level);
      const bossLeft = S.bossRemaining();
      const due = S.dueCount();
      const goalPct = Math.min(100,
        (s.daily.newWords / NG.CONFIG.DAILY_GOAL_NEW) * 50 +
        (s.daily.reviews / NG.CONFIG.DAILY_GOAL_REVIEW) * 50);
      const isNewDone = s.daily.newWords >= NG.CONFIG.DAILY_GOAL_NEW;
      const isRevDone = s.daily.reviews >= NG.CONFIG.DAILY_GOAL_REVIEW;

      const bossState = bossLeft === 0
        ? (S.bossCooldownLeft() > 0 ? 'charging' : 'ready')
        : 'locked';
      const bossEmoji = this.bossEmoji();

      let bossHtml;
      if (bossState === 'ready') {
        bossHtml = `
          <div class="boss-card ready">
            <div class="boss-emoji">${bossEmoji}</div>
            <div class="boss-info">
              <div class="bt">Boss 战开战啦！</div>
              <div class="bd">${s.level} → ${D.nextLevel(s.level)} 晋级挑战<br>15 题 · 120 秒 · 答对 13 题晋级</div>
            </div>
            <button class="boss-go" data-nav="boss">挑战</button>
          </div>`;
      } else if (bossState === 'charging') {
        bossHtml = `
          <div class="boss-card charging">
            <div class="boss-emoji">💤</div>
            <div class="boss-info">
              <div class="bt">Boss 充能中…</div>
              <div class="bd">休息一下，${util.fmtLeft(S.bossCooldownLeft())} 后可以再次挑战。先去复习巩固吧！</div>
            </div>
          </div>`;
      } else {
        bossHtml = `
          <div class="boss-card locked">
            <div class="boss-emoji">${bossEmoji}</div>
            <div class="boss-info">
              <div class="bt">Boss 尚未解锁</div>
              <div class="bd">再掌握 <b>${bossLeft}</b> 个单词，就能挑战 ${s.level} 级 Boss！</div>
            </div>
            <div style="min-width:64px">${NG.ui.bar((NG.CONFIG.BOSS_TARGET_WORDS - bossLeft) / NG.CONFIG.BOSS_TARGET_WORDS * 100, true)}</div>
          </div>`;
      }

      const trailHtml = D.levels.map((lv, i) => {
        const cur = D.levelIdx(s.level);
        const cls = i < cur ? 'done' : i === cur ? 'current' : 'locked';
        const mark = i < cur ? '✓' : lv;
        return `${i === 0 ? '' : '<div class="link"></div>'}<div class="node ${cls}">${mark}</div>`;
      }).join('');

      root.innerHTML = `
        <div class="screen" id="home-screen">
          <div class="topbar">
            <div class="mascot-avatar">🐰<span class="lv-badge">Lv.${S.foxLevel()}</span></div>
            <div class="topbar-greet">
              <div class="hi">${util.greeting()}！</div>
              <div class="sub">${util.esc(s.level)} 关 · 已掌握 ${S.masteredTotal()} 词</div>
            </div>
            <div class="chip streak">🔥${s.streak.days}</div>
            <div class="chip stars">⭐${s.stars}</div>
            <button class="icon-btn" id="btn-settings">${s.settings.sound ? '🔊' : '🔇'}</button>
          </div>

          <div class="hero-card">
            <div class="hero-level-row">
              <div class="hero-level">LEVEL ${util.esc(s.level)}<small>冒险中</small></div>
              <div class="hero-mascot">🐰</div>
            </div>
            <div class="hero-sub">掌握 ${NG.CONFIG.BOSS_TARGET_WORDS} 个单词解锁 Boss 战</div>
            ${NG.ui.bar(mastered / NG.CONFIG.BOSS_TARGET_WORDS * 100)}
            <div class="bar-label"><span>已掌握 ${mastered}</span><span>目标 ${NG.CONFIG.BOSS_TARGET_WORDS}</span></div>
            <div class="mt-16">
              <button class="btn warn" data-nav="lesson">${due > 0 ? `▶ 开始学习（含 ${due} 个复习）` : '▶ 开始学习'}</button>
            </div>
          </div>

          <div class="card goal-card">
            ${NG.ui.goalRing(goalPct)}
            <div class="goal-list">
              <div class="goal-item"><span class="done-mark">${isNewDone ? '✅' : '📝'}</span>新词 ${s.daily.newWords} / ${NG.CONFIG.DAILY_GOAL_NEW}</div>
              <div class="goal-item"><span class="done-mark">${isRevDone ? '✅' : '🔁'}</span>复习 ${s.daily.reviews} / ${NG.CONFIG.DAILY_GOAL_REVIEW}</div>
              <div class="goal-item muted">完成双目标奖励 🎁 2 星</div>
            </div>
          </div>

          ${bossHtml}

          <div class="grid-2">
            <button class="tile-card" data-nav="wordlist">
              <span class="ico">📖</span><span class="t">词库</span><span class="d">${D.usableWords(s.level).length} 个单词</span>
            </button>
            <button class="tile-card" data-nav="badges">
              <span class="ico">🏅</span><span class="t">徽章墙</span><span class="d">${Object.keys(s.badges).length} / ${S.BADGES.length} 枚</span>
            </button>
          </div>

          <div class="card trail-card">
            <div class="trail-title">🗺️ 冒险地图（RAZ 29 级 · 本 app 到 L 级）</div>
            <div class="trail">${trailHtml}</div>
          </div>

          <div class="muted center mt-12">朱迪 Lv.${S.foxLevel()} · 距下一级 ${200 - (s.xp % 200)} XP</div>
        </div>`;

      NG.ui.clouds(root.querySelector('.screen'));

      root.querySelector('#btn-settings').addEventListener('click', () => {
        NG.sfx.tap();
        NG.ui.modal('⚙️ 设置',
          `声音：${s.settings.sound ? '开启' : '关闭'}<br>当前级别：${s.level} · 连续学习 ${s.streak.days} 天`,
          [
            { label: s.settings.sound ? '🔇 关闭音效' : '🔊 开启音效', cls: 'ghost', onClick: () => { s.settings.sound = !s.settings.sound; S.save(); NG.screens.home.render(root); } },
            { label: '🧭 重新定级', cls: 'ghost', onClick: () => NG.app.go('placement') },
            { label: '🗑 重置全部进度', cls: 'ghost', onClick: () => NG.ui.modal('确定重置吗？', '所有学习进度、星星和徽章都会消失，无法找回。', [
              { label: '取消', cls: 'ghost' },
              { label: '确认重置', onClick: () => { S.reset(); NG.app.go('placement'); } },
            ]) },
            { label: '关闭', cls: '' },
          ]);
      });
    },

    bossEmoji() {
      const bosses = ['🐙', '🐲', '👾', '🤖', '🦖', '👹', '🦀', '🕷️', '👺', '🦇', '🐋', '🦂'];
      return bosses[D.levelIdx(S.s.level) % bosses.length];
    },
  };

  /* ================= 定级测试（文档 §5 Diagnostic Quest 适配版） ================= */
  NG.screens.placement = {
    usedWords: null,
    history: null,
    queue: null,
    qi: 0,
    score: 0,
    probeIdx: 0,

    render(root) {
      this.usedWords = new Set();
      this.history = [];
      this.probeIdx = NG.CONFIG.PLACEMENT_START_IDX;
      this.startProbe(root);
    },

    startProbe(root) {
      const lv = D.levelAt(this.probeIdx);
      const words = D.sample(lv, NG.CONFIG.PLACEMENT_PROBE_SIZE, this.usedWords);
      words.forEach((w) => this.usedWords.add(w));
      this.queue = words.map((w) => ({ word: w, lv }));
      this.qi = 0;
      this.score = 0;
      this.renderQuestion(root);
    },

    renderQuestion(root) {
      const s = S.s;
      const q = this.queue[this.qi];
      if (!q) return this.finishProbe(root);

      const trans = D.lookup(q.word).t;
      const dis = D.distractorTrans(q.lv, q.word, 3);
      if (dis.length < 3) { // 极端兜底：本级干扰不足，直接跳过该词
        this.qi++;
        return this.renderQuestion(root);
      }
      const options = util.shuffle([trans, ...dis]);

      root.innerHTML = `
        <div class="screen">
          <div class="placement-head">
            <div class="pf">🐰</div>
            <h2>魔法定级测验</h2>
            <p>别紧张，这不是考试！<br>朱迪只是想找到最适合你的冒险起点 ✨</p>
          </div>
          <div class="placement-meta">
            <span class="chip">第 ${this.history.length + 1} / ${NG.CONFIG.PLACEMENT_MAX_PROBES} 轮</span>
            <span class="chip">🔍 探测 ${util.esc(q.lv)} 级</span>
            <span class="chip">${this.qi + 1} / ${this.queue.length}</span>
          </div>
          <div class="qzone">
            <span class="qtype-badge">这个单词是什么意思？</span>
            <div class="q-word-big">${util.esc(q.word)}</div>
            <div class="q-phone">/${util.esc(D.lookup(q.word).p)}/</div>
            <div class="opts" id="opts">
              ${options.map((o, i) => `<button class="opt" data-i="${i}">${util.esc(o)}</button>`).join('')}
            </div>
          </div>
          <div class="mascot-row mt-12">
            <div class="m-face">🐰</div>
            <div class="bubble">认识它吗？猜一猜也没关系！</div>
          </div>
        </div>`;

      let answered = false;
      root.querySelectorAll('.opt').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (answered) return;
          answered = true;
          const ok = btn.textContent.trim() === trans;
          if (ok) { this.score++; btn.classList.add('correct'); NG.sfx.correct(); }
          else {
            btn.classList.add('wrong');
            root.querySelectorAll('.opt').forEach((b) => { if (b.textContent.trim() === trans) b.classList.add('correct'); });
            NG.sfx.wrong();
          }
          root.querySelectorAll('.opt').forEach((b) => { if (!b.classList.contains('correct') && !b.classList.contains('wrong')) b.classList.add('dim'); });
          this.qi++;
          setTimeout(() => this.renderQuestion(root), ok ? 550 : 900);
        });
      });
    },

    finishProbe(root) {
      const size = this.queue.length || 1;
      const score = this.score;
      this.history.push({ idx: this.probeIdx, score });

      const delta = score / size >= 0.8 ? 2 : score / size >= 0.6 ? 1 : score / size >= 0.4 ? -1 : -2;
      const next = util.clamp(this.probeIdx + delta, 0, D.maxLevelIdx);

      let finalIdx = null;
      if (next === this.probeIdx) finalIdx = this.probeIdx;                       // 收敛（触底/顶）
      else if (this.history.length >= NG.CONFIG.PLACEMENT_MAX_PROBES) {
        finalIdx = score / size >= 0.6 ? this.probeIdx : Math.max(0, this.probeIdx - 1);
      }

      if (finalIdx !== null) return this.renderResult(root, finalIdx);
      this.probeIdx = next;
      this.startProbe(root);
    },

    renderResult(root, finalIdx) {
      const lv = D.levelAt(finalIdx);
      S.s.level = lv;
      S.s.placementDone = true;
      S.save();

      root.innerHTML = `
        <div class="screen" style="justify-content:center">
          <div class="result-hero">
            <div class="big-emoji">🎉</div>
            <h2>你的起点是 ${lv} 级！</h2>
            <div class="sub">朱迪为你选好了最合适的冒险地图</div>
          </div>
          <div class="star-row"><span class="st lit">🐰</span></div>
          <div class="mascot-row" style="justify-content:center">
            <div class="m-face">🐰</div>
            <div class="bubble">太好了！我们从 ${lv} 级出发，一起去打 Boss 吧！</div>
          </div>
          <button class="btn success mt-24" data-nav="lesson">▶ 开始第一课</button>
          <button class="btn ghost mt-8" data-nav="home">先看看地图</button>
        </div>`;
      NG.fx.confetti();
      NG.sfx.win();
      NG.ui.clouds(root.querySelector('.screen'));
    },
  };

  /* ================= 词库浏览 ================= */
  NG.screens.wordlist = {
    curLevel: null,

    render(root) {
      const s = S.s;
      const curIdx = D.levelIdx(s.level);
      if (!this.curLevel || D.levelIdx(this.curLevel) > curIdx) this.curLevel = s.level;

      root.innerHTML = `
        <div class="screen">
          ${NG.ui.navbar('📖 单词词库')}
          <div class="tabs" id="lv-tabs">
            ${D.levels.slice(0, curIdx + 1).map((lv) => `<button class="tab ${lv === this.curLevel ? 'on' : ''}" data-lv="${lv}">${lv}</button>`).join('')}
          </div>
          <div class="search-row">
            <input class="search-input" id="wl-search" placeholder="搜索单词或中文…" autocomplete="off">
          </div>
          <div class="word-rows" id="wl-rows"></div>
          <div class="muted center mt-8">点击单词听发音 · ⭐ 已掌握</div>
        </div>`;

      const renderRows = () => {
        const kw = (root.querySelector('#wl-search').value || '').trim().toLowerCase();
        const rows = D.allWords(this.curLevel)
          .filter(([w, t]) => !kw || w.toLowerCase().includes(kw) || (t || '').includes(kw))
          .slice(0, 120);
        const el = root.querySelector('#wl-rows');
        if (!rows.length) {
          el.innerHTML = '<div class="empty-tip"><span class="e">🔍</span>没有找到匹配的单词</div>';
          return;
        }
        el.innerHTML = rows.map(([w, t]) => {
          const st = S.wordStat(w);
          const mark = st ? (st.m >= S.MASTER_AT ? '⭐' : '🔅') : '·';
          return `<div class="word-row" data-w="${util.esc(w)}">
            <div class="w">${util.esc(w)}</div>
            <div class="m">${util.esc(t || '—')}</div>
            <div class="mk">${mark}</div>
          </div>`;
        }).join('');
        el.querySelectorAll('.word-row').forEach((r) =>
          r.addEventListener('click', () => NG.audio.speak(r.dataset.w)));
      };

      root.querySelectorAll('#lv-tabs .tab').forEach((t) =>
        t.addEventListener('click', () => {
          this.curLevel = t.dataset.lv;
          root.querySelectorAll('#lv-tabs .tab').forEach((x) => x.classList.toggle('on', x === t));
          renderRows();
        }));
      root.querySelector('#wl-search').addEventListener('input', renderRows);
      renderRows();
    },
  };

  /* ================= 徽章墙 ================= */
  NG.screens.badges = {
    render(root) {
      const s = S.s;
      const levelBadges = Object.keys(s.badges)
        .filter((id) => id.startsWith('boss_lv_'))
        .map((id) => ({ icon: '🎖️', name: `${id.slice(8)} 级征服者`, desc: `通过 ${id.slice(8)} 级 Boss 战` }));
      const all = [...S.BADGES, ...levelBadges];
      const unlocked = new Set(Object.keys(s.badges));

      root.innerHTML = `
        <div class="screen">
          ${NG.ui.navbar('🏅 徽章墙')}
          <div class="card" style="display:flex;gap:12px;align-items:center">
            <div style="font-size:44px">🏆</div>
            <div>
              <div style="font-weight:900;font-size:16px">已收集 ${unlocked.size} / ${all.length} 枚徽章</div>
              <div class="muted mt-8">⭐ ${s.stars} 星 · 🐰 Lv.${S.foxLevel()} · ⚔️ Boss 胜 ${s.totals.bossWins} 场 · ⚡ 最长连对 ${s.bestCombo}</div>
            </div>
          </div>
          <div class="badge-grid">
            ${all.map((b) => `
              <div class="badge-cell ${unlocked.has(b.id) ? '' : 'locked'}">
                <span class="bi">${b.icon}</span>
                <div class="bn">${util.esc(b.name)}</div>
                <div class="bd">${util.esc(b.desc)}</div>
              </div>`).join('')}
          </div>
        </div>`;
    },
  };
})();
