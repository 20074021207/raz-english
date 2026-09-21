/**
 * state.js — 进度状态机：掌握度阶梯 / SM-2 间隔重复 / 连续打卡 / 每日目标 / 徽章 / Boss 门槛
 *
 * 掌握度模型（对齐 app/src/db schema 的 user_chunks.mastery_level 0-5）：
 *   答对 +1（快速答对 +2），答错 -1；m ≥ 3 视为"已掌握"。
 * 间隔表对齐 spaced-repetition.ts：m 0-5 → 10分钟 / 1 / 3 / 7 / 14 / 30 天。
 */
(function () {
  const KEY = 'razkid_v1';
  const DAY_MS = 86400000;
  const MASTER_AT = 3;

  const defaults = () => ({
    v: 1,
    createdAt: Date.now(),
    placementDone: false,
    level: null,               // 当前前沿级别（Boss 通过后前移）
    xp: 0,
    stars: 0,
    bestCombo: 0,
    streak: { days: 0, lastDay: null },
    daily: { day: null, newWords: 0, reviews: 0, rewarded: false },
    words: {},                 // word -> { l, m, nc, ne, next, last }
    bossCooldownUntil: 0,
    bossAttemptAt: 0,          // 进行中的 Boss 战开始时间（防刷新逃逸，见 load()）
    bossGraceUsed: false,      // 弃战豁免：首次中途退出不计冷却（防误触误伤孩子）
    pendingNotice: null,       // 启动待展示的一次性提示 { icon, text }（首页渲染时消费）
    badges: {},                // id -> timestamp
    totals: { lessons: 0, bossWins: 0, answers: 0, correct: 0 },
    settings: { sound: true, theme: 'auto' },   // theme: auto|dark|light
  });

  let s = null;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      s = raw ? Object.assign(defaults(), JSON.parse(raw)) : defaults();
    } catch (e) {
      s = defaults();
    }
    // 每日计数跨天重置
    const today = NG.util.todayStr();
    if (s.daily.day !== today) {
      s.daily = { day: today, newWords: 0, reviews: 0, rewarded: false };
    }
    // 上场 Boss 战未收场（中途刷新/关闭页面）→ 按弃战处理，防止"打不过就刷新"
    // 绕过 48 小时重试规则；首次弃战豁免冷却（孩子误触/误关 App 不该被罚 48h）
    if (s.bossAttemptAt) {
      if (!s.bossGraceUsed) {
        s.bossGraceUsed = true;
        s.pendingNotice = { icon: '🛡️', text: '上次 Boss 战没打完就离开啦，这次不罚冷却，随时再来！' };
      } else {
        s.bossCooldownUntil = Math.max(s.bossCooldownUntil, s.bossAttemptAt + NG.CONFIG.BOSS_COOLDOWN_H * 3600000);
      }
      s.bossAttemptAt = 0;
      save(true);
    }
    return s;
  }

  /* ---------------- 持久化 ----------------
   * 学习期每答一题都会 save()，全量序列化随进度增长（学满约 478KB），
   * 合并为 800ms 防抖写盘；页面隐藏/关闭时自动 flush，刷新逃逸防护不受影响。
   * Boss 战状态机等关键路径传 immediate=true 同步落盘。 */
  let saveTimer = null;

  function doSave() {
    try { localStorage.setItem(KEY, JSON.stringify(s)); }
    catch (e) { console.warn('[NG] 进度保存失败（存储空间不足？）', e); }
  }

  function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; doSave(); }
  }

  function save(immediate) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (immediate) { doSave(); return; }
    if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; doSave(); }, 800);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
  window.addEventListener('pagehide', flushSave);
  window.addEventListener('beforeunload', flushSave);

  /* ---------------- 徽章定义 ---------------- */
  const BADGES = [
    { id: 'first_lesson', icon: '🚀', name: '迈出第一步', desc: '完成第一节课' },
    { id: 'streak_3',     icon: '🔥', name: '坚持三天',   desc: '连续学习 3 天' },
    { id: 'streak_7',     icon: '🌟', name: '七日之约',   desc: '连续学习 7 天' },
    { id: 'combo_8',      icon: '⚡', name: '连击达人',   desc: '单课连对 8 题' },
    { id: 'stars_100',    icon: '⭐', name: '百星收集家', desc: '累计获得 100 星' },
    { id: 'words_50',     icon: '📚', name: '词霸萌芽',   desc: '掌握 50 个单词' },
    { id: 'words_200',    icon: '🌳', name: '词林高手',   desc: '掌握 200 个单词' },
    { id: 'boss_first',   icon: '⚔️', name: '屠龙勇士',   desc: '首次 Boss 战胜利' },
    { id: 'boss_5',       icon: '🏆', name: '五连冠',     desc: '赢下 5 场 Boss 战' },
  ];
  // 每晋一级动态徽章（D→E 记为 boss_lv_E）
  const levelBadge = (lv) => ({ id: `boss_lv_${lv}`, icon: '🎖️', name: `${lv} 级征服者`, desc: `通过 ${lv} 级 Boss 战` });

  NG.state = {
    MASTER_AT,
    BADGES,
    STORAGE_KEY: KEY,          // 进度导出/导入共用（screens.js 设置面板）
    get s() { return s; },

    load, save,

    reset() {
      s = defaults();
      save(true);
    },

    /* ---------------- 派生统计 ---------------- */
    wordStat(w) { return s.words[w]; },

    masteredTotal() {
      let n = 0;
      for (const w in s.words) if (s.words[w].m >= MASTER_AT) n++;
      return n;
    },

    masteredInLevel(lv) {
      let n = 0;
      for (const w in s.words) {
        const st = s.words[w];
        if (st.l === lv && st.m >= MASTER_AT) n++;
      }
      return n;
    },

    dueWords(maxN) {
      const now = Date.now();
      return Object.keys(s.words)
        .filter((w) => s.words[w].next <= now)
        .sort((a, b) => s.words[a].next - s.words[b].next)
        .slice(0, maxN || 100);
    },

    dueCount() {
      const now = Date.now();
      let n = 0;
      for (const w in s.words) if (s.words[w].next <= now) n++;
      return n;
    },

    foxLevel() { return Math.floor(s.xp / 200) + 1; },

    bossRemaining() {
      return Math.max(0, NG.CONFIG.BOSS_TARGET_WORDS - NG.state.masteredInLevel(s.level));
    },
    bossReady() { return s.placementDone && NG.state.bossRemaining() === 0; },
    bossCooldownLeft() { return Math.max(0, s.bossCooldownUntil - Date.now()); },

    /* ---------------- 学习活动记录 ---------------- */
    touchDay() {
      const today = NG.util.todayStr();
      if (s.daily.day !== today) s.daily = { day: today, newWords: 0, reviews: 0, rewarded: false };
      if (s.streak.lastDay !== today) {
        s.streak.days = s.streak.lastDay === NG.util.yesterdayStr() ? s.streak.days + 1 : 1;
        s.streak.lastDay = today;
      }
    },

    /** 新词进入学习阶段时调用 */
    learnNewWord(w) {
      const lv = s.level;
      if (!s.words[w]) s.words[w] = { l: lv, m: 0, nc: 0, ne: 0, next: Date.now(), last: 0 };
      s.daily.newWords++;
      NG.state.touchDay();
    },

    /**
     * 记录一次答题（对齐 computeMasteryDelta：快速答对 +2，普通 +1，慢对 +0，答错 -1）
     * @param {string} w 单词
     * @param {boolean} correct 是否答对
     * @param {number} ms 反应毫秒
     * @param {boolean} isReview 是否为复习轮（计入每日复习数）
     */
    recordAnswer(w, correct, ms, isReview) {
      const st = s.words[w];
      if (!st) return;
      st.last = Date.now();
      s.totals.answers++;
      if (correct) {
        s.totals.correct++;
        st.nc++;
        st.m = NG.util.clamp(st.m + (ms > 0 && ms < NG.CONFIG.FAST_MS ? 2 : 1), 0, 5);
      } else {
        st.ne++;
        st.m = NG.util.clamp(st.m - 1, 0, 5);
      }
      // 间隔表：m=0 10 分钟后重现，之后 1/3/7/14/30 天
      const intervals = [10 * 60000, DAY_MS, 3 * DAY_MS, 7 * DAY_MS, 14 * DAY_MS, 30 * DAY_MS];
      st.next = Date.now() + intervals[st.m];

      if (isReview) s.daily.reviews++;
      NG.state.touchDay();
      save();
    },

    /** 课程结算奖励，返回 { stars, xp, dailyBonus }；dailyBonus=true 表示本次达成每日双目标
     *  （UI 提示由调用方负责，与 checkBadges 同一约定） */
    awardLesson(correctCount, totalCount, maxCombo, masteredGain) {
      const acc = totalCount ? correctCount / totalCount : 0;
      let stars = 1;                                  // 保底 1 星（无惩罚原则）
      if (acc >= 0.8) stars++;
      if (acc >= 0.95) stars++;
      if (maxCombo >= 5) stars++;
      const xp = correctCount * 8 + maxCombo * 2 + 20 + masteredGain * 10;
      s.stars += stars;
      s.xp += xp;
      s.totals.lessons++;
      if (maxCombo > s.bestCombo) s.bestCombo = maxCombo;
      const dailyBonus = NG.state.awardDailyBonus();
      save();
      return { stars, xp, dailyBonus };
    },

    /** 每日双目标达成 → +2 星（一次性），返回是否本次达成 */
    awardDailyBonus() {
      if (s.daily.rewarded) return false;
      if (s.daily.newWords >= NG.CONFIG.DAILY_GOAL_NEW && s.daily.reviews >= NG.CONFIG.DAILY_GOAL_REVIEW) {
        s.daily.rewarded = true;
        s.stars += 2;
        return true;
      }
      return false;
    },

    /* ---------------- Boss 战 ---------------- */
    /** 战斗开始登记：正常收场由 endBossAttempt 清除，中途逃逸则由 load() 补记冷却（立即落盘防刷新逃逸） */
    startBossAttempt() {
      s.bossAttemptAt = Date.now();
      save(true);
    },

    endBossAttempt() {
      s.bossAttemptAt = 0;
      save(true);
    },

    startBossCooldown() {
      s.bossCooldownUntil = Date.now() + NG.CONFIG.BOSS_COOLDOWN_H * 3600000;
      save(true);
    },

    /** Boss 胜利：晋级到下一级 */
    promote() {
      const next = NG.data.nextLevel(s.level);
      if (!next) return null;
      s.level = next;
      s.bossCooldownUntil = 0;
      s.totals.bossWins++;
      s.xp += 100;
      s.stars += 5;
      save(true);
      return next;
    },

    /* ---------------- 徽章结算 ---------------- */
    /** 返回本次新解锁的徽章（调用方负责 toast） */
    checkBadges(extra) {
      const got = [];
      const give = (b) => {
        if (!s.badges[b.id]) { s.badges[b.id] = Date.now(); got.push(b); }
      };
      if (s.totals.lessons >= 1) give(BADGES[0]);
      if (s.streak.days >= 3) give(BADGES[1]);
      if (s.streak.days >= 7) give(BADGES[2]);
      if (s.bestCombo >= 8) give(BADGES[3]);
      if (s.stars >= 100) give(BADGES[4]);
      const mt = NG.state.masteredTotal();
      if (mt >= 50) give(BADGES[5]);
      if (mt >= 200) give(BADGES[6]);
      if (s.totals.bossWins >= 1) give(BADGES[7]);
      if (s.totals.bossWins >= 5) give(BADGES[8]);
      (extra || []).forEach((lv) => give(levelBadge(lv)));
      if (got.length) save();
      return got;
    },
  };
})();
