/**
 * syllables.js — 音节拼读引擎（正字法音节划分，如 basketball → bas·ket·ball）
 *
 * 设计对齐 sentences.js 先例：运行时确定性生成，不膨胀数据文件；
 * 同一个词在任何设备上得到的划分完全一致。
 *
 * 划分规则（小学自然拼读教学法）：
 *   1. 元字组/辅字组作为整体单元不拆（ai/ea/oo/igh、ch/sh/th/ck/qu…）；
 *      r 控组（ar/er/ir/or/ur）仅在 r 后不接元音且不双写 r 时成组（very/carrot 的 er/ar 不是字组）；
 *   2. 相邻两个元音单元之间直接分（li·on, gi·ant）；词尾 silent e 除外（square, whale）；
 *   3. 词尾"辅音+le"按字母边界自成音节（ta·ble, lit·tle, jun·gle, ea·gle, im·pos·si·ble）；
 *   4. 辅音簇在单元边界拆分，优先保证右侧音节头是合法连读（≤3 单元）：
 *      双写从中间拆（rab·bit）；sis·ter / mon·ster / chil·dren / soft·ly / san·dbox → sand·box；
 *   5. 单辅音默认归左（闭音节：sug·ar, chick·en 类）；
 *      以下情况归右（开音节/长音）：magic-e（pa·per, gar·den, bro·ther）、
 *      纯元字组后（a·round, be·cause）、词尾 y（la·dy, ti·ny）、
 *      后接单字母 i/o/u（mu·sic, ro·bot, be·gin）、a+l（lo·cal, le·gal）；
 *      x/ck/tch 永远归左（box·er, chick·en, kit·chen）；
 *   6. 复合词优先在词界拆（base·ball, bed·room, rain·bow, play·ground）；
 *   7. 后缀：-tion/-sion 单独成音节；-ing（词干含元音，swim·ming）；-ed 仅 t/d 后
 *      （want·ed；not·ed 走去 e 形；closed/played 单音节不拆）；-es 仅咝音后（box·es）；
 *      -s 复数并入末音节（ap·ples），单音节词复数不拆（leaves/cats）；
 *   8. 例外词典兜底正字法不规则（riv·er/nev·er/cit·y/i·de·a…），并覆盖常见屈折形式；
 *   9. "能按音节拼读"= 划分 ≥2 个音节才返回；单音节词返回 null（不显示）。
 */
(function () {
  const MIN_LEN = 3;          // 更短的词几乎都是单音节
  const SYL = '·';
  const VOWEL_CHAR = /[aeiou]/;
  const HAS_VOWEL = /[aeiouy]/;
  const CONSONANT_CHAR = /[bcdfghjklmnpqrstvwxz]/;

  /* ---------------- 单元表 ---------------- */
  const TEAMS = [
    'eigh', 'ough', 'igh', 'air', 'ear', 'eer', 'our', 'oar', 'eau',
    'ea', 'ee', 'ei', 'ey', 'ai', 'ay', 'oa', 'oe', 'oo', 'ou', 'ow',
    'oi', 'oy', 'au', 'aw', 'ue', 'ui', 'eu', 'ew', 'eo', 'ie',
  ];
  const R_TEAMS = new Set(['air', 'ear', 'eer', 'our', 'oar']);
  const PURE_TEAMS = new Set(TEAMS.filter((t) => !R_TEAMS.has(t)));
  const DIGRAPHS = ['tch', 'dge', 'ch', 'sh', 'th', 'ph', 'wh', 'ck', 'gh', 'ng', 'qu'];
  const NO_ONSET = new Set(['x', 'ck', 'tch']);   // 不作音节头的辅音单元 → 永远归左
  // 后缀化时会从中间拆开的双写辅音（swim·ming / spot·ted）；ss/ff/ll 不拆
  const SPLIT_DOUBLE = new Set(['bb', 'dd', 'gg', 'mm', 'nn', 'pp', 'rr', 'tt', 'zz']);
  const ONSET2 = new Set(['bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr',
    'sc', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw', 'tr', 'tw',
    'sh', 'ch', 'th', 'wh', 'ph', 'gh', 'qu', 'wr', 'kn', 'gn']);
  const ONSET3 = new Set(['str', 'spr', 'scr', 'spl', 'squ', 'thr', 'shr']);

  /* ---------------- 复合词（| 为词界，两段各自再划分） ---------------- */
  const COMPOUNDS = {
    baseball: 'base|ball', basketball: 'basket|ball', football: 'foot|ball',
    volleyball: 'volley|ball', skateboard: 'skate|board', snowboard: 'snow|board',
    keyboard: 'key|board', bedroom: 'bed|room', bathroom: 'bath|room',
    classroom: 'class|room', lunchroom: 'lunch|room', mailbox: 'mail|box',
    popcorn: 'pop|corn', swimsuit: 'swim|suit', suitcase: 'suit|case',
    playground: 'play|ground', sandbox: 'sand|box', backyard: 'back|yard',
    sidewalk: 'side|walk', eyebrow: 'eye|brow', eggnog: 'egg|nog',
    notebook: 'note|book', textbook: 'text|book', weekend: 'week|end',
    birthday: 'birth|day', grandpa: 'grand|pa', grandma: 'grand|ma',
    raincoat: 'rain|coat', rainbow: 'rain|bow', rainforest: 'rain|forest',
    snowman: 'snow|man', snowflake: 'snow|flake', sunflower: 'sun|flower',
    sunshine: 'sun|shine', waterfall: 'water|fall', watermelon: 'water|melon',
    homework: 'home|work', housework: 'house|work', toothbrush: 'tooth|brush',
    toothpaste: 'tooth|paste', hairbrush: 'hair|brush', haircut: 'hair|cut',
    goldfish: 'gold|fish', starfish: 'star|fish', jellyfish: 'jelly|fish',
    catfish: 'cat|fish', butterfly: 'butter|fly', dragonfly: 'dragon|fly',
    firefly: 'fire|fly', ladybug: 'lady|bug', cupcake: 'cup|cake',
    pancake: 'pan|cake', oatmeal: 'oat|meal', peanut: 'pea|nut',
    seafood: 'sea|food', seaweed: 'sea|weed', spaceship: 'space|ship',
    superpower: 'super|power', storyteller: 'story|teller', woodpecker: 'wood|pecker',
    windmill: 'wind|mill', thunderstorm: 'thunder|storm', rainstorm: 'rain|storm',
    grasshopper: 'grass|hopper', hummingbird: 'humming|bird', flashlight: 'flash|light',
    daylight: 'day|light', nighttime: 'night|time', himself: 'him|self',
    herself: 'her|self', myself: 'my|self', yourself: 'your|self',
    fireworks: 'fire|works', firetruck: 'fire|truck', fireman: 'fire|man',
    firehouse: 'fire|house', fireplace: 'fire|place', hometown: 'home|town',
    sometimes: 'some|times', basement: 'base|ment', eyesight: 'eye|sight',
    eyelid: 'eye|lid', snowblower: 'snow|blower', birdseed: 'bird|seed',
    cupboard: 'cup|board', scarecrow: 'scare|crow', houseboat: 'house|boat',
    firefighter: 'fire|fighter', lighthouse: 'light|house', sunglasses: 'sun|glasses',
  };

  /* ---------------- 例外词典（审计校准） ---------------- */
  const EXCEPTIONS = {
    river: 'riv·er', never: 'nev·er', seven: 'sev·en', eleven: 'e·lev·en', level: 'lev·el',
    fever: 'fev·er', cover: 'cov·er', oven: 'ov·en', camel: 'cam·el', model: 'mod·el',
    given: 'giv·en', driven: 'driv·en', heaven: 'heav·en', shiver: 'shiv·er', modern: 'mod·ern',
    hover: 'hov·er', liver: 'liv·er', honest: 'hon·est', govern: 'gov·ern',
    many: 'man·y', very: 'ver·y', body: 'bod·y', city: 'cit·y', pity: 'pit·y',
    orange: 'or·ange', onion: 'on·ion', poem: 'po·em', poet: 'po·et',
    diet: 'di·et', idea: 'i·de·a', create: 'cre·ate', area: 'ar·e·a', cereal: 'ce·re·al',
    minute: 'min·ute', every: 'ev·ery', really: 're·al·ly', library: 'li·brar·y',
    giraffe: 'gi·raffe', crocodile: 'croc·o·dile', chocolate: 'choc·o·late',
    vacation: 'va·ca·tion', education: 'ed·u·ca·tion', camera: 'cam·e·ra',
    banana: 'ba·na·na', tomato: 'to·ma·to', potato: 'po·ta·to', guitar: 'gui·tar',
    using: 'u·sing', being: 'be·ing', doing: 'do·ing', going: 'go·ing', seeing: 'see·ing',
    holiday: 'hol·i·day', present: 'pre·sent', business: 'busi·ness', ocean: 'o·cean',
    something: 'some·thing', anything: 'an·y·thing', everything: 'ev·ery·thing',
    created: 'cre·at·ed', animal: 'an·i·mal', family: 'fam·i·ly', animals: 'an·i·mals',
    families: 'fam·i·lies', finally: 'fi·nal·ly', usually: 'u·su·al·ly',
    elephant: 'ele·phant', eraser: 'e·ras·er', coral: 'cor·al', mother: 'moth·er',
    brother: 'broth·er', million: 'mil·lion', billion: 'bil·lion', seventy: 'sev·en·ty',
    eighty: 'eight·y', crooked: 'crook·ed', wicked: 'wick·ed', naked: 'nak·ed',
    reuse: 're·use', followed: 'fol·lowed', gorilla: 'go·ril·la', axle: 'ax·le',
    vegetable: 'veg·e·ta·ble', interesting: 'in·ter·est·ing', everywhere: 'ev·ery·where',
    special: 'spe·cial', social: 'so·cial', national: 'na·tion·al', personal: 'per·son·al',
    several: 'sev·er·al', delicious: 'de·li·cious', gorgeous: 'gor·geous', coyote: 'coy·o·te',
    gardener: 'gar·den·er', miserable: 'mis·er·a·ble', evening: 'eve·ning',
    different: 'dif·fer·ent', difference: 'dif·fer·ence', recess: 'rec·ess',
    fighter: 'fight·er', useful: 'use·ful', battery: 'bat·ter·y',
    feather: 'feath·er', sweater: 'sweat·er', color: 'col·or',
    natural: 'nat·u·ral', president: 'pres·i·dent', britain: 'brit·ain',
    conditioner: 'con·di·tion·er', melon: 'mel·on',

    /* ---- 重音边界校准（2026-09-21，以词库 IPA 词内重音标记为 ground truth 全库审计）----
     * 口径跟韦氏正字法：非前缀类按重音开右（parade→pa·rade）；
     * 前缀类保留闭音节形（dis·play / mis·tAKE 维持规则引擎输出，不进本表）。
     * 生成规则与复核记录见 README「音节拼读引擎」。 */
    parade: 'pa·rade', garage: 'ga·rage', prepare: 'pre·pare', prepared: 'pre·pared',
    between: 'be·tween', apart: 'a·part', apartment: 'a·part·ment', relax: 're·lax',
    behave: 'be·have', behavior: 'be·hav·ior', alarm: 'a·larm', ashamed: 'a·shamed',
    japan: 'ja·pan', donate: 'do·nate', donation: 'do·na·tion', afraid: 'a·fraid',
    karate: 'ka·ra·te', destroy: 'de·stroy', despair: 'de·spair', career: 'ca·reer',
    demand: 'de·mand', resource: 're·source', resourceful: 're·source·ful',
    resourcefulness: 're·source·ful·ness', patrol: 'pa·trol', remark: 're·mark',
    remarkable: 're·mark·a·ble', deprive: 'de·prive', deprived: 'de·prived',
    depart: 'de·part', department: 'de·part·ment', adapt: 'a·dapt',
    adaptable: 'a·dapt·a·ble', adjust: 'a·djust', rotate: 'ro·tate', rotation: 'ro·ta·tion',
    restore: 're·store', regret: 're·gret', retreat: 're·treat', descend: 'de·scend',
    descendant: 'de·scen·dant', engrossed: 'en·grossed', engrave: 'en·grave',
    devour: 'de·vour', despise: 'de·spise', crevasse: 'cre·vasse', mutate: 'mu·tate',
    mutation: 'mu·ta·tion', debate: 'de·bate', oblige: 'o·blige', opaque: 'o·paque',
    apache: 'a·pache', reprove: 're·prove', reproach: 're·proach', betray: 'be·tray',
    bestow: 'be·stow', retract: 're·tract', reprieve: 're·prieve', humane: 'hu·mane',
    repast: 're·past', migrate: 'mi·grate', migrating: 'mi·grat·ing',
    migration: 'mi·gra·tion', vibrate: 'vi·brate', vibration: 'vi·bra·tion',
    amazing: 'a·maz·ing', amazement: 'a·maze·ment', abandon: 'a·ban·don',
    abandoned: 'a·ban·doned', neglected: 'ne·glect·ed', neglect: 'ne·glect',
    respect: 're·spect', respective: 're·spec·tive', reflection: 're·flec·tion',
    refraction: 're·frac·tion',
    gorilla: 'go·ril·la', cilantro: 'ci·lan·tro', imagine: 'i·mag·ine',
    imaginary: 'i·mag·i·nar·y', arachnid: 'a·rach·nid', alaska: 'a·las·ka',
    librarian: 'li·brar·i·an', gigantic: 'gi·gan·tic', rehearsal: 're·hears·al',
    ingredient: 'in·gre·di·ent', suspicious: 'sus·pi·cious', suspicion: 'sus·pi·cion',
    ceramic: 'ce·ram·ic', okapi: 'o·ka·pi', festivity: 'fes·tiv·i·ty',
    characteristic: 'char·ac·ter·is·tic', bazaar: 'ba·zaar', evaporate: 'e·vap·o·rate',
    pistachio: 'pi·sta·chi·o', nomadic: 'no·mad·ic', tsunami: 'tsu·na·mi',
    international: 'in·ter·na·tion·al', nutrition: 'nu·tri·tion',
    calculation: 'cal·cu·la·tion', discriminate: 'dis·crim·i·nate',
    corporation: 'cor·po·ra·tion',
    responsible: 're·spon·si·ble', entrepreneur: 'en·tre·pre·neur',
    relationship: 're·la·tion·ship', anatomy: 'a·nat·o·my',
    segregation: 'seg·re·ga·tion', researcher: 're·search·er', dramatic: 'dra·mat·ic',
    safari: 'sa·fari', hospitable: 'hos·pi·ta·ble', hostility: 'hos·til·i·ty',
    destructive: 'de·struc·tive', spontaneity: 'spon·ta·ne·i·ty',
    petroleum: 'pe·tro·leum', prosperity: 'pros·per·i·ty', evacuate: 'e·vac·u·ate',
    depression: 'de·pres·sion', apartheid: 'a·par·theid', piranha: 'pi·ran·ha',
    hispanic: 'hi·span·ic', salaam: 'sa·laam', catastrophe: 'ca·tas·tro·phe',
    audacity: 'au·dac·i·ty', elated: 'e·lat·ed', diplomacy: 'di·plom·a·cy',
    quadrille: 'qua·drille', audacious: 'au·da·cious', refreshment: 're·fresh·ment',
    cetacean: 'ce·ta·cean', engagement: 'en·gage·ment', privation: 'pri·va·tion',
    distinguish: 'dis·tin·guish', obliterate: 'o·blit·er·ate', atrocious: 'a·tro·cious',
    metropolis: 'me·trop·o·lis', emancipated: 'e·man·ci·pat·ed',
    capricious: 'ca·pri·cious', repressive: 're·pres·sive', supremacy: 'su·prem·a·cy',
    tenacity: 'te·nac·i·ty', hysteria: 'hys·te·ria', tenacious: 'te·na·cious',
    insignificant: 'in·sig·nif·i·cant', harangue: 'ha·rangue', sagacious: 'sa·ga·cious',
    antagonistic: 'an·tag·o·nis·tic', proprietary: 'pro·pri·e·tar·y',
    proactive: 'pro·ac·tive', aghast: 'a·ghast', meander: 'me·an·der', koala: 'ko·a·la',

    /* ---- 第二轮：ASCII 撇号重音标记盲区（数据混用 ' 与 ˈ 两套记法，首轮审计不可见）----
     * 含 5 个单音节误拆词移入 NOSPLIT（aisle/braille/buy/guy/league） */
    advocate: 'ad·vo·cate', amiga: 'a·mi·ga', artisanal: 'ar·ti·san·al',
    australia: 'aus·tral·ia', bastille: 'bas·tille', berserker: 'ber·serk·er',
    blithesome: 'blithe·some', brickmaker: 'brick·mak·er', chiseled: 'chis·eled',
    clamor: 'clam·or', clarifier: 'clar·i·fi·er', conjurer: 'con·jur·er',
    contaminated: 'con·tam·i·nat·ed', coronavirus: 'cor·o·na·vi·rus',
    corroboree: 'cor·ro·boree', coveted: 'cov·et·ed', crawdad: 'craw·dad',
    cryptographic: 'cryp·to·graph·ic', czarina: 'cza·ri·na',
    dimensional: 'di·men·sion·al', disheveled: 'dis·hev·eled',
    disoriented: 'dis·o·ri·ent·ed', elaborate: 'e·lab·o·rate', estancia: 'es·tan·cia',
    favorite: 'fa·vor·ite', forager: 'for·ag·er', foremen: 'fore·men',
    geologic: 'ge·o·log·ic', goalie: 'goal·ie', greatest: 'great·est',
    guanaco: 'gua·na·co', handlebars: 'han·dle·bars', highlands: 'high·lands',
    homemade: 'home·made', impotency: 'im·po·tency',
    improvisational: 'im·pro·vi·sa·tion·al', infrasonic: 'in·fra·son·ic',
    inherited: 'in·her·it·ed', initials: 'i·ni·tials', inquiry: 'in·quir·y',
    inspiriting: 'in·spir·it·ing', ireland: 'ire·land', laborer: 'la·bor·er',
    latticework: 'lat·tice·work', lyrics: 'lyr·ics', mastaba: 'mas·ta·ba',
    mechanics: 'me·chan·ics', medusa: 'me·du·sa',
    mummification: 'mum·mi·fi·ca·tion', obligate: 'ob·li·gate',
    obliterated: 'o·blit·er·at·ed', outcropping: 'out·crop·ping',
    overcredulous: 'o·ver·cred·u·lous', pajamas: 'pa·ja·mas',
    paleontology: 'pa·le·on·tol·o·gy', palpitant: 'pal·pi·tant',
    passageway: 'pas·sage·way', patagonia: 'pa·ta·go·nia',
    patagonian: 'pa·ta·go·nian', patent: 'pat·ent', phonogram: 'pho·no·gram',
    phonologic: 'pho·no·log·ic', phytoplankton: 'phy·to·plank·ton',
    pictograph: 'pic·to·graph', picturesqueness: 'pic·tur·esque·ness',
    pinniped: 'pin·ni·ped', pisa: 'pi·sa', polynesia: 'pol·y·ne·sia',
    polynesian: 'pol·y·ne·sian', primate: 'pri·mate', prosimian: 'pro·si·mian',
    purebred: 'pure·bred', reestablish: 're·es·tab·lish', research: 're·search',
    retrogression: 'ret·ro·gres·sion', savanna: 'sa·van·na',
    secondhand: 'sec·ond·hand', segregated: 'seg·re·gat·ed', shootout: 'shoot·out',
    simulacra: 'sim·u·la·cra', stinger: 'sting·er', stonecutter: 'stone·cut·ter',
    stronger: 'strong·er', synchronized: 'syn·chro·nized', tamale: 'ta·ma·le',
    theater: 'the·a·ter', threatened: 'threat·ened', torturous: 'tor·tur·ous',
    traveler: 'trav·el·er', valor: 'val·or', velarium: 've·lar·i·um',
    vitamins: 'vi·ta·mins', whiteout: 'white·out',
    cellophane: 'cel·lo·phane', chatelaine: 'chat·e·laine',

    /* ---- 复审补漏（第一轮编辑遗漏，归一化重音审计复跑发现）---- */
    reflect: 're·flect', degree: 'de·gree', bizarre: 'bi·zarre',
    discover: 'dis·cov·er', discovery: 'dis·cov·er·y',
  };

  // 无论规则如何划分都只有一个音节 / 不应显示的词
  const NOSPLIT = new Set(['tongue', 'guard', 'aisle', 'braille', 'buy', 'guy', 'league']);

  /* ---------------- 词元切分 ---------------- */
  // 把单词切成不可再拆的单元：{ text, type: 'v'|'c', start }（start 指向小写词偏移）
  function tokenize(low) {
    const units = [];
    let i = 0;
    const prevUnit = () => units[units.length - 1];
    while (i < low.length) {
      const ch = low[i];
      if (ch === 'y') {
        // y 后接元音字母时是辅音（yes / yard / beyond / lawyer），否则是元音（happy / city）
        units.push({ text: 'y', type: VOWEL_CHAR.test(low[i + 1] || '') ? 'c' : 'v', start: i });
        i += 1;
        continue;
      }
      if (VOWEL_CHAR.test(ch)) {
        const team = TEAMS.find((t) => low.startsWith(t, i) && teamOk(low, i, t));
        if (team) { units.push({ text: team, type: 'v', start: i }); i += team.length; continue; }
        units.push({ text: ch, type: 'v', start: i });
        i += 1;
        continue;
      }
      // 辅音：先试辅字组（s 后的 ch/sh/th/ph/wh 不成组：school/sphere）
      const dg = DIGRAPHS.find((t) => low.startsWith(t, i)
        && !(['ch', 'sh', 'th', 'ph', 'wh'].includes(t) && prevUnit() && prevUnit().text === 's'));
      if (dg) { units.push({ text: dg, type: 'c', start: i }); i += dg.length; continue; }
      units.push({ text: ch, type: 'c', start: i });
      i += 1;
    }
    return units;
  }

  function teamOk(low, i, t) {
    if (!R_TEAMS.has(t)) return true;
    const after = low[i + t.length] || '';
    // r 控组要求：r 后不接元音（very/orange），也不双写 r（carrot/arrow）
    return !VOWEL_CHAR.test(after) && after !== 'y' && after !== 'r';
  }

  /* ---------------- 核心划分（不含复合词/例外/后缀） ---------------- */
  // 返回音节数组（小写），不足两个音节返回 null
  function analyze(low) {
    if (!low) return null;
    // 词尾"辅音+le"：按字母在 len-3 处分（ta|ble, lit|tle, jun|gle, ea|gle, im·pos·si|ble 递归左段）
    if (low.length >= 5 && low.endsWith('le') && CONSONANT_CHAR.test(low[low.length - 3])
      && HAS_VOWEL.test(low.slice(0, low.length - 3))) {
      const cut = low.length - 3;
      const left = analyze(low.slice(0, cut)) || [low.slice(0, cut)];
      return left.concat(low.slice(cut));
    }

    const units = tokenize(low);
    const n = units.length;
    const vidx = [];
    for (let i = 0; i < n; i++) if (units[i].type === 'v') vidx.push(i);
    if (vidx.length < 2) return null;

    const bounds = [];   // 每个元素 = 新音节起始的单元下标
    for (let k = 1; k < vidx.length; k++) {
      const prev = vidx[k - 1], next = vidx[k];
      if (next === prev + 1) {
        // 相邻元音单元：直接分；但词尾单个 silent e 不分（square/whale/store）
        if (next === n - 1 && units[next].text === 'e') continue;
        bounds.push(next);
        continue;
      }
      const b = placeBoundary(units, vidx[k - 1], next, low);
      if (b !== null) bounds.push(b);
    }

    // 组装音节，无元音字母的碎片并入右邻（末碎片并入左邻）
    const parts = [];
    let cursor = 0;
    for (let bi = 0; bi <= bounds.length; bi++) {
      const end = bi < bounds.length ? units[bounds[bi]].start : low.length;
      parts.push(low.slice(cursor, end));
      cursor = end;
    }
    for (let i = 0; i < parts.length; i++) {
      if (!HAS_VOWEL.test(parts[i])) {
        if (i + 1 < parts.length) { parts[i + 1] = parts[i] + parts[i + 1]; parts.splice(i, 1); i -= 1; }
        else { parts[i - 1] += parts[i]; parts.splice(i, 1); i -= 2; }
      }
    }
    return parts.length >= 2 ? parts : null;
  }

  // 在 prev|cluster|next 之间确定音节边界（返回边界单元下标；null = 不在此处拆）
  function placeBoundary(units, prev, next, low) {
    const cluster = units.slice(prev + 1, next);
    if (cluster.length === 1) {
      const c = cluster[0].text;
      if (NO_ONSET.has(c)) return prev + 2;              // x/ck/tch 归左：box·er, chick·en
      const v2 = units[next];
      const last = next === units.length - 1;
      if (v2.text === 'e' && last) return null;          // silent e：mile/whale/these 不拆
      if (v2.text === 'e') return prev + 1;              // magic-e 开右：pa·per, gar·den, bro·ther
      if (v2.text === 'y') return prev + 1;              // 词尾 y 开右：la·dy, ti·ny, no·sy
      if (PURE_TEAMS.has(v2.text)) return prev + 1;      // 纯元字组开右：a·round, be·cause, he·ro
      if ('iou'.includes(v2.text)) return prev + 1;      // mu·sic, ro·bot, be·gin
      if (v2.text === 'a' && low[units[next].start + 1] === 'l') return prev + 1;  // lo·cal, le·gal
      return prev + 2;                                   // 默认闭音节归左：sug·ar, a·gain
    }
    // 词尾 C+le 已在 analyze() 按字母处理；这里的词尾 silent-e 簇不拆（fence/twelve/bounce）
    if (next === units.length - 1 && units[next].text === 'e') return null;
    // 多单元簇：枚举切点，右侧音节头越长越合法越优先（sis·ter / mon·ster / chil·dren / soft·ly）
    let best = -1, bestScore = 0;
    for (let k = 1; k < cluster.length; k++) {
      const onset = cluster.slice(k).map((u) => u.text).join('');
      const score = ONSET3.has(onset) ? 3 : ONSET2.has(onset) ? 2
        : (onset.length === 1 && !NO_ONSET.has(onset)) ? 1 : 0;
      if (score > bestScore) { bestScore = score; best = prev + 1 + k; }
    }
    return best > 0 ? best : prev + 2;
  }

  /* ---------------- 复合词 / 例外 / 后缀 / 入口 ---------------- */
  const endsDouble = (s) => s.length >= 4
    && SPLIT_DOUBLE.has(s.slice(-2))
    && CONSONANT_CHAR.test(s[s.length - 1]);
  // 词干以双写辅音结尾时（swimm/spott），从双写处拆开，第二个字母并入后缀：
  // swim+m+ing → swim·ming，spot+t+ed → spot·ted（ss/ff/ll 不拆：dress·ing, call·ing）
  function suffixParts(stem, suf) {
    if (!analyze(stem) && endsDouble(stem)) {
      return joinParts([stem.slice(0, -1), stem.slice(-1) + suf]);
    }
    const p = analyze(stem) || [stem];
    return joinParts(p.concat(suf));
  }
  const joinParts = (parts) => parts.join(SYL);

  // 复合词：两段各自走完整划分管线（base|ball → base·ball；some|times → some·times）
  function compoundSplit(cp) {
    const cut = cp.indexOf('|');
    const a = splitToken(cp.slice(0, cut)) || cp.slice(0, cut);
    const b = splitToken(cp.slice(cut + 1)) || cp.slice(cut + 1);
    return a + SYL + b;
  }

  function splitCore(low) {
    if (NOSPLIT.has(low)) return null;
    const cp = COMPOUNDS[low];
    if (cp) return compoundSplit(cp);
    // 例外词典（splitToken 已提前查过；这里覆盖复合词两段的递归路径）
    const hit = exLookup(low);
    if (hit) return hit;

    // -tion / -sion 单独成音节
    for (const suf of ['tion', 'sion']) {
      if (low.endsWith(suf)) {
        const stem = low.slice(0, -4);
        if (stem.length >= 2 && HAS_VOWEL.test(stem)) {
          const p = analyze(stem) || [stem];
          return joinParts(p.concat(suf));
        }
        break;
      }
    }
    // -ing：词干含元音即可（mak·ing / swim·ming / sing·ing）
    if (low.endsWith('ing') && low.length >= 5) {
      const stem = low.slice(0, -3);
      if (stem.length >= 2 && HAS_VOWEL.test(stem)) return suffixParts(stem, 'ing');
    }
    // -ly：去 e 形词干独立成音节（like·ly / lone·ly / safe·ly）
    if (low.endsWith('ly') && low.length >= 5) {
      const stem = low.slice(0, -2);
      if (/e$/.test(stem) && stem.length >= 3 && HAS_VOWEL.test(stem)) {
        const p = analyze(stem) || [stem];
        return joinParts(p.concat('ly'));
      }
    }
    // -ful / -less / -ness / -ment 后缀（care·ful / end·less / hap·pi·ness / pave·ment）
    for (const suf of ['ful', 'less', 'ness', 'ment']) {
      if (low.endsWith(suf)) {
        const stem = low.slice(0, -suf.length);
        if (stem.length >= 3 && HAS_VOWEL.test(stem)) return suffixParts(stem, suf);
        break;
      }
    }
    return joinParts(analyze(low) || []) || null;
  }

  // 例外词典查找（整词 + 常见屈折形式：riv·ers / cov·ered / us·ing）
  function exLookup(low) {
    const ex = (k) => EXCEPTIONS[k];
    let hit = ex(low);
    if (!hit && /s$/.test(low) && ex(low.slice(0, -1))) hit = ex(low.slice(0, -1)) + 's';
    if (!hit && /ed$/.test(low) && ex(low.slice(0, -2))) hit = ex(low.slice(0, -2)) + 'ed';
    if (!hit && /ing$/.test(low) && ex(low.slice(0, -3))) hit = ex(low.slice(0, -3)) + 'ing';
    return hit || null;
  }

  function splitToken(word) {
    if (word.length < MIN_LEN || !/^[a-zA-Z]+$/.test(word)) return null;
    const low = word.toLowerCase();

    // 例外词典 / 免拆词 / 复合词优先于一切后缀规则
    if (NOSPLIT.has(low)) return null;
    const cp = COMPOUNDS[low];
    if (cp) return compoundSplit(cp);
    const early = exLookup(low);
    if (early) return early;

    // -ed：t/d 后成音节（want·ed, vis·it·ed）；去 e 形 t/d 后成音节（not·ed, rat·ed）；
    //      其余（closed/played/jumped）多为单音节，拆不出就放弃
    if (low.endsWith('ed') && low.length >= 4) {
      const s1 = low.slice(0, -2);
      if (/[td]$/.test(s1) && s1.length >= 2 && HAS_VOWEL.test(s1)) {
        return suffixParts(s1, 'ed');
      } else {
        const s2 = low.slice(0, -1);
        if (/e$/.test(s2)) {
          const core = s2.slice(0, -1);
          if (/[td]$/.test(core) && core.length >= 2 && HAS_VOWEL.test(core)) {
            const p = analyze(core) || [core];
            return joinParts(p.concat('ed'));
          }
          const p = analyze(s2);
          // 末音节过短（grabbe→grab|be）说明 e 只是动词变形，非独立音节；
          // 否则 -d 并入末音节（o·pened / hap·pened / em·pha·sized）
          if (p && p[p.length - 1].length >= 3) {
            p[p.length - 1] += 'd';
            return joinParts(p);
          }
          return null;
        }
      }
    }
    // -es：咝音后成音节（box·es, watch·es, kiss·es, no·ses）；词干整体为闭音节（glass·es）
    if (low.endsWith('es') && low.length >= 5) {
      const stem = low.slice(0, -2);
      if (/(s|x|z|ch|sh)$/.test(stem) && stem.length >= 2 && HAS_VOWEL.test(stem)) {
        return suffixParts(stem, 'es');
      }
    }
    // -s 复数：并入末音节（ap·ples / mon·keys / co·mics）；
    // 词干是单音节的 -es 词不拆（leaves/plates/cakes）
    if (/s$/.test(low) && !/ss$/.test(low) && low.length >= 5) {
      const stem = low.slice(0, -1);
      if (stem.length >= 3 && HAS_VOWEL.test(stem)) {
        const r = splitCore(stem);
        if (r) return r + 's';
        if (low.endsWith('es')) return null;
      }
    }
    return splitCore(low);
  }

  /* ---------------- 对外接口 ---------------- */
  const cache = new Map();

  NG.syllables = {
    /** 返回音节拼读串（如 'bas·ket·ball'）；单音节/无法可靠划分返回 null */
    get(word) {
      if (!word) return null;
      if (cache.has(word)) return cache.get(word);
      let out = null;
      if (word.includes(' ')) {
        // 短语：逐词划分，全部单音节则不显示（ice cream）；任一词可分则保留（liv·ing room）
        const toks = word.split(/\s+/);
        const res = toks.map((t) => splitToken(t));
        out = res.some(Boolean) ? toks.map((t, i) => res[i] || t).join(' ') : null;
      } else {
        out = splitToken(word);
        if (out && /^[A-Z]/.test(word)) out = out.charAt(0).toUpperCase() + out.slice(1);
      }
      cache.set(word, out);
      return out;
    },
  };
})();
