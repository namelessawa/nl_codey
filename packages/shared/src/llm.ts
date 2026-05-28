/** LLM provider abstraction. Implementations live in @coding-agent/llm. */

/**
 * Roles in a conversation. "tool" carries a tool result back to the model and
 * is new in Phase 2; the legacy single-shot flow only uses the first three.
 */
export type LLMRole = "system" | "user" | "assistant" | "tool";

/** A single tool call requested by the model. `args` is the parsed arguments. */
export type LLMToolCall = {
  id: string;
  name: string;
  args: unknown;
};

/**
 * A conversation message, discriminated on `role`. Every variant carries a
 * `content` string (possibly empty) so legacy code that reads `m.content`
 * remains valid after the Phase 2 union widening.
 */
export type LLMMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: LLMToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

/** Minimal JSON Schema shape used to describe tool parameters. */
export type JSONSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: unknown[];
  additionalProperties?: boolean | JSONSchema;
  [key: string]: unknown;
};

/** A tool exposed to the model via the native tool-calling API. */
export type ToolSchema = {
  name: string;
  description: string;
  parameters: JSONSchema;
};

/** Token accounting for one chat turn, including computed USD cost. */
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type LLMFinishReason = "stop" | "tool_use" | "max_tokens" | "error";

/** A streamed chunk emitted by {@link ChatLLMProvider.chat}. */
export type LLMChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "finish"; reason: LLMFinishReason; usage: TokenUsage }
  | { type: "error"; message: string };

export type LLMChatInput = {
  messages: LLMMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  /** Per-request abort signal (e.g. for run cancellation). */
  signal?: AbortSignal;
};

// ----- Legacy single-shot completion (Phase 1 compatibility surface) -----

export type LLMCompleteInput = {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Per-request abort signal (e.g. for run cancellation). */
  signal?: AbortSignal;
};

export type LLMCompleteOutput = {
  text: string;
};

/**
 * Phase-1 single-shot interface. Retained as a compatibility surface: the
 * settings test-connection check and any remaining two-pass callers use it.
 */
export interface LLMProvider {
  readonly name: string;
  complete(input: LLMCompleteInput): Promise<LLMCompleteOutput>;
}

/**
 * Phase-2 streaming + tool-calling interface. The agent main loop targets this.
 * Real providers implement both `complete` (legacy) and `chat`.
 */
export interface ChatLLMProvider extends LLMProvider {
  readonly model: string;
  readonly contextWindow: number;
  chat(input: LLMChatInput): AsyncIterable<LLMChunk>;
}
