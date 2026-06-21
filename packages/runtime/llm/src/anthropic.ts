import type {
  ChatLLMProvider,
  LLMChatInput,
  LLMChunk,
  LLMCompleteInput,
  LLMCompleteOutput,
  LLMFinishReason,
  LLMMessage,
  ToolSchema,
} from "@nlc/shared";
import { computeCostUsd, contextWindowFor, estimateMessageTokens, estimateTokens } from "@nlc/shared";
import { postWithRetries, redactError } from "./http.js";
import { sseData } from "./stream.js";

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

/** A streamed SSE event payload from /v1/messages with stream: true. */
type StreamEvent = {
  type?: string;
  index?: number;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  content_block?: { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { output_tokens?: number };
  error?: { message?: string };
};

type ToolBlockAccum = { id: string; name: string; json: string };

/**
 * Anthropic provider using the native /v1/messages API. System prompts go in
 * the top-level `system` field; tool results are sent as `tool_result` content
 * blocks inside user messages, per the API.
 */
export class AnthropicProvider implements ChatLLMProvider {
  readonly name = "anthropic";
  readonly model: string;
  readonly contextWindow: number;
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
    this.model = config.model;
    this.contextWindow = contextWindowFor(config.model);
  }

  async complete(input: LLMCompleteInput): Promise<LLMCompleteOutput> {
    const url = `${this.baseUrl()}/v1/messages`;
    const { system, messages } = splitSystem(input.messages);
    const body = {
      model: this.config.model,
      max_tokens: input.maxTokens ?? this.config.maxTokens,
      temperature: input.temperature ?? this.config.temperature,
      ...(system ? { system } : {}),
      messages,
    };

    let res: Response;
    try {
      res = await this.post(url, body, input.signal);
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

  async *chat(input: LLMChatInput): AsyncIterable<LLMChunk> {
    const url = `${this.baseUrl()}/v1/messages`;
    const { system, messages } = splitSystem(input.messages);
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: input.maxTokens ?? this.config.maxTokens,
      temperature: input.temperature ?? this.config.temperature,
      ...(system ? { system } : {}),
      messages,
      stream: true,
    };
    if (input.tools && input.tools.length > 0) {
      body.tools = input.tools.map(toAnthropicTool);
    }

    let res: Response;
    try {
      res = await this.post(url, body, input.signal);
    } catch (err) {
      yield { type: "error", message: redactError("anthropic request failed", err, this.config.apiKey) };
      return;
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      yield {
        type: "error",
        message: redactError(`anthropic API error ${res.status}`, detail.slice(0, 500), this.config.apiKey),
      };
      return;
    }

    const toolBlocks = new Map<number, ToolBlockAccum>();
    let finishReason: LLMFinishReason = "stop";
    let assistantText = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      for await (const payload of sseData(res, input.signal)) {
        let evt: StreamEvent;
        try {
          evt = JSON.parse(payload) as StreamEvent;
        } catch {
          continue;
        }
        if (evt.error?.message) {
          yield { type: "error", message: redactError("anthropic API error", evt.error.message, this.config.apiKey) };
          return;
        }
        switch (evt.type) {
          case "message_start":
            inputTokens = evt.message?.usage?.input_tokens ?? inputTokens;
            outputTokens = evt.message?.usage?.output_tokens ?? outputTokens;
            break;
          case "content_block_start":
            if (evt.content_block?.type === "tool_use" && evt.index !== undefined) {
              toolBlocks.set(evt.index, {
                id: evt.content_block.id ?? `call_${evt.index}`,
                name: evt.content_block.name ?? "",
                json: "",
              });
            }
            break;
          case "content_block_delta": {
            if (evt.delta?.type === "text_delta" && evt.delta.text) {
              assistantText += evt.delta.text;
              yield { type: "text_delta", text: evt.delta.text };
            } else if (evt.delta?.type === "input_json_delta" && evt.index !== undefined) {
              const acc = toolBlocks.get(evt.index);
              if (acc) acc.json += evt.delta.partial_json ?? "";
            }
            break;
          }
          case "message_delta":
            if (evt.delta?.stop_reason) finishReason = mapStopReason(evt.delta.stop_reason);
            outputTokens = evt.usage?.output_tokens ?? outputTokens;
            break;
          default:
            break;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        yield { type: "error", message: "Request aborted" };
        return;
      }
      yield { type: "error", message: redactError("anthropic stream failed", err, this.config.apiKey) };
      return;
    }

    const ordered = [...toolBlocks.entries()].sort((a, b) => a[0] - b[0]);
    for (const [index, acc] of ordered) {
      yield {
        type: "tool_call",
        id: acc.id || `call_${index}`,
        name: acc.name,
        args: parseJson(acc.json),
      };
    }
    if (ordered.length > 0) finishReason = "tool_use";

    const finalInput = inputTokens || estimateMessageTokens(input.messages);
    const finalOutput = outputTokens || estimateTokens(assistantText);
    yield {
      type: "finish",
      reason: finishReason,
      usage: {
        inputTokens: finalInput,
        outputTokens: finalOutput,
        costUsd: computeCostUsd(this.config.model, finalInput, finalOutput),
      },
    };
  }

  private baseUrl(): string {
    // Strip trailing slashes without a regex: `/\/+$/` is polynomial in the
    // number of trailing slashes (CodeQL js/polynomial-redos).
    let url = this.config.baseUrl;
    let end = url.length;
    while (end > 0 && url.charCodeAt(end - 1) === 47) end -= 1;
    if (end !== url.length) url = url.slice(0, end);
    return url;
  }

  private post(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    return postWithRetries(
      (s) =>
        fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.config.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify(body),
          signal: s,
        }),
      { timeoutSeconds: this.config.timeoutSeconds, ...(signal ? { signal } : {}) },
    );
  }
}

/** Extract the system prompt and convert the rest into Anthropic messages. */
function splitSystem(messages: LLMMessage[]): { system: string; messages: Array<Record<string, unknown>> } {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const converted = messages
    .filter((m) => m.role !== "system")
    .map(toAnthropicMessage);
  return { system, messages: converted };
}

function toAnthropicMessage(m: LLMMessage): Record<string, unknown> {
  if (m.role === "tool") {
    return {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
    };
  }
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    const content: Array<Record<string, unknown>> = [];
    if (m.content) content.push({ type: "text", text: m.content });
    for (const tc of m.toolCalls) {
      content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args ?? {} });
    }
    return { role: "assistant", content };
  }
  return { role: m.role, content: m.content };
}

function toAnthropicTool(tool: ToolSchema): Record<string, unknown> {
  return { name: tool.name, description: tool.description, input_schema: tool.parameters };
}

function mapStopReason(reason: string): LLMFinishReason {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  return "stop";
}

function parseJson(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { __raw: raw, __parseError: true };
  }
}
