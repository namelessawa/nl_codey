import type {
  LLMCompleteInput,
  LLMCompleteOutput,
  LLMMessage,
  LLMProvider,
} from "@coding-agent/shared";
import { withTimeout, redactError } from "./http.js";

export type AnthropicConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutSeconds: number;
};

const ANTHROPIC_VERSION = "2023-06-01";

type MessagesResponse = {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
};

/**
 * Anthropic provider using the native /v1/messages API. System prompts are
 * passed via the top-level `system` field (not as a message), per the API.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly config: AnthropicConfig;

  constructor(config: AnthropicConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required for provider "anthropic". Open Settings to configure it.');
    }
    if (!config.baseUrl) {
      throw new Error('Base URL is required for provider "anthropic".');
    }
    if (!config.model) {
      throw new Error('Model name is required for provider "anthropic".');
    }
    this.config = config;
  }

  async complete(input: LLMCompleteInput): Promise<LLMCompleteOutput> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/messages`;
    const system = input.messages
      .filter((m: LLMMessage) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = input.messages
      .filter((m: LLMMessage) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const body = {
      model: this.config.model,
      max_tokens: input.maxTokens ?? this.config.maxTokens,
      temperature: input.temperature ?? this.config.temperature,
      ...(system ? { system } : {}),
      messages,
    };

    let res: Response;
    try {
      res = await withTimeout(
        (signal) =>
          fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": this.config.apiKey,
              "anthropic-version": ANTHROPIC_VERSION,
            },
            body: JSON.stringify(body),
            signal,
          }),
        this.config.timeoutSeconds,
        input.signal,
      );
    } catch (err) {
      throw new Error(redactError("anthropic request failed", err, this.config.apiKey));
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        redactError(`anthropic API error ${res.status}`, detail.slice(0, 500), this.config.apiKey),
      );
    }

    const json = (await res.json()) as MessagesResponse;
    if (json.error?.message) {
      throw new Error(redactError("anthropic API error", json.error.message, this.config.apiKey));
    }
    const text = json.content?.find((c) => c.type === "text")?.text;
    if (typeof text !== "string") {
      throw new Error("anthropic API returned no completion text");
    }
    return { text };
  }
}
