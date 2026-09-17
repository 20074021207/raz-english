/**
 * audio.js — 发音（有道 TTS 主通道 + Web Speech API 兜底）与合成音效
 *
 * 发音 URL 与 app/src/services/pronunciation.ts 同源：
 *   https://dict.youdao.com/dictvoice?audio={word}&type=1（美音）
 * 离线/失败时回退 speechSynthesis，保证任何环境都有声音。
 */
(function () {
  let unlocked = false;
  let ctx = null;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** iOS/微信需要首次用户手势后才允许播音频 */
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    ensureCtx();
    // 预热一条有道音频（静音播放），解锁 <audio> 通道
    try {
      const a = new Audio('https://dict.youdao.com/dictvoice?audio=hello&type=1');
      a.volume = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
  }
  document.addEventListener('touchstart', unlock, { once: true, passive: true });
  document.addEventListener('click', unlock, { once: true });

  function sysSpeak(word, done) {
    try {
      if (!window.speechSynthesis) { if (done) done(); return; }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(word);
      u.lang = 'en-US';
      u.rate = 0.82;
      const v = window.speechSynthesis.getVoices().find((x) => /^en(-|_)/i.test(x.lang));
      if (v) u.voice = v;
      if (done) { u.onend = done; u.onerror = done; }
      window.speechSynthesis.speak(u);
      // 部分环境不回调 onend：按语速兜底
      if (done) setTimeout(done, 900 + word.length * 120);
    } catch (e) { if (done) done(); }
  }

  /** 播放一条文本（有道 mp3 → 失败回退系统 TTS；watchdog 保证必然回调） */
  function playOne(text, done) {
    let finished = false;
    let a = null;
    const fin = () => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      if (a) { a.onended = null; a.onerror = null; }
      done();
    };
    // 总看门狗：正常朗读 900ms+130ms/字符，再加 2.5s 网络余量
    const watchdog = setTimeout(fin, 900 + text.length * 130 + 2500);
    try {
      a = new Audio(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=1`);
      a.onended = fin;
      a.onerror = () => sysSpeak(text, fin);
      const p = a.play();
      if (p && p.catch) p.catch(() => sysSpeak(text, fin));
    } catch (e) {
      sysSpeak(text, fin);
    }
  }

  // 顺序朗读令牌：新的朗读/序列会使旧序列失效
  let seqId = 0;

  NG.audio = {
    speak(word) {
      if (!word) return;
      unlock();
      seqId++; // 单句朗读终止进行中的序列
      playOne(word, () => {});
    },

    /**
     * 顺序朗读一串文本（如：单词 → 例句1 → 例句2 → 例句3）
     * onItem(i) 在每条开始时回调；onDone() 在全部完成或被取消后回调（被取消不回调）
     */
    speakSequence(texts, onItem, onDone) {
      unlock();
      const id = ++seqId;
      let i = 0;
      const step = () => {
        if (id !== seqId) return;             // 已被后续朗读取代
        if (i >= texts.length) { if (onDone) onDone(); return; }
        const idx = i;
        playOne(texts[i++], () => {
          if (id !== seqId) return;
          setTimeout(step, 280);              // 句间停顿
        });
        if (onItem) onItem(idx);
      };
      step();
    },

    cancelSequence() { seqId++; },
  };

  /* ---------------- 合成音效（WebAudio，零素材） ---------------- */
  function tone(freq, t0, dur, type, vol, when) {
    if (!NG.state || !NG.state.s || !NG.state.s.settings.sound) return;
    const c = ensureCtx();
    if (!c) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const start = c.currentTime + (when || 0);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol || 0.16, start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(c.destination);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  NG.sfx = {
    tap:    () => tone(600, 0, 0.06, 'sine', 0.05),
    correct:() => { tone(660, 0, 0.12, 'triangle', 0.18); tone(880, 0, 0.16, 'triangle', 0.16, 0.09); },
    wrong:  () => { tone(200, 0, 0.22, 'sawtooth', 0.07); tone(150, 0, 0.26, 'sawtooth', 0.06, 0.1); },
    combo:  (n) => {
      const base = 520 + Math.min(n, 10) * 40;
      [0, 0.07, 0.14].forEach((d, i) => tone(base * (1 + i * 0.26), 0, 0.1, 'square', 0.06, d));
    },
    star:   () => { tone(1320, 0, 0.18, 'sine', 0.12); tone(1760, 0, 0.22, 'sine', 0.1, 0.08); },
    win:    () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0, 0.22, 'triangle', 0.16, i * 0.12)); },
    lose:   () => { [392, 330, 262].forEach((f, i) => tone(f, 0, 0.26, 'triangle', 0.12, i * 0.16)); },
    tick:   () => tone(980, 0, 0.05, 'square', 0.05),
    bosshit:() => { tone(160, 0, 0.18, 'sawtooth', 0.14); tone(90, 0, 0.24, 'sawtooth', 0.12, 0.06); },
  };
})();
