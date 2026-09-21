/**
 * core.js — 命名空间、全局配置、通用工具
 *
 * 设计对齐：
 * - BOSS_* 参数对齐 docs/course_generator_arch.md §1.3 与 app/src/app/raz-boss.tsx
 * - SRS 间隔对齐 app/src/services/spaced-repetition.ts（SM-2 变体 0/1/3/7/14/30 天）
 */
window.NG = window.NG || {};

NG.CONFIG = {
  // Boss 战（晋级 Diagnostic Sprint）
  BOSS_QUESTIONS: 15,        // 文档 §1.3：15 个词
  BOSS_TIME_S: 120,          // 文档 §1.3：限时 120 秒
  BOSS_PASS_RATIO: 0.85,     // 文档 §1.3：正确率 ≥ 85% 晋级
  BOSS_COOLDOWN_H: 48,       // 文档 §1.3：未通过 48h 后重试
  BOSS_TARGET_WORDS: 30,     // H5 适配：本级掌握 30 词即解锁 Boss（对应文档 80% 掌握率触发）

  // 课程节奏（四年级学生注意力 ~12 分钟）
  SESSION_NEW_WORDS: 8,      // 每课新词（文档 §1.2：每批 5-8 个）
  SESSION_REVIEW_MAX: 4,     // 每课穿插的到期复习词上限
  DAILY_GOAL_NEW: 8,         // 每日新词目标
  DAILY_GOAL_REVIEW: 10,     // 每日复习目标

  PLACEMENT_START_IDX: 4,    // 定级起点 = levels[4] = D（四年级默认；3 轮探针定级区间 AA–H）
  PLACEMENT_PROBE_SIZE: 5,   // 每级探针 5 词（文档 §5.1）
  PLACEMENT_MAX_PROBES: 3,   // 最多 3 轮探针（≤15 题，文档 §5.1）

  FAST_MS: 2500,             // 快速反应阈值：答对且 < 2.5s 额外 +1 掌握度
};

NG.util = {
  esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  sample(arr, n) {
    return NG.util.shuffle(arr).slice(0, n);
  },

  clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },

  todayStr(d) {
    const dt = d || new Date();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${dt.getFullYear()}-${m}-${day}`;
  },

  yesterdayStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return NG.util.todayStr(d);
  },

  /** 毫秒 → 儿童友好倒计时（"26小时" / "40分钟"） */
  fmtLeft(ms) {
    if (ms <= 0) return '0分钟';
    const h = Math.floor(ms / 3600000);
    const m = Math.ceil((ms % 3600000) / 60000);
    if (h >= 1) return `${h}小时`;
    return `${m}分钟`;
  },

  greeting() {
    const h = new Date().getHours();
    if (h < 6) return '夜深啦';
    if (h < 9) return '早上好';
    if (h < 12) return '上午好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  },

  /** 连击横幅鼓励语（无惩罚原则） */
  cheer: {
    combo: ['火力全开！', '停不下来！', '小天才！', '势不可挡！'],
  },
  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
};
