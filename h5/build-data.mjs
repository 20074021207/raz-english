#!/usr/bin/env node
/**
 * RAZ 词库 → H5 内嵌数据构建脚本（零依赖）
 *
 * 从 assets/dicts/raz/ 读取 AA–Z2 全 29 级词库（12,526 行 / 5,837 唯一词），
 * 做儿童友好释义清洗后压缩为 h5/data/raz-data.js。
 *
 * 输出格式（数组四元组，体积最小化；第 4 列词性供 corpus-build 例句构建消费）:
 *   window.RAZ_DATA = { levels: ["AA",...,"Z2"], words: { D: [["fox","狐狸；狡猾的人","fɒks","n"], ...] } }
 *
 * 用法: node build-data.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'assets/dicts/raz');
const OUT_DIR = join(ROOT, 'h5/data');
const LEVELS = ['AA', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'Z1', 'Z2'];

/**
 * 儿童友好释义清洗：
 * - 只取第一义项，按「；」切分后取前 2 个语义片段
 * - 剥离词性标注 (n./vt./adj. ...)、学科标签 ([脊椎])、括注（人名/国家名）
 * - 丢弃含「人名」的片段（如 "n. (Fox)（英、美）福克斯（人名）"）
 */
const POS_LEAD = String.raw`(?:n|v|vt|vi|adj|adv|prep|pron|conj|det|art|aux|num|abbr|interj|int)\.\s*`;
const POS_HEAD_RE = new RegExp(`^${POS_LEAD}`, 'i');   // 首词性标注：剥除与词性识别共用
const POS_MID_RE = new RegExp(String.raw`\s(?:n|v|vt|vi|adj|adv|prep|pron|conj|det|art|aux|num|abbr|interj|int)\.`, 'i');

/** 提取首义项词性（供例句引擎消费）：n/v/vt/vi/adj/adv/num/...，无法识别返回 '' */
function posOf(trans) {
  const m = (trans && trans[0] || '').match(POS_HEAD_RE);
  return m ? m[0].trim().replace(/\.$/, '').toLowerCase() : '';
}

function cleanTrans(trans) {
  if (!trans || trans.length === 0) return '';
  // 截断人名音译段："n. (Team)人名；(柬)甸" 及其后全部内容
  let text = trans[0].replace(/[(（][^）)]{0,30}[)）]\s*人名.*$/, '');
  const parts = text.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
  const picked = [];
  for (let p of parts) {
    if (/人名/.test(p)) continue;
    p = p.replace(POS_HEAD_RE, '');
    p = p.replace(/\[.*?\]\s*/g, '');          // 学科标签 [脊椎]
    p = p.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, ''); // 括注
    p = p.replace(/\s*[，,]\s*$/, '').trim();
    // 片段内残留第二词性（如 "喜爱 v. 使过得快活"）则截断
    const midPos = p.search(POS_MID_RE);
    if (midPos > 0) p = p.slice(0, midPos).trim();
    if (!p) continue;
    picked.push(p);
    if (picked.length >= 2) break;
  }
  return picked.join('；');
}

const words = {};
let total = 0;

for (const level of LEVELS) {
  const raw = JSON.parse(readFileSync(join(SRC_DIR, `raz-${level}.json`), 'utf8'));
  const seen = new Set();
  const rows = [];
  for (const w of raw) {
    if (!w.name || seen.has(w.name)) continue;
    seen.add(w.name);
    rows.push([w.name, cleanTrans(w.trans), w.usphone || '', posOf(w.trans)]);
  }
  words[level] = rows;
  total += rows.length;
  const empty = rows.filter((r) => !r[1]).length;
  console.log(`  ${level}: ${rows.length} 词${empty ? ` (释义缺失 ${empty})` : ''}`);
}

mkdirSync(OUT_DIR, { recursive: true });
const payload = `window.RAZ_DATA=${JSON.stringify({
  generatedAt: new Date().toISOString().slice(0, 10),
  levels: LEVELS,
  words,
})};`;
writeFileSync(join(OUT_DIR, 'raz-data.js'), payload, 'utf8');

console.log(`\n✓ 共 ${total} 词 → h5/data/raz-data.js (${(payload.length / 1024).toFixed(0)} KB)`);
