/**
 * sentences.js — 双语例句引擎（离线精语料为唯一数据源）
 *
 * 全部例句来自构建期精语料 data/sentences-corpus.js（AA–Z2 全 29 级 5,781 唯一词、
 * 17,304 句自然儿童例句；构建期经词汇墙 / 目标词出现 / 全库查重三重审计，
 * 生成规则与审计脚本在 corpus-build/）。
 * 语料未覆盖的极少数最高级低频词**不生成机器兜底句**——学习卡只呈现单词+释义，
 * 练习也不考例句填空，避免 "It is so cardiac!" 这类模板怪句。
 *
 * 渲染工程约定（词边界匹配，允许常规屈折后缀）：
 * - 高亮 / 挖空绝不误中别的单词里的字母（Come 里的 me、Today 里的 day）；
 * - 含撇号词（Valentine's Day）先匹配后转义，挖空不会被 HTML 实体化破坏；
 * - 例句填空只选「目标词恰好独立出现一次」的句子，挖空后答案绝不残留句面。
 */
(function () {
  const util = NG.util;

  const escRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** 独立出现匹配：词边界 + 常规屈折后缀（cars/legs/waves/loved/boxes 整词命中） */
  function standaloneRe(word, global) {
    return new RegExp(`\\b${escRe(word)}(?:'s|es|ed|ing|ies|s|d)?\\b`, global ? 'gi' : 'i');
  }

  const cache = new Map();
  const clozeCache = new Map();

  function corpusOf(word) {
    const c = window.RAZ_SENTENCES && window.RAZ_SENTENCES[word];
    return (c && c.length) ? c.map(([en, zh]) => ({ en, zh })) : [];
  }

  NG.sentences = {
    /** 该词的全部双语例句 [{en, zh}]（精语料未覆盖时返回空数组） */
    get(word) {
      if (!cache.has(word)) cache.set(word, corpusOf(word));
      return cache.get(word);
    },

    /** 可用于例句填空的句子：目标词恰好独立出现一次（屈折形式出现也算泄漏，一并排除） */
    clozeSentences(word) {
      if (!clozeCache.has(word)) {
        const re = standaloneRe(word, true);
        clozeCache.set(word, NG.sentences.get(word)
          .filter((s) => (s.en.match(re) || []).length === 1));
      }
      return clozeCache.get(word);
    },

    /** 学习卡高亮：目标词（含屈折形）整词加粗；目标词未出现则原样返回 */
    highlight(sentence, word) {
      const m = sentence.match(standaloneRe(word));
      if (!m) return util.esc(sentence);
      const i = m.index, j = i + m[0].length;
      return util.esc(sentence.slice(0, i)) +
        '<b class="hl">' + util.esc(m[0]) + '</b>' +
        util.esc(sentence.slice(j));
    },

    /** 例句填空渲染：首个独立出现处挖空（先匹配后转义）；未命中返回转义原句 */
    blankFirst(sentence, word) {
      const m = sentence.match(standaloneRe(word));
      if (!m) return util.esc(sentence);
      const i = m.index, j = i + m[0].length;
      return util.esc(sentence.slice(0, i)) +
        '<span class="blank" id="cloze-blank">&nbsp;____&nbsp;</span>' +
        util.esc(sentence.slice(j));
    },
  };
})();
