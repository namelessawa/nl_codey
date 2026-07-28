import type {
  ChatLLMProvider,
  LLMChatInput,
  LLMChunk,
  LLMCompleteInput,
  LLMCompleteOutput,
  LLMMessage,
  TokenUsage,
} from "@nlc/shared";
import { computeCostUsd, contextWindowFor } from "@nlc/shared";
import { MOCK_PROMPT_PREFIXES } from "./prompts.js";

const MOCK_MODEL = "mock-model";

/**
 * Deterministic provider for running the whole loop with no API key.
 *
 * Legacy `complete()` (Phase 1 two-pass flow):
 * - Plan requests -> a valid plan JSON derived from the task.
 * - Patch requests -> a unified diff creating AGENT_NOTES.md.
 *
 * Phase 2 `chat()` (tool-use loop):
 * - Turn 0: a brief message + a `list_files` tool call.
 * - Turn 1: an `apply_patch` tool call creating AGENT_NOTES.md.
 * - Turn 2: if a prior tool result reported a failing command, emit a repair
 *   `apply_patch` (drives the verifier loop); otherwise finish with a summary.
 * - Later turns: finish with a summary.
 *
 * Deterministic test scenarios can opt in through `NLC_MOCK_SCENARIO`.
 * `command-confirmation` requests one whitelisted command and then stops,
 * allowing approval surfaces to prove both execution and rejection offline.
 * `redacted-error` emits one raw, synthetic credential-bearing provider error
 * so downstream persistence and display boundaries can prove redaction.
 * `large-output` emits 80 numbered lines and stops without tools so a native
 * terminal can prove scrollback retention and navigation.
 */
export class MockLLMProvider implements ChatLLMProvider {
  readonly name = "mock";
  readonly model = MOCK_MODEL;
  readonly contextWindow = contextWindowFor(MOCK_MODEL);

  async complete(input: LLMCompleteInput): Promise<LLMCompleteOutput> {
    const system = input.messages.find((m) => m.role === "system")?.content ?? "";
    const task = firstUserText(input.messages);

    if (MOCK_PROMPT_PREFIXES.plan.some((p) => system.startsWith(p))) {
      return { text: this.plan(task) };
    }
    if (MOCK_PROMPT_PREFIXES.patch.some((p) => system.startsWith(p))) {
      return { text: this.patch(task) };
    }
    // Summarization / compression and other ad-hoc completions.
    return { text: `Mock summary of ${input.messages.length} messages.` };
  }

  async *chat(input: LLMChatInput): AsyncIterable<LLMChunk> {
    const hasTools = (input.tools?.length ?? 0) > 0;
    if (!hasTools) {
      yield* emitText("Mock response (no tools available).", input.signal);
      yield finish("stop", input.messages, "Mock response (no tools available).");
      return;
    }

    const task = firstUserText(input.messages);
    const turn = input.messages.filter((m) => m.role === "assistant").length;

    if (process.env["NLC_MOCK_SCENARIO"] === "redacted-error") {
      const secret =
        process.env["NLC_MOCK_ERROR_SECRET"] ?? "sk-missing-redaction-fixture";
      yield {
        type: "error",
        message:
          `Mock provider failure\nAuthorization: Bearer ${secret}\n` +
          `at C:\\Users\\redaction-user\\.nlc\\config.json?token=${secret}`,
      };
      return;
    }

    if (process.env["NLC_MOCK_SCENARIO"] === "large-output") {
      const text = largeOutputFixture();
      yield* emitText(text, input.signal);
      yield finish("stop", input.messages, text);
      return;
    }

    if (
      process.env["NLC_MOCK_SCENARIO"] === "command-confirmation" &&
      input.tools?.some((tool) => tool.name === "run_command")
    ) {
      if (turn === 0) {
        const text = "Requesting a deterministic validation command.";
        yield* emitText(text, input.signal);
        yield {
          type: "tool_call",
          id: "call_command_1",
          name: "run_command",
          args: { command: "tsc --noEmit" },
        };
        yield finish("tool_use", input.messages, text);
        return;
      }
      const summary = "Command confirmation scenario completed.";
      yield* emitText(summary, input.signal);
      yield finish("stop", input.messages, summary);
      return;
    }

    if (turn === 0) {
      const text = `Exploring the project for task: ${firstLine(task)}`;
      yield* emitText(text, input.signal);
      yield { type: "tool_call", id: "call_list", name: "list_files", args: {} };
      yield finish("tool_use", input.messages, text);
      return;
    }

    if (turn === 1) {
      const text = "Applying a minimal change.";
      yield* emitText(text, input.signal);
      yield {
        type: "tool_call",
        id: "call_patch_1",
        name: "apply_patch",
        args: { patch: this.patch(task) },
      };
      yield finish("tool_use", input.messages, text);
      return;
    }

    if (turn === 2 && hasFailingCommand(input.messages)) {
      const text = "A check failed; applying a repair.";
      yield* emitText(text, input.signal);
      yield {
        type: "tool_call",
        id: "call_patch_2",
        name: "apply_patch",
        args: { patch: this.repairPatch(task) },
      };
      yield finish("tool_use", input.messages, text);
      return;
    }

    const summary = `Done. Task handled by MockLLMProvider: ${firstLine(task)}`;
    yield* emitText(summary, input.signal);
    yield finish("stop", input.messages, summary);
  }

  private plan(task: string): string {
    const queries = extractKeywords(task);
    return JSON.stringify(
      {
        summary: `Mock plan for task: ${firstLine(task)}`,
        searchQueries: queries,
        likelyFiles: [],
        suggestedCommands: [],
      },
      null,
      2,
    );
  }

  private patch(task: string): string {
    return notesPatch("AGENT_NOTES.md", "Agent Notes", task);
  }

  private repairPatch(task: string): string {
    return notesPatch("AGENT_FIX.md", "Agent Fix", task);
  }
}

function notesPatch(file: string, heading: string, task: string): string {
  const summary = firstLine(task).replace(/\r?\n/g, " ");
  const body = [`# ${heading}`, "", `Task: ${summary}`, "", "Generated by MockLLMProvider for end-to-end testing."];
  const lines = body.map((l) => `+${l}`).join("\n");
  return ["--- /dev/null", `+++ b/${file}`, `@@ -0,0 +1,${body.length} @@`, lines, ""].join("\n");
}

function largeOutputFixture(): string {
  return Array.from(
    { length: 80 },
    (_, index) =>
      `scrollback-line-${String(index + 1).padStart(3, "0")} retained output`,
  ).join("\n");
}

async function* emitText(
  text: string,
  signal?: AbortSignal,
): AsyncGenerator<LLMChunk> {
  // Simulate streaming by chunking the text into a few deltas.
  const mid = Math.ceil(text.length / 2);
  const parts = [text.slice(0, mid), text.slice(mid)].filter((p) => p.length > 0);
  for (const part of parts) {
    await waitForMockDelay(signal);
    yield { type: "text_delta", text: part };
  }
}

async function waitForMockDelay(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const raw = Number.parseInt(process.env["NLC_MOCK_CHUNK_DELAY_MS"] ?? "0", 10);
  const delayMs = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 5_000) : 0;
  if (delayMs === 0) return;
  await new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(finish, delayMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function finish(
  reason: "stop" | "tool_use",
  messages: LLMMessage[],
  assistantText: string,
): LLMChunk {
  const inputTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  const outputTokens = Math.ceil(assistantText.length / 4);
  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    costUsd: computeCostUsd(MOCK_MODEL, inputTokens, outputTokens),
  };
  return { type: "finish", reason, usage };
}

/** True when any tool-result message reports a non-zero command exit code. */
function hasFailingCommand(messages: LLMMessage[]): boolean {
  for (const m of messages) {
    if (m.role !== "tool") continue;
    try {
      const parsed = JSON.parse(m.content) as { exitCode?: unknown };
      if (typeof parsed.exitCode === "number" && parsed.exitCode !== 0) return true;
    } catch {
      // not JSON; ignore
    }
  }
  return false;
}

function firstUserText(messages: LLMMessage[]): string {
  const content = messages.find((m) => m.role === "user")?.content ?? "";
  const taggedPrefix = "用户任务：\n";
  if (!content.startsWith(taggedPrefix)) return content;
  return content.slice(taggedPrefix.length).split("\n")[0]?.trim() ?? "";
}

function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").trim().slice(0, 120) || "(empty task)";
}

function extractKeywords(task: string): string[] {
  const ids = task.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? [];
  const stop = new Set(["the", "and", "for", "this", "that", "with", "function", "添加", "修复"]);
  const unique = [...new Set(ids)].filter((w) => !stop.has(w.toLowerCase()));
  return unique.slice(0, 5);
}
