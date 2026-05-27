import type {
  ChatLLMProvider,
  LLMChunk,
  LLMFinishReason,
  LLMMessage,
  LLMToolCall,
  ToolSchema,
  TokenUsage,
} from "@coding-agent/shared";
import type { BudgetController } from "./budget.js";
import { compressConversation } from "./compressor.js";

/** One consumed chat turn: streamed text, tool calls, finish reason, usage. */
export type ConsumedTurn = {
  text: string;
  toolCalls: LLMToolCall[];
  finishReason: LLMFinishReason;
  usage: TokenUsage;
  errorMessage?: string;
};

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

/**
 * Drain one `chat()` stream into an aggregated turn, forwarding each chunk to
 * `onChunk` for live UI. Tool-call chunks are collected; the final usage and
 * finish reason come from the `finish` chunk.
 */
export async function consumeStream(
  stream: AsyncIterable<LLMChunk>,
  onChunk?: (chunk: LLMChunk) => void,
): Promise<ConsumedTurn> {
  let text = "";
  const toolCalls: LLMToolCall[] = [];
  let finishReason: LLMFinishReason = "stop";
  let usage: TokenUsage = ZERO_USAGE;
  let errorMessage: string | undefined;

  for await (const chunk of stream) {
    onChunk?.(chunk);
    switch (chunk.type) {
      case "text_delta":
        text += chunk.text;
        break;
      case "tool_call":
        toolCalls.push({ id: chunk.id, name: chunk.name, args: chunk.args });
        break;
      case "finish":
        finishReason = chunk.reason;
        usage = chunk.usage;
        break;
      case "error":
        errorMessage = chunk.message;
        finishReason = "error";
        break;
    }
  }

  return { text, toolCalls, finishReason, usage, ...(errorMessage ? { errorMessage } : {}) };
}

export type ToolLoopOutcome =
  | { state: "done"; finalText: string }
  | { state: "failed"; reason: string }
  | { state: "cancelled" }
  | { state: "budget_exceeded"; reason: string };

export type ToolLoopDeps = {
  llm: ChatLLMProvider;
  tools: ToolSchema[];
  budget: BudgetController;
  signal?: AbortSignal;
  temperature?: number;
  /** Forward each streamed chunk for live UI (text deltas, tool calls). */
  onChunk?: (chunk: LLMChunk) => void;
  /** Record the assistant message (text + tool calls) for persistence/UI. */
  onAssistant?: (text: string, toolCalls: LLMToolCall[], usage: TokenUsage) => void;
  /** Does this tool call require explicit user approval before executing? */
  requiresApproval: (call: LLMToolCall) => boolean;
  /** Block until the user approves; resolve false to cancel the run. */
  waitForApproval: (call: LLMToolCall) => Promise<boolean>;
  /** Record a tool call about to run (for step logging / state). */
  onToolCall?: (call: LLMToolCall) => void;
  /** Execute a tool call and return the serialized result fed back to the model. */
  executeTool: (call: LLMToolCall) => Promise<string>;
  /** Record a completed tool result. */
  onToolResult?: (call: LLMToolCall, result: string) => void;
  /**
   * Optional context-window compression. When the conversation exceeds the
   * trigger ratio of `contextWindow`, the middle is folded into a summary
   * produced by `summarize` before the next model turn.
   */
  compression?: {
    contextWindow: number;
    summarize: (text: string) => Promise<string>;
    /** Notify how many middle messages were folded into a summary. */
    onCompressed?: (compressedCount: number) => void;
  };
};

/**
 * The Phase 2 agent main loop: the model drives by selecting tools until it
 * stops, the budget trips, the user cancels, or an error occurs. The macro
 * state machine lives in the caller (AgentService); this owns the micro loop.
 *
 * `messages` is copied, not mutated. The conversation grows internally and is
 * surfaced via the callbacks so the caller can persist/stream it.
 */
export async function runToolLoop(
  initialMessages: LLMMessage[],
  deps: ToolLoopDeps,
): Promise<ToolLoopOutcome> {
  let messages: LLMMessage[] = [...initialMessages];

  while (true) {
    const limit = deps.budget.exceeded();
    if (limit.exceeded) return { state: "budget_exceeded", reason: limit.reason ?? "unknown" };
    if (deps.signal?.aborted) return { state: "cancelled" };

    deps.budget.incrementIteration();

    if (deps.compression) {
      const compressed = await compressConversation(
        messages,
        deps.compression.contextWindow,
        deps.compression.summarize,
      );
      if (compressed) {
        messages = compressed.messages;
        deps.compression.onCompressed?.(compressed.compressedCount);
      }
      if (deps.signal?.aborted) return { state: "cancelled" };
    }

    const turn = await consumeStream(
      deps.llm.chat({
        messages,
        tools: deps.tools,
        ...(deps.temperature !== undefined ? { temperature: deps.temperature } : {}),
        ...(deps.signal ? { signal: deps.signal } : {}),
      }),
      deps.onChunk,
    );

    deps.budget.addUsage(turn.usage);
    messages.push({ role: "assistant", content: turn.text, toolCalls: turn.toolCalls });
    deps.onAssistant?.(turn.text, turn.toolCalls, turn.usage);

    if (turn.finishReason === "error") {
      return { state: "failed", reason: turn.errorMessage ?? "LLM stream error" };
    }
    if (deps.signal?.aborted) return { state: "cancelled" };

    if (turn.toolCalls.length === 0) {
      // No tools requested: a stop is success; anything else is a dead end.
      if (turn.finishReason === "stop") return { state: "done", finalText: turn.text };
      return { state: "failed", reason: `Model stopped without tools (reason: ${turn.finishReason})` };
    }

    for (const call of turn.toolCalls) {
      if (deps.signal?.aborted) return { state: "cancelled" };
      deps.budget.recordToolCall();
      deps.onToolCall?.(call);

      if (deps.requiresApproval(call)) {
        const approved = await deps.waitForApproval(call);
        if (!approved) return { state: "cancelled" };
        if (deps.signal?.aborted) return { state: "cancelled" };
      }

      const result = await deps.executeTool(call);
      deps.onToolResult?.(call, result);
      messages.push({ role: "tool", toolCallId: call.id, content: result });
    }
  }
}
