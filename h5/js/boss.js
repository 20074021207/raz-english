/**
 * boss.js — 晋级 Boss 战（Diagnostic Sprint）
 *
 * 参数完全对齐 docs/course_generator_arch.md §1.3 与 app/src/app/raz-boss.tsx：
 *   15 题（70% 下一级新词 + 30% 本级巩固）· 全局 120 秒 · 正确率 ≥ 85% 晋级 ·
 *   未通过 48h 冷却 · sprint_score = 正确率 × (0.7 + 0.3 × 速度系数)
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
      const used = new Set();
      const words = [
        ...D.sample(next, nNew, used),
        ...D.sample(cur, nOld, used),
      ];
      const pool = util.shuffle(words);
      const spellable = (w) => /^[a-z]{3,8}$/.test(w);

      return pool.map((w, idx) => {
        const info = D.lookup(w);
        const t = idx % 3;
        let type = 'translation';
        if (t === 1) type = 'listen';
        if (t === 2 && spellable(w)) type = 'spell';
        return { word: w, lv: info.l, type };
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
      const q = this.queue[this.qi];
      if (!q) return this.finish(root);
      const info = D.lookup(q.word);
      const total = this.queue.length;

      let body = '';
      if (q.type === 'translation') {
        const options = util.shuffle([info.t, ...D.distractorTrans(q.lv, q.word, 3)]);
        q._options = options; q._answer = info.t;
        body = `
          <span class="qtype-badge">📖 词义选择</span>
          <div class="q-word-big">${util.esc(q.word)}</div>
          <div class="q-phone">/${util.esc(info.p)}/</div>
          <div class="opts" id="opts">${options.map((o, i) => `<button class="opt" data-i="${i}">${util.esc(o)}</button>`).join('')}</div>`;
      } else if (q.type === 'listen') {
        const options = util.shuffle([q.word, ...D.distractorWords(q.lv, q.word, 3)]);
        q._options = options; q._answer = q.word;
        body = `
          <span class="qtype-badge">🎧 听音辨词</span>
          <div class="q-prompt">听一听，选出你听到的单词</div>
          <div class="listen-zone"><button class="speak-btn big" id="q-replay">🔊</button></div>
          <div class="opts" id="opts">${options.map((o, i) => `<button class="opt word-opt" data-i="${i}">${util.esc(o)}</button>`).join('')}</div>
          <div class="listen-reveal" id="listen-reveal"></div>`;
      } else {
        const letters = q.word.split('');
        const extra = Math.max(2, Math.floor(letters.length * 0.4));
        const alpha = 'abcdefghijklmnopqrstuvwxyz';
        const set = new Set(letters);
        const pads = [];
        while (pads.length < extra) {
          const ch = alpha[Math.floor(Math.random() * 26)];
          if (!set.has(ch)) { pads.push(ch); set.add(ch); }
        }
        q._tiles = util.shuffle([...letters, ...pads]);
        q._picked = []; q._pickedIdx = [];
        body = `
          <span class="qtype-badge">🧩 碎片组装</span>
          <div class="q-prompt">拼出这个单词！</div>
          <div class="q-trans-target">${util.esc(info.t)}</div>
          <div class="listen-zone"><button class="speak-btn" id="q-replay">🔊</button></div>
          <div class="slots" id="slots">${letters.map(() => '<div class="slot"></div>').join('')}</div>
          <div class="tiles" id="tiles">${q._tiles.map((ch, i) => `<button class="tile" data-i="${i}">${ch}</button>`).join('')}</div>`;
      }

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
        const slotsEl = root.querySelector('#slots');
        const tilesEl = root.querySelector('#tiles');
        let locked = false;
        const sync = () => {
          slotsEl.querySelectorAll('.slot').forEach((sl, i) => {
            const ch = q._picked[i];
            sl.textContent = ch || '';
            sl.classList.toggle('filled', !!ch);
          });
          const used = new Set(q._pickedIdx);
          tilesEl.querySelectorAll('.tile').forEach((t, i) => t.classList.toggle('used', used.has(i)));
        };
        tilesEl.addEventListener('click', (e) => {
          const t = e.target.closest('.tile');
          if (!t || locked || t.classList.contains('used')) return;
          q._picked.push(q._tiles[+t.dataset.i]);
          q._pickedIdx.push(+t.dataset.i);
          NG.sfx.tap();
          sync();
          if (q._picked.length === q.word.length) {
            locked = true;
            const ok = q._picked.join('') === q.word;
            if (!ok) slotsEl.querySelectorAll('.slot').forEach((sl, i) => {
              sl.textContent = q.word[i];
              sl.classList.add('reveal');
            });
            advance(ok);
          }
        });
        root.querySelector('#q-replay').addEventListener('click', () => NG.audio.speak(q.word));
        setTimeout(() => NG.audio.speak(q.word), 300);
      } else {
        let answered = false;
        root.querySelector('#q-replay')?.addEventListener('click', () => NG.audio.speak(q.word));
        if (q.type === 'listen') setTimeout(() => NG.audio.speak(q.word), 300);
        root.querySelectorAll('#opts .opt').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (answered) return;
            answered = true;
            const ok = q._options[+btn.dataset.i] === q._answer;
            root.querySelectorAll('#opts .opt').forEach((b) => {
              if (b.textContent.trim() === q._answer) b.classList.add('correct');
              else if (b === btn && !ok) b.classList.add('wrong');
              else b.classList.add('dim');
              b.disabled = true;
            });
            if (ok) NG.audio.speak(q.word);
            // 听音辨词：作答后显示单词 + 释义（音→义联结）
            if (q.type === 'listen') {
              const rev = root.querySelector('#listen-reveal');
              if (rev) rev.innerHTML = `<b>${util.esc(q.word)}</b><span class="rev-phone">/${util.esc(info.p)}/</span><span class="rev-trans">${util.esc(info.t)}</span>`;
            }
            advance(ok);
          });
        });
      }
    },

    finish(root) {
      if (this.phase !== 'battle') return;
      this.phase = 'verdict';
      clearInterval(this.timer);

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
            <div class="stat-row"><span class="k">级别</span><span class="v">${passed ? `${S.s.level === next ? next : next} 级已解锁 🎉` : '保持当前级别'}</span></div>
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
