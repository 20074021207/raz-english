// batch-17 校验脚本：复刻 audit-corpus.mjs 的 forms()/INFLECT_TO_BASE 精确逻辑（只读，不写任何文件）
import { readFileSync, readdirSync } from 'fs';
const dir = 'D:/study/ai-coding/github/raz-english/h5/corpus-build/';
const { allowed } = JSON.parse(readFileSync(dir + 'allowed.json', 'utf8'));
const ALLOWED = new Set(allowed);
const CONTRACTIONS = new Set(["don't", "can't", "it's", "that's", "let's", "i'm", "you're",
  "we're", "they're", "he's", "she's", "isn't", "aren't", "what's", "here's", "there's", "o'clock"]);

function forms(w) {
  w = w.toLowerCase().replace(/é/g, 'e');
  const out = new Set([w, w + "'s"]);
  const stemE = w.endsWith('e') ? w.slice(0, -1) : null;
  const add = (s) => out.add(s);
  add(w + 's'); add(w + 'es'); add(w + 'ing'); add(w + 'ed'); add(w + 'd'); add(w + 'er'); add(w + 'est');
  if (stemE) { add(stemE + 'ing'); add(stemE + 'ed'); add(stemE + 'er'); add(stemE + 'est'); }
  if (w.endsWith('y') && w.length > 2) { add(w.slice(0, -1) + 'ies'); add(w.slice(0, -1) + 'ied'); add(w.slice(0, -1) + 'ier'); add(w.slice(0, -1) + 'iest'); }
  const last = w[w.length - 1];
  if (w.length >= 3 && /[bcdfglmnprst]/.test(last) && /[aeiou]/.test(w[w.length - 2]) && !/[aeiou]/.test(w[w.length - 3] || '')) {
    add(w + last + 'ing'); add(w + last + 'ed'); add(w + last + 'er'); add(w + last + 'est');
  }
  return out;
}
const INFLECT_TO_BASE = new Map();
for (const a of ALLOWED) {
  for (const f of forms(a)) if (!INFLECT_TO_BASE.has(f)) INFLECT_TO_BASE.set(f, a);
  if (a.includes(' ')) for (const part of a.split(' ')) if (!INFLECT_TO_BASE.has(part)) INFLECT_TO_BASE.set(part, part);
}
for (const c of CONTRACTIONS) INFLECT_TO_BASE.set(c, c);
function tokens(sentence) {
  return sentence.toLowerCase().replace(/é/g, 'e').replace(/[.,!?;:"()]/g, ' ').split(/\s+/).filter(Boolean)
    .flatMap((t) => (t.includes('-') && t !== 'x-ray' ? t.split('-') : [t]));
}

const batch = JSON.parse(readFileSync(dir + 'batch-17.json', 'utf8'));
const words = JSON.parse(readFileSync(dir + 'words-batch-17.json', 'utf8'));
const batchKeys = Object.keys(batch);
const missing = words.filter(w => !batchKeys.includes(w));
const extra = batchKeys.filter(w => !words.includes(w));
if (missing.length) console.log('MISSING KEYS:', missing.join(', '));
if (extra.length) console.log('EXTRA KEYS:', extra.join(', '));

// 全库英文句去重扫描（只读）
const seenEn = new Map();
for (const f of readdirSync(dir).filter(f => /^batch-\d+\.json$/.test(f) && f !== 'batch-17.json').sort()) {
  const data = JSON.parse(readFileSync(dir + f, 'utf8'));
  for (const [w, sents] of Object.entries(data)) for (const [en] of sents) {
    const k = en.toLowerCase();
    if (!seenEn.has(k)) seenEn.set(k, `${f}[${w}]`);
  }
}

const errors = [];
let sentCount = 0;
for (const [word, sents] of Object.entries(batch)) {
  sentCount += sents.length;
  if (sents.length !== 3) errors.push(word + ': ' + sents.length + ' sentences');
  const target = new Set(forms(word.toLowerCase()));
  if (word.includes(' ')) for (const p of word.toLowerCase().split(/\s+/)) for (const f of forms(p)) target.add(f);
  const isPhrase = word.includes(' ') || word.includes("'");
  const phraseRe = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'), 'i');
  const puncts = sents.map(s => s[0].trim().slice(-1));
  if (new Set(puncts).size < 2) errors.push(word + ': same sentence type ' + puncts.join(''));
  sents.forEach(([en, zh], i) => {
    const why = [];
    const toks = tokens(en);
    if (toks.length < 2 || toks.length > 11) why.push('句长越界');
    if (!/^[A-Z]/.test(en)) why.push('未大写开头');
    if (!/[.!?]$/.test(en.trim())) why.push('句尾标点缺失');
    if (!zh || !zh.trim()) why.push('中文缺失');
    let hasTarget;
    if (isPhrase) hasTarget = phraseRe.test(en);
    else hasTarget = toks.some((t) => target.has(t.replace(/é/g, 'e')));
    if (!hasTarget) why.push('未含目标词');
    for (const t of toks) {
      const norm = t.replace(/é/g, 'e');
      if (target.has(norm) || (isPhrase && phraseRe.test(norm))) continue;
      if (INFLECT_TO_BASE.has(norm)) continue;
      why.push(`墙外词:${t}`);
    }
    const k = en.toLowerCase();
    if (seenEn.has(k)) why.push(`与 ${seenEn.get(k)} 重复`);
    else seenEn.set(k, `batch-17[${word}]`);
    if (why.length) errors.push(`[${word}#${i}] ${en} → ${why.join('；')}`);
  });
}
console.log('entries:', batchKeys.length, '| wordlist:', words.length, '| sentences:', sentCount);
console.log(errors.length ? errors.join('\n') : 'ALL CHECKS PASSED (audit-exact logic, read-only)');
