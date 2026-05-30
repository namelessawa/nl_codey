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
  "agent.maxAutoSteps": { "zh-CN": "最大连续自动执行步数", "en-US": "Max auto steps" },
  "agent.sandbox": { "zh-CN": "启用沙箱模式", "en-US": "Sandbox mode" },

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
} as const;

export type I18nKey = keyof typeof STRINGS;

export function t(key: I18nKey, lang: LanguagePreference): string {
  return STRINGS[key]?.[lang] ?? key;
}
