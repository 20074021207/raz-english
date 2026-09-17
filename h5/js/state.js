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
    badges: {},                // id -> timestamp
    totals: { lessons: 0, bossWins: 0, answers: 0, correct: 0 },
    settings: { sound: true },
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
    return s;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* 存储满等极端情况静默 */ }
  }

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
    get s() { return s; },

    load, save,

    reset() {
      s = defaults();
      save();
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

    /** 本级新词剩余（未学过的可用词数） */
    freshLeft(lv) {
      return NG.data.usableWords(lv).filter((w) => !s.words[w]).length;
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
    foxXpPct() { return (s.xp % 200) / 2; },

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

    /** 课程结算奖励，返回 { stars, xp } */
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
      NG.state.awardDailyBonus();
      save();
      return { stars, xp };
    },

    /** 每日双目标达成 → +2 星（一次性） */
    awardDailyBonus() {
      if (s.daily.rewarded) return;
      if (s.daily.newWords >= NG.CONFIG.DAILY_GOAL_NEW && s.daily.reviews >= NG.CONFIG.DAILY_GOAL_REVIEW) {
        s.daily.rewarded = true;
        s.stars += 2;
        setTimeout(() => NG.fx && NG.fx.toast('每日目标达成，奖励 2 颗星星！', '🎁'), 1400);
      }
    },

    /* ---------------- Boss 战 ---------------- */
    startBossCooldown() {
      s.bossCooldownUntil = Date.now() + NG.CONFIG.BOSS_COOLDOWN_H * 3600000;
      save();
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
      save();
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
