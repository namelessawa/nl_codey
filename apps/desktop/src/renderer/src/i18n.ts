import type { LanguagePreference } from "@coding-agent/shared";

/**
 * Lightweight translation dictionary for the Settings UI and key labels. Full
 * application-wide i18n is an incremental follow-up; this keeps the new surface
 * bilingual without pulling in a framework.
 */
const STRINGS = {
  "settings.title": { "zh-CN": "设置", "en-US": "Settings" },
  "settings.open": { "zh-CN": "设置", "en-US": "Settings" },
  "settings.save": { "zh-CN": "保存", "en-US": "Save" },
  "settings.cancel": { "zh-CN": "取消", "en-US": "Cancel" },
  "settings.reset": { "zh-CN": "重置默认值", "en-US": "Reset to defaults" },
  "settings.resetConfirm": {
    "zh-CN": "确定要恢复所有默认配置吗？此操作会清除已保存的 API Key。",
    "en-US": "Restore all default settings? This clears the saved API key.",
  },
  "settings.saved": { "zh-CN": "设置已保存", "en-US": "Settings saved" },
  "settings.saveFailed": { "zh-CN": "保存失败", "en-US": "Save failed" },

  "group.llm": { "zh-CN": "LLM 设置", "en-US": "LLM" },
  "group.agent": { "zh-CN": "Agent 设置", "en-US": "Agent" },
  "group.ui": { "zh-CN": "界面设置", "en-US": "Interface" },

  "llm.provider": { "zh-CN": "Provider", "en-US": "Provider" },
  "llm.apiKey": { "zh-CN": "API Key", "en-US": "API Key" },
  "llm.apiKeyHint": {
    "zh-CN": "密钥仅本地加密保存，不会出现在日志中。",
    "en-US": "Stored encrypted locally; never written to logs.",
  },
  "llm.baseUrl": { "zh-CN": "Base URL", "en-US": "Base URL" },
  "llm.model": { "zh-CN": "Model", "en-US": "Model" },
  "llm.temperature": { "zh-CN": "Temperature", "en-US": "Temperature" },
  "llm.maxTokens": { "zh-CN": "Max Tokens", "en-US": "Max Tokens" },
  "llm.timeout": { "zh-CN": "Timeout（秒）", "en-US": "Timeout (s)" },
  "llm.test": { "zh-CN": "测试连接", "en-US": "Test connection" },
  "llm.testing": { "zh-CN": "测试中…", "en-US": "Testing…" },

  "agent.workspacePath": { "zh-CN": "工作目录", "en-US": "Workspace path" },
  "agent.choose": { "zh-CN": "选择…", "en-US": "Choose…" },
  "agent.allowShell": { "zh-CN": "允许执行 Shell 命令", "en-US": "Allow shell execution" },
  "agent.requireConfirm": {
    "zh-CN": "执行命令前需要确认",
    "en-US": "Confirm before running commands",
  },
  "agent.readOnly": {
    "zh-CN": "只读（指令）模式",
    "en-US": "Read-only (instruction) mode",
  },
  "agent.readOnlyHint": {
    "zh-CN": "开启后 agent 不能修改任何文件——只能读取、搜索、运行验证命令并以文字给出建议。",
    "en-US": "When on, the agent cannot modify any file — it can only read, search, run verification commands, and propose changes in prose.",
  },
  "agent.multiAgent": {
    "zh-CN": "启用多代理协作",
    "en-US": "Enable multi-agent orchestration",
  },
  "agent.multiAgentHint": {
    "zh-CN": "改用 Phase 3 协调器（Planner → Coder → Reviewer）驱动,沿用同一套审批 / 沙箱 / 验证机制",
    "en-US": "Route runs through the Phase 3 Planner → Coder → Reviewer pipeline; same approval / sandbox / verify gates as single-agent",
  },
  "agent.maxAutoSteps": { "zh-CN": "最大连续自动执行步数", "en-US": "Max auto steps" },
  "agent.sandbox": { "zh-CN": "启用沙箱模式", "en-US": "Sandbox mode" },
  "agent.sandboxEnabled": { "zh-CN": "启用沙箱", "en-US": "Sandbox enabled" },
  "agent.sandboxEnabledHint": {
    "zh-CN": "关闭后忽略下方模式选择,run_command 仅按白名单直接在宿主机执行",
    "en-US": "Off uses the host-side whitelist regardless of the mode picked below",
  },

  "ui.theme": { "zh-CN": "主题", "en-US": "Theme" },
  "ui.language": { "zh-CN": "语言", "en-US": "Language" },
  "ui.fontSize": { "zh-CN": "字体大小", "en-US": "Font size" },
  "ui.theme.system": { "zh-CN": "跟随系统", "en-US": "System" },
  "ui.theme.light": { "zh-CN": "浅色", "en-US": "Light" },
  "ui.theme.dark": { "zh-CN": "深色", "en-US": "Dark" },
  "ui.fontSize.small": { "zh-CN": "小", "en-US": "Small" },
  "ui.fontSize.medium": { "zh-CN": "中", "en-US": "Medium" },
  "ui.fontSize.large": { "zh-CN": "大", "en-US": "Large" },

  "secrets.unavailable": {
    "zh-CN": "系统安全存储不可用，API Key 本次不会持久化保存。",
    "en-US": "OS secure storage unavailable; the API key will not be persisted.",
  },

  "settings.eyebrow": { "zh-CN": "codey · 运行手册", "en-US": "codey · runbook" },
  "settings.unsaved": { "zh-CN": "未保存的更改", "en-US": "unsaved changes" },
  "settings.allSaved": { "zh-CN": "全部已保存", "en-US": "all changes saved" },
  "settings.storage.title": {
    "zh-CN": "API Key 加密存储",
    "en-US": "API key encrypted at rest",
  },
  "settings.storage.body": {
    "zh-CN": "Electron safeStorage（DPAPI）。不会写入 settings.json，也不会被记录。",
    "en-US": "Electron safeStorage (DPAPI). Never logged or written to settings.json.",
  },

  "settings.tab.llm.hint": { "zh-CN": "Provider · API Key · 模型", "en-US": "Provider · API key · Model" },
  "settings.tab.agent.hint": { "zh-CN": "工作区 · 沙箱 · 限额", "en-US": "Workspace · Sandbox · Limits" },
  "settings.tab.ui.hint": { "zh-CN": "主题 · 语言 · 字号", "en-US": "Theme · Language · Density" },
  "settings.tab.shortcuts": { "zh-CN": "快捷键", "en-US": "Shortcuts" },
  "settings.tab.shortcuts.hint": {
    "zh-CN": "按键 · 绑定 · 冲突",
    "en-US": "Keys · Bindings · Conflicts",
  },

  "llm.paneTitle": { "zh-CN": "语言模型", "en-US": "Language model" },
  "llm.paneIntro": {
    "zh-CN":
      "选择 Provider、填入 API Key 并指定模型。点击下方测试按钮会发起一次最小请求；在你启动任务之前不会消耗 token。",
    "en-US":
      "Pick a provider, paste a key, and choose a model. The test button sends one minimal request — no run will execute until you start a task.",
  },

  "agent.paneTitle": { "zh-CN": "Agent 行为", "en-US": "Agent behaviour" },
  "agent.paneIntro": {
    "zh-CN": "约束 Agent 可以做什么、在哪里做、最多自动执行多少步。",
    "en-US":
      "What the agent is allowed to do, where it's allowed to do it, and how many steps it gets before the budget breaker steps in.",
  },
  "agent.workspacePathHint": {
    "zh-CN": "读/写/执行的根目录",
    "en-US": "root for every read / write / run",
  },
  "agent.allowShellHint": {
    "zh-CN": "run_command 遵循白名单 · 60 秒超时 · 100KB 输出上限",
    "en-US": "run_command obeys the whitelist · 60s timeout · 100KB output cap",
  },
  "agent.requireConfirmHint": {
    "zh-CN": "白名单命令也需要二次确认 · 更慢但更安全",
    "en-US": "ask even for whitelisted commands · slower, safer",
  },
  "agent.maxAutoStepsHint": {
    "zh-CN": "预算断路器触发前的硬上限",
    "en-US": "hard cap before the budget breaker stops the run",
  },
  "agent.sandboxHint": {
    "zh-CN": "run_command 的执行方式 — packages/sandbox 同时强制下方三条",
    "en-US": "how run_command executes — packages/sandbox enforces all three",
  },
  "agent.sandbox.whitelist": { "zh-CN": "白名单", "en-US": "Whitelist" },
  "agent.sandbox.whitelistTag": { "zh-CN": "默认 · 最安全", "en-US": "safest · default" },
  "agent.sandbox.whitelistBody": {
    "zh-CN":
      "完全匹配的命令白名单（pnpm test、pytest…），过滤链式调用 / 重定向 / rm -rf，宿主机执行且 cwd 锁定在工作区。",
    "en-US":
      "Exact-match allowlist (pnpm test, pytest, …) screened for chaining / redirection / rm -rf, spawned on the host with cwd pinned to the workspace.",
  },
  "agent.sandbox.comingSoon": { "zh-CN": "即将推出", "en-US": "coming soon" },
  "agent.sandbox.wslTag": { "zh-CN": "隔离", "en-US": "isolated" },
  "agent.sandbox.dockerTag": { "zh-CN": "最强隔离", "en-US": "most isolated" },
  "agent.budgetCap": { "zh-CN": "预算上限", "en-US": "Budget cap" },
  "agent.budgetCapHint": {
    "zh-CN": "每次运行的美元上限（硬性封顶 $5.00）",
    "en-US": "dollar ceiling per run (hard-capped at $5.00)",
  },
  "agent.sandbox.wslBody": {
    "zh-CN": "在 WSL Ubuntu 中运行工作区副本，默认无出站网络，结果同步回宿主机。",
    "en-US":
      "Runs inside a WSL Ubuntu instance against a workspace copy. No network egress by default; changes sync back to the host.",
  },
  "agent.sandbox.dockerBody": {
    "zh-CN": "临时容器绑挂工作区，默认无出站网络，除非显式开启。",
    "en-US":
      "Ephemeral container with the workspace bind-mounted. No network egress unless a command opts in.",
  },

  "ui.paneTitle": { "zh-CN": "界面", "en-US": "Interface" },
  "ui.paneIntro": {
    "zh-CN": "视觉偏好。这些设置与语言、主题一起保存在 settings.json 中。",
    "en-US":
      "Visual preferences. These settings live in settings.json alongside language and theme.",
  },
  "ui.density": { "zh-CN": "密度", "en-US": "Density" },
  "ui.densityHint": {
    "zh-CN": "影响 sidebar / chat / approval sheet 的留白",
    "en-US": "affects sidebar, chat, and approval sheet spacing",
  },
  "ui.density.comfy": { "zh-CN": "舒适", "en-US": "Comfortable" },
  "ui.density.compact": { "zh-CN": "紧凑", "en-US": "Compact" },
  "ui.pipeline": { "zh-CN": "运行时显示流水线", "en-US": "Show pipeline strip during runs" },
  "ui.pipelineHint": {
    "zh-CN": "聊天上方的 plan → search → patch → verify 进度条",
    "en-US": "thin progress bar above the chat: plan → search → patch → verify",
  },
  "ui.motion": { "zh-CN": "启用动画", "en-US": "Enable animations" },
  "ui.motionHint": {
    "zh-CN": "状态脉动 · 面板过渡 · 滚动到底",
    "en-US": "status pulses, panel transitions, scroll-to-bottom",
  },
  "ui.smoothTransitions": {
    "zh-CN": "开启平滑切换",
    "en-US": "Smooth view transitions",
  },
  "ui.smoothTransitionsHint": {
    "zh-CN": "在空白页 / 新建任务 / 对话视图之间淡入淡出 · 关闭动画时自动失效",
    "en-US": "fade between empty / compose / chat views · ignored when motion is off",
  },

  "quickprefs.title": { "zh-CN": "快速偏好", "en-US": "quick preferences" },
  "quickprefs.allSettings": { "zh-CN": "全部设置…", "en-US": "All settings…" },
  "quickprefs.autosave": { "zh-CN": "自动保存", "en-US": "saved automatically" },

  "shortcuts.paneTitle": { "zh-CN": "键盘快捷键", "en-US": "Keyboard shortcuts" },
  "shortcuts.paneIntro": {
    "zh-CN": "下面是当前版本的默认绑定。后续版本将支持自定义录制与冲突检测。",
    "en-US":
      "Defaults shipped in this build. Recording, conflict detection, and per-action rebinding land in a future release.",
  },
  "shortcuts.group.workflow": { "zh-CN": "工作流", "en-US": "Workflow" },
  "shortcuts.group.approval": { "zh-CN": "审批", "en-US": "Approval" },
  "shortcuts.group.nav": { "zh-CN": "导航", "en-US": "Navigation" },
  "shortcuts.group.app": { "zh-CN": "应用", "en-US": "App" },
  "shortcuts.filterPlaceholder": {
    "zh-CN": "搜索快捷键…（例如 patch、palette、Ctrl+K）",
    "en-US": "Search shortcuts… (e.g. patch, palette, ctrl+k)",
  },
  "shortcuts.resetAll": { "zh-CN": "全部重置", "en-US": "Reset all" },
  "shortcuts.resetOne": { "zh-CN": "恢复默认", "en-US": "Reset to default" },
  "shortcuts.resetConfirm": {
    "zh-CN": "确定要把所有快捷键恢复为默认值吗？",
    "en-US": "Reset every shortcut to defaults?",
  },
  "shortcuts.unbind": { "zh-CN": "解除绑定", "en-US": "Unbind" },
  "shortcuts.unbound": { "zh-CN": "— 未绑定 —", "en-US": "— unbound —" },
  "shortcuts.pressKeys": { "zh-CN": "请按键…", "en-US": "press keys…" },
  "shortcuts.conflictBanner": {
    "zh-CN": "存在快捷键冲突 · 先定义的会赢 · 保存前请先解决",
    "en-US":
      "One or more bindings collide. The earlier-defined action wins at runtime; resolve before saving.",
  },
  "shortcuts.alsoBoundTo": { "zh-CN": "也绑定到", "en-US": "also bound to" },
  "shortcuts.recallLast": { "zh-CN": "调取上一条消息", "en-US": "Recall last message" },
  "shortcuts.recallLastHint": {
    "zh-CN": "在 composer 中向上翻历史",
    "en-US": "in the composer · cycles back through history",
  },
  "shortcuts.openDiff": { "zh-CN": "打开完整 diff", "en-US": "Open full diff" },
  "shortcuts.openDiffHint": {
    "zh-CN": "展开 notebook 审批面板",
    "en-US": "expand the notebook approval sheet",
  },
  "shortcuts.palette": { "zh-CN": "命令面板", "en-US": "Command palette" },
  "shortcuts.paletteHint": {
    "zh-CN": "模糊查找 runs、文件、动作",
    "en-US": "fuzzy-find runs, files, actions",
  },
  "shortcuts.searchHistory": { "zh-CN": "搜索历史", "en-US": "Search history" },
  "shortcuts.searchHistoryHint": {
    "zh-CN": "跨本项目全部 runs",
    "en-US": "across all runs in this project",
  },
  "shortcuts.nextThread": { "zh-CN": "下一个 thread", "en-US": "Next thread" },
  "shortcuts.nextThreadHint": { "zh-CN": "向下移动 sidebar", "en-US": "move down in the sidebar" },
  "shortcuts.prevThread": { "zh-CN": "上一个 thread", "en-US": "Previous thread" },
  "shortcuts.prevThreadHint": { "zh-CN": "向上移动 sidebar", "en-US": "move up in the sidebar" },
  "shortcuts.newRun": { "zh-CN": "新建运行", "en-US": "New run" },
  "shortcuts.newRunHint": {
    "zh-CN": "开始一段新的 Agent 对话",
    "en-US": "open a new conversation with the agent",
  },
  "shortcuts.openWorkspace": { "zh-CN": "打开工作区", "en-US": "Open workspace" },
  "shortcuts.openWorkspaceHint": {
    "zh-CN": "选择一个项目目录",
    "en-US": "pick a project folder",
  },
  "shortcuts.sendMessage": { "zh-CN": "发送消息 · 启动任务", "en-US": "Send message · Run task" },
  "shortcuts.sendMessageHint": {
    "zh-CN": "把 composer 提交给 Agent",
    "en-US": "submit the composer to the agent",
  },
  "shortcuts.stopRun": { "zh-CN": "停止 Agent", "en-US": "Stop the agent" },
  "shortcuts.stopRunHint": {
    "zh-CN": "取消运行 · 阶段之间设有 checkpoint",
    "en-US": "cancel — checkpointed between phases",
  },
  "shortcuts.approvePatch": { "zh-CN": "批准补丁", "en-US": "Approve patch" },
  "shortcuts.approvePatchHint": {
    "zh-CN": "应用提议的 diff · 仅在等待审批时生效",
    "en-US": "apply the proposed diff · only while awaiting",
  },
  "shortcuts.rejectPatch": { "zh-CN": "拒绝补丁", "en-US": "Reject patch" },
  "shortcuts.rejectPatchHint": {
    "zh-CN": "把意见发回 Agent",
    "en-US": "send the agent back with feedback",
  },
  "shortcuts.rollback": { "zh-CN": "回滚上一次运行", "en-US": "Rollback last run" },
  "shortcuts.rollbackHint": {
    "zh-CN": "恢复到写入前的快照",
    "en-US": "restore the pre-write snapshot",
  },
  "shortcuts.quickPrefs": { "zh-CN": "快速偏好", "en-US": "Quick preferences" },
  "shortcuts.quickPrefsHint": {
    "zh-CN": "主题 · 语言 · 字号 浮层",
    "en-US": "theme · language · font-size popover",
  },
  "shortcuts.openSettings": { "zh-CN": "打开设置", "en-US": "Open settings" },
  "shortcuts.openSettingsHint": { "zh-CN": "本面板", "en-US": "this panel" },

  // ─────────────  Topbar  ─────────────
  "topbar.switchWorkspace": { "zh-CN": "切换工作区", "en-US": "Switch workspace" },
  "topbar.openWorkspace": { "zh-CN": "打开工作区", "en-US": "Open a workspace" },
  "topbar.noWorkspace": { "zh-CN": "未打开工作区", "en-US": "No workspace open" },
  "topbar.switchModel": { "zh-CN": "切换模型", "en-US": "Switch model" },
  "topbar.noModel": { "zh-CN": "未选择模型", "en-US": "no model" },
  "topbar.connected": { "zh-CN": "已连接", "en-US": "connected" },
  "topbar.notConfigured": { "zh-CN": "未配置", "en-US": "not configured" },
  "topbar.settings": { "zh-CN": "设置", "en-US": "Settings" },
  "topbar.runHash": { "zh-CN": "运行", "en-US": "run" },
  "topbar.iter": { "zh-CN": "迭代", "en-US": "iter" },
  "topbar.collapseLeft": { "zh-CN": "收起左侧栏", "en-US": "Collapse left sidebar" },
  "topbar.expandLeft": { "zh-CN": "展开左侧栏", "en-US": "Expand left sidebar" },
  "topbar.collapseRight": { "zh-CN": "收起右侧栏", "en-US": "Collapse right panel" },
  "topbar.expandRight": { "zh-CN": "展开右侧栏", "en-US": "Expand right panel" },
  "topbar.workbench": { "zh-CN": "工作台", "en-US": "Workbench" },
  "topbar.workbenchTitle": {
    "zh-CN": "打开工作台 · 长期记忆 / 任务 / 角色 / 风格 / 学习",
    "en-US": "Open the workbench · memory / tasks / roles / style / learning",
  },

  // ─────────────  EmptyView / cover  ─────────────
  "empty.runbookCover": { "zh-CN": "运行手册 · 封面", "en-US": "runbook · cover" },
  "empty.pageLabel": { "zh-CN": "p. 001", "en-US": "p. 001" },
  "empty.titleA": { "zh-CN": "全新的", "en-US": "A new" },
  "empty.titleB": { "zh-CN": "运行手册。", "en-US": "runbook." },
  "empty.lede": {
    "zh-CN":
      "把这本手册绑定到一个项目目录。每次对话、每个 diff、每次回滚都会被写进这本手册——一次运行一页，页面可干净撕下。",
    "en-US":
      "Bind this notebook to a project folder. Every conversation, every diff, every rollback gets written into the book — one entry per run. Pages tear out cleanly.",
  },
  "empty.bindProject": { "zh-CN": "绑定一个项目", "en-US": "Bind a project" },
  "empty.opening": { "zh-CN": "正在打开…", "en-US": "Opening…" },
  "empty.dropFolder": { "zh-CN": "把文件夹拖到这里", "en-US": "Drop a folder here" },
  "empty.dropSub": {
    "zh-CN": "或点击浏览 · 任意本地项目 · 数据不会离开本机",
    "en-US": "or click to browse · any local project · nothing leaves your machine",
  },
  "empty.recent": { "zh-CN": "继续之前的工作", "en-US": "Pick up where you left off" },
  "empty.footSigned": {
    "zh-CN": "未签字之前，不会写入任何内容",
    "en-US": "nothing is written until you sign for it",
  },
  "empty.footSnapshots": {
    "zh-CN": "每次改动都有快照 · 每次运行可回滚",
    "en-US": "every change snapshots · every run reverses",
  },

  // ─────────────  Relative time  ─────────────
  "time.justNow": { "zh-CN": "刚刚", "en-US": "just now" },
  "time.secondsAgo": { "zh-CN": "{n} 秒前", "en-US": "{n}s ago" },
  "time.minutesAgo": { "zh-CN": "{n} 分钟前", "en-US": "{n}m ago" },
  "time.hoursAgo": { "zh-CN": "{n} 小时前", "en-US": "{n}h ago" },
  "time.daysAgo": { "zh-CN": "{n} 天前", "en-US": "{n}d ago" },

  // ─────────────  ThreadsSidebar  ─────────────
  "threads.new": { "zh-CN": "新建运行", "en-US": "New run" },
  "threads.search": { "zh-CN": "搜索运行…", "en-US": "Search runs…" },
  "threads.clear": { "zh-CN": "清空", "en-US": "Clear" },
  "threads.clearTitle": {
    "zh-CN": "清空此工作区的所有运行",
    "en-US": "Clear all runs in this workspace",
  },
  "threads.clearConfirm": {
    "zh-CN": "确定要删除此工作区的全部 {n} 条运行吗？此操作不可撤销。",
    "en-US":
      "Delete all {n} runs for this workspace? This cannot be undone.",
  },
  "threads.empty": {
    "zh-CN": "暂无运行。在上方输入任务开始一次。",
    "en-US": "No runs yet. Start one with a task above.",
  },
  "threads.untitled": { "zh-CN": "（未命名运行）", "en-US": "(untitled run)" },
  "threads.pill.awaiting": { "zh-CN": "待批准", "en-US": "awaiting" },
  "threads.pill.live": { "zh-CN": "进行中", "en-US": "live" },
  "threads.history": { "zh-CN": "历史记录", "en-US": "History" },
  "threads.group.today": { "zh-CN": "今天", "en-US": "today" },
  "threads.group.yesterday": { "zh-CN": "昨天", "en-US": "yesterday" },
  "threads.group.thisWeek": { "zh-CN": "本周", "en-US": "this week" },
  "threads.group.older": { "zh-CN": "更早", "en-US": "older" },
  "threads.meta.applied": { "zh-CN": "已应用", "en-US": "applied" },
  "threads.meta.failed": { "zh-CN": "失败", "en-US": "failed" },
  "threads.meta.overBudget": { "zh-CN": "超出预算", "en-US": "over budget" },
  "threads.meta.stopped": { "zh-CN": "已停止", "en-US": "stopped" },
  "threads.meta.awaiting": { "zh-CN": "待批准", "en-US": "awaiting" },

  // ─────────────  DockerInstallModal  ─────────────
  "docker.sandboxUnavailable": { "zh-CN": "沙箱不可用", "en-US": "Sandbox unavailable" },
  "docker.required": {
    "zh-CN": "为了安全运行，需要 Docker",
    "en-US": "Docker is required for safe operation",
  },
  "docker.body": {
    "zh-CN":
      "本代码 Agent 会在你的工作区中运行命令并修改文件。如果没有容器沙箱，任何工具调用——测试运行器、构建脚本、生成的代码——都会以你的账户权限直接在你的机器上执行。",
    "en-US":
      "This coding agent runs commands and edits files in your workspace. Without a container sandbox, any tool call—test runners, build scripts, generated code—executes directly on your machine with the full permissions of your user account.",
  },
  "docker.bodyDirect": { "zh-CN": "直接在你的机器上", "en-US": "directly on your machine" },
  "docker.risk1": {
    "zh-CN": "有缺陷或恶意的工具可能删除你有访问权限的任意位置的文件",
    "en-US": "A buggy or malicious tool can delete files anywhere you have access",
  },
  "docker.risk2": {
    "zh-CN": "工作区之外的凭证和 SSH 密钥都能被读取",
    "en-US": "Credentials and SSH keys outside the workspace are reachable",
  },
  "docker.risk3": {
    "zh-CN": "网络出站不受限制——存在泄露和外传的风险",
    "en-US": "Network egress is unrestricted — leaks and exfiltration are possible",
  },
  "docker.recommendation": {
    "zh-CN":
      "安装 Docker Desktop，可以把每条命令都限制在一个临时容器内：工作区以挂载方式接入、网络默认禁用。这正是 Claude Code 在 Linux/macOS 上使用的隔离方式。",
    "en-US":
      "Install Docker Desktop to confine every command to an ephemeral container with the workspace bind-mounted and the network blocked by default. This is the same isolation Claude Code uses on Linux/macOS.",
  },
  "docker.recommendationStrong": {
    "zh-CN": "安装 Docker Desktop",
    "en-US": "Install Docker Desktop",
  },
  "docker.probeFailed": { "zh-CN": "上次探测失败：", "en-US": "Last probe failed:" },
  "docker.daemonStopped": {
    "zh-CN":
      "已找到 Docker CLI（{version}），但守护进程未运行。请启动 Docker Desktop 后点击\"重新检测\"。",
    "en-US":
      "Docker CLI found ({version}) but the daemon isn't running. Start Docker Desktop and click \"Re-check\".",
  },
  "docker.skip": { "zh-CN": "跳过并接受风险", "en-US": "Skip and accept the risk" },
  "docker.skipTitle": {
    "zh-CN": "在清除前会禁用 run_command、apply_patch、write_file",
    "en-US": "Disables run_command, apply_patch, write_file until cleared",
  },
  "docker.recheck": { "zh-CN": "重新检测", "en-US": "Re-check" },
  "docker.rechecking": { "zh-CN": "正在检测…", "en-US": "Re-checking…" },
  "docker.install": { "zh-CN": "安装 Docker Desktop", "en-US": "Install Docker Desktop" },
  "docker.close": { "zh-CN": "关闭", "en-US": "Close" },
  "docker.start": { "zh-CN": "启动 Docker 并进入", "en-US": "Start Docker & continue" },
  "docker.starting": { "zh-CN": "正在启动…", "en-US": "Starting…" },
  "docker.startingBody": {
    "zh-CN": "正在启动 Docker Desktop 并等待守护进程就绪——通常需要 30 至 90 秒。准备就绪后本窗口将自动关闭。",
    "en-US":
      "Launching Docker Desktop and waiting for the daemon — usually 30–90 seconds. This window will close automatically once it's ready.",
  },
  "docker.startFailed": {
    "zh-CN": "未能启动 Docker：{error}。请尝试手动启动 Docker Desktop，然后点击重新检测。",
    "en-US":
      "Couldn't start Docker: {error}. Try launching Docker Desktop manually, then click Re-check.",
  },

  // ─────────────  DockerStatusBadge  ─────────────
  "docker.notInstalled": { "zh-CN": "未安装 Docker", "en-US": "Docker not installed" },
  "docker.notRunning": { "zh-CN": "Docker 未运行", "en-US": "Docker not running" },
  "docker.degraded": { "zh-CN": "受限模式", "en-US": "degraded" },
  "docker.badge.degradedTitle": {
    "zh-CN": "{label} · 当前为受限模式（不安全工具已禁用）。点击查看详情。",
    "en-US":
      "{label} · running in degraded mode (unsafe tools disabled). Click to review.",
  },
  "docker.badge.installTitle": {
    "zh-CN": "{label} · 点击打开安装指南",
    "en-US": "{label} · click to open the install guide",
  },

  // ─────────────  ApprovalSheet  ─────────────
  "approval.crumb.project": { "zh-CN": "项目", "en-US": "project" },
  "approval.crumb.patch": { "zh-CN": "补丁", "en-US": "patch" },
  "approval.crumb.runbook": { "zh-CN": "运行手册", "en-US": "runbook" },
  "approval.headingA": { "zh-CN": "一次改动，", "en-US": "A change," },
  "approval.headingB": { "zh-CN": "已签字并应用。", "en-US": "signed and applied." },
  "approval.subtitleFallback": {
    "zh-CN": "本次运行提议一处改动。",
    "en-US": "This run proposes a change.",
  },
  "approval.subtitleAfter": {
    "zh-CN": "写入前会生成快照；每次编辑都可通过上方运行头部完全回滚。",
    "en-US":
      "A snapshot is taken before write; every edit is fully reversible from the run header above.",
  },
  "approval.label.summary": { "zh-CN": "摘要", "en-US": "Summary" },
  "approval.label.files": { "zh-CN": "文件", "en-US": "Files" },
  "approval.label.patch": { "zh-CN": "补丁", "en-US": "Patch" },
  "approval.label.signOff": { "zh-CN": "签字", "en-US": "Sign-off" },
  "approval.linesAdded": { "zh-CN": "+{n} 行新增", "en-US": "+{n} lines" },
  "approval.linesRemoved": { "zh-CN": "−{n} 行删除", "en-US": "−{n} lines" },
  "approval.snapshot": { "zh-CN": "快照 · 自动", "en-US": "snapshot · auto" },
  "approval.fileSingular": { "zh-CN": "个文件", "en-US": "file" },
  "approval.filePlural": { "zh-CN": "个文件", "en-US": "files" },
  "approval.newSuffix": { "zh-CN": " · 新增 {n}", "en-US": " · {n} new" },
  "approval.moreFiles": {
    "zh-CN": "本次补丁还有 {n} 个文件",
    "en-US": "+{n} more files in this patch",
  },
  "approval.initial": {
    "zh-CN": "在下方签字以确认你已审阅本次改动。",
    "en-US": "Initial here to confirm you've reviewed the change.",
  },
  "approval.initialPlaceholder": { "zh-CN": "你的姓名缩写", "en-US": "your initials" },
  "approval.signAria": { "zh-CN": "用姓名缩写签字", "en-US": "Sign with your initials" },
  "approval.reversibleStrong": { "zh-CN": "完全可回滚", "en-US": "fully reversible" },
  "approval.reversibleHint": {
    "zh-CN": "在运行头部点击一次即可恢复写入前的快照",
    "en-US": "one click in the run header restores the pre-write snapshot",
  },
  "approval.reject": { "zh-CN": "拒绝", "en-US": "Reject" },
  "approval.askChanges": { "zh-CN": "请求修改…", "en-US": "Ask for changes…" },
  "approval.apply": { "zh-CN": "签字并应用", "en-US": "Sign & apply" },
  "approval.close": { "zh-CN": "关闭", "en-US": "Close" },

  // ─────────────  ChatRunView (status / composer / banners)  ─────────────
  "chat.stop": { "zh-CN": "停止运行", "en-US": "Stop run" },
  "chat.rollback": { "zh-CN": "回滚已应用的改动", "en-US": "Rollback applied changes" },
  "chat.budgetExceeded": { "zh-CN": "超出预算", "en-US": "Budget exceeded" },
  "chat.failed": { "zh-CN": "失败", "en-US": "Failed" },
  "chat.stopped": { "zh-CN": "已停止", "en-US": "Stopped" },
  "chat.cancelled": { "zh-CN": "运行已取消", "en-US": "the run was cancelled" },
  "chat.applied": { "zh-CN": "已应用", "en-US": "Applied" },
  "chat.composer.replyOrApprove": {
    "zh-CN": "回复、请求修改，或在上方打开补丁批准…",
    "en-US": "Reply, ask for changes, or open the patch above to approve…",
  },
  "chat.composer.inProgress": {
    "zh-CN": "运行进行中 — 你可以介入，Agent 会响应…",
    "en-US": "Run in progress — interject and the agent will react…",
  },
  "chat.composer.followUp": {
    "zh-CN": "描述一个后续任务…",
    "en-US": "Describe a follow-up task…",
  },
  "chat.attachTitle": { "zh-CN": "附加文件（即将推出）", "en-US": "Attach file (coming soon)" },
  "chat.attachAria": { "zh-CN": "附加文件", "en-US": "Attach file" },
  "chat.hintSend": { "zh-CN": "Ctrl+↵ 运行 · ↑ 回溯", "en-US": "Ctrl+↵ to run · ↑ recall" },

  // ─────────────  Toast messages  ─────────────
  "toast.patchApplied": { "zh-CN": "补丁已应用", "en-US": "Patch applied" },
  "toast.patchRejected": { "zh-CN": "补丁已拒绝", "en-US": "Patch rejected" },
  "toast.rolledBack": { "zh-CN": "已回滚", "en-US": "Rolled back" },
  "toast.noRunsToClear": { "zh-CN": "无可清空的运行", "en-US": "No runs to clear" },
  "toast.clearedRuns": { "zh-CN": "已清空 {n} 条运行", "en-US": "Cleared {n} runs" },
  "toast.clearedRun": { "zh-CN": "已清空 1 条运行", "en-US": "Cleared 1 run" },
  "toast.switchedModel": { "zh-CN": "已切换到 {model}", "en-US": "Switched to {model}" },

  // ─────────────  NewRunCompose  ─────────────
  "compose.bound": { "zh-CN": "已绑定", "en-US": "bound" },
  "compose.headingA": { "zh-CN": "Agent 接下来应该", "en-US": "What should the agent" },
  "compose.headingB": { "zh-CN": "做什么？", "en-US": "do next?" },
  "compose.lede": {
    "zh-CN":
      "用自然语言描述任务。Agent 会规划、搜索、编辑并提议一个补丁——在你签字之前，不会写入磁盘。",
    "en-US":
      "Describe a task in plain language. The agent plans, searches, edits, and proposes a patch — you sign before anything writes to disk.",
  },
  "compose.placeholder": {
    "zh-CN": "例如：给 packages/shared 中的 parseConfig 加一个单元测试",
    "en-US": "e.g. add a unit test for parseConfig in packages/shared",
  },
  "compose.hintStart": {
    "zh-CN": "Ctrl+↵ 开始运行",
    "en-US": "Ctrl+↵ to start the run",
  },
  "compose.start": { "zh-CN": "开始运行", "en-US": "Start run" },
  "compose.openWorkspaceFirst": { "zh-CN": "请先打开工作区", "en-US": "Open a workspace first" },
} as const;

export type I18nKey = keyof typeof STRINGS;

export function t(key: I18nKey, lang: LanguagePreference): string {
  return STRINGS[key]?.[lang] ?? key;
}

/**
 * Interpolate `{name}` placeholders in a translated string. Values are stringified
 * with String() — pass numbers, strings, anything that has a sensible toString.
 *
 *   format(t("threads.clearConfirm", lang), { n: runs.length })
 */
export function format(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** Combo: translate a key and interpolate placeholders in one call. */
export function tf(
  key: I18nKey,
  lang: LanguagePreference,
  values: Record<string, string | number>,
): string {
  return format(t(key, lang), values);
}
