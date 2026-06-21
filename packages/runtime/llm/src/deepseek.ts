import { OpenAICompatibleProvider } from "./openai-compatible.js";

export type DeepSeekConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

/**
 * Back-compat thin wrapper around {@link OpenAICompatibleProvider}. DeepSeek is
 * OpenAI-compatible, so the generic provider handles it; this preserves the
 * original Phase-1 API for any existing callers.
 */
export class DeepSeekLLMProvider extends OpenAICompatibleProvider {
  constructor(config: DeepSeekConfig) {
    super({
      name: "deepseek",
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      temperature: 0.2,
      maxTokens: 4096,
      timeoutSeconds: 60,
    });
  }
}
