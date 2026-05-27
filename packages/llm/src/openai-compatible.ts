import type {
  LLMCompleteInput,
  LLMCompleteOutput,
  LLMProvider,
} from "@coding-agent/shared";
import { withTimeout, redactError } from "./http.js";

export type OpenAICompatibleConfig = {
  /** Provider id, used only for the human-readable provider name. */
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutSeconds: number;
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

/**
 * Generic provider for any OpenAI-compatible /chat/completions endpoint:
 * OpenAI, DeepSeek, OpenRouter, Google Gemini (OpenAI-compat base URL), and
 * user-defined Custom providers. No SDK dependency — plain fetch.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private readonly config: OpenAICompatibleConfig;

  constructor(config: OpenAICompatibleConfig) {
    if (!config.apiKey) {
      throw new Error(`API key is required for provider "${config.name}". Open Settings to configure it.`);
    }
    if (!config.baseUrl) {
      throw new Error(`Base URL is required for provider "${config.name}".`);
    }
    if (!config.model) {
      throw new Error(`Model name is required for provider "${config.name}".`);
    }
    this.config = config;
    this.name = config.name;
  }

  async complete(input: LLMCompleteInput): Promise<LLMCompleteOutput> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const body = {
      model: this.config.model,
      messages: input.messages,
      temperature: input.temperature ?? this.config.temperature,
      max_tokens: input.maxTokens ?? this.config.maxTokens,
      stream: false,
    };

    let res: Response;
    try {
      res = await withTimeout(
        (signal) =>
          fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify(body),
            signal,
          }),
        this.config.timeoutSeconds,
        input.signal,
      );
    } catch (err) {
      // Never let the key reach an error string (it can't here, but be defensive).
      throw new Error(redactError(`${this.name} request failed`, err, this.config.apiKey));
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        redactError(`${this.name} API error ${res.status}`, detail.slice(0, 500), this.config.apiKey),
      );
    }

    const json = (await res.json()) as ChatResponse;
    if (json.error?.message) {
      throw new Error(redactError(`${this.name} API error`, json.error.message, this.config.apiKey));
    }
    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new Error(`${this.name} API returned no completion text`);
    }
    return { text };
  }
}
