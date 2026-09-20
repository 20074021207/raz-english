/**
 * 语料合并 + 独立审计（不信任生成端自查）：
 *  1. 覆盖率：与 words-batch-*.json 并集比对
 *  2. 目标词出现：每句须含目标词或其自然屈折（含规则双写/去 e/y→i 变体）
 *  3. 词汇墙：除目标词族外，所有 token 必须能还原到 allowed 词（屈折/所有格/白名单缩写）
 *  4. 去重：全库英文句不得重复
 *  5. 基础卫生：句长 2-12 词、首字母大写、句尾 .!?；中文非空
 * 产出：清洗后的合并语料 + 违规报告
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const DIR = 'corpus-build';
const { allowed } = JSON.parse(readFileSync(`${DIR}/allowed.json`, 'utf8'));
const ALLOWED = new Set(allowed);

const CONTRACTIONS = new Set(["don't", "can't", "it's", "that's", "let's", "i'm", "you're",
  "we're", "they're", "he's", "she's", "isn't", "aren't", "what's", "here's", "there's", "o'clock"]);

// 生成一个词的全部合法形态（用于目标词匹配与墙内屈折还原）
function forms(w) {
  w = w.toLowerCase().replace(/é/g, 'e');   // 重音归一化（café→cafe）
  const out = new Set([w, w + "'s"]);
  const stemE = w.endsWith('e') ? w.slice(0, -1) : null;
  const add = (s) => out.add(s);
  add(w + 's'); add(w + 'es');
  add(w + 'ing'); add(w + 'ed'); add(w + 'd');
  add(w + 'er'); add(w + 'est');
  if (stemE) { add(stemE + 'ing'); add(stemE + 'ed'); add(stemE + 'er'); add(stemE + 'est'); }
  if (w.endsWith('y') && w.length > 2) { add(w.slice(0, -1) + 'ies'); add(w.slice(0, -1) + 'ied'); add(w.slice(0, -1) + 'ier'); add(w.slice(0, -1) + 'iest'); }
  // 双写尾辅音（单音节规则近似）：hop→hopping/hopped
  const last = w[w.length - 1];
  if (w.length >= 3 && /[bcdfglmnprst]/.test(last) && /[aeiou]/.test(w[w.length - 2]) && !/[aeiou]/.test(w[w.length - 3] || '')) {
    add(w + last + 'ing'); add(w + last + 'ed'); add(w + last + 'er'); add(w + last + 'est');
  }
  return out;
}

// 墙内屈折还原表：形态 → 基词（覆盖 allowed 全表；多词条目拆出组成词）
const INFLECT_TO_BASE = new Map();
for (const a of ALLOWED) {
  for (const f of forms(a)) if (!INFLECT_TO_BASE.has(f)) INFLECT_TO_BASE.set(f, a);
  if (a.includes(' ')) for (const part of a.split(' ')) if (!INFLECT_TO_BASE.has(part)) INFLECT_TO_BASE.set(part, part);
}
for (const c of CONTRACTIONS) INFLECT_TO_BASE.set(c, c);

// 分词（小写、去标点、保留撇号与连字符内部；café→cafe 归一化）
function tokens(sentence) {
  return sentence.toLowerCase()
    .replace(/é/g, 'e')
    .replace(/[.,!?;:"()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((t) => (t.includes('-') && t !== 'x-ray' ? t.split('-') : [t]));
}

// ---- 合并 ----
const merged = {};
const batchFiles = readdirSync(DIR).filter((f) => /^batch-\d+\.json$/.test(f)).sort();
for (const f of batchFiles) {
  const data = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'));
  for (const [w, sents] of Object.entries(data)) {
    if (merged[w]) console.log(`⚠️ 词 ${w} 在 ${f} 中重复定义（保留先出现的）`);
    else merged[w] = sents;
  }
}

// ---- 目标词册（来自 words-batch 并集，验证覆盖率） ----
const expected = new Set();
for (const f of readdirSync(DIR).filter((x) => /^words-batch-\d+\.json$/.test(x))) {
  for (const w of JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))) expected.add(w);
}
const missing = [...expected].filter((w) => !merged[w]);
const extra = Object.keys(merged).filter((w) => !expected.has(w));

// ---- 逐句审计 ----
const violations = [];
const seenEn = new Map();
const clean = {};
let totalSents = 0, droppedSents = 0;

for (const [word, sents] of Object.entries(merged)) {
  const target = new Set(forms(word.toLowerCase()));
  // 多词短语：组成单词也豁免（Great Britain → great/britain）
  if (word.includes(' ')) for (const p of word.toLowerCase().split(/\s+/)) for (const f of forms(p)) target.add(f);
  const isPhrase = word.includes(' ') || word.includes("'");
  const phraseRe = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'), 'i');
  const valid = [];
  for (const [en, zh] of sents) {
    totalSents++;
    const why = [];
    const toks = tokens(en);
    if (toks.length < 2 || toks.length > 11) why.push('句长越界');
    if (!/^[A-Z]/.test(en)) why.push('未大写开头');
    if (!/[.!?]$/.test(en.trim())) why.push('句尾标点缺失');
    if (!zh || !zh.trim()) why.push('中文缺失');
    // 目标词出现
    let hasTarget;
    if (isPhrase) hasTarget = phraseRe.test(en);
    else hasTarget = toks.some((t) => target.has(t.replace(/é/g, 'e')));
    if (!hasTarget) why.push('未含目标词');
    // 词汇墙
    for (const t of toks) {
      const norm = t.replace(/é/g, 'e');
      if (target.has(norm) || (isPhrase && phraseRe.test(norm))) continue;
      if (INFLECT_TO_BASE.has(norm)) continue;
      why.push(`墙外词:${t}`);
    }
    // 去重
    if (seenEn.has(en.toLowerCase())) why.push(`与 ${seenEn.get(en.toLowerCase())} 重复`);
    else seenEn.set(en.toLowerCase(), word);

    if (why.length) {
      violations.push(`[${word}] ${en} → ${why.join('；')}`);
      droppedSents++;
    } else {
      valid.push([en, zh]);
    }
  }
  if (valid.length) clean[word] = valid;
}

// ---- 报告与产出 ----
writeFileSync(`${DIR}/audit-report.txt`, violations.join('\n'));
const outWords = Object.keys(clean).length;
const outSents = Object.values(clean).reduce((n, s) => n + s.length, 0);
console.log(`批次文件: ${batchFiles.length} | 期望词: ${expected.size} | 合并词: ${Object.keys(merged).length}`);
console.log(`缺失词: ${missing.length}${missing.length ? ' → ' + missing.slice(0, 20).join(',') : ''} | 多余词: ${extra.length}`);
console.log(`原句数: ${totalSents} | 违规丢弃: ${droppedSents} | 保留: ${outSents} 句 / ${outWords} 词`);
console.log(`违规明细写入 corpus-build/audit-report.txt（前 15 条见下）`);
console.log(violations.slice(0, 15).join('\n'));

// 生成运行时语料文件（紧凑）
const payload = `/**\n * sentences-corpus.js — 离线精语料（构建期生成，勿手改）\n * 生成: h5/corpus-build/ 下的批次 JSON 经 audit-corpus.mjs 审计合并\n * 覆盖: AA–H ${outWords} 词；未覆盖词由 sentences.js 模板兜底\n */\nwindow.RAZ_SENTENCES=${JSON.stringify(clean)};`;
writeFileSync('data/sentences-corpus.js', payload);
console.log(`\n✓ 已生成 data/sentences-corpus.js（${(payload.length / 1024).toFixed(0)} KB，${outWords} 词 / ${outSents} 句）`);
