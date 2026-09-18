/**
 * audio.js — 发音引擎（有道 TTS 主通道 + Web Speech 兜底）与合成音效
 *
 * 通道设计（实测结论：有道 dictvoice 单词合成稳定，整句合成经常返回 500）：
 * - 单词：有道 mp3（ended 事件为主推进源；动态看门狗；瞬时错误静默重试一次）
 * - 句子：本地 speechSynthesis（起播哨兵 1.6s，没真正开口降级有道）→ 有道 → 节奏地板
 * - 任何一级失败都明确降级，绝不静默跳句、绝不与在播音频叠音
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

  /* ---------------- 原生 TTS 桥（iOS App 的 WKWebView 注入） ----------------
   * WKWebView 不支持网页 speechSynthesis，App 壳通过 AVSpeechSynthesizer 提供本地合成。
   * JS 侧 postMessage({id, text})，原生读完回调 NG.audio.__nativeTtsDone(id)。 */
  let nativeSeq = 0;
  function nativeSpeak(text, done) {
    const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nativeTTS;
    if (!bridge) return false;
    const id = ++nativeSeq;
    let called = false;
    const fin = () => { if (!called) { called = true; done(); } };
    NG.audio.__nativeTtsDone = (cbId) => { if (cbId === id) fin(); };
    bridge.postMessage({ id, text });
    // 末级防挂起兜底：原生侧另有完成备份回调（更快），此处仅防"回调链路全断"，
    // 估时按慢速朗读上限收紧，保证兜底触发时距上一句结束 ≈ 1-2 秒
    setTimeout(fin, 1300 + text.length * 145);
    return true;
  }

  /**
   * 纯本地语音合成（最后一级通道，也可作主通道）。
   * onend 为主推进源；无声报错默认走 900ms 节奏地板（可用 onSilentError 覆盖为降级）；
   * 超长防挂起看门狗仅当环境连 onend/onerror 都不触发时才生效。
   */
  function pureLocal(text, done, onSpoke, onSilentError) {
    // iOS App：优先走原生 AVSpeechSynthesizer（离线可用、发音稳定）
    if (nativeSpeak(text, done)) return;
    try {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { if (done) done(); return; }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.82;                     // 放慢，适合儿童跟读
      const v = window.speechSynthesis.getVoices().find((x) => /^en(-|_)/i.test(x.lang));
      if (v) u.voice = v;
      let called = false;
      let spoke = false;
      let hangdog = null;
      const fin2 = () => {
        if (called) return;
        called = true;
        if (hangdog) clearTimeout(hangdog);
        if (done) done();
      };
      u.onstart = () => { spoke = true; if (onSpoke) onSpoke(); };
      u.onend = fin2;
      u.onerror = () => {
        if (spoke) fin2();
        else if (onSilentError) onSilentError();
        else setTimeout(fin2, 900);      // 节奏地板：无声环境不瞬间放行
      };
      // 防挂起：真实慢速朗读 ~11 字符/秒，留 3 倍余量
      hangdog = setTimeout(fin2, 3000 + text.length * 300);
      window.speechSynthesis.speak(u);
    } catch (e) { if (done) done(); }
  }

  /**
   * 句子通道（多级回退）：
   *   1) 本地合成，1.6s 起播哨兵——没真正开口（无声环境/被拦截）立即降级；
   *   2) 有道 dictvoice（整句不稳定但值得一试，含重试与动态看门狗）；
   *   3) 仍失败 → playOne 内部落到 pureLocal 的 900ms 节奏地板。
   */
  function speakSentence(text, done) {
    // iOS App：原生 TTS 是唯一主通道（无哨兵竞态、不依赖网络）
    if (nativeSpeak(text, done)) return;
    // 浏览器环境：本地 speechSynthesis 优先
    if (window.speechSynthesis && window.SpeechSynthesisUtterance) {
      let finished = false;
      let u = null;
      let watchdog = null;
      const arm = (ms) => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => { if (!finished) bail(); }, ms);
      };
      const fin = () => {
        if (finished) return;
        finished = true;
        if (watchdog) clearTimeout(watchdog);
        if (u) { u.onend = null; u.onerror = null; u.onstart = null; }
        done();
      };
      // 本地始终没开口：停掉队列 → 有道兜底
      const bail = () => {
        if (finished) return;
        try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
        playOne(text, fin);
      };
      try {
        window.speechSynthesis.cancel();
        u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        u.rate = 0.82;                     // 放慢，适合儿童跟读
        const v = window.speechSynthesis.getVoices().find((x) => /^en(-|_)/i.test(x.lang));
        if (v) u.voice = v;
        u.onstart = () => {
          if (finished) return;
          // 已真实开口：onend 为主推进源；超长看门狗仅防"永不回调"的环境
          arm(1500 + text.length * 250 + 9000);
        };
        u.onend = fin;
        u.onerror = () => { arm(0); bail(); };
        // 反挂起兜底：即使从未有任何回调也保证序列继续（极慢起播场景放宽到 6s）
        arm(6000);
        window.speechSynthesis.speak(u);
      } catch (e) {
        bail();
      }
    } else {
      playOne(text, done);
    }
  }

  /**
   * 单词通道：有道 dictvoice mp3。
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
    // 兜底：停掉没播完的音频 → 本地语音接管（或已回退过则直接放行）
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
      pureLocal(text, fin);
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
     * 第 0 项（单词）走有道，其余走句子多级回退通道。
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
        const play = idx === 0 ? playOne : speakSentence;
        play(texts[i++], () => {
          if (id !== seqId) return;
          setTimeout(step, 1000);             // 句间停顿 1 秒（用户指定）
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
