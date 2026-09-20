/**
 * E2E 冒烟测试：定级 → 学习课 → Boss 战 → 各屏幕
 * 运行: node test/e2e.mjs
 * 前置: npm i -D playwright（仓库任意层级），浏览器可用系统 Chrome（channel: 'chrome'）
 *       或执行 npx playwright install chromium 后自动回退
 */
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('未找到 playwright，请先安装：npm i -D playwright');
  process.exit(1);
}

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8931';
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const errors = [];
const results = [];
const ok = (name, pass, extra = '') => {
  results.push(`${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!pass) process.exitCode = 1;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true })
  .catch(() => chromium.launch({ headless: true }));   // 无系统 Chrome 时回退内置 chromium
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const shot = (name) => page.screenshot({ path: SHOTS + name + '.png' });
const sleep = (ms) => page.waitForTimeout(ms);
const qState = (scr) => page.evaluate((n) => {
  const S = NG.screens[n];
  const q = S.session ? S.session.queue[S.qi] : (S.queue && S.queue[S.qi]);
  if (!q) return null;
  return { type: q.type, word: q.word, answer: q._answer || q.word, tiles: q._tiles };
}, scr);

async function answerCurrent(scr) {
  const q = await qState(scr);
  if (!q) return false;
  if (q.type === 'spell') {
    const letters = q.word.split('');
    for (const ch of letters) {
      await page.evaluate((c) => {
        const t = [...document.querySelectorAll('#tiles .tile')]
          .find((x) => !x.classList.contains('used') && x.textContent === c);
        if (t) t.click();
      }, ch);
      await sleep(40);
    }
    return true;
  }
  // 选择题：按 data-i 从题目数据定位正确项再点击
  // （选项可能以音节形态显示，不能比对 DOM 文本；绕开 Playwright 动作性检查与重渲染的竞态）
  return page.evaluate(({ scr, ans }) => {
    const S = NG.screens[scr];
    const q = S.session ? S.session.queue[S.qi] : (S.queue && S.queue[S.qi]);
    if (!q || !q._options) return false;
    const idx = q._options.indexOf(ans);
    const hit = idx >= 0 && document.querySelector(`#opts .opt[data-i="${idx}"]`);
    if (hit) { hit.click(); return true; }
    return false;
  }, { scr, ans: q.answer });
}

async function isVis(sel) { try { return await page.locator(sel).first().isVisible({ timeout: 800 }); } catch { return false; } }

try {
  await page.goto(BASE + '/');
  await page.waitForLoadState('domcontentloaded');
  await sleep(600);

  /* ---------- 1. 定级测试 ---------- */
  let placed = false;
  for (let i = 0; i < 30 && !placed; i++) {
    placed = await isVis('.result-hero');
    if (placed) break;
    if (await isVis('#opts')) {
      await page.evaluate(() => {
        const word = document.querySelector('.q-word-big')?.textContent.trim();
        const ans = word && NG.data.lookup(word).t;
        const opts = [...document.querySelectorAll('#opts .opt')];
        (opts.find((o) => ans && o.textContent.trim() === ans.trim()) || opts[0]).click();
      });
    }
    await sleep(1100);
  }
  const placement = await page.evaluate(() => ({ done: NG.state.s.placementDone, level: NG.state.s.level }));
  ok('定级测试完成并定级', placement.done && !!placement.level, `起点 ${placement.level}`);
  await shot('01-placement-result');

  /* ---------- 2. 学习课：学习卡（例句 + 朗读门控）+ 练习 ---------- */
  await page.click('[data-nav="lesson"]');
  await page.waitForSelector('.sent-row', { timeout: 3000 });
  const learnCount = await page.evaluate(() => NG.screens.lesson.session.learn.length);
  // 首张学习卡：3 条双语例句 + 目标词高亮 + 朗读门控挂钩
  // （门控为两段式：单词读完即解锁按钮，因此不在此断言 disabled，避免与时序竞态）
  const sentRows = await page.locator('.sent-row').count();
  const cardOk = await page.evaluate(() => {
    const texts = [...document.querySelectorAll('.sent-text')];
    const zhs = [...document.querySelectorAll('.sent-zh')];
    return texts.length === 3 && zhs.length === 3 &&
      texts.every((r) => r.querySelector('.hl')) &&
      zhs.every((r) => r.textContent.trim().length >= 3) &&
      typeof NG.screens.lesson._releaseGate === 'function';
  });
  ok('学习卡：3 条双语例句 + 朗读门控挂钩', sentRows === 3 && cardOk, `${sentRows} 条`);
  await shot('10-learn-card-sentences');

  for (let i = 0; i < 40 && (await isVis('#ls-next')); i++) {
    await page.evaluate(() => NG.screens.lesson._releaseGate && NG.screens.lesson._releaseGate());  // E2E 跳过真实音频等待
    await page.evaluate(() => document.getElementById('ls-next').click());
    await sleep(150);
  }
  ok('学习卡阶段走完', !(await isVis('#ls-next')), `新词 ${learnCount} 个`);

  let exDone = false, answered = 0, sawTypes = new Set(), clozeShot = false, listenChecked = false, spellChecked = false;
  for (let i = 0; i < 120 && !exDone; i++) {
    if (await isVis('.result-hero')) { exDone = true; break; }
    const q = await qState('lesson');
    if (!q) { await sleep(400); continue; }
    if (q.type === 'cloze' && !clozeShot) {
      const hasBlank = await page.locator('#cloze-blank').count();
      ok('例句填空题渲染（空格+单词选项）', hasBlank === 1);
      await shot('11-exercise-cloze');
      clozeShot = true;
    }
    if (q.type === 'spell' && !spellChecked) {
      const lowerOk = await page.evaluate(() =>
        [...document.querySelectorAll('#tiles .tile')].every((t) => /^[a-z]$/.test(t.textContent)));
      ok('拼写题字母为小写', lowerOk);
      spellChecked = true;
    }
    sawTypes.add(q.type);
    const fine = await answerCurrent('lesson');
    if (!fine) { await sleep(400); continue; }
    answered++;
    if (q.type === 'listen' && !listenChecked) {
      const rev = await page.evaluate(() => (document.querySelector('#listen-reveal') || {}).textContent || '');
      ok('听音题答后显示单词+中文含义', /[\u4e00-\u9fa5]/.test(rev), rev.trim().slice(0, 24));
      listenChecked = true;
    }
    await sleep(1000);
  }
  ok('练习阶段全部答完', exDone, `${answered} 题，题型 ${[...sawTypes].join('/')}`);
  ok('例句填空题型已出现', sawTypes.has('cloze'));
  const starLit = await page.locator('.star-row .st.lit').count();
  ok('结算星星点亮', starLit >= 1, `${starLit} 星`);
  await shot('02-lesson-done');

  const afterLesson = await page.evaluate(() => ({
    stars: NG.state.s.stars, xp: NG.state.s.xp, streak: NG.state.s.streak.days,
    mastered: NG.state.masteredInLevel(NG.state.s.level), bossLeft: NG.state.bossRemaining(),
    words: Object.keys(NG.state.s.words).length,
  }));
  ok('状态更新（星星/经验/打卡）', afterLesson.stars > 0 && afterLesson.xp > 0 && afterLesson.streak >= 1,
    `⭐${afterLesson.stars} XP${afterLesson.xp} 🔥${afterLesson.streak} 掌握${afterLesson.mastered}`);

  /* ---------- 3. 返回首页 ---------- */
  await page.click('[data-nav="home"]');
  await sleep(500);
  ok('首页 Boss 卡呈锁定态', await isVis('.boss-card.locked'), `还差 ${afterLesson.bossLeft} 词`);
  await shot('03-home');

  /* ---------- 4. 词库 ---------- */
  await page.click('[data-nav="wordlist"]');
  await sleep(400);
  const rows = await page.locator('.word-row').count();
  ok('词库列表渲染', rows > 50, `${rows} 行`);
  await shot('04-wordlist');
  await page.click('.navbar .icon-btn');
  await sleep(300);

  /* ---------- 5. Boss 战（注入 35 个已掌握词解锁） ---------- */
  await page.evaluate(() => {
    const s = NG.state.s;
    NG.data.usableWords(s.level).slice(0, 35).forEach((w) => {
      s.words[w] = { l: s.level, m: 4, nc: 5, ne: 0, next: Date.now() + 86400000, last: Date.now() };
    });
    NG.state.save();
    NG.app.go('home');
  });
  await sleep(400);
  ok('首页 Boss 卡解锁', await isVis('.boss-card.ready'));
  await shot('05-boss-ready');
  await page.click('.boss-go');
  await sleep(400);
  await page.click('#boss-start');
  await sleep(600);

  let bossDone = false, bossAns = 0, bossTypes = new Set();
  for (let i = 0; i < 40 && !bossDone; i++) {
    if (await isVis('.verdict-emoji')) { bossDone = true; break; }
    const q = await qState('boss');
    if (!q) { await sleep(400); continue; }
    bossTypes.add(q.type);
    const fine = await answerCurrent('boss');
    if (!fine) { await sleep(400); continue; }
    bossAns++;
    await sleep(1100);
  }
  ok('Boss 战 15 题打完', bossDone && bossAns >= 15, `${bossAns} 题，题型 ${[...bossTypes].join('/')}`);

  const bossResult = await page.evaluate(() => ({
    passed: NG.state.s.totals.bossWins >= 1,
    level: NG.state.s.level,
    badges: Object.keys(NG.state.s.badges),
  }));
  const prevLevel = placement.level;
  ok('Boss 胜利晋级', bossResult.passed && bossResult.level !== prevLevel, `${prevLevel} → ${bossResult.level}`);
  ok('晋级徽章入账', bossResult.badges.includes(`boss_lv_${bossResult.level}`), bossResult.badges.join(','));
  await shot('06-boss-verdict');

  /* ---------- 6. 冷却态显示 ---------- */
  await page.evaluate(() => { NG.state.startBossCooldown(); NG.state.save(); NG.app.go('boss'); });
  await sleep(400);
  ok('Boss 冷却态展示', (await page.textContent('body')).includes('充能'));
  await page.evaluate(() => { NG.state.s.bossCooldownUntil = 0; NG.state.save(); NG.app.go('home'); });
  await sleep(300);
  await shot('07-home-levelup');

  /* ---------- 7. 复习到期词 ---------- */
  await page.evaluate(() => {
    const s = NG.state.s;
    Object.keys(s.words).forEach((w) => { s.words[w].next = Date.now() - 1000; });
    NG.state.save();
  });
  await page.click('[data-nav="lesson"]');
  await sleep(500);
  const reviewSession = await page.evaluate(() => ({
    learn: NG.screens.lesson.session.learn.length,
    review: NG.screens.lesson.session.reviewSet.size,
  }));
  ok('到期复习自动混入课程', reviewSession.review > 0 && reviewSession.learn >= 0,
    `新词 ${reviewSession.learn} / 复习 ${reviewSession.review}`);

} catch (e) {
  ok('流程无异常', false, e.message);
  await shot('99-error').catch(() => {});
}

console.log('\n========== E2E 结果 ==========');
results.forEach((r) => console.log(r));
if (errors.length) {
  console.log('\n---- 页面错误 ----');
  [...new Set(errors)].forEach((e) => console.log('⚠️ ', e.slice(0, 300)));
} else {
  console.log('\n页面无 console/page 错误 ✓');
}
await browser.close();
