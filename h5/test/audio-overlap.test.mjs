/**
 * 回归测试：例句朗读中途切换单词，旧例句不得与新单词叠音
 * 运行: node test/audio-overlap.test.mjs（零依赖，stub 浏览器环境直接驱动 audio.js）
 *
 * 复现路径（修复前）：
 *   例句经 speechSynthesis 朗读中切换单词 → cancel() 使旧 utterance 异步触发
 *   onerror(interrupted) → speakSentence.bail 未检查序列令牌 → 为旧例句再开一条
 *   有道 playOne 音频 → 与新单词朗读同时出声，且劫持 currentAudio。
 *
 * 通道契约（2026-09-26 iOS Safari 无声修复后）：
 *   TTS 未被证实真实开口（ttsConfirmed=false，stub 环境即如此）时，例句走有道整句，
 *   整句失败退逐词串读——与单词同通道。因此本测试的例句断言全部针对有道 URL。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const AUDIO_SRC = readFileSync(fileURLToPath(new URL('../js/audio.js', import.meta.url)), 'utf8');

/* ---------------- stub 浏览器环境 ---------------- */
const played = [];          // 每次 Audio.play 的 URL（叠音检测主证据）
const playingSet = new Set();
const synthSpoken = [];     // speechSynthesis.speak 的文本（检测旧句经 pureLocal 复活）
let synthCurrent = null;

class FakeAudio {
  constructor(url) {
    this.url = url;
    this.onended = this.onerror = this.onplaying = this.ontimeupdate = null;
    this.duration = NaN;
    this.paused = false;
    this._listeners = {};   // playWordAudio 走 addEventListener('ended'/'error') 通道
  }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const arr = this._listeners[type];
    if (arr) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); }
  }
  _emit(type) { (this._listeners[type] || []).forEach((fn) => fn()); }
  play() {
    played.push(this.url);
    playingSet.add(this);
    this.paused = false;
    if (this.onplaying) this.onplaying();   // 起播即视为真实出声
    return Promise.resolve();
  }
  pause() { this.paused = true; playingSet.delete(this); }
}

class FakeUtterance {
  constructor(text) { this.text = text; }
}

const synth = {
  speak(u) {
    synthCurrent = u;
    synthSpoken.push(u.text);
    queueMicrotask(() => { if (synthCurrent === u && u.onstart) u.onstart(); });
  },
  cancel() {
    const u = synthCurrent;
    synthCurrent = null;
    // Chrome 行为：打断在播 utterance 时异步触发 onerror(interrupted)
    queueMicrotask(() => { if (u && u.onerror) u.onerror({ error: 'interrupted' }); });
  },
  getVoices: () => [],
};

const sandbox = {
  NG: {},
  window: { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance },
  document: { addEventListener() {} },
  Audio: FakeAudio,
  SpeechSynthesisUtterance: FakeUtterance,
  setTimeout, clearTimeout, queueMicrotask, console,
};
vm.createContext(sandbox);
vm.runInContext(AUDIO_SRC, sandbox, { filename: 'audio.js' });
const NG = sandbox.NG;

const youdao = (t) => `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(t)}&type=1`;
const startedWith = (t) => played.filter((u) => u === youdao(t)).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, pass, extra = '') => {
  results.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};
/** 手动让某文本的在播有道音频"播完"（驱动序列推进） */
const endAudio = (text) => {
  const url = youdao(text);
  const a = [...playingSet].find((x) => x.url === url);
  if (a) { playingSet.delete(a); if (a.onended) a.onended(); a._emit('ended'); }
};

/* ---------------- 场景 A：例句朗读中点喇叭切到新单词（speak 路径） ---------------- */
const seqA = ['cat', 'the cat sat on the mat'];
NG.audio.speakSequence(seqA, () => {}, () => {});
await sleep(30);                       // 单词 cat 经有道起播
endAudio('cat');                       // cat 播完 → 1s 句间停顿 → 例句开始
await sleep(1100);
// 通道契约：TTS 未证实前例句逐词串读有道单词 mp3（不走 TTS，也不打注定 500 的整句接口）。
// 链的首词起播即证明路由正确；整链完成由场景 D 覆盖。
ok('A1 例句逐词串读有道（TTS 已门控）',
  startedWith('the') >= 1 && startedWith(seqA[1]) === 0 && synthSpoken.length === 0,
  `played=${JSON.stringify(played)} tts=${JSON.stringify(synthSpoken)}`);

const oldCountA = startedWith(seqA[1]);   // 打断前旧例句已合法起播 1 次
NG.audio.speak('dog');                 // ← 用户切换单词（打断序列）
await sleep(300);                      // 放行 interrupted onerror 等微任务/短定时器

ok('A2 新单词正常朗读', startedWith('dog') === 1);
// 打断后旧例句不得复活：播放次数停在打断前的值
ok('A3 打断后旧例句未复活', startedWith(seqA[1]) === oldCountA, `played=${JSON.stringify(played)}`);
// unlock 的 hello 预热音频音量为 0 且真实浏览器会自然播完，不计入叠音统计
const overlapA = [...playingSet].filter((x) => !x.url.includes('audio=hello')).length;
ok('A4 同一时刻至多一条在播音频', overlapA <= 1, `overlap=${overlapA}`);

/* ---------------- 场景 B：例句朗读中点「下一个」（cancelSequence + 新序列路径） ---------------- */
NG.audio.cancelSequence();             // 停掉场景 A 的 dog
await sleep(50);
const seqB = ['dog', 'dogs bark loudly', 'a dog runs'];
NG.audio.speakSequence(seqB, () => {}, () => {});
await sleep(30);
endAudio('dog');
await sleep(1100);                     // 例句 1 有道整句朗读中……
ok('B1 新序列例句逐词串读有道', startedWith('dogs') === 1 && startedWith(seqB[1]) === 0,
  `played=${JSON.stringify(played)}`);

const oldCountB1 = startedWith(seqB[1]);
const oldCountB2 = startedWith(seqB[2]);
NG.audio.cancelSequence();             // ← 用户点「下一个」
NG.audio.speakSequence(['fish', 'fish swim'], () => {}, () => {});
await sleep(300);

ok('B2 新单词正常朗读', startedWith('fish') >= 1);
// 打断后旧序列例句不得复活：播放次数停在打断前的值
ok('B3 被打断的旧例句未复活', startedWith(seqB[1]) === oldCountB1 && startedWith(seqB[2]) === oldCountB2,
  `played=${JSON.stringify(played)}`);
ok('B4 打断后无新增本地合成朗读', synthSpoken.length === 0, `tts=${JSON.stringify(synthSpoken)}`);

/* ---------------- 场景 C：currentAudio 未被旧回退劫持（后续打断能停掉正确音频） ---------------- */
const fishAudio = [...playingSet].find((x) => x.url === youdao('fish'));
NG.audio.cancelSequence();
await sleep(30);
ok('C1 打断后新单词音频确实被暂停', !fishAudio || fishAudio.paused === true);

/* ---------------- 场景 D：App 内逐词串读（webkit 桥存在） ----------------
 * P1：打断后 step 链必须停（修复前 pause 不触发 ended/error，看门狗放行 → 幽灵词继续蹦）；
 * P2：看门狗放行时须先 pause 旧词（修复前长词未播完即推进，与下一词叠音）。 */
sandbox.window.webkit = { messageHandlers: { nativeTTS: { postMessage() {} } } };
NG.audio.cancelSequence();             // 清掉场景 C 残留
await sleep(50);

const seqD = ['cat', 'one two three', 'four five six'];
NG.audio.speakSequence(seqD, () => {}, () => {});
await sleep(30);
endAudio('cat');                       // 单词播完 → 1s 停顿 → 例句 1 逐词串读
await sleep(1100);
ok('D1 例句 1 已进入逐词串读', startedWith('one') === 1, `played=${JSON.stringify(played)}`);

const oneAudio = [...playingSet].find((x) => x.url === youdao('one'));
await sleep(3500);                     // 越过 'one' 的 3.5s 看门狗
ok('D2 看门狗放行时旧词已暂停（不叠音）', !!oneAudio && oneAudio.paused === true);
await sleep(600);                      // 260ms 后应推进到下一词
ok('D3 序列继续推进到下一词', startedWith('two') === 1, `played=${JSON.stringify(played)}`);

NG.audio.cancelSequence();             // ← 例句 1 朗读中打断（❌/下一个）
await sleep(4300);                     // 越过 'two' 的看门狗：修复前此处蹦出 'three'
ok('D4 打断后不再续读后续词', startedWith('three') === 0 && startedWith('four') === 0
  && startedWith('five') === 0 && startedWith('six') === 0, `played=${JSON.stringify(played)}`);

console.log(results.join('\n'));
console.log(process.exitCode ? '\n❌ 存在叠音回归' : '\n✅ 全部通过：切换单词不再叠音');
process.exit(process.exitCode || 0);
