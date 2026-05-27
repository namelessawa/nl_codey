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
} as const;

export type I18nKey = keyof typeof STRINGS;

export function t(key: I18nKey, lang: LanguagePreference): string {
  return STRINGS[key]?.[lang] ?? key;
}
