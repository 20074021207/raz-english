# NeuroGlot System Architecture & Agent Roles

## 目录结构树 (Directory Structure)
```
/
├── assets/
│   └── dicts/
│       └── raz/                   # RAZ 分级词库 (AA→Z2, 29级, 12526词条)
│           ├── raz-AA.json ... raz-Z2.json
│           └── _manifest.json     # 词库注册清单（RAZ 课程拓扑的基础数据源）
├── app/src/
│   ├── types/
│   │   ├── vocabulary.ts          # 词汇数据模型 (RAZ→NeuroGlot 桥接)
│   │   ├── conversation.ts       # 实时对话引擎类型 (场景/FSM/Persona/情绪)
│   │   ├── exercise.ts            # 练习题型定义
│   │   ├── lesson.ts              # 课程与技能树节点
│   │   ├── chunk.ts               # 组块掌握度追踪
│   │   ├── courseware.ts          # 课件分发与跟读
│   │   └── content-pack.ts       # 内容包 Manifest
│   ├── services/
│   │   ├── vocabulary.ts          # RAZ 词库加载、i+1 窗口查询、抽样
│   │   ├── conversation-fsm.ts   # 场控 FSM 状态机引擎
│   │   ├── glm-voice.ts          # GLM-4-Voice WebSocket 客户端 + Prompt 组装器
│   │   ├── vocab-firewall.ts     # 词汇防火墙 (RAZ 准入控制)
│   │   ├── scenario-loader.ts    # 场景包加载注册中心
│   │   ├── pronunciation.ts       # 有道发音 API 服务 (开发阶段)
│   │   ├── audio-player.ts        # 本地音频播放
│   │   ├── content-loader.ts      # 课程包加载
│   │   ├── content-pack.ts        # 内容包管理
│   │   ├── courseware.ts          # 课件下载缓存
│   │   ├── shadowing.ts          # 镜像跟读 (ASR)
│   │   └── spaced-repetition.ts  # 间隔重复算法
│   ├── data/
│   │   └── scenarios/
│   │       └── customs-entry.ts  # 海关入境场景包 (FSM 定义)
│   ├── utils/
│   │   └── hash.ts               # DJB2 哈希工具
│   ├── components/
│   │   └── conversation/
│   │       ├── ConversationScreen.tsx    # 对话主屏幕
│   │       └── EnvironmentEffects.tsx   # 环境压迫视觉效果
│   ├── stores/                    # Zustand 状态管理
│   └── db/                        # SQLite 本地数据库
├── docs/
│   ├── architecture.md            # 系统宏观架构与模块设计论述
│   ├── course_generator_arch.md   # LLM 自动课程生成引擎架构
│   ├── database_schema.md         # 数据库与核心数据结构设计
│   ├── realtime_conversation_arch.md # 实时对话引擎架构 (Rust/JSI + GLM-4-Voice + FSM)
│   └── methodology_6month.md      # 6 个月行为重塑方法论
├── h5/                            # H5 版「朱迪单词」🐰（四年级适配，零依赖纯静态）
│   ├── index.html                 # 入口（脚本按序加载，双击即可运行）
│   ├── css/style.css              # 儿童友好移动端设计系统
│   ├── js/                        # core/audio/data/sentences/syllables/state/ui/questions/screens/lesson/boss/app
│   ├── data/sentences-corpus.js   # 离线精语料（AA–Z2 5,781 词 17,304 句，构建期生成）
│   ├── corpus-build/              # 精语料构建：RULES.md 规则 / 48 批语料 / 审计脚本
│   ├── data/raz-data.js           # 构建产物：AA–Z2 全 29 级 12,526 行 / 5,837 唯一词内嵌词库（含词性）
│   ├── build-data.mjs             # 词库压缩 + 儿童释义清洗 + 词性提取脚本
│   ├── test/e2e.mjs               # Playwright 无头冒烟测试（定级→课程→Boss→复习）
│   ├── test/audio-overlap.test.mjs # 零依赖回归测试（例句朗读切词不叠音）
│   └── README.md                  # 运行说明与设计文档对齐表
├── ios/                           # iOS 原生壳（JudyWords：WKWebView 打包 h5 全资源，AVSpeechSynthesizer 桥）
├── schema/
│   └── init.sql                   # MySQL 核心四域初始化脚本
├── scripts/
│   └── download-raz.mjs           # RAZ 词库批量下载脚本
├── task_plan.md
├── progress.md
└── AGENTS.md
```

## 每文件核心职责 (Core Responsibilities)
- `assets/dicts/raz/`: RAZ 分级词库 JSON 资产，29 个级别共 12,526 词条，来源 qwerty-learner (GPL-3.0)。
- `app/src/types/vocabulary.ts`: 桥接 qwerty-learner 原始 Word 格式与 NeuroGlot VocabularyEntry，包含 RAZ 分级枚举和 i+1 数值映射。
- `app/src/services/vocabulary.ts`: 词库惰性加载、按级别查询、i+1 窗口查询、随机抽样、单词精确查找。
- `app/src/services/pronunciation.ts`: 单词发音服务，集成有道词典 API 与本地 expo-file-system 磁盘缓存，统一接口设计便于未来切换至阿里云 TTS。
- `docs/architecture.md`: 确立神经可塑性语言引擎的核心设计模式、输入/组块/输出/情绪四个底层子系统的运作标准。
- `docs/course_generator_arch.md`: 定义 RAZ 29 阶截断式 DAG 拓扑、词汇级别约束引擎、LLM 新闻短文生成器、晋级 Boss 战、课件 JSON Schema 管线。
- `docs/realtime_conversation_arch.md`: 实时对话引擎全层架构：Rust/JSI VAD 接口、GLM-4-Voice 集成、意图状态机流转、Chunk 反应延迟遥测、Persona 面具与词汇防火墙的 Prompt 组装逻辑。
- `docs/methodology_6month.md`: 6 个月行为重塑方法论，覆盖 Chunk Reflex、Persona Masking、情境知觉锚定三层认知神经科学机制。
- `docs/database_schema.md`: 定义 MySQL + Graph DB 混合存储策略、RAZ 级别跃迁状态追踪、遥测数据 30 天滚动归档标准。
- `schema/init.sql`: 包含六个核心域（能力评估、AOT队列、RAZ晋级引擎、TTS资产去重缓存、交互遥测、实时对话引擎）的具体 DDL 定义。
- `scripts/download-raz.mjs`: 零依赖 Node.js 脚本，从 GitHub 批量拉取 RAZ JSON 并生成 manifest。
- `h5/`: H5 版「朱迪单词」（吉祥物为疯狂动物城的朱迪兔），面向四年级小学生的零依赖纯静态学习游戏。复用 RAZ 词库（AA–Z2 全 29 级内嵌）、Boss 战参数（15 题/120s/85%/48h 冷却，首次弃战豁免）、SM-2 间隔重复与有道发音 API；含定级测试（起点 D，区间 AA–H）、五题型课程引擎（词义/反选/听音/拼写/例句填空，填空仅用「目标词恰一次独立出现」的精语料句）、错题重排队、每日目标、每日打卡（完成学习任务后 +1 星、连续 7/14/30 天里程碑加奖）、徽章系统、进度导出/导入；进度存 localStorage。
- `ios/JudyWords/`: iOS 原生 WKWebView 壳，h5 全资源离线打包（sync-www.sh 同步），例句朗读经 AVSpeechSynthesizer 原生桥（离线可用）。
- `task_plan.md`: 无交互环境下的强迫执行边界与状态检查单。
- `progress.md`: 记载当前项目的执行生命周期，充当系统的外部工作记忆。
- `AGENTS.md`: 定义全局系统边界与代码规范基石。

## 系统模块级依赖关系 (Module Dependencies)

```mermaid
graph TD
    A[RAZ Vocabulary Matrix\n(29级分级词表 AA→Z2)] --> B[Neural Chunking & Graph Network\n(神经组块提取与知识图谱)]
    B --> C[3-Tier Output Sandbox\n(三阶输出与回放网格)]
    C -.Feedback.-> B
    A -.Emotion Filter.-> D[Affective Filter Regulators\n(情绪管理控制总线)]
    B -.Emotion Filter.-> D
    C -.Emotion Filter.-> D
    D -.Bio-rhythm Sync.-> C
    B --> E[29-Tiered DAG Curriculum Engine\n(RAZ 分级技能树发生器)]
    E -.Target.-> F[Micro-Lesson Synthesizer\n(RAZ 词汇约束 LLM 课程合成器)]
    A -.Vocab Wall.-> F  %% RAZ 词表构成词汇墙，约束 LLM 生成边界
    F --> G[Leveled News Generator\n(RAZ 级别新闻短文生成器)]
    G --> C
    F --> C
```

**代理职责划分**：
1. **Input Agent (RAZ Vocabulary Manager)**：职责为管理 29 级 RAZ 词表的加载、更新与级别间词汇封要。构建 Allowed Vocabulary Set 哈希表，为下游课件合成提供词汇墙约束。
2. **Chunking Agent (Graph DB Manager)**: 职责为模式识别与网络构建，依赖 Input Agent 的粗数据，输出结构化组块。
3. **Curriculum Topology Agent (RAZ DAG Manager)**: 职责为管理用户的 RAZ 层级跃迁（AA 到 Z2 的轨道状态管理），生成每个级别内部的 DAG 微课拓扑，触发晋级 Boss 战。
4. **Lesson Synthesis Agent (RAZ-Constrained Content Pipeline)**: 职责为在服务端预组装 JSON 与阿里云 TTS 音频资源。执行词汇级别降级清洗（Vocabulary Downgrade Filtering），确保生成的题干句子和新闻短文不超纲。
5. **Sandbox Agent (UI Player)**: 职责为管控通过 Manifest 发起的客户端课件单课并发下载系统，注入本地 `file://` 路径无状态启动课程。包含在用户答题跟读时的状态拦截与录音上报，支持失败容错。
6. **Affective Agent (System Doctor)**: 职责为监测各个链路产生的压力值，拥有强行叫停/切换任务的最高权限。
