import type {
  ChatLLMProvider,
  LLMChatInput,
  LLMChunk,
  LLMCompleteInput,
  LLMCompleteOutput,
  LLMFinishReason,
  LLMMessage,
  ToolSchema,
} from "@coding-agent/shared";
import { computeCostUsd, contextWindowFor, estimateMessageTokens, estimateTokens } from "@coding-agent/shared";
import { withTimeout, redactError } from "./http.js";
import { sseData } from "./stream.js";

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

/** Streaming delta shape from /chat/completions with stream: true. */
type StreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string };
};

/** Accumulator for one fragmented tool call while streaming. */
type ToolCallAccum = { id: string; name: string; args: string };

/**
 * Generic provider for any OpenAI-compatible /chat/completions endpoint:
 * OpenAI, DeepSeek, OpenRouter, Google Gemini (OpenAI-compat base URL), and
 * user-defined Custom providers. No SDK dependency — plain fetch.
 */
export class OpenAICompatibleProvider implements ChatLLMProvider {
  readonly name: string;
  readonly model: string;
  readonly contextWindow: number;
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
    this.model = config.model;
    this.contextWindow = contextWindowFor(config.model);
  }

  async complete(input: LLMCompleteInput): Promise<LLMCompleteOutput> {
    const url = `${this.baseUrl()}/chat/completions`;
    const body = {
      model: this.config.model,
      messages: input.messages.map(toOpenAIMessage),
      temperature: input.temperature ?? this.config.temperature,
      max_tokens: input.maxTokens ?? this.config.maxTokens,
      stream: false,
    };

    let res: Response;
    try {
      res = await this.post(url, body, input.signal);
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

  async *chat(input: LLMChatInput): AsyncIterable<LLMChunk> {
    const url = `${this.baseUrl()}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: input.messages.map(toOpenAIMessage),
      temperature: input.temperature ?? this.config.temperature,
      max_tokens: input.maxTokens ?? this.config.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (input.tools && input.tools.length > 0) {
      body.tools = input.tools.map(toOpenAITool);
      body.tool_choice = "auto";
    }

    let res: Response;
    try {
      res = await this.post(url, body, input.signal);
    } catch (err) {
      yield { type: "error", message: redactError(`${this.name} request failed`, err, this.config.apiKey) };
      return;
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      yield {
        type: "error",
        message: redactError(`${this.name} API error ${res.status}`, detail.slice(0, 500), this.config.apiKey),
      };
      return;
    }

    const toolCalls = new Map<number, ToolCallAccum>();
    let finishReason: LLMFinishReason = "stop";
    let assistantText = "";
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    try {
      for await (const payload of sseData(res, input.signal)) {
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(payload) as StreamChunk;
        } catch {
          continue; // skip unparseable keep-alive fragments
        }
        if (chunk.error?.message) {
          yield { type: "error", message: redactError(`${this.name} API error`, chunk.error.message, this.config.apiKey) };
          return;
        }
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
          completionTokens = chunk.usage.completion_tokens ?? completionTokens;
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (delta?.content) {
          assistantText += delta.content;
          yield { type: "text_delta", text: delta.content };
        }
        for (const tc of delta?.tool_calls ?? []) {
          const acc = toolCalls.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
          toolCalls.set(tc.index, acc);
        }
        if (choice.finish_reason) finishReason = mapFinishReason(choice.finish_reason);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        yield { type: "error", message: "Request aborted" };
        return;
      }
      yield { type: "error", message: redactError(`${this.name} stream failed`, err, this.config.apiKey) };
      return;
    }

    // Emit assembled tool calls before finishing, in index order.
    const ordered = [...toolCalls.entries()].sort((a, b) => a[0] - b[0]);
    for (const [index, acc] of ordered) {
      yield {
        type: "tool_call",
        id: acc.id || `call_${index}`,
        name: acc.name,
        args: parseArgs(acc.args),
      };
    }
    if (ordered.length > 0 && finishReason === "stop") finishReason = "tool_use";

    const inputTokens = promptTokens ?? estimateMessageTokens(input.messages);
    const outputTokens = completionTokens ?? estimateTokens(assistantText);
    yield {
      type: "finish",
      reason: finishReason,
      usage: {
        inputTokens,
        outputTokens,
        costUsd: computeCostUsd(this.config.model, inputTokens, outputTokens),
      },
    };
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, "");
  }

  private post(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    return withTimeout(
      (s) =>
        fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: s,
        }),
      this.config.timeoutSeconds,
      signal,
    );
  }
}

/** Convert a shared LLMMessage into the OpenAI wire format. */
function toOpenAIMessage(m: LLMMessage): Record<string, unknown> {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function toOpenAITool(tool: ToolSchema): Record<string, unknown> {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

function mapFinishReason(reason: string): LLMFinishReason {
  if (reason === "tool_calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  if (reason === "stop") return "stop";
  return "stop";
}

function parseArgs(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    // Return the raw string so the caller can surface a parse error to the model.
    return { __raw: raw, __parseError: true };
  }
}
