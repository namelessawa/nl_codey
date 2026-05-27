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

export type ThemePreference = "system" | "light" | "dark";
export type LanguagePreference = "zh-CN" | "en-US";
export type FontSizePreference = "small" | "medium" | "large";

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
};

export type UISettings = {
  theme: ThemePreference;
  language: LanguagePreference;
  fontSize: FontSizePreference;
};

export type AppSettings = {
  llm: LLMSettings;
  agent: AgentSettings;
  ui: UISettings;
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
} as const;

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
  },
  ui: {
    theme: "system",
    language: "zh-CN",
    fontSize: "medium",
  },
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
  };
}
