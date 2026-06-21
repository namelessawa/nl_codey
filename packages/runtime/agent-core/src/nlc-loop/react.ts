/**
 * Phase 3 — react.
 *
 * The actual model-driven ReAct loop. One turn = one streamed `chat()` call.
 * Each turn either:
 *
 *   (a) returns ONLY assistant text and `finishReason === "stop"`
 *       → terminal `done`, the text is the final response.
 *   (b) returns assistant text + one or more `tool_call`s
 *       → execute each call (gated by an optional approval callback),
 *         feed the result back as a `role: "tool"` message, then loop.
 *   (c) returns `finishReason === "error"` or a non-`stop` finish without
 *       tools → terminal `failed`.
 *
 * Iteration is bounded by {@link BudgetController}: tokens spent, cost
 * accumulated, tool calls issued, iterations consumed. The abort signal is
 * checked at every boundary so a Ctrl+C / GUI Stop tears down promptly.
 *
 * Project-feature integration is via the {@link NlcLoopOptions} callbacks —
 * the SAME hooks the GUI's full driveLoop uses — so this loop is suitable
 * for headless `nlc run`, scripted automation, and as a leaner alternative
 * to the verifier-laden GUI path when the caller doesn't need it.
 */
import type { LLMMessage, LLMToolCall, ToolSchema } from "@nlc/shared";
import { DEFAULT_BUDGET_LIMITS } from "@nlc/shared";
import { consumeStream } from "../loop.js";
import { BudgetController } from "../budget.js";
import { phase2Transform } from "./transform.js";
import type { NlcLoopDeps, Phase2Result, Phase3Result } from "./types.js";

/** Default for {@link NlcLoopOptions.maxRepairAttempts}. */
export const DEFAULT_MAX_REPAIR_ATTEMPTS = 3;

/** Halt notice appended once when consecutive apply_patch crosses the cap. */
const REPAIR_CAP_NOTICE_TEMPLATE =
  "❗ 已达自动修复上限（连续 {n} 次 apply_patch 未通过验证）。请停止 apply_patch,改为向用户报告当前进展、或采取不同策略(如先 read_file 调查、或回退已写补丁)。";

/** Run Phase 3: drive `chat()` ↔ tool calls until terminal. Never throws — terminal states are returned. */
export async function phase3ReactLoop(
  phase2: Phase2Result,
  deps: NlcLoopDeps,
  extraTools: readonly ToolSchema[] = [],
): Promise<Phase3Result> {
  let messages: LLMMessage[] = [...phase2.messages];
  const tools: ToolSchema[] = [...deps.tools, ...extraTools];
  const budget = deps.options?.budget ?? new BudgetController(DEFAULT_BUDGET_LIMITS);
  const signal = deps.options?.signal;
  const temperature = deps.options?.temperature ?? 0.2;
  const requiresApproval = deps.options?.requiresApproval ?? (() => false);
  const waitForApproval =
    deps.options?.waitForApproval ?? ((): Promise<boolean> => Promise.resolve(true));
  const maxRepairAttempts = deps.options?.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;
  const compressInLoop = deps.options?.compressInLoop === true;

  /**
   * Consecutive-apply_patch streak. Bumped per apply_patch, reset on any
   * other tool call. Drives the {@link NlcLoopOptions.maxRepairAttempts}
   * cap — once the streak exceeds the cap, a single halt notice is
   * appended and further verifier feedback is suppressed until the
   * streak resets. Mirrors `runToolLoop`'s safety pattern.
   */
  let consecutiveRepairs = 0;
  let turns = 0;
  let toolCalls = 0;

  while (true) {
    if (signal?.aborted) {
      return { state: "cancelled", finalMessages: messages, turns, toolCalls };
    }
    const limit = budget.exceeded();
    if (limit.exceeded) {
      return {
        state: "budget_exceeded",
        failureReason: limit.reason ?? "budget exceeded",
        finalMessages: messages,
        turns,
        toolCalls,
      };
    }
    budget.incrementIteration();
    turns += 1;

    // In-loop Phase 2 re-check: long ReAct loops that grew context
    // mid-run get folded BEFORE the next chat() so we don't OOM the
    // window. The first iteration usually no-ops because Phase 2
    // already ran at entry.
    if (compressInLoop) {
      const recheck = await phase2Transform({ messages }, deps);
      if (recheck.compressed) {
        messages = recheck.messages;
      }
      if (signal?.aborted) {
        return { state: "cancelled", finalMessages: messages, turns, toolCalls };
      }
    }

    const turn = await consumeStream(
      deps.llm.chat({
        messages,
        tools,
        temperature,
        ...(signal ? { signal } : {}),
      }),
      deps.options?.onChunk,
    );
    budget.addUsage(turn.usage);

    messages.push({
      role: "assistant",
      content: turn.text,
      toolCalls: turn.toolCalls,
    });
    deps.options?.onAssistant?.(turn.text, turn.toolCalls, turn.usage);

    // Abort wins over finishReason==='error'. Provider SSE paths catch the
     // AbortError and yield an in-band { type:'error', message:'Request
     // aborted' } chunk (so the AsyncIterable resolves cleanly instead of
     // throwing out of `for await`). Without the abort check first, a
     // user-clicked Stop during streaming gets classified as `failed` with
     // reason "Request aborted" — see code-review M3.
    if (signal?.aborted) {
      return { state: "cancelled", finalMessages: messages, turns, toolCalls };
    }
    if (turn.finishReason === "error") {
      return {
        state: "failed",
        failureReason: turn.errorMessage ?? "LLM stream error",
        finalMessages: messages,
        turns,
        toolCalls,
      };
    }

    if (turn.toolCalls.length === 0) {
      if (turn.finishReason === "stop") {
        return {
          state: "done",
          finalText: turn.text,
          finalMessages: messages,
          turns,
          toolCalls,
        };
      }
      return {
        state: "failed",
        failureReason: `Model stopped without tools (reason: ${turn.finishReason})`,
        finalMessages: messages,
        turns,
        toolCalls,
      };
    }

    for (const call of turn.toolCalls) {
      if (signal?.aborted) {
        return { state: "cancelled", finalMessages: messages, turns, toolCalls };
      }
      toolCalls += 1;
      budget.recordToolCall();
      deps.options?.onToolCall?.(call);

      if (requiresApproval(call)) {
        const ok = await waitForApproval(call);
        if (!ok) return { state: "cancelled", finalMessages: messages, turns, toolCalls };
        if (signal?.aborted) {
          return { state: "cancelled", finalMessages: messages, turns, toolCalls };
        }
      }

      let resultText: string;
      try {
        resultText = await deps.executeTool(call);
      } catch (err) {
        // A tool throw is caught here and fed back as a structured envelope
        // so the model gets a fair shot at recovery (same behaviour as the
        // GUI's executor wrapper).
        resultText = JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
      messages.push({ role: "tool", toolCallId: call.id, content: resultText });
      deps.options?.onToolResult?.(call, resultText);

      // Maintain the consecutive-apply_patch streak unconditionally so
      // the cap behaves the same with or without a verifier wired.
      if (call.name === "apply_patch") consecutiveRepairs += 1;
      else consecutiveRepairs = 0;

      // Optional verify-after-patch: only fires for apply_patch by design,
      // matching the GUI loop's contract. Throws are swallowed (fail-open).
      // Bounded by the repair-cap streak: cross the cap → emit halt notice
      // once → silent thereafter until any non-apply_patch resets it.
      if (deps.options?.verifyAfterPatch && call.name === "apply_patch") {
        if (consecutiveRepairs === maxRepairAttempts + 1) {
          messages.push({
            role: "user",
            content: REPAIR_CAP_NOTICE_TEMPLATE.replace("{n}", String(maxRepairAttempts)),
          });
        } else if (consecutiveRepairs <= maxRepairAttempts) {
          let feedback: string | null = null;
          try {
            feedback = await deps.options.verifyAfterPatch(call, resultText);
          } catch {
            feedback = null;
          }
          if (feedback) {
            messages.push({ role: "user", content: feedback });
          }
        }
        // consecutiveRepairs > maxRepairAttempts + 1: silently suppress.
        if (signal?.aborted) {
          return { state: "cancelled", finalMessages: messages, turns, toolCalls };
        }
      }
    }
  }
}
