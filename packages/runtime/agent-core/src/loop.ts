import type {
  ChatLLMProvider,
  LLMChunk,
  LLMFinishReason,
  LLMMessage,
  LLMToolCall,
  ToolSchema,
  TokenUsage,
} from "@nlc/shared";
import type { BudgetController } from "./budget.js";
import { phase3ReactLoop, DEFAULT_MAX_REPAIR_ATTEMPTS as NLC_DEFAULT_MAX_REPAIR } from "./nlc-loop/react.js";
import type { NlcLoopDeps, Phase2Result } from "./nlc-loop/types.js";

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
 * Default for {@link ToolLoopDeps.maxRepairAttempts}. Re-exported from the
 * nlc-loop module so the two entrypoints can never drift.
 */
export const DEFAULT_MAX_REPAIR_ATTEMPTS = NLC_DEFAULT_MAX_REPAIR;

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

export type ToolLoopOutcome = {
  /**
   * The final conversation state after the loop ends. Includes any compression
   * that happened mid-loop. Persist this so a follow-up call (continueTask)
   * can resume from the full history rather than rebuilding from steps.
   */
  finalMessages: LLMMessage[];
} & (
  | { state: "done"; finalText: string }
  | { state: "failed"; reason: string }
  | { state: "cancelled" }
  | { state: "budget_exceeded"; reason: string }
);

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
   * Optional automatic verification after a successful `apply_patch` write.
   * Runs the project's test/build command and returns feedback to append to
   * the conversation (a pass note or a structured failure for the model to
   * repair), or null to skip. Drives the verify→repair loop.
   *
   * **Fail-open contract:** a throw is caught and treated as null inside the
   * loop, so a crashing verifier (network blip, OOM, parse error) can never
   * trap the agent. Mirrors MiMo's `goalGate` `Effect.catch` (`fail-open on
   * any judge error so a flaky judge can never trap the user`).
   */
  verifyAfterPatch?: (call: LLMToolCall, result: string) => Promise<string | null>;
  /**
   * Hard cap on **consecutive** `apply_patch` calls that receive verifier
   * feedback. Once the streak exceeds the cap, a single halt notice is
   * appended and further verifier feedback is suppressed until any other
   * tool call resets the streak. Defaults to {@link DEFAULT_MAX_REPAIR_ATTEMPTS}.
   *
   * Mirrors MiMo's `MAX_GOAL_REACT` / `MAX_TASK_GATE_MAIN_REACT` bounded-
   * ReAct safety pattern: without a cap a perpetually-failing verifier turns
   * the run into an apply_patch ↔ verify-fail churn that only the budget
   * controller can stop, wasting tokens and burying the real failure under
   * repair noise.
   */
  maxRepairAttempts?: number;
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
 * The Phase 2 agent main loop — preserved as a thin shim over
 * {@link phase3ReactLoop} after the nlc-loop merge. All existing callers
 * (AgentService.driveLoop, loop.test.ts) keep working unchanged: the
 * ToolLoopDeps shape is mapped onto the NlcLoopOptions surface and the
 * Phase3Result is mapped back onto the {@link ToolLoopOutcome} discriminated
 * union.
 *
 * The strengths of the original implementation — consecutive-apply_patch
 * repair cap, in-loop compression, fail-open verifier — now live in
 * {@link phase3ReactLoop} so the explicit-three-phase entrypoint
 * ({@link runNlcLoop}) and this legacy entrypoint share one codepath.
 */
export async function runToolLoop(
  initialMessages: LLMMessage[],
  deps: ToolLoopDeps,
): Promise<ToolLoopOutcome> {
  const phase2: Phase2Result = {
    messages: [...initialMessages],
    compressed: false,
    compressedCount: 0,
    tokensBefore: 0,
    tokensAfter: 0,
  };

  const nlcDeps: NlcLoopDeps = {
    llm: deps.llm,
    tools: deps.tools,
    executeTool: deps.executeTool,
    options: {
      budget: deps.budget,
      ...(deps.signal ? { signal: deps.signal } : {}),
      ...(deps.temperature !== undefined ? { temperature: deps.temperature } : {}),
      ...(deps.onChunk ? { onChunk: deps.onChunk } : {}),
      ...(deps.onAssistant ? { onAssistant: deps.onAssistant } : {}),
      ...(deps.onToolCall ? { onToolCall: deps.onToolCall } : {}),
      ...(deps.onToolResult ? { onToolResult: deps.onToolResult } : {}),
      requiresApproval: deps.requiresApproval,
      waitForApproval: deps.waitForApproval,
      ...(deps.verifyAfterPatch ? { verifyAfterPatch: deps.verifyAfterPatch } : {}),
      ...(deps.maxRepairAttempts !== undefined ? { maxRepairAttempts: deps.maxRepairAttempts } : {}),
      // Map the old `compression` block onto the new flat options. When
      // the caller wired compression, turn on in-loop checks AND honour
      // their custom summariser + onCompressed callback.
      ...(deps.compression
        ? {
            compressInLoop: true,
            contextWindow: deps.compression.contextWindow,
            summarize: deps.compression.summarize,
            ...(deps.compression.onCompressed
              ? { onCompressed: deps.compression.onCompressed }
              : {}),
          }
        : {}),
    },
  };

  const phase3 = await phase3ReactLoop(phase2, nlcDeps);

  // Map Phase3Result → ToolLoopOutcome discriminated union.
  switch (phase3.state) {
    case "done":
      return {
        state: "done",
        finalText: phase3.finalText ?? "",
        finalMessages: phase3.finalMessages,
      };
    case "failed":
      return {
        state: "failed",
        reason: phase3.failureReason ?? "unknown",
        finalMessages: phase3.finalMessages,
      };
    case "cancelled":
      return { state: "cancelled", finalMessages: phase3.finalMessages };
    case "budget_exceeded":
      return {
        state: "budget_exceeded",
        reason: phase3.failureReason ?? "unknown",
        finalMessages: phase3.finalMessages,
      };
  }
}
