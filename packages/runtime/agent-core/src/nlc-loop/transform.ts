/**
 * Phase 2 — transform.
 *
 * Decision: does the current message stack fit inside a comfortable share of
 * the model's context window? If yes, pass through; if no, fold the middle
 * of history into an LLM-written summary so the next chat() turn doesn't
 * crash on context overflow.
 *
 * Reuses the project's existing {@link compressConversation} so the
 * summarisation prompt (zh/en) and the "keep N most recent + the system
 * prompt and the user task" invariants stay aligned with the GUI's loop.
 * No new SDK, no new HTTP path — the summarising chat() call goes through
 * the same {@link ChatLLMProvider} as the main turn.
 */
import {
  contextWindowFor,
  estimateMessageTokens,
  type LLMMessage,
} from "@nlc/shared";
import { compressConversation, getSummarizePrompt } from "../compressor.js";
import type { NlcLoopDeps, Phase2Result } from "./types.js";

/** Default ratio — same value the GUI's loop uses (60% of the window). */
const DEFAULT_COMPRESSION_RATIO = 0.6;

/**
 * Run Phase 2: estimate, decide, optionally compress. Never throws on a
 * summariser failure (fail-open).
 *
 * `input` is intentionally the minimal shape — `{ messages }` — so the
 * Phase 3 in-loop re-check can call this directly without fabricating a
 * full {@link Phase1Result} every iteration.
 */
export async function phase2Transform(
  input: { messages: LLMMessage[] },
  deps: NlcLoopDeps,
): Promise<Phase2Result> {
  const window = deps.options?.contextWindow ?? contextWindowFor(deps.llm.model);
  const ratio = deps.options?.compressionRatio ?? DEFAULT_COMPRESSION_RATIO;
  const threshold = Math.max(1, Math.floor(window * ratio));

  const tokensBefore = estimateMessageTokens(input.messages);
  if (tokensBefore <= threshold) {
    return {
      messages: input.messages,
      compressed: false,
      compressedCount: 0,
      tokensBefore,
      tokensAfter: tokensBefore,
    };
  }

  // Above threshold — try to compress. compressConversation handles the
  // "keep system + task + recent N" invariant; we only own the summariser
  // hook here. Honour an explicit override so legacy callers can supply
  // their own (matches `runToolLoop`'s old `compression.summarize`).
  const summarise =
    deps.options?.summarize ??
    (async (text: string): Promise<string> => {
      const out = await deps.llm.complete({
        messages: [
          { role: "system", content: getSummarizePrompt(deps.options?.language ?? "zh-CN") },
          { role: "user", content: text },
        ],
        temperature: 0.2,
        ...(deps.options?.signal ? { signal: deps.options.signal } : {}),
      });
      return out.text.trim();
    });

  let compressed: Awaited<ReturnType<typeof compressConversation>> = null;
  try {
    compressed = await compressConversation(input.messages, window, summarise);
  } catch {
    // Fail-open: a summariser crash must NOT trap the run. Phase 3 will
    // still try the original messages — the model may itself OOM the
    // context, which is a known and explicit failure mode.
    compressed = null;
  }

  if (!compressed) {
    return {
      messages: input.messages,
      compressed: false,
      compressedCount: 0,
      tokensBefore,
      tokensAfter: tokensBefore,
    };
  }

  const messages = compressed.messages as LLMMessage[];
  deps.options?.onCompressed?.(compressed.compressedCount);
  return {
    messages,
    compressed: true,
    compressedCount: compressed.compressedCount,
    tokensBefore,
    tokensAfter: estimateMessageTokens(messages),
  };
}
