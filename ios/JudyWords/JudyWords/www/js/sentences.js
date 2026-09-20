/**
 * sentences.js — 词性感知双语例句引擎（每个单词 3 条确定性例句 + 中文翻译）
 *
 * 设计原则（对齐 docs/course_generator_arch.md §2.1 词汇墙）：
 * - 英文模板只使用 RAZ AA 级超高频词（I/you/see/a/the/is/look/like/can...），
 *   目标词以原形嵌入，绝不引入超纲词汇；
 * - 中文翻译由模板双语对 + 词条首义生成（{T}=中文首义，{TP}=谓语形剥"的/地"）；
 * - 词性来自词库首义项标注（build-data.mjs 第 4 列）；
 * - DJB2 哈希（对齐 app/src/utils/hash.ts）决定模板轮换起点，
 *   同一个词在任何设备上生成的 3 句例句完全一致——重复暴露强化情境记忆。
 */
(function () {
  const util = NG.util;

  /* ---------------- 特殊词集（人工审定的白名单） ---------------- */
  const MASS = new Set(('water,milk,rice,bread,meat,juice,soup,jam,honey,tea,coffee,sugar,salt,ice,snow,rain,' +
    'wind,money,music,homework,housework,grass,hair,sand,paper,love,fun,help,work,time,sleep,food,fruit,' +
    'weather,news,candy,popcorn,toast,flour,paint,glue,mail,laundry,trash').split(','));

  const PLURAL_IRREG = new Set(['children', 'feet', 'men', 'women', 'people', 'teeth', 'mice']);
  // 以 s 结尾但实为单数（bus/glass 类以 ss/us/is 结尾已由规则排除，这里兜底其余）
  const SINGULAR_S = new Set(['series', 'species', 'news', 'mathematics', 'physics']);

  const WEEK = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  const HOLIDAY = new Set(['Christmas', 'Easter', 'Halloween', 'Thanksgiving', 'Hanukkah', 'New Year']);
  const CELESTIAL = new Set(['Moon', 'Sun', 'Earth']);
  const LANG = new Set(['English', 'Chinese', 'Japanese', 'French', 'Spanish', 'German', 'Korean']);
  const ORD = new Set(['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']);
  const NUM = new Set(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']);
  const NUM_BIG = new Set(['hundred', 'thousand']);
  // 无词性标注的多词动词短语
  const VP = new Set(['shake hands', 'cut out', 'give up', 'fall apart', 'wake up', 'come in', 'sit down',
    'check in', 'check out', 'take over']);
  // 无词性标注且不宜造句的复合词（交给 meta 模板）
  const PHRASE_META = new Set(['natural gas', 'blood sugar', 'thank you', 'less than']);

  // an 冠词判定：元音字母开头用 an，u 开头仅 umbrella 用 an（uniform/unicorn 等发 /ju/ 用 a）
  const AN_EXTRA = new Set(['umbrella']);

  /* ---------------- 双语模板库 ----------------
     {w}=目标词原形  {T}=中文首义  {TP}=谓语形（剥"的/地"）  {W}=英文原词引用 */
  const T = {
    noun: [
      ['I see a {w}.', '我看见一个{T}。'],
      ['This is my {w}.', '这是我的{T}。'],
      ['Look at that {w}!', '看那个{T}！'],
      ['The {w} is very nice.', '这个{T}很好。'],
      ['Can you see the {w}?', '你能看见这个{T}吗？'],
      ['I like this {w}.', '我喜欢这个{T}。'],
    ],
    nounAn: [
      ['I see an {w}.', '我看见一个{T}。'],
      ['This is my {w}.', '这是我的{T}。'],
      ['Look at that {w}!', '看那个{T}！'],
      ['The {w} is very nice.', '这个{T}很好。'],
      ['Can you see the {w}?', '你能看见这个{T}吗？'],
      ['I like this {w}.', '我喜欢这个{T}。'],
    ],
    plural: [
      ['I like {w}.', '我喜欢{T}。'],
      ['The {w} are very nice.', '这些{T}很好。'],
      ['Look at these {w}!', '看这些{T}！'],
      ['Can you see the {w}?', '你能看见这些{T}吗？'],
      ['I see many {w}.', '我看见许多{T}。'],
    ],
    mass: [
      ['I want some {w}.', '我想要一些{T}。'],
      ['I like {w} very much.', '我非常喜欢{T}。'],
      ['{w} is my favorite.', '{T}是我的最爱。'],
      ['The {w} is so good.', '这个{T}真好。'],
    ],
    vt: [
      ['I {w} it.', '我{T}它。'],
      ['Can you {w} it?', '你能{T}它吗？'],
      ['I {w} it every day.', '我每天{T}它。'],
    ],
    vi: [
      ['I {w} every day.', '我每天{T}。'],
      ["Let's {w} together!", '我们一起{T}吧！'],
      ['I like to {w}.', '我喜欢{T}。'],
    ],
    v: [
      ['I {w} a lot.', '我经常{T}。'],
      ["Let's {w} together!", '我们一起{T}吧！'],
      ['I like to {w}.', '我喜欢{T}。'],
    ],
    adj: [
      ['It is so {w}!', '它真{TP}！'],
      ['This one is {w}.', '这个很{TP}。'],
      ['How {w} it is!', '多么{TP}啊！'],
    ],
    adv: [
      ['She does it {w}.', '她做这件事很{TP}。'],
      ['He does it {w} too.', '他做这件事也很{TP}。'],
      ['They do it {w}.', '他们做这件事很{TP}。'],
    ],
    week: [
      ['{w} is my favorite day.', '{T}是我最喜欢的一天。'],
      ['I go to school on {w}.', '我{T}去上学。'],
      ['See you on {w}!', '咱们{T}见！'],
    ],
    holiday: [
      ['{w} is coming!', '{T}就要到了！'],
      ['I love {w}!', '我爱{T}！'],
      ['Happy {w}!', '{T}快乐！'],
    ],
    celestial: [
      ['The {w} is very big.', '{T}很大。'],
      ['Look at the {w}!', '快看{T}！'],
      ['I see the {w} every day.', '我每天都能看到{T}。'],
    ],
    lang: [
      ['I speak {w}.', '我会说{T}。'],
      ['She speaks {w} well.', '她{T}说得很好。'],
      ['{w} is fun to learn.', '学{T}很有趣。'],
    ],
    ord: [
      ['This is my {w} time.', '这是我{T}次。'],
      ['He is the {w} one.', '他是{T}个。'],
      ['Today is my {w} day.', '今天是我{T}天。'],
    ],
    num: [
      ['My lucky number is {w}.', '我的幸运数字是{T}。'],
      ['I can count to {w}.', '我能数到{T}。'],
      ['Say {w} with me!', '跟我一起说{T}！'],
    ],
    // 功能词（介词/代词/冠词等，~85 词）：元句子引导真实使用
    meta: [
      ['I often say "{w}" in class.', '我上课经常说"{W}"。'],
      ['Can you make a sentence with "{w}"?', '你能用"{W}"造个句子吗？'],
      ['"{w}" helps me speak English.', '"{W}"帮我学说英语。'],
    ],
    vp: [
      ["Let's {w}!", '让我们{T}吧！'],
      ["Don't {w}!", '不要{T}！'],
      ['We {w} together.', '我们一起{T}。'],
    ],
    gerund: [
      ['I like {w}.', '我喜欢{T}。'],
      ['{w} is fun.', '{T}很有趣。'],
      ['I enjoy {w}.', '我享受{T}。'],
    ],
  };

  /* ---------------- 工具 ---------------- */
  // DJB2（与 app/src/utils/hash.ts 同族）
  function djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h;
  }

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  // 句首字母大写（引号开头时保持引号内小写引用形态）
  const polish = (s) => {
    const idx = s.search(/[a-zA-Z"]/);
    if (idx > 0) s = s.slice(0, idx) + s[idx].toUpperCase() + s.slice(idx + 1);
    return s;
  };

  function isPlural(word) {
    if (PLURAL_IRREG.has(word) || word.endsWith('ies') || word.endsWith('ves')) return true;
    if (SINGULAR_S.has(word)) return false;
    return /s$/.test(word) && !/(ss|us|is)$/.test(word);
  }

  function category(word, pos) {
    if (VP.has(word)) return 'vp';
    if (WEEK.has(word)) return 'week';
    if (HOLIDAY.has(word)) return 'holiday';
    if (CELESTIAL.has(word)) return 'celestial';
    if (LANG.has(word)) return 'lang';
    if (ORD.has(word)) return 'ord';
    if (NUM.has(word)) return 'num';
    if (NUM_BIG.has(word)) return 'meta';
    if (!pos) {
      if (word.includes(' ')) return PHRASE_META.has(word) ? 'meta' : 'noun';  // 复合名词（roller coaster 等）
      return /ing$/.test(word) ? 'gerund' : 'n';
    }
    if (pos === 'n' || pos === 'abbr') {
      if (MASS.has(word)) return 'mass';
      if (isPlural(word)) return 'plural';
      return 'noun';
    }
    if (pos === 'vt') return 'vt';
    if (pos === 'vi') return 'vi';
    if (pos === 'v') return 'v';
    if (pos === 'adj') return 'adj';
    if (pos === 'adv') return 'adv';
    return 'meta'; // prep/pron/det/conj/int/aux/num 其他
  }

  const cache = new Map();

  /** 模板兜底：未覆盖词的确定性例句生成 */
  function templateSentences(word) {
    const info = NG.data.lookup(word);
    const pos = info ? info.pos : '';
    const cat = category(word, pos);

    let templates = T[cat] || T.meta;
    // 可数名词 an 冠词特判
    if (cat === 'noun' && (/^[aeiou]/.test(word) || AN_EXTRA.has(word))) templates = T.nounAn;

    // 中文首义（截到第一个分隔符/空格），谓语形剥"的/地"，数词剥"个"
    let t = ((info && info.t) || word).split(/[；，,、\s]/)[0] || word;
    if (cat === 'num') t = t.replace(/个$/, '');
    const tp = t.replace(/(的|地)$/, '');

    const start = djb2(word) % templates.length;
    const picked = [];
    for (let i = 0; i < 3; i++) {
      const [enT, zhT] = templates[(start + i) % templates.length];
      let en = enT.replaceAll('{w}', word);
      if (en.startsWith(word) && /^[a-z]/.test(word)) en = cap(word) + en.slice(word.length);
      const zh = zhT
        .replaceAll('{T}', t)
        .replaceAll('{TP}', tp)
        .replaceAll('{W}', word);
      picked.push({ en: polish(en), zh });
    }
    return picked;
  }

  NG.sentences = {
    /** 返回该词的 3 条双语例句 [{en, zh}]（确定性）
     *  优先取离线精语料（data/sentences-corpus.js，AA–H 全覆盖），未覆盖词回退模板生成 */
    get(word) {
      if (cache.has(word)) return cache.get(word);
      const corpus = window.RAZ_SENTENCES && window.RAZ_SENTENCES[word];
      let picked;
      if (corpus && corpus.length) {
        picked = corpus.map(([en, zh]) => ({ en, zh }));
      } else {
        picked = templateSentences(word);
      }
      cache.set(word, picked);
      return picked;
    },

    /** 学习卡高亮渲染：目标词加粗（大小写不敏感首个匹配） */
    highlight(sentence, word) {
      const esc = util.esc(sentence);
      const re = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i');
      return esc.replace(re, '<b class="hl">$1</b>');
    },
  };
})();
