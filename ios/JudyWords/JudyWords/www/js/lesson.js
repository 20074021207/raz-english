/**
 * lesson.js — 课程引擎：学习卡 → 混合题型练习 → 结算
 *
 * 题型（对齐 app/src/types/exercise.ts 的词汇训练子集 + 例句填空扩展）：
 *   en2cn  词义选择   cn2en 反向选择   listen 听音辨词   spell 碎片组装
 *   cloze  例句填空（情境锚定，对齐 methodology_6month.md §3 情境烙印）
 * 生命周期（对齐 docs §4 The Dumb Player）：
 *   答错的题以新题型重新压入队尾，直到清空队列才结算。
 */
(function () {
  const util = NG.util;
  const S = NG.state;
  const D = NG.data;
  const C = NG.CONFIG;

  const ALL_TYPES = ['en2cn', 'cn2en', 'listen', 'spell', 'cloze'];

  function spellable(word) {
    return /^[a-z]{3,8}$/.test(word);
  }

  function pickType(word, exclude) {
    let pool = ALL_TYPES.filter((t) => t !== exclude && (t !== 'spell' || spellable(word)));
    if (!pool.length) pool = ['en2cn'];
    return util.pick(pool);
  }

  /**
   * @param {string} word
   * @param {boolean} isReview 是否复习轮
   * @param {string=} forceType 指定题型
   * @param {string=} excludeType 排除题型（错题重排队时避免重复刚失败的型）
   */
  function makeEx(word, isReview, forceType, excludeType) {
    const t = forceType || pickType(word, excludeType);
    const ex = { word, type: t, isReview: !!isReview, tries: 0 };
    if (t === 'cloze') {
      ex.sentence = util.pick(NG.sentences.get(word));   // 该词随机一条双语例句
    }
    return ex;
  }

  /** 交错排队：打乱但避免同一单词的题相邻 */
  function interleave(exs) {
    const out = [];
    let pool = util.shuffle(exs);
    while (pool.length) {
      let i = 0;
      if (out.length) {
        const alt = pool.findIndex((e) => e.word !== out[out.length - 1].word);
        if (alt > 0) i = alt;
      }
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }

  NG.screens.lesson = {
    session: null,

    render(root) {
      this.session = this.buildSession();
      if (!this.session) return this.renderEmpty(root);
      if (this.session.learn.length) this.renderLearn(root, 0);
      else this.renderExercise(root);
    },

    /* ---------------- 会话组装：到期复习 + 新词 ---------------- */
    buildSession() {
      const s = S.s;
      const due = S.dueWords(C.SESSION_REVIEW_MAX)
        .filter((w) => D.lookup(w));                       // 防御：词库里不存在的不复习

      const seen = new Set(Object.keys(s.words));
      const fresh = D.sample(s.level, C.SESSION_NEW_WORDS, seen);

      if (!due.length && !fresh.length) {
        // 兜底：本级已学但未掌握的弱词
        const weak = D.usableWords(s.level)
          .filter((w) => s.words[w] && s.words[w].m < S.MASTER_AT)
          .sort((a, b) => s.words[a].m - s.words[b].m)
          .slice(0, 8);
        if (!weak.length) return null;
        const exs = weak.map((w) => makeEx(w, true));
        return { learn: [], queue: interleave(exs), reviewSet: new Set(weak) };
      }

      // 新词：两道题（识别类 + 回忆类），复习词：一道题
      const exs = [];
      fresh.forEach((w) => {
        const first = util.pick(['en2cn', 'cn2en']);
        const second = util.pick(first === 'en2cn'
          ? ['cn2en', 'listen', 'spell', 'cloze']
          : ['en2cn', 'listen', 'spell', 'cloze']);
        exs.push(makeEx(w, false, first));
        exs.push(makeEx(w, false, second));
      });
      due.forEach((w) => exs.push(makeEx(w, true)));

      return { learn: fresh, queue: interleave(exs), reviewSet: new Set(due) };
    },

    renderEmpty(root) {
      root.innerHTML = `
        <div class="screen" style="justify-content:center">
          <div class="empty-tip">
            <span class="e">🌈</span>
            ${S.s.level} 级的单词你都学过啦！<br>复习时间还没到，去挑战 Boss 吧！
          </div>
          <button class="btn success" data-nav="boss">⚔️ 挑战 Boss</button>
          <button class="btn ghost mt-8" data-nav="home">返回地图</button>
        </div>`;
    },

    /* ---------------- 阶段一：学习卡（朗读门控：单词读完解锁，例句续播） ---------------- */
    renderLearn(root, i) {
      const sess = this.session;
      const word = sess.learn[i];
      const info = D.lookup(word);
      const sents = NG.sentences.get(word);
      S.learnNewWord(word);
      S.save();

      const nextLabel = i + 1 < sess.learn.length ? '记住了，下一个 ▶' : '记住了，开始练习 ⚡';
      root.innerHTML = `
        <div class="screen learn-wrap">
          <div class="hud">
            <button class="icon-btn" id="ls-exit">✕</button>
            <div style="flex:1">${NG.ui.bar(i / sess.learn.length * 100, true)}</div>
            <span class="count">新词 ${i + 1}/${sess.learn.length}</span>
          </div>
          <div class="learn-dots">${sess.learn.map((_, j) => `<span class="dot ${j <= i ? 'on' : ''}"></span>`).join('')}</div>
          <div class="flashcard">
            <div class="word" id="ls-word">${util.esc(word)}</div>
            <div class="phone">/${util.esc(info.p)}/</div>
            <div class="trans">${util.esc(info.t)}</div>
            <button class="speak-btn" id="ls-speak">🔊</button>
            <div class="sent-list">
              ${sents.map((s, j) => `
                <div class="sent-row" data-s="${j}">
                  <span class="sent-ico">🔈</span>
                  <div class="sent-body">
                    <div class="sent-text">${NG.sentences.highlight(s.en, word)}</div>
                    <div class="sent-zh">${util.esc(s.zh)}</div>
                  </div>
                </div>`).join('')}
            </div>
          </div>
          <div class="mascot-row">
            <div class="m-face">🐰</div>
            <div class="bubble">先听朱迪读一遍，跟着大声读；点例句可以单独听哦！</div>
          </div>
          <button class="btn success mt-12" id="ls-next" disabled>🎧 朱迪正在朗读…</button>
        </div>`;

      // ── 朗读门控（两段式）：单词读完即解锁「下一个」（学习主目标达成），
      //    例句继续自动朗读强化语境；点例句/喇叭可打断并单独听（跳过门控） ──
      this.gateStamp = (this.gateStamp || 0) + 1;
      const stamp = this.gateStamp;
      const btn = root.querySelector('#ls-next');
      const rows = [...root.querySelectorAll('.sent-row')];
      const wordEl = root.querySelector('#ls-word');
      let btnUnlocked = false;
      let playedAll = false;
      const unlockBtn = () => {
        if (btnUnlocked || stamp !== this.gateStamp) return;
        btnUnlocked = true;
        btn.disabled = false;
        btn.textContent = nextLabel;
      };
      const clearHighlights = () => {
        rows.forEach((r) => r.classList.remove('speaking'));
        if (wordEl) wordEl.classList.remove('speaking');
      };
      const finishAll = () => {
        if (playedAll || stamp !== this.gateStamp) return;
        playedAll = true;
        clearHighlights();
      };
      this._releaseGate = () => { unlockBtn(); finishAll(); };   // 供 E2E 使用

      const texts = [word, ...sents.map((s) => s.en)];
      // 单词看门狗：网络卡死也保证按钮可点；总看门狗兜底清高亮
      // （按新音频引擎最坏耗时估算：起播兜底 8.5s + 慢速估读 + 句间停顿，正常路径由 onDone 驱动）
      setTimeout(unlockBtn, 900 + word.length * 130 + 2500);
      setTimeout(finishAll, texts.reduce((a, t) => a + 8500 + t.length * 180 + 280, 0) + 6000);

      NG.audio.speakSequence(texts, (idx) => {
        if (stamp !== this.gateStamp) return;
        rows.forEach((r) => r.classList.remove('speaking'));
        if (wordEl) wordEl.classList.toggle('speaking', idx === 0);
        if (idx > 0 && rows[idx - 1]) rows[idx - 1].classList.add('speaking');
        if (idx === 1) unlockBtn();          // 例句 1 开始 = 单词已读完
      }, finishAll);

      // 手动点击 → 打断序列并直接解锁（孩子主动点读视为完成）
      const manualUnlock = (speakText) => {
        NG.audio.cancelSequence();
        NG.audio.speak(speakText);
        unlockBtn();
        clearHighlights();
      };
      root.querySelector('#ls-speak').addEventListener('click', () => manualUnlock(word));
      rows.forEach((row) => row.addEventListener('click', () => manualUnlock(sents[+row.dataset.s].en)));

      root.querySelector('#ls-next').addEventListener('click', () => {
        if (btn.disabled) return;
        NG.sfx.tap();
        NG.audio.cancelSequence();
        if (i + 1 < sess.learn.length) this.renderLearn(root, i + 1);
        else this.renderExercise(root);
      });
      root.querySelector('#ls-exit').addEventListener('click', () => this.confirmExit(root));
    },

    /* ---------------- 阶段二：练习 ---------------- */
    renderExercise(root) {
      this.qi = 0;
      this.answers = 0;
      this.correct = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.masterBefore = {};
      Object.keys(S.s.words).forEach((w) => { this.masterBefore[w] = S.s.words[w].m; });
      this.renderQuestion(root);
    },

    renderQuestion(root) {
      const sess = this.session;
      const q = sess.queue[this.qi];
      if (!q) return this.renderDone(root);
      const info = D.lookup(q.word);
      const qStart = performance.now();

      const body = q.type === 'spell'
        ? NG.questions.spellBody(q, info, { tools: true })
        : NG.questions.choiceBody(q, info, { speakableWord: q.type === 'en2cn' });

      root.innerHTML = `
        <div class="screen">
          <div class="hud">
            <button class="icon-btn" id="q-exit">✕</button>
            <div style="flex:1">${NG.ui.bar(this.qi / sess.queue.length * 100, true)}</div>
            ${this.combo >= 2 ? `<span class="combo">🔥x${this.combo}</span>` : ''}
            <span class="count">${this.qi + 1}/${sess.queue.length}</span>
          </div>
          <div class="qzone">${body}</div>
        </div>`;

      const done = (ok, chosenEl) => {
        this.answers++;
        const ms = performance.now() - qStart;
        const isReview = sess.reviewSet.has(q.word);
        S.recordAnswer(q.word, ok, ms, isReview);
        if (ok) {
          this.correct++;
          this.combo++;
          this.maxCombo = Math.max(this.maxCombo, this.combo);
          NG.sfx.correct();
          if (chosenEl) NG.fx.floatText(chosenEl, '+8', '#1fa85c');
          if (this.combo === 3 || this.combo === 5 || this.combo === 8 || this.combo === 12) {
            NG.fx.comboBanner(this.combo);
            NG.sfx.combo(this.combo);
          }
        } else {
          this.combo = 0;
          NG.sfx.wrong();
          if (q.tries < 2) {  // 错题以新题型压回队尾（文档 §4 生命周期机制）
            const re = makeEx(q.word, q.isReview, null, q.type);
            re.tries = q.tries + 1;
            sess.queue.push(re);
          }
        }
        this.qi++;
        setTimeout(() => this.renderQuestion(root), ok ? 620 : 1150);
      };

      if (q.type === 'spell') {
        NG.questions.bindSpell(root, q, (ok) => done(ok, null), { tools: true });
        setTimeout(() => NG.audio.speak(q.word), 300);
      } else {
        NG.questions.bindChoice(root, q, info, (ok, btn) => done(ok, btn), { speakableWord: q.type === 'en2cn' });
        if (q.type === 'listen' || q.type === 'en2cn') setTimeout(() => NG.audio.speak(q.word), 300);
      }

      root.querySelector('#q-exit').addEventListener('click', () => this.confirmExit(root));
    },

    confirmExit(root) {
      NG.ui.modal('要离开这一课吗？', '已经学会的进度都会保存，放心离开！', [
        { label: '继续学习', cls: 'success' },
        { label: '离开', cls: 'ghost', onClick: () => NG.app.go('home') },
      ]);
    },

    /* ---------------- 阶段三：结算 ---------------- */
    renderDone(root) {
      const sess = this.session;
      const acc = this.answers ? this.correct / this.answers : 0;
      const masteredGain = [...new Set(sess.queue.map((q) => q.word))]
        .filter((w) => (this.masterBefore[w] ?? 0) < S.MASTER_AT && S.s.words[w] && S.s.words[w].m >= S.MASTER_AT)
        .length;
      const { stars, xp } = S.awardLesson(this.correct, this.answers, this.maxCombo, masteredGain);
      const newBadges = S.checkBadges();

      root.innerHTML = `
        <div class="screen" style="justify-content:center">
          <div class="result-hero">
            <div class="big-emoji">${acc >= 0.9 ? '🏆' : acc >= 0.7 ? '🎉' : '💪'}</div>
            <h2>${acc >= 0.9 ? '完美通关！' : acc >= 0.7 ? '做得好！' : '努力就有收获！'}</h2>
            <div class="sub">${util.pick(['朱迪为你骄傲！', '你的单词力又变强了！', '距离 Boss 又近了一步！'])}</div>
          </div>
          <div class="star-row">
            ${[1, 2, 3, 4].map((i) => `<span class="st ${i <= stars ? 'lit' : ''}" style="animation-delay:${i * 0.18}s">⭐</span>`).join('')}
          </div>
          <div class="card stat-rows">
            <div class="stat-row"><span class="k">答对题数</span><span class="v em">${this.correct} / ${this.answers}</span></div>
            <div class="stat-row"><span class="k">最长连对</span><span class="v">🔥 ${this.maxCombo}</span></div>
            <div class="stat-row"><span class="k">新掌握单词</span><span class="v am">+${masteredGain}</span></div>
            <div class="stat-row"><span class="k">获得经验</span><span class="v">+${xp} XP</span></div>
            <div class="stat-row"><span class="k">距离 Boss</span><span class="v">${S.bossReady() ? '已解锁！⚔️' : `还差 ${S.bossRemaining()} 词`}</span></div>
          </div>
          <button class="btn warn mt-16" data-nav="home">🗺️ 返回冒险地图</button>
          <button class="btn ghost mt-8" data-nav="lesson">再来一课 ⚡</button>
        </div>`;

      NG.ui.clouds(root.querySelector('.screen'));
      NG.sfx.win();
      if (stars >= 3) NG.fx.confetti();

      // 星星逐个点亮 + 徽章提示
      root.querySelectorAll('.star-row .st.lit').forEach((el, i) =>
        setTimeout(() => NG.sfx.star(), 300 + i * 180));
      newBadges.forEach((b, i) =>
        setTimeout(() => NG.fx.toast(`获得徽章【${b.name}】！`, b.icon), 1200 + i * 900));
    },
  };
})();
