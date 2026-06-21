/**
 * CLI-side settings reader. Reads the non-secret part of `~/.nlc/settings.json`
 * (the same file the GUI writes) and resolves the API key from environment
 * variables — the GUI encrypts it via Electron `safeStorage`, which the CLI
 * has no access to, so we deliberately do NOT try to decrypt `apikey.bin`.
 *
 * Precedence for the API key:
 *   1. `NLC_API_KEY`            — explicit override, any provider
 *   2. `ANTHROPIC_API_KEY`      — when provider=anthropic
 *   3. `OPENAI_API_KEY`         — when provider=openai/openai-compat
 *   4. `DEEPSEEK_API_KEY`       — when provider=deepseek
 *   5. `OPENROUTER_API_KEY`     — when provider=openrouter
 *   6. `GEMINI_API_KEY`         — when provider=gemini
 *   7. `<provider>_API_KEY`     — generic fallback
 * If none is set, an empty string is returned and the agent service will
 * fall back to the env mock provider (mirroring the GUI's first-run behaviour
 * without a configured key).
 */
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  providerProtocolToId,
  toLLMConfig,
  type AppSettings,
  type LLMConfig,
} from "@nlc/shared";
import { activeProvider, loadProviderStore } from "./provider-store.js";

export type CliSettings = {
  /** Effective merged settings (with the resolved API key spliced in). */
  appSettings: AppSettings;
  /** True when an API key was found in the environment. */
  apiKeyFromEnv: boolean;
  /** True when a CLI-managed provider override was active. */
  providerFromStore: boolean;
};

export function loadCliSettings(dataRoot: string): CliSettings {
  const file = path.join(dataRoot, "settings.json");
  let base = DEFAULT_SETTINGS;
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      base = mergeSettings(parsed);
    }
  } catch {
    base = DEFAULT_SETTINGS;
  }
  // CLI-managed provider override wins over settings.json — that's the
  // whole point of /provider. The store path lives next to settings.json
  // and is only read here; settings.json itself stays GUI-owned.
  const override = activeProvider(loadProviderStore(dataRoot));
  if (override) {
    const effectiveProvider = providerProtocolToId(override.protocol);
    base = {
      ...base,
      llm: {
        ...base.llm,
        provider: effectiveProvider,
        baseUrl: override.baseUrl,
        model: override.model,
      },
    };
    if (override.apiKey.length > 0) {
      base = { ...base, llm: { ...base.llm, apiKey: override.apiKey } };
    }
  }
  // Env fallback only when neither settings.json nor the CLI store
  // produced an API key.
  const apiKey =
    base.llm.apiKey.length > 0 ? base.llm.apiKey : resolveApiKey(base.llm.provider);
  return {
    appSettings: { ...base, llm: { ...base.llm, apiKey } },
    apiKeyFromEnv: base.llm.apiKey.length === 0 && apiKey.length > 0,
    providerFromStore: override !== null,
  };
}

export function cliLlmConfig(settings: CliSettings): LLMConfig {
  return toLLMConfig(settings.appSettings.llm);
}

function resolveApiKey(provider: string): string {
  const env = process.env;
  if (env.NLC_API_KEY) return env.NLC_API_KEY;
  const map: Record<string, string | undefined> = {
    anthropic: env.ANTHROPIC_API_KEY,
    openai: env.OPENAI_API_KEY,
    "openai-compat": env.OPENAI_API_KEY,
    deepseek: env.DEEPSEEK_API_KEY,
    openrouter: env.OPENROUTER_API_KEY,
    gemini: env.GEMINI_API_KEY,
  };
  const direct = map[provider];
  if (direct) return direct;
  const generic = env[`${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`];
  return generic ?? "";
}
