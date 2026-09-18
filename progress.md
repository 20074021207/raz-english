# 执行进度纪要 (Execution Progress)

## [2026-04-18] 课件多文件下载与跟读逻辑重构

**高阶摘要**:
将原先对网络极度依赖的 AOT 流式推流架构重构成 "AI后台预制 -> 阿里云 TTS -> 单课独立下载 -> 完全纯离线学习 + 归一化 ASR 评核" 架构。放弃本地打 ZIP 避免原生模块解压依赖，采用 Manifest 清单并发下载。针对 shadowing 场景引入2次失败静默过关的容错机制。

**执行记录**:
- 确定架构模型：纯离线按清单下载模型，确立采用阿里云TTS/ASR生态。
- 修订了 `docs/architecture.md`, `docs/course_generator_arch.md`, `AGENTS.md`。
- 修改并迁移了 `app/src/db/schema.ts`（引入了 `courseware_cache` 与字段调整）。
- 构建了 `app/src/types/courseware.ts` 及完善练习题目属性（加入 `audioLocalPath` 和 `expectedText`）。
- 构建了基于池化并发下载引擎 `app/src/services/courseware.ts`。
- 构建了包含防死锁（失败两次静默护航）逻辑和简单归一化对比算法的录音评测代理 `app/src/services/shadowing.ts`。
- 扩充了 Zustand State (`lesson.store.ts`) 支持了 shadowing 的生命周期。
- 插入了 `ShadowingExercise` UI组块，并在 `LessonScreen` 响应状态拦截。

**当前阻碍**:
架构梳理就绪。服务端实现移交。此任务闭环。

## [2026-04-19] qwerty-learner 架构分析与 RAZ 词库集成

**高阶摘要**:
深度分析 qwerty-learner (21.8k Star) 项目源码，提取对 NeuroGlot 有价值的设计模式和数据资产。最终决策：仅复用 RAZ 分级词库数据（29 级、12,526 词条），配合有道发音 API 建立完整的词汇基础层。

**执行记录**:
- 分析了 qwerty-learner 的状态管理（Jotai atomWithStorage）、打字引擎、IndexedDB 五层记录模型。
- 提取设计模式：声明式词库注册 + 惰性加载、LetterMistakes 字母级错误建模、默写遮蔽策略。
- 批量下载 29 个 RAZ 分级词库 JSON 至 `assets/dicts/raz/`，自动生成 `_manifest.json`。
- 创建 `scripts/download-raz.mjs`：零依赖 Node.js 批量下载脚本（并发 5 路限流）。
- 创建 `app/src/types/vocabulary.ts`：桥接 qwerty-learner Word 格式与 NeuroGlot VocabularyEntry，含 RAZ 分级枚举和 i+1 数值映射。
- 创建 `app/src/services/vocabulary.ts`：词库惰性加载、i+1 窗口查询（±N 级）、Fisher-Yates 随机抽样、全局单词精确查找。
- 创建 `app/src/services/pronunciation.ts`：有道词典发音 API 封装（开发阶段），统一接口设计便于切换阿里云 TTS。
- 同步更新 `AGENTS.md` 架构文档。

**关键决策**:
- ⚠ 不复用 qwerty-learner 的"惩罚式清空重输"交互——与 NeuroGlot 零惩罚设计哲学冲突。
- ✓ 仅使用 RAZ 词库（用户指令），不导入 CET/IELTS/GRE 等其他词库。
- ✓ 先用有道发音 API，后续切换阿里云 TTS（用户确认）。

**当前状态**: 词汇基础层就绪，可供 Curriculum Topology Agent 和诊断系统消费。
## 2026-04-20
- 初始化 git 仓库，添加 origin 配置并使用 init message 推送至 https://github.com/dayuer/english.git (master/main)

- 修复 app 目录被识别为 embedded git repository 的问题，重新追踪内部源码并推送到 origin

## [2026-09-17] H5 版「小狐狸单词大冒险」开发（四年级适配）

**高阶摘要**:
基于仓库现有资源（RAZ 词库、Boss 战参数、SM-2 算法、主题色）构建零依赖纯静态 H5
学习游戏，面向四年级小学生。全部逻辑运行于浏览器本地（localStorage），双击
index.html 即可运行，无需构建链路。

**执行记录**:
- 新建 `h5/` 目录：index.html + css/js 共 10 个模块，无框架、无打包、无网络加载依赖。
- `h5/build-data.mjs`：将 assets/dicts/raz AA–L 共 13 级 5,615 词压缩为 163KB 内嵌数据，
  附带儿童友好释义清洗（剥离词性标注/学科标签/人名音译段，仅保留前 2 个语义段）。
- 对齐设计文档实现：Boss 战（15 题/120s/85% 晋级/48h 冷却/70% 下一级抽样/sprint_score）、
  自适应定级（起点 D，探针制，≤15 题）、SM-2 间隔重复（10min/1/3/7/14/30 天）、
  错题新题型重排队、同级别干扰项（词汇墙不超纲）。
- 游戏化层：学习卡→4 题型（词义/反向/听音/拼字母）→连击横幅→星星结算→Confetti；
  每日双目标（8 新词+10 复习）、连续打卡、9 枚固定徽章 + 每级征服者徽章、词库浏览、
  有道 TTS（WebSpeech 离线兜底）、WebAudio 合成音效（零素材）。
- `h5/test/e2e.mjs`：Playwright 无头 Chrome 冒烟测试，14 项断言全通过
  （定级→课程→错题重排队→Boss 解锁/晋级/冷却→复习混排），零 console 错误。

**关键决策**:
- ✓ Boss 解锁门槛儿童化为本级掌握 30 词（文档 80% 掌握率的适龄版）。
- ✓ 无惩罚设计：结算保底 1 星、Boss 失败仅冷却不扣资产（methodology 情绪过滤原则）。
- ✓ 数据内嵌为 window 全量 JS 而非 fetch JSON——兼容 file:// 直开与微信内嵌浏览器。

**当前状态**: H5 版可用。运行方式见 h5/README.md。

## [2026-09-17] H5 例句系统：每词 3 例句 + 例句填空题型

**高阶摘要**:
为 H5 版增加全词库例句覆盖（5,615 词 × 3 句）。放弃 LLM 批量生成与静态内嵌两案，
采用**运行时词性感知模板引擎**：零数据膨胀、零网络依赖、DJB2 确定性（同词同句，
重复暴露强化情境锚定，对齐 methodology_6month.md §3 情境烙印）。

**执行记录**:
- `build-data.mjs` 增量保留首义项词性（第 4 列），词性覆盖 5,570/5,615 (99.2%)。
- 新增 `js/sentences.js`：名词（可数 a/an/复数/不可数）、vt/vi/v 帧式模板（it 宾语帧
  规避及物动词配价问题）、形容词/副词通用安全帧、星期/节日/天体/语言/序数/数词/
  动词短语/复合名词白名单词集；模板词汇全部在 RAZ AA 级高频词内（词汇墙约束）。
- 学习卡新增 3 例句（目标词高亮、点击整句 TTS）；新增 cloze 例句填空题型
  （句中挖空选词 + 中文释义提示，答对自动朗读完整句子）。
- 修复既有 bug：错题重排队曾复用失败题型（makeEx 参数语义错误）。
- 全量审计 5,615 词 0 异常（含词/大写/标点/去重）；E2E 扩至 16 项断言全过，
  零 console 错误。

**当前状态**: 例句系统上线。数据文件 188KB（词性列 +25KB）。

## [2026-09-17] H5 例句强化包：顺序朗读门控 / 双语例句 / 听音释义 / 小写拼写 / 更名朱迪单词

**高阶摘要**:
按用户反馈迭代 5 项：学习卡改为「单词→3 例句」自动顺序朗读且读完才解锁下一题
（强制完整语音暴露，杜绝跳过）；例句全部配上中文翻译（模板双语对）；拼写题统一
小写；听音题作答后展示单词+音标+释义完成音→义联结；应用更名「朱迪单词」，
吉祥物由小狐狸换为疯狂动物城主角朱迪兔 🐰。

**执行记录**:
- `audio.js` 新增 speakSequence 顺序朗读引擎：Audio ended 事件链 + 失败回退
  speechSynthesis（onend）+ 双层看门狗（单条/全程），任何网络状况下必然回调。
- `sentences.js` 升级双语模板库（19 类句式各配中文句式，{T} 首义/{TP} 谓语形
  剥"的/地"/数词剥"个"/空格分隔释义兼容），全量 5,615 词复审 0 异常。
- 学习卡朗读门控：gateStamp 会话戳隔离 + `_releaseGate` 钩子；手动点读视为
  完成直接解锁（保护主动探索动机）。
- 听音辨词（课程+Boss）作答后注入 listen-reveal 释义条；拼写题 lesson/boss
  槽位与揭示全部小写； mascot-avatar/hero-mascot 类名与全站文案更新。
- E2E 扩至 19 项断言全过（门控初始禁用/双语断言/小写断言/释义断言），
  零 console 错误。localStorage key 保持 razkid_v1，老进度无损。

**当前状态**: 已交付。浏览器刷新即可见（localhost:8080）。

## [2026-09-18] 修复学习卡跳句：例句改走本地语音合成

**根因**（实测定位）:
有道 dictvoice 对整句 TTS 合成不稳定——同一句多次请求间或返回 120 字节的
500 JSON（"returned null audio"），单词合成始终可靠。句子拿到无效数据后
引擎提前推进，表现为"没读完第二句就读第三句"；旧版固定时长看门狗（估算过紧）
与兜底切换不暂停旧音频还会造成截断/叠音。

**修复**:
- 音频路由拆分：单词走有道（保留瞬时错误静默重试 + 动态看门狗：起播前 7s、
  起播后按真实 duration+4s）；句子一律走浏览器本地 speechSynthesis
  （零网络依赖，onend 主推进 + 从宽估时兜底 + 无声环境节奏保护）。
- 新增 stopCurrent：打断/切句时统一暂停在播 <audio> 并 cancel 语音队列，
  杜绝叠音；手动点读不再与序列残留播放重叠。
- 学习卡总看门狗按新引擎最坏耗时放宽（正常路径仍由 onDone 驱动）。
- 无头 Chrome 三轮时序探针：句间隔稳定 1.4-2.8s、done 单次触发；
  E2E 19 项全过，零 console 错误。
