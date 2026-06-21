/**
 * Preset LLM providers catalogued for the `/provider` picker.
 *
 * The catalogue is independent of {@link LLMProviderId} — the existing
 * union (`openai` / `anthropic` / `gemini` / `deepseek` / `openrouter` /
 * `custom`) defines the *transport* the runtime uses, while the preset
 * list defines the *vendor* the user picked. For everything that speaks
 * OpenAI-compatible (most domestic Chinese vendors do), we route through
 * the existing `custom` transport with the right `baseUrl` and `model`.
 *
 * Inspired by the provider list maintained by
 * https://github.com/songquanpeng/one-api — endpoints and default models
 * are best-effort and easy to override per-install via the `custom`
 * slots.
 */
import type { LLMProviderId } from "./settings.js";

export type ProviderProtocol = "openai-compat" | "anthropic" | "gemini";

export type PresetProvider = {
  /** Stable id used as the storage key. NOT shown to the user. */
  id: string;
  /** Human-readable label shown in the picker. */
  displayName: string;
  /** Short region tag for grouping in the picker. */
  region: "international" | "china" | "aggregator" | "self-hosted";
  /** Default API endpoint. The user can still edit it after picking. */
  baseUrl: string;
  /** Default model id. */
  defaultModel: string;
  /** Transport family — drives which {@link LLMProviderId} we persist. */
  protocol: ProviderProtocol;
  /**
   * Optional env var the runtime falls back to when the stored API key
   * is empty. Mirrors the lookup in `apps/cli/src/lib/settings.ts`.
   */
  envKey?: string;
  /** One-line description shown under the row in the picker. */
  hint?: string;
};

/**
 * Map a preset's protocol family to the {@link LLMProviderId} the
 * runtime understands. OpenAI-compatible providers all land on `custom`
 * (with their own baseUrl) so we don't have to widen `LLMProviderId`
 * every time a new Chinese vendor ships.
 */
export function providerProtocolToId(protocol: ProviderProtocol): LLMProviderId {
  if (protocol === "anthropic") return "anthropic";
  if (protocol === "gemini") return "gemini";
  return "custom";
}

/**
 * Preset catalogue. Curated, deliberately short on each row so the
 * picker stays scannable. Add more by extending this array — every
 * other surface (`/provider` UI, storage, runtime override) reads from
 * here without further changes.
 */
export const PRESET_PROVIDERS: readonly PresetProvider[] = [
  // ── International ─────────────────────────────────────────────────
  {
    id: "openai",
    displayName: "OpenAI",
    region: "international",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    protocol: "openai-compat",
    envKey: "OPENAI_API_KEY",
  },
  {
    id: "anthropic",
    displayName: "Anthropic (Claude)",
    region: "international",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-opus-4-7",
    protocol: "anthropic",
    envKey: "ANTHROPIC_API_KEY",
  },
  {
    id: "google-gemini",
    displayName: "Google Gemini",
    region: "international",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    protocol: "openai-compat",
    envKey: "GEMINI_API_KEY",
  },
  {
    id: "groq",
    displayName: "Groq",
    region: "international",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    protocol: "openai-compat",
    envKey: "GROQ_API_KEY",
  },
  {
    id: "mistral",
    displayName: "Mistral AI",
    region: "international",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    protocol: "openai-compat",
    envKey: "MISTRAL_API_KEY",
  },
  {
    id: "xai",
    displayName: "xAI (Grok)",
    region: "international",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-2",
    protocol: "openai-compat",
    envKey: "XAI_API_KEY",
  },
  {
    id: "cohere",
    displayName: "Cohere",
    region: "international",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    defaultModel: "command-r-plus",
    protocol: "openai-compat",
    envKey: "COHERE_API_KEY",
  },

  // ── China ────────────────────────────────────────────────────────
  {
    id: "deepseek",
    displayName: "DeepSeek 深度求索",
    region: "china",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    protocol: "openai-compat",
    envKey: "DEEPSEEK_API_KEY",
  },
  {
    id: "zhipu",
    displayName: "智谱 AI (GLM)",
    region: "china",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-plus",
    protocol: "openai-compat",
    envKey: "ZHIPU_API_KEY",
  },
  {
    id: "moonshot",
    displayName: "月之暗面 Kimi",
    region: "china",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-32k",
    protocol: "openai-compat",
    envKey: "MOONSHOT_API_KEY",
  },
  {
    id: "qwen",
    displayName: "通义千问 (DashScope)",
    region: "china",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-max",
    protocol: "openai-compat",
    envKey: "DASHSCOPE_API_KEY",
  },
  {
    id: "doubao",
    displayName: "字节豆包 (Volcengine Ark)",
    region: "china",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-pro-32k",
    protocol: "openai-compat",
    envKey: "ARK_API_KEY",
  },
  {
    id: "yi",
    displayName: "零一万物 Yi",
    region: "china",
    baseUrl: "https://api.lingyiwanwu.com/v1",
    defaultModel: "yi-large",
    protocol: "openai-compat",
    envKey: "YI_API_KEY",
  },
  {
    id: "baichuan",
    displayName: "百川智能 Baichuan",
    region: "china",
    baseUrl: "https://api.baichuan-ai.com/v1",
    defaultModel: "Baichuan4",
    protocol: "openai-compat",
    envKey: "BAICHUAN_API_KEY",
  },
  {
    id: "minimax",
    displayName: "MiniMax 海螺",
    region: "china",
    baseUrl: "https://api.minimax.chat/v1",
    defaultModel: "abab6.5-chat",
    protocol: "openai-compat",
    envKey: "MINIMAX_API_KEY",
  },
  {
    id: "stepfun",
    displayName: "阶跃星辰 StepFun",
    region: "china",
    baseUrl: "https://api.stepfun.com/v1",
    defaultModel: "step-1-32k",
    protocol: "openai-compat",
    envKey: "STEPFUN_API_KEY",
  },
  {
    id: "hunyuan",
    displayName: "腾讯混元",
    region: "china",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    defaultModel: "hunyuan-pro",
    protocol: "openai-compat",
    envKey: "HUNYUAN_API_KEY",
  },
  {
    id: "ernie",
    displayName: "百度文心 (千帆)",
    region: "china",
    baseUrl: "https://qianfan.baidubce.com/v2",
    defaultModel: "ernie-4.0-8k",
    protocol: "openai-compat",
    envKey: "QIANFAN_API_KEY",
  },
  {
    id: "spark",
    displayName: "讯飞星火",
    region: "china",
    baseUrl: "https://spark-api-open.xf-yun.com/v1",
    defaultModel: "generalv3.5",
    protocol: "openai-compat",
    envKey: "SPARK_API_KEY",
  },

  // ── Aggregators / Self-hosted ────────────────────────────────────
  {
    id: "openrouter",
    displayName: "OpenRouter",
    region: "aggregator",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o",
    protocol: "openai-compat",
    envKey: "OPENROUTER_API_KEY",
  },
  {
    id: "one-api",
    displayName: "One API (自部署)",
    region: "self-hosted",
    baseUrl: "http://localhost:3000/v1",
    defaultModel: "gpt-4o",
    protocol: "openai-compat",
    hint: "self-hosted one-api / new-api aggregator gateway",
  },
  {
    id: "ollama",
    displayName: "Ollama (本地)",
    region: "self-hosted",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "qwen2.5-coder:14b",
    protocol: "openai-compat",
    hint: "local Ollama daemon — no API key required",
  },
  {
    id: "lmstudio",
    displayName: "LM Studio (本地)",
    region: "self-hosted",
    baseUrl: "http://localhost:1234/v1",
    defaultModel: "local-model",
    protocol: "openai-compat",
    hint: "local LM Studio inference server",
  },
];

/** How many custom slots the picker exposes. */
export const CUSTOM_PROVIDER_SLOT_COUNT = 5;

/** Lookup a preset by id; null if not found. */
export function findPresetProvider(id: string): PresetProvider | null {
  return PRESET_PROVIDERS.find((p) => p.id === id) ?? null;
}

/** Storage key for a custom slot (e.g. `custom:1`). */
export function customSlotKey(slot: number): string {
  return `custom:${slot}`;
}

/** Inverse of {@link customSlotKey}; returns null when the key isn't a custom slot. */
export function parseCustomSlotKey(key: string): number | null {
  const m = /^custom:([1-9]\d?)$/.exec(key);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  if (n < 1 || n > CUSTOM_PROVIDER_SLOT_COUNT) return null;
  return n;
}
