import { readFileSync } from 'fs';
const dir = 'D:/study/ai-coding/github/raz-english/h5/corpus-build/';
const batch = JSON.parse(readFileSync(dir + 'batch-13.json', 'utf8'));
const words = JSON.parse(readFileSync(dir + 'words-batch-13.json', 'utf8'));
const { allowed } = JSON.parse(readFileSync(dir + 'allowed.json', 'utf8'));
const A = new Set(allowed.map(w => w.toLowerCase()));
A.add('alot'); // placeholder for the phrase "a lot"
const CONTR = new Set(["don't","can't","it's","that's","let's","i'm","you're","we're","they're","he's","she's","isn't","aren't","what's","here's","there's"]);

const wordList = Array.isArray(words) ? words : (words.words || Object.keys(words));
const batchKeys = Object.keys(batch);
const missing = wordList.filter(w => !batchKeys.includes(w));
const extra = batchKeys.filter(w => !wordList.includes(w));
if (missing.length) console.log('MISSING KEYS:', missing.join(', '));
if (extra.length) console.log('EXTRA KEYS:', extra.join(', '));

function stripW(w){
  const cands = [w];
  const push = c => { cands.push(c); if (/(.)\1$/.test(c)) cands.push(c.slice(0,-1)); };
  if (w.endsWith("'s")) cands.push(w.slice(0,-2));
  if (w.endsWith("ies")) push(w.slice(0,-3) + 'y');
  if (w.endsWith("es")) cands.push(w.slice(0,-2));
  if (w.endsWith("s")) cands.push(w.slice(0,-1));
  if (w.endsWith("ed")) { cands.push(w.slice(0,-1)); cands.push(w.slice(0,-2)); }
  if (w.endsWith("ing")) { const b = w.slice(0,-3); cands.push(b); cands.push(b + 'e'); }
  if (w.endsWith("er")) cands.push(w.slice(0,-2));
  if (w.endsWith("est")) cands.push(w.slice(0,-3));
  return cands;
}
function inWall(w){ if (CONTR.has(w)) return true; if (A.has(w)) return true; return stripW(w).some(c => A.has(c)); }
function targetInfs(t){
  const set = new Set([t, t+"'s"]);
  set.add(t+'s'); set.add(t+'es'); set.add(t+'ed'); set.add(t+'ing');
  if (t.endsWith('e')) { set.add(t+'d'); set.add(t.slice(0,-1)+'ing'); }
  if (/[^aeiou][aeiou][^aeiouwxy]$/.test(t)) set.add(t + t.slice(-1) + 'ing');
  return set;
}
const errors = [];
console.log('entries:', batchKeys.length, '| wordlist:', wordList.length);
for (const [word, sents] of Object.entries(batch)) {
  if (sents.length !== 3) errors.push(word + ': ' + sents.length + ' sentences');
  const t = word.toLowerCase();
  const isPhrase = t.includes(' ');
  const infs = targetInfs(t);
  const parts = isPhrase ? t.split(' ') : null;
  const partInfs = parts ? new Set([...targetInfs(parts[0]), ...targetInfs(parts[1])]) : null;
  // punctuation variety: the three sentences should not share the same structure type
  const puncts = sents.map(s => s[0].trim().slice(-1));
  if (new Set(puncts).size < 2) errors.push(word + ': same sentence type ' + puncts.join(''));
  sents.forEach(([en, zh], i) => {
    if (!/^[A-Z]/.test(en)) errors.push(`${word}[${i}]: not capitalized`);
    if (!/[.!?]$/.test(en)) errors.push(`${word}[${i}]: bad end punct`);
    if (!/[。！？]$/.test(zh)) errors.push(`${word}[${i}]: zh punct`);
    const clean = en.toLowerCase().replace(/a lot/g, 'alot').replace(/[^a-z'\s]/g, ' ');
    const wc = clean.trim().split(/\s+/).length;
    if (wc < 3 || wc > 9) errors.push(`${word}[${i}]: ${wc} words`);
    if (isPhrase && !en.toLowerCase().includes(t)) errors.push(`${word}[${i}]: phrase missing`);
    const toks = clean.trim().split(/\s+/).filter(Boolean);
    if (!isPhrase && !toks.some(tok => infs.has(tok))) errors.push(`${word}[${i}]: target missing`);
    for (const tok of toks) {
      if (CONTR.has(tok)) continue;
      if (infs.has(tok)) continue;
      if (partInfs && partInfs.has(tok)) continue;
      if (inWall(tok)) continue;
      errors.push(`${word}[${i}]: wall violation "${tok}"`);
    }
  });
}
console.log(errors.length ? errors.join('\n') : 'ALL CHECKS PASSED');
