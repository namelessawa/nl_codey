# NL_Codey — 本地 Windows 桌面编码代理

一个本地桌面端的编码代理。打开一个项目，输入一项任务，代理会驱动一个
**自主工具调用循环**：它读取代码、搜索、规划、并修改 —— 每一次修改都
以补丁的形式提出。**未经你批准，任何文件都不会被写入。** 每一步都会
被记录到 SQLite，每一次改动都会被快照，任何一次运行都可以 **回滚**。
文件和命令访问严格限制在工作区根目录之内。

## 目录

- [演进阶段](#演进阶段)
- [架构](#架构)
- [环境要求](#环境要求)
- [安装 Docker（强烈推荐）](#安装-docker强烈推荐)
- [安装](#安装)
- [启动](#启动)
- [工作区 UI](#工作区-ui)
- [配置 LLM（设置面板）](#配置-llm设置面板)
- [代理的工具](#代理的工具)
- [沙箱模式](#沙箱模式)
- [测试](#测试)
- [安全模型](#安全模型)
- [更新历史](CHANGELOG.md)

## 演进阶段

项目分四个阶段演进，全部已合入 `main`，并在 0.1.0 之后追加了一个
独立 CLI 入口与会话树存储：

- **Phase 1 — 安全的单轮 MVP。** 路径隔离、命令白名单、超时控制、
  输出截断，写入前必须显式批准。
- **Phase 2 — 自主工具调用循环。** 模型驱动的流式 tool-calling 循环，
  带预算熔断器、自动 verify→repair 循环、对照基线测试的回归守卫、
  长上下文压缩、对 LLM 瞬时失败的指数退避重试、V4A 上下文补丁格式、
  符号索引以及 eval 测评框架。GUI 中实时显示 trace、迭代时间线、
  预算指示器和项目卡片。
- **Phase 3 — 长期项目托付。** 跨会话记忆、语义索引、任务规划
  （依赖图 + 调度器）、多代理编排（Planner / Coder / Reviewer）、
  Git 集成（分支 / 提交 / PR）、Web 工具、以及 WSL/Docker 沙箱运行器
  —— 通过 "Phase 3" 标签页统一呈现。
- **Phase 4 — 跨项目自演化 + 团队规模。** 七个新的 workspace 包，
  让代理从"单项目托付"演进到"可证明的跨项目持续改进 + 可扩展到
  整夜工作"：跨项目知识图谱、风格规范学习器、被动反馈信号收集、
  可选的 LoRA 微调管道（带三规则评估门）、分布式协调器、只读式
  技术债扫描提案箱、插件 SDK。每项能力都有独立的功能开关，
  即使全部禁用，系统也能优雅退化为完整的 Phase 3。
- **CLI + 会话树（0.1.0 之后追加）。** `apps/cli` 提供 opencode 风格
  的 Ink TUI（带 `/provider`、`/sessions`、`/tree`、`/branch`、
  `/resume`、`/model`、`/think`、`/theme` 等斜杠命令）；
  `packages/session` 在 `~/.nlc/agent.session/` 下以 git 风格的可分支
  JSONL 会话树持久化对话，与现有 SQLite 运行历史并行。两者均与桌面
  GUI 共享同一套 `@nlc/agent-core` 工具循环和 settings 存储。

## 架构

pnpm monorepo 结构（`apps/*`、`packages/*`）。Workspace 包以原始
TypeScript 源码方式发布，由 `electron-vite` **打包**；跨包引用使用
`@nlc/*` 别名 + `.js` 后缀（NodeNext/Bundler ESM 约定）。

```
apps/desktop              Electron 应用（main / preload / React 渲染层）
apps/cli                  Ink TUI（nlc 命令），与 desktop 共享 agent-core 工具循环
packages/shared           类型定义 + IPC 契约 —— 所有包都依赖它，是依赖中枢
packages/sandbox          路径隔离、命令白名单/路由、WSL + Docker 运行器
packages/storage          SQLite（better-sqlite3）：workspaces/runs/steps/snapshots + Phase 3/4 表
packages/session          可分支 JSONL 会话树（~/.nlc/agent.session/），与 SQLite 运行历史并行
packages/project-indexer  文件扫描、忽略规则、项目类型检测
packages/llm              Provider 抽象：流式 chat() + complete()，OpenAI 兼容 + Anthropic
packages/tools            代理的工具集（list/read/search/patch/run/git/symbol/web/memory/task）
packages/agent-core       工具调用循环、预算、verifier、回归守卫、压缩器、eval、rollback
packages/memory           跨会话记忆：decision/preference/failure/fact 条目 + 检索器
packages/semantic-index   嵌入器、分块器、余弦向量检索、增量重建索引
packages/planner          依赖图、DAG 校验、调度波次、LLM 任务分解器
packages/orchestrator     Planner/Coder/Reviewer 角色、消息总线、锁管理器、worker 池
packages/git-integration  分支管理、conventional commit 编写器、PR 生成器、diff 摘要
packages/web-tools        域名白名单、可读性抓取、搜索后端
packages/global-memory    跨项目知识图谱 + provenance + 隐私范围 + 撤回级联
packages/style-profile    StyleSpec 数据模型 + 代码风格抽取器 + diff 反馈学习器
packages/learning         被动信号收集器 + 偏好数据集构建器 + 数据策展
packages/finetune         可选 LoRA/QLoRA + 三规则评估门 + 模型注册表 + 嵌入 A/B
packages/distributed      Coordinator + 任务分发器 + 节点恢复 + 单机优雅降级
packages/proactive        只读技术债扫描 + 提案箱（snooze/dismiss/convert）
packages/plugin-sdk       Manifest 校验 + 逐次权限重检 + 沙箱路由 + 命令转义
```

渲染进程从不直接接触 Node —— 它通过 preload 桥暴露的类型化
`window.agentApi` 与主进程通信（`contextIsolation: true`，
`nodeIntegration: false`）。实时更新通过 `broadcast` → `onAgentEvent`
通道反向流回，载体是一个判别联合类型 `AgentEvent`。

## 环境要求

- Node.js 20+（开发环境为 24）
- pnpm 10+
- Windows 11（主要目标平台）
- 一套 C/C++ 构建工具链，用于原生模块 `better-sqlite3`
  （Visual Studio Build Tools 中的 "Desktop development with C++"，
  或一次性执行 `npm install --global windows-build-tools`）。
- **Docker Desktop（强烈推荐）。** 见下节"安装 Docker"。

`ripgrep` 已通过 `@vscode/ripgrep` **内置**，无需系统安装。WSL 是
可选的；仅当选择 `wsl` 沙箱模式时才需要。

## 安装 Docker（强烈推荐）

应用首次启动时会自动检测 Docker。**没有 Docker 时,代理的工具调用
(运行测试、应用补丁、写入文件) 会直接在你的宿主机上以你的用户权限执行**
—— 一个有 bug 的脚本或恶意的生成代码可以删除工作区之外的文件、
读取你的 SSH 私钥、向外网泄漏数据。

安装 Docker Desktop 可让 `docker` 模式把每条命令都关进一个临时容器,
工作区以 bind-mount 注入,网络默认关闭。这与 Claude Code 在 Linux/macOS
上使用的隔离思路一致。

### 安装步骤(Windows)

1. 访问 [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
   并下载 **Docker Desktop for Windows**。
2. 双击安装程序;若提示启用 WSL 2 或 Hyper-V,接受默认选项。
3. 安装完成后启动 Docker Desktop,等待右下角图标变为常亮(daemon 就绪)。
4. 回到 NL_Codey,点击右上角红色徽章 **Docker not installed** 旁的
   **Re-check** —— 检测成功后徽章自动消失,Agent 设置面板自动解锁。

> Docker Desktop 在个人使用、教育用途和小公司(<250 员工 + 年营收 <
> $10M)是免费的。详情见 [Docker Desktop 订阅条款](https://www.docker.com/pricing/)。

### 如果你选择不安装 Docker

首次启动的安装提醒模态框右下角有一个红色的 **Skip and accept the risk** 按钮。
点击后应用会进入 **降级模式 (degraded mode)**:

- 顶栏始终显示一个红色 **Docker not installed** 徽章,点击重新打开安装指引;
- **设置 → Agent** 栏目顶部出现红色警告横幅,且整个栏目被锁定 —— 你无法
  修改工作区路径、沙箱模式、自动步数等任何 Agent 设置,直到你安装 Docker
  或主动取消 skip;
- 代理循环中所有 `run_command` / `apply_patch` / `write_file` 工具调用
  **失败关闭** —— LLM 自主选择这些工具时会拿到一个可读的拒绝消息,
  允许它换一个工具继续。
- 唯一仍然工作的是只读工具(`read_file`、`list_files`、`search_text`、
  `find_symbol`、`git_status` / `git_diff` 等);代理可以理解你的代码并
  给出建议,但 **不会** 修改任何文件。

你随时可以装上 Docker 再点击红色徽章 → **Re-check** 来解除降级模式 ——
应用会广播状态变化,所有 UI 实时刷新,无需重启。

## 安装

```powershell
pnpm install
```

`pnpm install` 会执行 `electron-rebuild` postinstall 步骤，将
`better-sqlite3` 重建为 Electron 的 ABI。如果失败（通常是工具链
缺失），先安装 C++ 构建工具，然后重新运行：

```powershell
pnpm rebuild:native
```

## 启动

```powershell
pnpm dev
```

这会启动带 HMR 的 Electron 应用。点击左上角的 **打开** 选择项目
文件夹，输入任务，点击 **运行**。

构建生产包：

```powershell
pnpm build
```

## 工作区 UI

左侧面板把最近项目和当前文件夹结构常驻屏幕；中央面板用多个标签页
流式展示代理的工作。

- **最近工作区** —— 之前打开过的文件夹按时间倒序列出
  （持久化到 SQLite），一键即可重新打开。打开前会先验证文件夹是否
  仍然存在。
- **结构化文件树** —— 工作区以可折叠的目录/文件树渲染
  （目录优先，可展开），而不是扁平路径列表。
- **项目卡片** —— 检测到的项目类型（Node/TS、Python、Go、Rust 或
  未知）、代理倾向使用的校验命令、文件总数、出现最多的扩展名。
- **格式化输出** —— 代理消息以 Markdown 渲染（标题、列表、加粗/
  斜体、行内与围栏代码），由一个无依赖的小型渲染器实现。
- **自动滚动** —— 步骤流随新输出滚动，向上翻看时会暂停
  （回到底部时重新启用）。
- **Trace / Timeline / Budget** —— Trace 标签页显示每步的时间戳、
  耗时、过滤、搜索和 JSON 导出；Timeline 标签页可视化
  edit→verify→repair 迭代；顶部预算指示器（成本 / 迭代次数 /
  工具调用次数 / 已用时间）超过 80% 变琥珀色、超过 100% 变红。
- **Phase 3 标签页** —— 记忆面板、任务树、角色时间线、git diff
  预览、失败库、沙箱状态指示器。
- **Phase 4 标签页** —— 全部七项 Phase 4 能力的开关面板：
  知识图谱视图、风格规范编辑器、学习仪表盘（信号统计 + 冻结测试
  集周趋势）、微调管理器（模型注册表 + 一键回滚 + 每个 job 的
  eval Δ / 留出集 / 回归数）、提案箱（扫描 + 转换/snooze/dismiss）、
  集群监控（每 10 秒自动刷新）、插件管理器（启用/禁用/卸载，
  显示权限）。

## 配置 LLM（设置面板）

点击 **齿轮图标**（⚙，中央工具栏右上角）打开 **设置**。
分为三组：

- **LLM** —— Provider（OpenAI / Anthropic / Google Gemini /
  DeepSeek / OpenRouter / Custom）、API Key（带遮罩 + 显隐切换）、
  Base URL（按 Provider 自动填充）、Model、Temperature（0–2）、
  Max Tokens、Timeout（秒），以及一个 **测试连接** 按钮（发送一次
  最小请求，返回"连接成功"或脱敏后的错误）。
- **Agent** —— 工作区路径、允许 shell 执行、命令执行前确认、
  最大自动步数、沙箱模式。
- **Interface** —— 主题（跟随系统 / 浅色 / 深色）、语言
  （zh-CN / en-US）、字体大小。

页脚是 保存 / 取消 / 重置为默认值（重置时需确认），每次保存会有
toast 提示。

### API Key 存储在哪里

API Key 通过 Electron `safeStorage` **静态加密**（OS 后端：
Windows DPAPI / macOS Keychain / Linux Secret Service），写入
`<userData>/apikey.bin`。它 **绝不** 写入 `settings.json`、不记录
到日志、也不出现在错误消息里（provider 错误会被脱敏）。其他所有
设置以 JSON 存于 `<userData>/settings.json`。Windows 下
`<userData>` 是 `%APPDATA%/coding-agent`。

> 如果操作系统报告安全存储不可用，面板会显示警告，且 API Key
> **本次会话不会持久化**（不会回退到明文存盘）。

### Provider 覆盖

OpenAI、DeepSeek、OpenRouter、Google Gemini、Custom 共用同一个
OpenAI 兼容 `/chat/completions` provider（Gemini 走 Google 的
OpenAI 兼容 base URL）。Anthropic 使用原生 `/v1/messages` API。
两类都暴露流式 `chat()`（token 增量 + 工具调用，SSE 重组）和非
流式 `complete()`，瞬时失败会以指数退避有界重试。**Custom**
provider 只需 Base URL + API Key + Model。

### 无 Key 时的开发回退

未配置 API Key 时，LLM 调用回退到 `.env` 中的 env provider
（复制 `.env.example`）。默认 `LLM_PROVIDER=mock` 不需要 Key，
可以完整跑通 工具调用 / 批准 / 校验 / 回滚 循环。

SQLite 数据库位于 `<userData>/data/workspace-state.db`。

## 代理的工具

每个工具都强制硬上限，避免单步淹没模型上下文或越界访问工作区。

| 工具 | 限制 / 说明 |
|---|---|
| `list_files` | 仅工作区内，忽略 `node_modules/.git/dist/build/target/.venv/__pycache__/.next/out`，≤500 个文件 |
| `read_file` | 仅工作区内，≤200KB，拒绝二进制文件 |
| `read_file_range` | 1-索引闭区间切片，≤500 行,报告总行数 |
| `search_text` | ripgrep，≤100 个匹配，≤300 字符上下文，自动跳过忽略目录 |
| `find_symbol` | 定位声明或列出文件符号（TS/JS、Python、Go、Rust），≤400 个文件 / ≤50 个结果 |
| `apply_patch` | 统一 diff **或** V4A 上下文格式；写入前先快照；事务性应用（失败不会留下部分损坏）；等待人工批准 |
| `run_command` | 白名单（或按沙箱模式走 WSL/Docker），60 秒超时,100KB 输出上限,cwd 锁定工作区根 |
| `git_status` / `git_diff` | 分支 + 变更摘要；工作树或暂存区的统一 diff |
| `record_plan` | 把结构化计划写入 trace（仅建议性） |
| `semantic_search` | 在嵌入式项目索引上做余弦检索 |
| `web_fetch` / `web_search` | 可读性抓取 + 搜索,限制在域名白名单内 |
| `read_memory` / `write_memory` | 跨会话的 decision / preference / failure / fact 条目 |
| `propose_task_breakdown` / `update_task_status` | 用于规划和编排的任务树 |
| `request_review` / `approve_change` / `request_changes` | Coder↔Reviewer 编排消息 |
| `write_file` | 内部使用（仅在批准后调用），写入前快照 |

**命令白名单**（沙箱模式 `whitelist`，默认）：`npm test`、`npm run test`、
`npm run build`、`pnpm test`、`pnpm build`、`yarn test`、`yarn build`、
`pytest`、`pytest .`、`go test ./...`、`cargo test`、`tsc --noEmit`、
`npx tsc --noEmit`。要加入新的校验命令，请加入白名单，**不要** 放宽
匹配器。

## 沙箱模式

`run_command` 通过以下三种模式之一路由（在 设置 → Agent 中选择）：

- **`whitelist`**（默认,最安全）—— 精确匹配的允许列表,会被危险
  模式（命令链、命令替换、重定向、`rm -rf`、`powershell` 等）
  筛查,最终在宿主机上 spawn,cwd 锁定到工作区根。子进程被分配到一个
  Windows **Job Object**(`KILL_ON_JOB_CLOSE` + 内存/CPU/进程数上限),
  Electron 退出或运行取消时整棵进程树原子化销毁。
- **`wsl`** —— 在 WSL Ubuntu 实例中运行，针对工作区的副本。
- **`docker`** —— 在临时容器中运行，工作区以绑定挂载方式注入。
  推荐生产使用,见上节"安装 Docker"。

WSL/Docker 运行默认 **无网络出口**，除非某条命令明确开启；改动的
文件会同步回宿主。

> **关于"开箱即用"的真沙箱:** Windows 原生没有等价于 Linux `bwrap` /
> macOS `sandbox-exec` 的用户态工具(它们是 Linux 内核命名空间或
> Seatbelt 的特性),因此应用打包内不能自带强隔离。AppContainer 是
> Windows 原生可选的真沙箱方案,长期路线已在
> [`docs/sandbox/appcontainer-spike.md`](docs/sandbox/appcontainer-spike.md)
> 记录(~10 工作日的 native addon 工作)。在那之前,Docker 是
> Windows 上能拿到的最强隔离。

## 测试

```powershell
pnpm test          # vitest run（所有包）
pnpm typecheck     # tsc --noEmit 跨所有 workspace 项目
```

覆盖范围包括：路径隔离（含 symlink 逃逸）、命令白名单 + 注入拒绝 +
沙箱策略/路由、`apply_patch`（统一 diff + V4A，新增/修改/删除，
失败不破坏文件）、工具调用循环 / 预算 / verifier / 回归守卫 /
压缩器 / eval 测评框架、记忆检索器、语义索引、Planner 图/调度器、
Orchestrator 消息总线 / 锁 / 角色、Git 集成、Web 工具、LLM provider
（流式 chat、重试），以及存储生命周期。

> **原生模块注意：** `pnpm test` 在裸 Node 下运行，而 `better-sqlite3`
> 在 `pnpm dev`/`build` 流程中是按 Electron 的 ABI 重建的。因此唯一
> 真正打开 DB 的测试（`packages/storage/src/storage.test.ts`）在 Node
> 下会因 ABI 不匹配失败 —— 这是工具链层面的现象,不是代码回归。
> 详见 `CLAUDE.md`。

## 安全模型

- 每个路径都被 `resolve` 并校验确实位于工作区根之内（含 `realpath`
  的 symlink 逃逸检查，正确处理 Windows 路径分隔符）。
- 命令在 spawn 前要么精确匹配白名单、要么经 WSL/Docker 沙箱路由，
  并对危险模式做筛查。
- 补丁在写入前先快照原内容,并以事务方式应用；rollback 时按逆序
  恢复累计的迭代快照。
- 补丁的应用必须在 GUI 中显式批准 —— 循环会停在那里等 Apply/Reject
  IPC 解析。
- 每次运行有预算熔断器，限制 成本 / 迭代次数 / 工具调用次数 /
  时长（成本硬上限 $5.00），触发后立即停止。
- 任意一次运行都可以通过 **Rollback** 完整回滚；运行可以通过
  **Stop** 取消（AbortSignal,阶段间设有 checkpoint）。
- **Phase 4 微调** 受三规则评估门保护：候选模型分数 ≥ 基线、零
  per-task 回归、留出集不崩溃；任何一条不满足都不会被晋升。
  模型注册表强制"同时只有一个 active 模型"，可一键回滚到基线。
- **Phase 4 提案箱** 是只读的：扫描器从不修改文件、从不创建任务、
  从不运行非只读命令；所有动作必须经人工 convert 才会进入 Planner
  管道。
- **Phase 4 插件** 必须经人工逐权限批准（永远不会自动批准），插件
  调用时每次都重新校验权限；命令参数 shell 转义。
