# 🐰 朱迪单词 — H5 版（RAZ 英语 · 四年级适配）

基于本仓库 NeuroGlot 项目资源构建的**零依赖、零构建**纯静态 H5 学习游戏，
吉祥物为疯狂动物城主角朱迪（🐰 Judy），面向四年级小学生（9-10 岁），复用项目的 RAZ 词库、Boss 战参数、SM-2 间隔
重复算法与 Nordic Teal 视觉主题。

## 运行

```bash
# 方式一：任一静态服务器（推荐，手机同局域网可访问）
cd h5 && python3 -m http.server 8080
# 打开 http://localhost:8080

# 方式二：直接双击 index.html（数据已内嵌为 JS，无需网络请求加载）
```

发音使用有道词典 API（需联网），离线时自动回退浏览器 `speechSynthesis`。

## 目录结构

```
h5/
├── index.html          # 入口（脚本按序加载，无模块、无打包）
├── css/style.css       # 儿童友好移动端设计系统（对齐 app/src/theme）
├── js/
│   ├── core.js         # NG 命名空间 / 全局配置 / 工具函数
│   ├── audio.js        # 有道 TTS + WebSpeech 兜底 + WebAudio 合成音效
│   ├── data.js         # RAZ 词库访问层（抽样 / 干扰项 / 索引 / 词性）
│   ├── sentences.js    # 词性感知例句引擎（每词 3 条确定性例句，DJB2 轮换）
│   ├── syllables.js    # 音节拼读引擎（正字法音节划分：basketball → bas·ket·ball）
│   ├── state.js        # 掌握度阶梯 / SRS / 每日目标 / 打卡 / 徽章 / Boss 门槛
│   ├── ui.js           # 共享组件 + Confetti/Toast 特效
│   ├── questions.js    # 共享出题组件（题干渲染 + 作答交互，课程/Boss 复用）
│   ├── screens.js      # 首页 / 定级测试 / 词库 / 徽章墙
│   ├── lesson.js       # 课程引擎（学习卡+例句 → 5 题型练习 → 错题重排队 → 结算）
│   ├── boss.js         # 晋级 Boss 战（Diagnostic Sprint）
│   └── app.js          # 极简路由 + 启动
├── data/raz-data.js    # 构建产物：AA–Z2 全 29 级共 12,526 词（内嵌，约 677KB）
├── data/sentences-corpus.js # 离线精语料：5,781 词 17,304 句（构建期生成）
├── build-data.mjs      # 词库压缩构建脚本（node build-data.mjs）
└── test/e2e.mjs        # Playwright 冒烟测试（需系统 Chrome）
```

## 与项目设计文档的对齐关系

| 机制 | 来源 | H5 实现 |
|---|---|---|
| Boss 战参数 | `docs/course_generator_arch.md` §1.3 | 15 题 / 120 秒 / ≥85% 晋级 / 48h 冷却（中途刷新按弃战同样计冷却），70% 下一级新词 + 30% 本级已学词，sprint_score 同 `raz-boss.tsx` |
| 定级测试 | 同上 §5 | 自适应探针（起点 D，每轮 5 词，最多 3 轮 ≤15 题） |
| 间隔重复 | `app/src/services/spaced-repetition.ts` | 掌握度 0-5，间隔 10min/1/3/7/14/30 天，快答 +2 慢对 +0 答错 -1 |
| 错题生命周期 | 同上 §4 Dumb Player | 答错以新题型压回队尾，清空队列才结算 |
| 词汇墙 | 同上 §2.1 | 练习干扰项仅从同级别词表抽取（不超纲） |
| 发音 | `app/src/services/pronunciation.ts` | 同款有道 dictvoice URL |
| 情绪过滤 | `docs/methodology_6month.md` | 无惩罚设计：保底 1 星、错题鼓励语、Boss 失败仅冷却不扣资产 |

**儿童适配调整**：解锁 Boss 需本级掌握 30 词（对应文档"80% 掌握率触发"的儿童版）；
每课 8 新词 + ≤4 到期复习；每日双目标（8 新词 + 10 复习）达成奖励 2 星。

## 数据构建

```bash
node build-data.mjs   # 从 ../assets/dicts/raz/ 重新生成 data/raz-data.js
```

释义清洗规则：只保留第一义项前 2 个语义段，剥离词性标注 / 学科标签 /
人名音译段（如 "n. (Team)人名；(柬)甸" 整段截断），4 年级学生一眼可读；
同时保留首义项词性（第 4 列），供例句引擎消费。

## 例句引擎（js/sentences.js）

每个单词 3 条**双语例句**（英文 + 中文翻译），运行时确定性返回：

- **离线精语料优先**（`data/sentences-corpus.js`）：AA–H 全部 2,129 个唯一词的
  6,367 句自然儿童例句，构建期由 LLM 分批编写，经词汇墙 / 目标词出现 / 全库查重
  三重审计（生成规则与审计脚本在 `corpus-build/`）——面向四年级的完整句、
  有画面感、每词三句句式互异；
- **模板兜底**：语料未覆盖的词（I–L 级高级词）回退词性感知模板生成
  （DJB2 哈希轮换，同一单词任何设备上句句一致）；
- **词汇墙**：精语料编写时强制只使用 AA 级词表 + 功能词墙（637 词，含屈折），
  违规句在审计中自动剔除；多义词按小学生核心义（run=跑、left=左边）。

模板引擎细节（兜底路径）：名词（可数/复数/不可数）、动词、形容词、副词等
各有专属句式库（英文模板 + 对应中文句式）；特殊词集（星期/节日/天体/语言/
序数/数词/动词短语/复合名词）逐类定制句式；全部使用 RAZ AA 级超高频词。

例句的四个消费场景：

1. **学习卡**：目标词高亮 + 中文翻译；「单词 → 例句 1→2→3」顺序自动朗读，
   **单词读完即解锁**【记住了，下一个】，例句继续流式读完强化语境
   （speakSequence 事件链 + 双看门狗兜底，网络卡死也能解锁；
   手动点读视为完成直接解锁）；
2. **例句填空（cloze）题型**：句中挖空选词，答对后自动朗读完整句子；
3. **听音辨词**：作答后显示单词 + 音标 + 中文含义（音→义联结）；
4. 错题重排队时自动更换题型（排除刚失败的题型）重新作答。

拼写题字母与槽位均为小写，与词库形态一致。

## 音节拼读引擎（js/syllables.js）

给所有**能按音节拼读**的单词生成音节划分（basketball → `bas·ket·ball`），
运行时确定性生成、不膨胀数据文件，同一单词在任何设备上划分完全一致：

- **规则引擎**（小学自然拼读教学法）：元字组/辅字组整体单元（ai/ea/oo/igh、ch/sh/th/ck/qu）；
  双写辅音从中间拆（rab·bit）；辅音簇按"右侧合法音节头"拆分（sis·ter / mon·ster / chil·dren）；
  单辅音默认归左（闭音节），magic-e / 词尾 y / 纯元字组后开右（pa·per, ci·ty, a·round）；
  词尾"辅音+le"自成音节（ta·ble, lit·tle, jun·gle）；
- **前后缀**：-tion/-sion/-ing/-ed/-es/-ly/-ful/-less/-ness/-ment 按读音规则成音节
  （want·ed 但 played 不拆；swim·ming 但 dress·ing；box·es 但 glass·es）；
- **复合词表 + 例外词典**：base·ball / rain·bow / play·ground 按词界拆；
  riv·er / cit·y / i·de·a 等正字法不规则词逐个审定；
- **消费场景**：学习卡大词直接以音节形态显示（bas·ket·ball），点击单词切回原形
  basketball、再点还原；课程练习与 Boss 战的词义选择题干、英文选项、听音揭示词
  同样按音节显示；定级测试同样显示；
- 全量 5,615 词审计：与词库 IPA 音节数交叉校准 + AA–C 级逐词人工抽查。

## 测试

```bash
# 1) 安装测试依赖（仓库任意层级）：npm i -D playwright
#    有系统 Chrome 可直接跑；否则先 npx playwright install chromium
# 2) 启动静态服务（任意端口，可用 E2E_BASE 覆盖）
python3 -m http.server 8931 &
node test/e2e.mjs     # 无头浏览器走完整链路：定级→课程→Boss→冷却→复习
```

## 已知边界

- 词库覆盖 RAZ 全 29 级（AA–Z2，12,526 行 / 5,837 唯一词）。定级自适应探针从 D 级
  出发、最多 3 轮，初始定级区间 AA–H；更高级别通过 Boss 战逐级晋升可达。
- 进度存于 `localStorage`（key `razkid_v1`），清除浏览器数据会丢失进度；
  设置里提供重置与重新定级入口。

## iOS App 打包（ios/JudyWords）

原生 WKWebView 壳（UIKit + 手写 pbxproj），H5 全资源离线打包进 App：

```bash
./ios/JudyWords/sync-www.sh     # 1. 同步 h5/ → 壳资源
xcodebuild -project ios/JudyWords/JudyWords.xcodeproj -target JudyWords \
  -configuration Release -sdk iphoneos SYMROOT=$PWD/ios/JudyWords/build build
ios-deploy --bundle ios/JudyWords/build/Release-iphoneos/JudyWords.app --no-wifi -n
```

- 例句朗读：WKWebView 无 speechSynthesis，App 内自动走原生
  AVSpeechSynthesizer 桥（audio.js 的 nativeTTS 通道，离线可用）
- 部署目标 iOS 12.0（兼容 iPhone 6S / iOS 13.x）
- 免费签名 7 天有效：到期后重跑上述命令重装；首次启动需在
  设置→通用→描述文件与设备管理 中信任开发者
