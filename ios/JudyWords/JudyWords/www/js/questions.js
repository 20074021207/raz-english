/**
 * questions.js — 共享出题组件：题干渲染 + 作答交互绑定
 *
 * 课程练习（lesson.js）与 Boss 战（boss.js）共用的题型层，
 * 消除两处重复的题干模板 / 拼写交互 / 判分标记逻辑。
 *
 * 题型约定（对齐 app/src/types/exercise.ts 词汇训练子集）：
 *   en2cn 词义选择 / cn2en 反向选择 / listen 听音辨词 / cloze 例句填空 → 选择题（#opts .opt）
 *   spell 碎片组装 → #slots + #tiles
 * 渲染函数负责写入 q._options / q._answer / q._tiles / q._picked，
 * 绑定函数通过回调上抛结果——屏幕层只关心判定之后的业务（记分 / 重排队 / 特效）。
 */
(function () {
  const util = NG.util;
  const D = NG.data;

  const escRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 英文单词按音节形态显示（bas·ket·ball）；引擎不可用/单音节时回退原形
  const wordLabel = (w) => (NG.syllables && NG.syllables.get(w)) || w;

  // 音节点的间隙用 span 收紧（.syl-dot），比纯文本排得紧
  const sylHtml = (syl) => util.esc(syl).replace(/·/g, '<span class="syl-dot">·</span>');
  // 显示用 HTML：有多音节划分返回带收紧点的音节形态，否则原形
  const labelHtml = (w) => {
    const s = NG.syllables && NG.syllables.get(w);
    return s ? sylHtml(s) : util.esc(w);
  };

  /**
   * 点击单词在 音节形态 / 原形 之间切换（bas·ket·ball ↔ basketball）
   * @param {Element} el 展示音节的元素（切换其 innerHTML）
   * @param {string} word 原形单词
   * @param {string=} syl 音节形态（无则不绑定）
   */
  function bindSyllableToggle(el, word, syl) {
    if (!el || !syl) return;
    el.classList.add('syl-toggle');
    if (!el.title) el.title = '点我切换音节拼读';
    el.addEventListener('click', () => {
      const plain = el.dataset.plain === '1';
      el.dataset.plain = plain ? '' : '1';
      el.innerHTML = plain ? sylHtml(syl) : util.esc(word);
    });
  }

  const optsHtml = (options, isWord) => options.map((o, i) =>
    `<button class="opt ${isWord ? 'word-opt' : ''}" data-i="${i}">${isWord ? labelHtml(o) : util.esc(o)}</button>`).join('');

  /** 拼写干扰字母：数量 = max(2, 词长×0.4)，不与目标词已有字母重复 */
  function spellPads(word) {
    const letters = word.split('');
    const extra = Math.max(2, Math.floor(letters.length * 0.4));
    const alpha = 'abcdefghijklmnopqrstuvwxyz';
    const set = new Set(letters);
    const pads = [];
    while (pads.length < extra) {
      const ch = alpha[Math.floor(Math.random() * 26)];
      if (!set.has(ch)) { pads.push(ch); set.add(ch); }
    }
    return [...letters, ...pads];
  }

  /**
   * 选择题题干（en2cn / cn2en / listen / cloze），写入 q._options / q._answer
   * @param {object} opts speakableWord: 题干单词可点击发音（课程练习的 en2cn；Boss 战不提供）
   */
  function choiceBody(q, info, opts) {
    const o = opts || {};
    let options, body;
    if (q.type === 'en2cn') {
      options = util.shuffle([info.t, ...D.distractorTrans(info.l, q.word, 3)]);
      body = `
        <span class="qtype-badge">📖 词义选择</span>
        <div class="q-word-big${o.speakableWord ? ' speakable' : ''}">${labelHtml(q.word)}</div>
        <div class="q-phone">/${util.esc(info.p)}/${o.speakableWord ? ' · 点击单词听发音' : ''}</div>
        <div class="opts" id="opts">${optsHtml(options, false)}</div>`;
    } else if (q.type === 'cn2en') {
      options = util.shuffle([q.word, ...D.distractorWords(info.l, q.word, 3)]);
      body = `
        <span class="qtype-badge">🔤 反向选择</span>
        <div class="q-prompt">哪个单词是这个意思？</div>
        <div class="q-trans-target">${util.esc(info.t)}</div>
        <div class="opts" id="opts">${optsHtml(options, true)}</div>`;
    } else if (q.type === 'listen') {
      options = util.shuffle([q.word, ...D.distractorWords(info.l, q.word, 3)]);
      body = `
        <span class="qtype-badge">🎧 听音辨词</span>
        <div class="q-prompt">听一听，选出你听到的单词</div>
        <div class="listen-zone">
          <button class="speak-btn big" id="q-replay">🔊</button>
        </div>
        <div class="opts" id="opts">${optsHtml(options, true)}</div>
        <div class="listen-reveal" id="listen-reveal"></div>`;
    } else { // cloze
      options = util.shuffle([q.word, ...D.distractorWords(info.l, q.word, 3)]);
      const blanked = util.esc(q.sentence.en).replace(
        new RegExp(escRe(q.word), 'i'),
        '<span class="blank" id="cloze-blank">&nbsp;____&nbsp;</span>'
      );
      body = `
        <span class="qtype-badge">📝 例句填空</span>
        <div class="q-prompt">选出填入空格的单词</div>
        <div class="cloze-sentence">${blanked}</div>
        <div class="cloze-hint">💡 ${util.esc(info.t)}</div>
        <div class="opts" id="opts">${optsHtml(options, true)}</div>`;
    }
    q._options = options;
    q._answer = q.type === 'en2cn' ? info.t : q.word;
    return body;
  }

  /**
   * 拼写题题干，写入 q._tiles / q._picked / q._pickedIdx
   * @param {object} opts tools: 渲染撤销/清空工具（课程练习用；Boss 战求快不提供）
   */
  function spellBody(q, info, opts) {
    const o = opts || {};
    q._tiles = util.shuffle(spellPads(q.word));
    q._picked = [];
    q._pickedIdx = [];
    return `
      <span class="qtype-badge">🧩 碎片组装</span>
      <div class="q-prompt">拼出这个单词！</div>
      <div class="q-trans-target">${util.esc(info.t)}</div>
      <div class="listen-zone"><button class="speak-btn" id="q-replay">🔊</button></div>
      <div class="slots" id="slots">${q.word.split('').map(() => '<div class="slot"></div>').join('')}</div>
      <div class="tiles" id="tiles">${q._tiles.map((ch, i) => `<button class="tile" data-i="${i}">${ch}</button>`).join('')}</div>
      ${o.tools ? `
      <div class="spell-tools">
        <button class="btn ghost small" id="sp-undo">⌫ 撤销</button>
        <button class="btn ghost small" id="sp-clear">清空</button>
      </div>` : ''}`;
  }

  /**
   * 绑定选择题作答：判分标记 / cloze 回填 / listen 揭示 / 答对朗读
   * @param {function} onAnswer (ok, chosenEl) 作答后回调一次
   * @param {object} opts speakableWord: 绑定题干单词点击发音
   */
  function bindChoice(root, q, info, onAnswer, opts) {
    const o = opts || {};
    if (o.speakableWord) {
      const w = root.querySelector('.q-word-big');
      if (w) w.addEventListener('click', () => NG.audio.speak(q.word));
    }
    // 题干/揭示词的音节切换（点击 bas·ket·ball ↔ basketball）
    const stemWord = root.querySelector('.q-word-big');
    if (stemWord) bindSyllableToggle(stemWord, q.word, NG.syllables && NG.syllables.get(q.word));
    const replay = root.querySelector('#q-replay');
    if (replay) replay.addEventListener('click', () => { NG.sfx.tap(); NG.audio.speak(q.word); });

    let answered = false;
    root.querySelectorAll('#opts .opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (answered) return;
        answered = true;
        const ok = q._options[+btn.dataset.i] === q._answer;
        // 判分标记按 data-i 从题目数据比对（选项可能以音节形态显示，不能比对文本）
        root.querySelectorAll('#opts .opt').forEach((b) => {
          if (q._options[+b.dataset.i] === q._answer) b.classList.add('correct');
          else if (b === btn && !ok) b.classList.add('wrong');
          else b.classList.add('dim');
          b.disabled = true;
        });
        // 例句填空：回填空格；答对后朗读完整句子强化情境记忆
        if (q.type === 'cloze') {
          const blank = root.querySelector('#cloze-blank');
          if (blank) { blank.textContent = ok ? ` ${q.word} ` : ` ${q._answer} `; blank.classList.add(ok ? 'filled' : 'reveal'); }
          if (ok) NG.audio.speak(q.sentence.en);
        } else {
          NG.audio.speak(q.word);   // 无论对错都朗读单词强化记忆
        }
        // 听音辨词：作答后显示单词 + 释义（音→义联结）
        if (q.type === 'listen') {
          const rev = root.querySelector('#listen-reveal');
          if (rev) {
            rev.innerHTML = `<b>${labelHtml(q.word)}</b><span class="rev-phone">/${util.esc(info.p)}/</span><span class="rev-trans">${util.esc(info.t)}</span>`;
            bindSyllableToggle(rev.querySelector('b'), q.word, NG.syllables && NG.syllables.get(q.word));
          }
        }
        onAnswer(ok, btn);
      });
    });
  }

  /**
   * 绑定拼写题交互：点字母入槽，凑满即判定
   * @param {function} onDone (ok)
   * @param {object} opts tools: 绑定 #sp-undo / #sp-clear（与 spellBody 的 tools 配套）
   */
  function bindSpell(root, q, onDone, opts) {
    const o = opts || {};
    const slotsEl = root.querySelector('#slots');
    const tilesEl = root.querySelector('#tiles');
    let locked = false;
    const sync = () => {
      slotsEl.querySelectorAll('.slot').forEach((sl, i) => {
        const ch = q._picked[i];
        sl.textContent = ch || '';
        sl.classList.toggle('filled', !!ch);
      });
      const usedIdx = new Set(q._pickedIdx);
      tilesEl.querySelectorAll('.tile').forEach((t, i) => t.classList.toggle('used', usedIdx.has(i)));
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
        if (!ok) {  // 答错揭示正确拼写，视觉留存
          slotsEl.querySelectorAll('.slot').forEach((sl, i) => {
            sl.textContent = q.word[i];
            sl.classList.add('reveal');
          });
        }
        onDone(ok);
      }
    });
    const replay = root.querySelector('#q-replay');
    if (replay) replay.addEventListener('click', () => { NG.sfx.tap(); NG.audio.speak(q.word); });
    if (o.tools) {
      root.querySelector('#sp-undo').addEventListener('click', () => {
        if (locked) return;
        q._picked.pop(); q._pickedIdx.pop();
        NG.sfx.tap(); sync();
      });
      root.querySelector('#sp-clear').addEventListener('click', () => {
        if (locked) return;
        q._picked = []; q._pickedIdx = [];
        NG.sfx.tap(); sync();
      });
    }
    sync();
  }

  NG.questions = { spellPads, choiceBody, spellBody, bindChoice, bindSpell,
    wordLabel, sylHtml, labelHtml, bindSyllableToggle };
})();
