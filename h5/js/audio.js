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

  // 当前在播的音频，供打断时统一停掉，杜绝叠音
  let currentAudio = null;

  function stopCurrent() {
    if (currentAudio) { try { currentAudio.pause(); } catch (e) { /* ignore */ } currentAudio = null; }
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }

  /**
   * 本地语音合成朗读（句子主通道）：
   * 有道 dictvoice 对整句合成经常返回 500（"returned null audio"，单词则稳定可靠），
   * 因此句子一律走本地 speechSynthesis——零网络依赖、真机均有英文语音。
   * onend 为主推进源；估时看门狗兜底；无声环境不瞬间放行，保持序列节奏。
   */
  function speakLocal(text, done) {
    try {
      if (!window.speechSynthesis) { if (done) done(); return; }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.82;                     // 放慢，适合儿童跟读
      const v = window.speechSynthesis.getVoices().find((x) => /^en(-|_)/i.test(x.lang));
      if (v) u.voice = v;
      let called = false;
      let spoke = false;
      const fin2 = () => { if (!called) { called = true; if (done) done(); } };
      u.onstart = () => { spoke = true; };
      u.onend = fin2;
      // 从未开口就报错（无声环境/无语音包）：不瞬间放行
      u.onerror = () => { spoke ? fin2() : setTimeout(fin2, 900); };
      // 兜底：部分环境不回调 onend。估时从宽（慢速朗读 ~11 字符/秒，留 2 倍余量）
      setTimeout(fin2, 1500 + text.length * 180);
      window.speechSynthesis.speak(u);
    } catch (e) { if (done) done(); }
  }

  /**
   * 单词通道：有道 dictvoice（音质好、单词合成稳定）。
   * 推进只认 Audio 的 ended 事件；看门狗按播放状态动态布防：
   * 起播前 7s（网络卡死），起播后=真实时长+4s；瞬时错误静默重试一次。
   */
  function playOne(text, done) {
    let finished = false;
    let fellBack = false;
    let started = false;
    let retried = false;
    let a = null;
    let watchdog = null;
    const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=1`;

    const disarm = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };
    const arm = (ms, onFire) => {
      disarm();
      watchdog = setTimeout(() => { if (!finished) onFire(); }, ms);
    };
    const fin = () => {
      if (finished) return;
      finished = true;
      disarm();
      if (a) { a.onended = null; a.onerror = null; a.onplaying = null; a.ontimeupdate = null; }
      if (currentAudio === a) currentAudio = null;
      done();
    };
    const markStarted = () => {
      if (started || finished || fellBack) return;
      started = true;
      // 已真实出声：按元数据时长兜底（未知则按估），结束后未触发 ended 才会走到
      const dur = isFinite(a.duration) && a.duration > 0
        ? a.duration * 1000
        : 1200 + text.length * 170;
      arm(dur + 4000, bailToSys);
    };
    // 兜底：停掉没播完的音频 → 系统语音接管（或已回退过则直接放行）
    const bailToSys = () => {
      if (finished) return;
      if (fellBack) { fin(); return; }
      // 从未出声的瞬时错误（网络抖动）：先静默重试一次
      if (!started && !retried) {
        retried = true;
        disarm();
        if (a) { a.onended = null; a.onerror = null; a.onplaying = null; a.ontimeupdate = null; try { a.pause(); } catch (e) { /* ignore */ } }
        setTimeout(() => { if (!finished) start(); }, 200);
        return;
      }
      fellBack = true;
      try { if (a) { a.pause(); } } catch (e) { /* ignore */ }
      speakLocal(text, fin);
    };
    const start = () => {
      // 起播前兜底：7 秒仍没出声视为网络失败
      arm(7000, bailToSys);
      a = new Audio(url);
      currentAudio = a;
      a.onplaying = markStarted;
      a.ontimeupdate = () => { if (a.currentTime > 0.1) markStarted(); };  // 个别环境不触发 playing
      a.onended = fin;
      a.onerror = bailToSys;
      const p = a.play();
      if (p && p.catch) p.catch(bailToSys);
    };
    try {
      start();
    } catch (e) {
      bailToSys();
    }
  }

  // 顺序朗读令牌：新的朗读/序列会使旧序列失效
  let seqId = 0;

  NG.audio = {
    /** 单词/短文本：有道发音（失败自动回退本地语音） */
    speak(word) {
      if (!word) return;
      unlock();
      seqId++;              // 终止进行中的序列
      stopCurrent();        // 停掉在播音频，杜绝叠音
      playOne(word, () => {});
    },

    /**
     * 顺序朗读（学习卡：单词 → 例句1 → 例句2 → 例句3）。
     * 第 0 项（单词）走有道，其余（句子）走本地语音——有道整句合成不稳定。
     * onItem(i) 在每条开始时回调；onDone() 在全部完成后回调（被取消不回调）。
     */
    speakSequence(texts, onItem, onDone) {
      unlock();
      stopCurrent();
      const id = ++seqId;
      let i = 0;
      const step = () => {
        if (id !== seqId) return;             // 已被后续朗读取代
        if (i >= texts.length) { if (onDone) onDone(); return; }
        const idx = i;
        const play = idx === 0 ? playOne : speakLocal;
        play(texts[i++], () => {
          if (id !== seqId) return;
          setTimeout(step, 320);              // 句间停顿
        });
        if (onItem) onItem(idx);
      };
      step();
    },

    /** 打断序列/单句：停止在播音频与本地语音队列 */
    cancelSequence() {
      seqId++;
      stopCurrent();
    },
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
