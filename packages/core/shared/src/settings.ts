/**
 * Application settings: the single source of truth for LLM, agent, and UI
 * configuration. Types and pure helpers live here so main, renderer, and the
 * llm package all agree on the shape. Persistence + secret storage live in the
 * Electron main process (see apps/desktop/src/main/settings).
 */

export type LLMProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "openrouter"
  | "custom";

/** Providers that speak the OpenAI-compatible /chat/completions protocol. */
export const OPENAI_COMPATIBLE_PROVIDERS: readonly LLMProviderId[] = [
  "openai",
  "gemini",
  "deepseek",
  "openrouter",
  "custom",
];

import type { SandboxMode } from "./sandbox.js";

export type ThemePreference = "system" | "light" | "dark";
export type LanguagePreference = "zh-CN" | "en-US";
export type FontSizePreference = "small" | "medium" | "large";
export type DensityPreference = "comfy" | "compact";

/** Allowed sandbox modes for settings validation; mirrors {@link SandboxMode}. */
export const SANDBOX_MODES: readonly SandboxMode[] = ["whitelist", "wsl", "docker"];
export const DENSITY_VALUES: readonly DensityPreference[] = ["comfy", "compact"];

export type LLMSettings = {
  provider: LLMProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutSeconds: number;
};

export type AgentSettings = {
  workspacePath: string;
  allowShellExecution: boolean;
  requireConfirmationBeforeCommand: boolean;
  maxAutoSteps: number;
  sandboxEnabled: boolean;
  /** Execution backend when sandboxing is on. UI-driven; backend may treat
   *  unsupported values as a fall-through to "whitelist" until WSL/Docker
   *  drivers land. */
  sandboxMode: SandboxMode;
  /** Dollar ceiling per run. Hard-capped at $5 by validation. */
  budgetUsd: number;
  /**
   * Query-only mode (instruction mode): file-mutating tools (apply_patch /
   * write_file) are stripped from the LLM schema and hard-refused at
   * dispatch. The agent can read, search, list, run validation commands —
   * but never modify or delete a file. Default `false` (full read/write).
   */
  readOnly: boolean;
  /**
   * Opt-in multi-agent mode. When `true`, AgentService routes runs through
   * the Phase 3 Coordinator (Planner → Coder → Reviewer) with role-specific
   * tool subsets and structured role messages, instead of the single-agent
   * tool loop. Default `false` so the long-standing single-agent behaviour is
   * preserved; users who want orchestration explicitly opt in.
   */
  multiAgentEnabled: boolean;
};

export type UISettings = {
  theme: ThemePreference;
  language: LanguagePreference;
  fontSize: FontSizePreference;
  density: DensityPreference;
  /** Whether to render the plan→search→patch→verify strip during a run. */
  showPipeline: boolean;
  /** When true, hides animations and pulsing indicators. */
  reduceMotion: boolean;
  /**
   * When true, the main shell cross-fades between EmptyView / NewRunCompose /
   * ChatRunView and the right panel animates its contents on swap. Subordinate
   * to {@link reduceMotion} — turning motion off disables transitions regardless.
   */
  smoothTransitions: boolean;
};

/** Map of action id → key combo (e.g. "Ctrl+Enter"). Empty string = unbound. */
export type ShortcutBindings = Record<string, string>;

export type AppSettings = {
  llm: LLMSettings;
  agent: AgentSettings;
  ui: UISettings;
  shortcuts: ShortcutBindings;
};

/**
 * Subset consumed by the llm package to build a provider. Decoupled from the
 * full AppSettings so the llm package never imports agent/ui concerns.
 */
export type LLMConfig = {
  provider: LLMProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutSeconds: number;
};

/** Default base URL + a sensible model per provider. */
export const PROVIDER_PRESETS: Record<
  LLMProviderId,
  { baseUrl: string; defaultModel: string }
> = {
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o" },
  anthropic: { baseUrl: "https://api.anthropic.com", defaultModel: "claude-3-5-sonnet-latest" },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-1.5-pro",
  },
  deepseek: { baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-chat" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4o" },
  custom: { baseUrl: "", defaultModel: "" },
};

export const SETTINGS_LIMITS = {
  temperatureMin: 0,
  temperatureMax: 2,
  maxTokensMin: 1,
  maxTokensMax: 200_000,
  timeoutSecondsMin: 1,
  timeoutSecondsMax: 600,
  maxAutoStepsMin: 1,
  maxAutoStepsMax: 100,
  budgetUsdMin: 0,
  budgetUsdMax: 5,
} as const;

export const DEFAULT_SHORTCUTS: ShortcutBindings = {
  "new-run": "Ctrl+N",
  "open-workspace": "Ctrl+O",
  "send-message": "Ctrl+Enter",
  "stop-run": "Esc",
  "approve-patch": "Ctrl+Enter",
  "reject-patch": "Ctrl+Backspace",
  "open-diff": "Ctrl+D",
  rollback: "Ctrl+Shift+Z",
  "quick-prefs": "Ctrl+,",
  "open-settings": "Ctrl+;",
  "search-history": "Ctrl+K",
  palette: "Ctrl+Shift+P",
  "next-thread": "Ctrl+]",
  "prev-thread": "Ctrl+[",
  "recall-last": "ArrowUp",
};

export const DEFAULT_SETTINGS: AppSettings = {
  llm: {
    provider: "deepseek",
    apiKey: "",
    baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
    model: "deepseek-chat",
    temperature: 0.2,
    maxTokens: 4096,
    timeoutSeconds: 60,
  },
  agent: {
    workspacePath: "",
    allowShellExecution: false,
    requireConfirmationBeforeCommand: true,
    maxAutoSteps: 10,
    sandboxEnabled: true,
    sandboxMode: "whitelist",
    budgetUsd: 1.0,
    readOnly: false,
    multiAgentEnabled: false,
  },
  ui: {
    theme: "system",
    language: "zh-CN",
    fontSize: "medium",
    density: "comfy",
    showPipeline: true,
    reduceMotion: false,
    smoothTransitions: true,
  },
  shortcuts: { ...DEFAULT_SHORTCUTS },
};

/** A single validation problem, keyed by a dotted field path. */
export type ValidationIssue = { field: string; message: string };
export type ValidationResult = { valid: boolean; issues: ValidationIssue[] };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate settings without throwing. API key may be empty (saving is allowed;
 * the missing-key check happens at call time). Base URL is required and must be
 * a valid http(s) URL.
 */
export function validateSettings(settings: AppSettings): ValidationResult {
  const issues: ValidationIssue[] = [];
  const { llm, agent } = settings;

  if (!llm.baseUrl.trim()) {
    issues.push({ field: "llm.baseUrl", message: "Base URL is required" });
  } else if (!isHttpUrl(llm.baseUrl.trim())) {
    issues.push({ field: "llm.baseUrl", message: "Base URL must be a valid http(s) URL" });
  }

  if (!llm.model.trim()) {
    issues.push({ field: "llm.model", message: "Model name is required" });
  }

  if (
    !isFiniteNumber(llm.temperature) ||
    llm.temperature < SETTINGS_LIMITS.temperatureMin ||
    llm.temperature > SETTINGS_LIMITS.temperatureMax
  ) {
    issues.push({
      field: "llm.temperature",
      message: `Temperature must be between ${SETTINGS_LIMITS.temperatureMin} and ${SETTINGS_LIMITS.temperatureMax}`,
    });
  }

  if (
    !Number.isInteger(llm.maxTokens) ||
    llm.maxTokens < SETTINGS_LIMITS.maxTokensMin ||
    llm.maxTokens > SETTINGS_LIMITS.maxTokensMax
  ) {
    issues.push({
      field: "llm.maxTokens",
      message: `Max tokens must be an integer between ${SETTINGS_LIMITS.maxTokensMin} and ${SETTINGS_LIMITS.maxTokensMax}`,
    });
  }

  if (
    !isFiniteNumber(llm.timeoutSeconds) ||
    llm.timeoutSeconds < SETTINGS_LIMITS.timeoutSecondsMin ||
    llm.timeoutSeconds > SETTINGS_LIMITS.timeoutSecondsMax
  ) {
    issues.push({
      field: "llm.timeoutSeconds",
      message: `Timeout must be between ${SETTINGS_LIMITS.timeoutSecondsMin} and ${SETTINGS_LIMITS.timeoutSecondsMax} seconds`,
    });
  }

  if (
    !Number.isInteger(agent.maxAutoSteps) ||
    agent.maxAutoSteps < SETTINGS_LIMITS.maxAutoStepsMin ||
    agent.maxAutoSteps > SETTINGS_LIMITS.maxAutoStepsMax
  ) {
    issues.push({
      field: "agent.maxAutoSteps",
      message: `Max auto steps must be an integer between ${SETTINGS_LIMITS.maxAutoStepsMin} and ${SETTINGS_LIMITS.maxAutoStepsMax}`,
    });
  }

  if (
    !isFiniteNumber(agent.budgetUsd) ||
    agent.budgetUsd < SETTINGS_LIMITS.budgetUsdMin ||
    agent.budgetUsd > SETTINGS_LIMITS.budgetUsdMax
  ) {
    issues.push({
      field: "agent.budgetUsd",
      message: `Budget must be between $${SETTINGS_LIMITS.budgetUsdMin} and $${SETTINGS_LIMITS.budgetUsdMax}`,
    });
  }

  if (!SANDBOX_MODES.includes(agent.sandboxMode)) {
    issues.push({
      field: "agent.sandboxMode",
      message: `Sandbox mode must be one of: ${SANDBOX_MODES.join(", ")}`,
    });
  }

  return { valid: issues.length === 0, issues };
}

/** Extract the provider-building subset from full settings. */
export function toLLMConfig(llm: LLMSettings): LLMConfig {
  return {
    provider: llm.provider,
    apiKey: llm.apiKey,
    baseUrl: llm.baseUrl,
    model: llm.model,
    temperature: llm.temperature,
    maxTokens: llm.maxTokens,
    timeoutSeconds: llm.timeoutSeconds,
  };
}

/**
 * Mask an API key for safe display/logging: keep at most the last 4 chars.
 * NEVER log or surface a raw key — route every exposure through this helper.
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey) return "(not set)";
  const tail = apiKey.slice(-4);
  return `${"•".repeat(Math.min(8, Math.max(0, apiKey.length - 4)))}${tail}`;
}

/** Deep-merge a partial (e.g. persisted on-disk JSON) onto defaults. */
export function mergeSettings(partial: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    llm: { ...DEFAULT_SETTINGS.llm, ...(partial?.llm ?? {}) },
    agent: { ...DEFAULT_SETTINGS.agent, ...(partial?.agent ?? {}) },
    ui: { ...DEFAULT_SETTINGS.ui, ...(partial?.ui ?? {}) },
    shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...(partial?.shortcuts ?? {}) },
  };
}
