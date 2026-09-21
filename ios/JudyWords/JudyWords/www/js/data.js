/**
 * data.js — RAZ 词库访问层
 * 数据源 window.RAZ_DATA 由 build-data.mjs 生成（AA–Z2 全 29 级，12,526 行 / 5,837 唯一词）。
 */
(function () {
  const RAW = window.RAZ_DATA;
  if (!RAW) throw new Error('RAZ_DATA 未加载：请先运行 node build-data.mjs');

  const levels = RAW.levels;                       // ['AA'..'L']
  const byLevel = RAW.words;                       // { lv: [[word, trans, phone], ...] }
  const idx = new Map();                           // word -> {t, p, l}

  // 预构建索引 + 各级"有效词"视图（释义非空才可用于学习）
  const usableByLevel = {};
  levels.forEach((lv) => {
    usableByLevel[lv] = [];
    byLevel[lv].forEach(([w, t, p, pos]) => {
      idx.set(w, { t, p, pos: pos || '', l: lv });
      if (t) usableByLevel[lv].push(w);
    });
  });

  NG.data = {
    levels,
    maxLevelIdx: levels.length - 1,

    levelIdx(lv) { return levels.indexOf(lv); },
    levelAt(i) { return levels[NG.util.clamp(i, 0, levels.length - 1)]; },
    nextLevel(lv) {
      const i = levels.indexOf(lv);
      return i >= 0 && i < levels.length - 1 ? levels[i + 1] : null;
    },

    lookup(word) { return idx.get(word) || null; },

    /** 该级全部词行（含释义为空的） */
    allWords(lv) { return byLevel[lv] || []; },
    /** 该级可用于出题的词名（释义非空） */
    usableWords(lv) { return usableByLevel[lv] || []; },

    /** 随机抽 n 个不重复的可用词（可排除已有集合） */
    sample(lv, n, exclude) {
      const ex = exclude instanceof Set ? exclude : new Set(exclude || []);
      const pool = usableByLevel[lv].filter((w) => !ex.has(w));
      return NG.util.sample(pool, n);
    },

    /** 取 n 个干扰项英文词（同级别、与答案不同、互不相同） */
    distractorWords(lv, answer, n, exclude) {
      const ex = new Set([answer, ...(exclude || [])]);
      const pool = usableByLevel[lv].filter((w) => !ex.has(w));
      return NG.util.sample(pool, n);
    },

    /** 取 n 个干扰项中文释义（取释义首个语义段，避免与答案释义撞段） */
    distractorTrans(lv, answerWord, n) {
      const head = (s) => (s || '').split(/[；，,]/)[0];
      const ansHead = head(idx.get(answerWord)?.t);
      const pool = usableByLevel[lv]
        .filter((w) => w !== answerWord)
        .map((w) => idx.get(w).t)
        .filter((t, i, arr) => t && head(t) !== ansHead && arr.indexOf(t) === i);
      return NG.util.sample(pool, n);
    },
  };
})();
