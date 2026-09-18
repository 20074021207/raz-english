/**
 * boss.js — 晋级 Boss 战（Diagnostic Sprint）
 *
 * 参数完全对齐 docs/course_generator_arch.md §1.3 与 app/src/app/raz-boss.tsx：
 *   15 题（70% 下一级新词 + 30% 本级已学词巩固）· 全局 120 秒 · 正确率 ≥ 85% 晋级 ·
 *   未通过 48h 冷却（中途刷新/退出按弃战同样计冷却）·
 *   sprint_score = 正确率 × (0.7 + 0.3 × 速度系数)
 */
(function () {
  const util = NG.util;
  const S = NG.state;
  const D = NG.data;
  const C = NG.CONFIG;

  NG.screens.boss = {
    phase: null,
    queue: null,

    render(root) {
      const s = S.s;
      const next = D.nextLevel(s.level);
      const cooldown = S.bossCooldownLeft();

      // 无下一级（L 级通关）
      if (!next) {
        root.innerHTML = `
          <div class="screen" style="justify-content:center">
            <div class="result-hero">
              <div class="big-emoji">👑</div>
              <h2>你已征服 L 级！</h2>
              <div class="sub">H5 版地图到此为止，继续复习保持实力吧！</div>
            </div>
            <button class="btn success mt-16" data-nav="home">返回地图</button>
          </div>`;
        return;
      }

      // 冷却中
      if (cooldown > 0) {
        root.innerHTML = `
          <div class="screen dark" style="justify-content:center">
            <div class="verdict-emoji">💤</div>
            <div class="result-hero">
              <h2>Boss 正在充能</h2>
              <div class="sub" style="color:rgba(255,255,255,0.75)">还有 ${util.fmtLeft(cooldown)} 就能再战！<br>先去复习巩固一下吧 💪</div>
            </div>
            <button class="btn success mt-16" data-nav="lesson">▶ 去复习</button>
            <button class="btn ghost mt-8" data-nav="home">返回地图</button>
          </div>`;
        return;
      }

      // 未解锁（理论上首页已拦，这里兜底）
      if (!S.bossReady()) {
        root.innerHTML = `
          <div class="screen" style="justify-content:center">
            <div class="empty-tip"><span class="e">🔒</span>再掌握 ${S.bossRemaining()} 个单词即可解锁 Boss 战</div>
            <button class="btn success" data-nav="lesson">▶ 继续学习</button>
            <button class="btn ghost mt-8" data-nav="home">返回地图</button>
          </div>`;
        return;
      }

      this.renderIntro(root, next);
    },

    renderIntro(root, next) {
      const bossEmoji = NG.screens.home.bossEmoji();
      root.innerHTML = `
        <div class="screen dark" style="justify-content:center">
          <div class="boss-face">${bossEmoji}</div>
          <div class="boss-vs">${S.s.level} 级守护者 · 击败它前往 ${next} 级</div>
          <div class="card mt-16" style="background:rgba(255,255,255,0.08);text-align:left">
            <div class="stat-row"><span class="k">⚔️ 题量</span><span class="v">${C.BOSS_QUESTIONS} 道词汇题</span></div>
            <div class="stat-row"><span class="k">⏱ 限时</span><span class="v">${C.BOSS_TIME_S} 秒</span></div>
            <div class="stat-row"><span class="k">🏆 晋级条件</span><span class="v">答对 ${Math.ceil(C.BOSS_QUESTIONS * C.BOSS_PASS_RATIO)} 题</span></div>
            <div class="stat-row"><span class="k">🛡 失败保护</span><span class="v">${C.BOSS_COOLDOWN_H} 小时后可重试</span></div>
          </div>
          <div class="mascot-row mt-16" style="justify-content:center">
            <div class="m-face">🐰</div>
            <div class="bubble" style="background:rgba(255,255,255,0.92)">别怕！你已掌握 ${S.masteredInLevel(S.s.level)} 个单词，一定能赢！</div>
          </div>
          <button class="btn warn mt-16" id="boss-start">⚔️ 开始战斗</button>
          <button class="btn ghost mt-8" data-nav="home">再准备一下</button>
        </div>`;
      root.querySelector('#boss-start').addEventListener('click', () => {
        NG.sfx.bosshit();
        this.startBattle(root, next);
      });
    },

    buildQuestions(next) {
      const cur = S.s.level;
      const nNew = Math.ceil(C.BOSS_QUESTIONS * 0.7);
      const nOld = C.BOSS_QUESTIONS - nNew;
      const newWords = D.sample(next, nNew);
      // 巩固题只考本级「学过」的词（以学习记录 st.l 为准，与 masteredInLevel 口径一致；
      // 解锁战斗时本级必有 ≥30 个已掌握，正常足够；极端情况退回全级抽样）
      const learned = Object.keys(S.s.words).filter((w) => S.s.words[w].l === cur);
      const oldWords = learned.length >= nOld ? util.sample(learned, nOld) : D.sample(cur, nOld);
      const pool = util.shuffle([...newWords, ...oldWords]);
      const spellable = (w) => /^[a-z]{3,8}$/.test(w);

      return pool.map((w, idx) => {
        const t = idx % 3;
        let type = 'en2cn';
        if (t === 1) type = 'listen';
        if (t === 2 && spellable(w)) type = 'spell';
        return { word: w, lv: D.lookup(w).l, type };
      });
    },

    startBattle(root, next) {
      this.queue = this.buildQuestions(next);
      this.qi = 0;
      this.score = 0;
      this.timeLeft = C.BOSS_TIME_S;
      this.t0 = performance.now();
      this.lastTickSec = C.BOSS_TIME_S;
      this.next = next;
      this.phase = 'battle';
      S.startBossAttempt();   // 登记战斗：中途刷新/退出将在下次启动按弃战计冷却

      this.timer = setInterval(() => {
        this.timeLeft = Math.max(0, this.timeLeft - 0.1);
        const el = document.getElementById('boss-timer');
        if (el) {
          el.textContent = Math.ceil(this.timeLeft);
          el.classList.toggle('warn', this.timeLeft <= 60 && this.timeLeft > 30);
          el.classList.toggle('danger', this.timeLeft <= 30);
        }
        const sec = Math.ceil(this.timeLeft);
        if (sec <= 10 && sec !== this.lastTickSec && this.timeLeft > 0) {
          this.lastTickSec = sec;
          NG.sfx.tick();
        }
        if (this.timeLeft <= 0) this.finish(root);
      }, 100);

      this.renderQuestion(root);
    },

    renderQuestion(root) {
      if (this.phase !== 'battle') return;   // 计时器已结算（超时），忽略挂起的推进回调
      const q = this.queue[this.qi];
      if (!q) return this.finish(root);
      const info = D.lookup(q.word);
      const total = this.queue.length;

      const body = q.type === 'spell'
        ? NG.questions.spellBody(q, info, {})
        : NG.questions.choiceBody(q, info, {});

      root.innerHTML = `
        <div class="screen dark">
          <div class="hud">
            <div style="flex:1">${NG.ui.bar(this.qi / total * 100, true)}</div>
            <span class="count">✅ ${this.score}</span>
            <span class="boss-timer" id="boss-timer">${Math.ceil(this.timeLeft)}</span>
          </div>
          <div class="boss-face" id="boss-face">${NG.screens.home.bossEmoji()}</div>
          <div class="boss-vs">第 ${this.qi + 1} / ${total} 题 · 击败守护者冲向 ${this.next} 级！</div>
          <div class="qzone">${body}</div>
        </div>`;

      const advance = (ok) => {
        if (ok) {
          this.score++;
          const bf = root.querySelector('#boss-face');
          if (bf) { bf.classList.add('hit'); setTimeout(() => bf.classList.remove('hit'), 420); }
          NG.sfx.bosshit();
        } else NG.sfx.wrong();
        // 已学过的词照常结算掌握度
        if (S.wordStat(q.word)) S.recordAnswer(q.word, ok, 0, true);
        this.qi++;
        setTimeout(() => (this.qi >= this.queue.length ? this.finish(root) : this.renderQuestion(root)), ok ? 650 : 1200);
      };

      if (q.type === 'spell') {
        NG.questions.bindSpell(root, q, advance);
        setTimeout(() => NG.audio.speak(q.word), 300);
      } else {
        NG.questions.bindChoice(root, q, info, advance);
        if (q.type === 'listen') setTimeout(() => NG.audio.speak(q.word), 300);
      }
    },

    finish(root) {
      if (this.phase !== 'battle') return;
      this.phase = 'verdict';
      clearInterval(this.timer);
      S.endBossAttempt();

      const total = this.queue.length;
      const accuracy = this.score / total;
      const elapsed = (performance.now() - this.t0) / 1000;
      const speedFactor = Math.max(0, 1 - elapsed / (C.BOSS_TIME_S * 2));
      const sprintScore = Math.round(accuracy * 100 * (0.7 + 0.3 * speedFactor));
      const passed = accuracy >= C.BOSS_PASS_RATIO;

      let extraBadges = [];
      if (passed) {
        const newLevel = S.promote();
        if (newLevel) extraBadges.push(newLevel);
      } else {
        S.startBossCooldown();
      }
      const newBadges = S.checkBadges(extraBadges);
      const next = this.next;

      root.innerHTML = `
        <div class="screen dark" style="justify-content:center">
          <div class="verdict-emoji">${passed ? '🏆' : '🛡'}</div>
          <div class="result-hero">
            <h2>${passed ? '晋级成功！' : '守护者太强了…'}</h2>
            <div class="sub" style="color:rgba(255,255,255,0.78)">
              ${passed ? `恭喜解锁 ${next} 级地图！朱迪超骄傲！` : `只差一点点！复习后再来，${C.BOSS_COOLDOWN_H} 小时后 Boss 重返战场。`}
            </div>
          </div>
          <div class="stat-card mt-16">
            <div class="stat-row"><span class="k">正确率</span><span class="v ${passed ? 'em' : 'rd'}">${Math.round(accuracy * 100)}%（${this.score}/${total}）</span></div>
            <div class="stat-row"><span class="k">用时</span><span class="v">${Math.round(elapsed)} 秒</span></div>
            <div class="stat-row"><span class="k">Sprint Score</span><span class="v">${sprintScore}</span></div>
            <div class="stat-row"><span class="k">级别</span><span class="v">${passed ? `${next} 级已解锁 🎉` : '保持当前级别'}</span></div>
          </div>
          <button class="btn ${passed ? 'success' : 'warn'} mt-16" data-nav="home">🗺️ 返回冒险地图</button>
          ${passed ? '' : '<button class="btn ghost mt-8" data-nav="lesson">▶ 去复习薄弱词</button>'}
        </div>`;

      if (passed) {
        NG.fx.confetti('big');
        NG.sfx.win();
      } else {
        NG.sfx.lose();
      }
      newBadges.forEach((b, i) =>
        setTimeout(() => NG.fx.toast(`获得徽章【${b.name}】！`, b.icon), 1000 + i * 900));
    },
  };
})();
