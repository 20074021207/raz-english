import { readFileSync } from 'fs';
// 复刻 audit-corpus.mjs 的精确校验逻辑，仅针对 batch-22 + 跨批次查重
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
  add(w + 's'); add(w + 'es');
  add(w + 'ing'); add(w + 'ed'); add(w + 'd');
  add(w + 'er'); add(w + 'est');
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
  return sentence.toLowerCase().replace(/é/g, 'e')
    .replace(/[.,!?;:"()]/g, ' ')
    .split(/\s+/).filter(Boolean)
    .flatMap((t) => (t.includes('-') && t !== 'x-ray' ? t.split('-') : [t]));
}

const batch = JSON.parse(readFileSync(dir + 'batch-22.json', 'utf8'));
const wordList = JSON.parse(readFileSync(dir + 'words-batch-22.json', 'utf8'));
const batchKeys = Object.keys(batch);
const missing = wordList.filter(w => !batchKeys.includes(w));
const extra = batchKeys.filter(w => !wordList.includes(w));
if (missing.length) console.log('MISSING KEYS:', missing.join(', '));
if (extra.length) console.log('EXTRA KEYS:', extra.join(', '));

// 跨批次英文句查重
const seenEn = new Map();
import { existsSync } from 'fs';
for (let i = 1; i <= 21; i++) {
  const f = dir + 'batch-' + String(i).padStart(2, '0') + '.json';
  if (!existsSync(f)) continue;
  const data = JSON.parse(readFileSync(f, 'utf8'));
  for (const [w, sents] of Object.entries(data))
    for (const [en] of sents) if (!seenEn.has(en.toLowerCase())) seenEn.set(en.toLowerCase(), w);
}

const errors = [];
console.log('entries:', batchKeys.length, '| wordlist:', wordList.length);
for (const [word, sents] of Object.entries(batch)) {
  if (sents.length !== 3) errors.push(word + ': ' + sents.length + ' sentences');
  const t = word.toLowerCase();
  const target = new Set(forms(t));
  const isPhrase = t.includes(' ');
  if (isPhrase) for (const p of t.split(/\s+/)) for (const f of forms(p)) target.add(f);
  const phraseRe = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'), 'i');
  const puncts = sents.map(s => s[0].trim().slice(-1));
  if (new Set(puncts).size < 2) errors.push(word + ': same sentence type ' + puncts.join(''));
  sents.forEach(([en, zh], i) => {
    if (!/^[A-Z]/.test(en)) errors.push(`${word}[${i}]: not capitalized`);
    if (!/[.!?]$/.test(en.trim())) errors.push(`${word}[${i}]: bad end punct`);
    if (!zh || !zh.trim()) errors.push(`${word}[${i}]: zh missing`);
    if (!/[。！？]$/.test(zh.trim())) errors.push(`${word}[${i}]: zh punct`);
    if (/[,.!?;:"']/.test(zh)) errors.push(`${word}[${i}]: zh halfwidth punct`);
    const toks = tokens(en);
    if (toks.length < 3 || toks.length > 9) errors.push(`${word}[${i}]: ${toks.length} words`);
    let hasTarget = isPhrase ? phraseRe.test(en) : toks.some(tk => target.has(tk));
    if (!hasTarget) errors.push(`${word}[${i}]: target missing`);
    for (const tk of toks) {
      if (target.has(tk) || (isPhrase && phraseRe.test(tk))) continue;
      if (INFLECT_TO_BASE.has(tk)) continue;
      errors.push(`${word}[${i}]: wall violation "${tk}"`);
    }
    const low = en.toLowerCase();
    if (seenEn.has(low)) errors.push(`${word}[${i}]: dup of [${seenEn.get(low)}] ${en}`);
    else seenEn.set(low, word);
  });
}
console.log('total sentences:', batchKeys.reduce((n, w) => n + batch[w].length, 0));
console.log(errors.length ? errors.join('\n') : 'ALL CHECKS PASSED');
