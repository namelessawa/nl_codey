import type { ChatLLMProvider, LLMConfig } from "@nlc/shared";
import { OPENAI_COMPATIBLE_PROVIDERS } from "@nlc/shared";
import { MockLLMProvider } from "./mock.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { AnthropicProvider } from "./anthropic.js";

/**
 * Build the active provider from an LLMConfig (sourced from app settings).
 * Throws a readable error if required fields are missing — callers should
 * surface this to the user rather than crashing.
 */
export function createLLMProvider(config: LLMConfig): ChatLLMProvider {
  if (config.provider === "anthropic") {
    return new AnthropicProvider({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      timeoutSeconds: config.timeoutSeconds,
    });
  }

  if (OPENAI_COMPATIBLE_PROVIDERS.includes(config.provider)) {
    return new OpenAICompatibleProvider({
      name: config.provider,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      timeoutSeconds: config.timeoutSeconds,
    });
  }

  throw new Error(`Unknown LLM provider: ${config.provider}`);
}

/**
 * Legacy env-based factory, kept for headless/dev runs without configured
 * settings. `LLM_PROVIDER=mock` (default) needs no API key.
 */
export function createLLMProviderFromEnv(env: NodeJS.ProcessEnv = process.env): ChatLLMProvider {
  const selected = (env.LLM_PROVIDER ?? "mock").toLowerCase();
  if (selected === "mock") return new MockLLMProvider();
  if (selected === "deepseek") {
    return createLLMProvider({
      provider: "deepseek",
      apiKey: env.DEEPSEEK_API_KEY ?? "",
      baseUrl: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      model: env.DEEPSEEK_MODEL ?? "deepseek-chat",
      temperature: 0.2,
      maxTokens: 4096,
      timeoutSeconds: 60,
    });
  }
  return new MockLLMProvider();
}
