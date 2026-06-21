import { describe, expect, it, vi } from "vitest";
import type {
  BudgetLimits,
  ChatLLMProvider,
  LLMChatInput,
  LLMChunk,
  LLMMessage,
  LLMToolCall,
} from "@nlc/shared";
import { MockLLMProvider } from "@nlc/llm";
import { BudgetController } from "./budget.js";
import { runToolLoop, type ToolLoopDeps } from "./loop.js";
import { AGENT_TOOL_SCHEMAS } from "./tools-registry.js";

const LIMITS: BudgetLimits = {
  maxIterations: 15,
  maxCostUsd: 1,
  maxToolCalls: 30,
  maxWallTimeMs: 60_000,
};

const START: LLMMessage[] = [
  { role: "system", content: "system" },
  { role: "user", content: "do a thing" },
];

function deps(overrides: Partial<ToolLoopDeps> = {}): ToolLoopDeps {
  return {
    llm: new MockLLMProvider(),
    tools: AGENT_TOOL_SCHEMAS,
    budget: new BudgetController(LIMITS),
    requiresApproval: (c) => c.name === "apply_patch",
    waitForApproval: async () => true,
    executeTool: async () => JSON.stringify({ ok: true, exitCode: 0 }),
    ...overrides,
  };
}

describe("runToolLoop", () => {
  it("drives list_files then apply_patch (with approval) then finishes", async () => {
    const executed: string[] = [];
    const approvals: string[] = [];
    const outcome = await runToolLoop(
      START,
      deps({
        waitForApproval: async (c) => {
          approvals.push(c.name);
          return true;
        },
        executeTool: async (c) => {
          executed.push(c.name);
          return JSON.stringify({ ok: true, exitCode: 0 });
        },
      }),
    );

    expect(executed).toEqual(["list_files", "apply_patch"]);
    expect(approvals).toEqual(["apply_patch"]);
    expect(outcome.state).toBe("done");
  });

  it("cancels when the user rejects an approval", async () => {
    const executed: string[] = [];
    const outcome = await runToolLoop(
      START,
      deps({
        waitForApproval: async () => false,
        executeTool: async (c) => {
          executed.push(c.name);
          return "{}";
        },
      }),
    );

    expect(executed).toEqual(["list_files"]); // apply_patch never executed
    expect(outcome).toMatchObject({ state: "cancelled" });
  });

  it("trips the budget circuit breaker", async () => {
    const outcome = await runToolLoop(
      START,
      deps({ budget: new BudgetController({ ...LIMITS, maxIterations: 1 }) }),
    );
    expect(outcome).toMatchObject({ state: "budget_exceeded", reason: "max_iterations" });
  });

  it("cancels immediately when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const outcome = await runToolLoop(START, deps({ signal: ac.signal }));
    expect(outcome).toMatchObject({ state: "cancelled" });
  });

  it("forwards streamed chunks and records assistant turns", async () => {
    const chunkTypes: string[] = [];
    const assistantTurns: number = await (async () => {
      let count = 0;
      await runToolLoop(
        START,
        deps({
          onChunk: (c) => chunkTypes.push(c.type),
          onAssistant: () => {
            count += 1;
          },
        }),
      );
      return count;
    })();

    expect(chunkTypes).toContain("text_delta");
    expect(chunkTypes).toContain("finish");
    expect(assistantTurns).toBeGreaterThanOrEqual(2);
  });

  it("runs verifyAfterPatch only after a successful apply_patch", async () => {
    const verified: string[] = [];
    await runToolLoop(
      START,
      deps({
        executeTool: async (c) =>
          c.name === "apply_patch"
            ? JSON.stringify({ applied: true, changedFiles: ["a.ts"] })
            : JSON.stringify({ ok: true }),
        verifyAfterPatch: async (call, result) => {
          verified.push(call.name);
          expect(result).toContain("applied");
          return "✅ verification passed";
        },
      }),
    );

    // The mock drives list_files then apply_patch; only the patch is verified.
    expect(verified).toEqual(["apply_patch"]);
  });

  it("compresses an oversized conversation before the first model turn", async () => {
    const big: LLMMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "do a thing" },
      ...Array.from({ length: 14 }, (_, i) => ({
        role: "assistant" as const,
        content: "x".repeat(400) + i,
      })),
    ];
    const summarize = vi.fn(async () => "summary");
    let compressedCount = 0;

    const outcome = await runToolLoop(
      big,
      deps({
        compression: {
          contextWindow: 50,
          summarize,
          onCompressed: (n) => {
            compressedCount = n;
          },
        },
      }),
    );

    expect(summarize).toHaveBeenCalled();
    expect(compressedCount).toBeGreaterThan(0);
    expect(outcome.state).toBe("done");
  });

  // ----------------------------------------------------------------------
  // B1: verifyAfterPatch must be fail-open, and the repair cycle must be
  // bounded so a runaway apply_patch ↔ verify-failure loop terminates
  // gracefully instead of churning until the budget trips. (MiMo: fail-open
  // + MAX_*_REACT bound. See goal.ts/gate.ts pattern.)
  // ----------------------------------------------------------------------

  it("B1 fail-open: verifyAfterPatch throw does not fail the loop", async () => {
    let verifyCalled = 0;
    const userFeedbacks: string[] = [];
    const outcome = await runToolLoop(
      START,
      deps({
        verifyAfterPatch: async () => {
          verifyCalled += 1;
          throw new Error("simulated verifier crash");
        },
        onAssistant: () => {},
        executeTool: async () => JSON.stringify({ applied: true }),
      }),
    );

    expect(verifyCalled).toBeGreaterThanOrEqual(1);
    expect(outcome.state).toBe("done");
    // The verifier crash must NOT have been appended as user feedback.
    for (const m of outcome.finalMessages) {
      if (m.role === "user") userFeedbacks.push(m.content);
    }
    for (const fb of userFeedbacks) {
      expect(fb).not.toMatch(/simulated verifier crash/);
    }
  });

  it("B1 cap default 3: consecutive apply_patch verifier feedback halts at cap", async () => {
    const llm = new RepairLoopLLM(/* loopForever = */ 8);
    const feedbacks: string[] = [];
    const outcome = await runToolLoop(START, {
      llm,
      tools: AGENT_TOOL_SCHEMAS,
      // Generous budget so the cap (not the budget) terminates the repair churn.
      budget: new BudgetController({ ...LIMITS, maxIterations: 25, maxToolCalls: 25 }),
      requiresApproval: () => false,
      waitForApproval: async () => true,
      executeTool: async () => JSON.stringify({ applied: true }),
      verifyAfterPatch: async () => "❌ failure feedback for repair",
    });

    // Walk the conversation: every user-role message after the initial seed is
    // a verifyAfterPatch feedback or the halt notice.
    for (const m of outcome.finalMessages.slice(2)) {
      if (m.role === "user") feedbacks.push(m.content);
    }
    const failureFeedbacks = feedbacks.filter((f) => f.startsWith("❌"));
    const haltFeedbacks = feedbacks.filter((f) => /已达自动修复上限|repair cap/.test(f));
    expect(failureFeedbacks.length).toBeLessThanOrEqual(3);
    expect(haltFeedbacks.length).toBeGreaterThanOrEqual(1);
  });

  it("B1 custom cap: maxRepairAttempts=1 caps after a single failure", async () => {
    const llm = new RepairLoopLLM(8);
    const outcome = await runToolLoop(START, {
      llm,
      tools: AGENT_TOOL_SCHEMAS,
      budget: new BudgetController({ ...LIMITS, maxIterations: 25, maxToolCalls: 25 }),
      requiresApproval: () => false,
      waitForApproval: async () => true,
      executeTool: async () => JSON.stringify({ applied: true }),
      verifyAfterPatch: async () => "❌ feedback",
      maxRepairAttempts: 1,
    });

    const failures = outcome.finalMessages
      .slice(2)
      .filter((m) => m.role === "user" && m.content.startsWith("❌"));
    expect(failures.length).toBeLessThanOrEqual(1);
  });

  it("B1 reset: a non-apply_patch tool between patches resets the cap counter", async () => {
    const llm = new MixedLLM([
      "apply_patch", "apply_patch", "apply_patch", // first burst (3)
      "list_files",                                // RESET
      "apply_patch", "apply_patch", "apply_patch", // second burst (3)
    ]);
    const outcome = await runToolLoop(START, {
      llm,
      tools: AGENT_TOOL_SCHEMAS,
      budget: new BudgetController({ ...LIMITS, maxIterations: 25, maxToolCalls: 25 }),
      requiresApproval: () => false,
      waitForApproval: async () => true,
      executeTool: async () => JSON.stringify({ applied: true }),
      verifyAfterPatch: async () => "❌ feedback",
    });

    const failures = outcome.finalMessages
      .slice(2)
      .filter((m) => m.role === "user" && m.content.startsWith("❌"));
    // 3 from burst A + 3 from burst B = 6 feedbacks, none capped because of the reset.
    expect(failures.length).toBe(6);
  });
});

// ---- helpers for the B1 tests ------------------------------------------

const NULL_USAGE = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

/**
 * Drives apply_patch on every turn (up to `maxTurns`), then stops. Used to
 * simulate the runaway repair loop that the cap is supposed to break.
 */
class RepairLoopLLM implements ChatLLMProvider {
  readonly name = "repair-mock";
  readonly model = "mock-model";
  readonly contextWindow = 1_000_000;
  constructor(private readonly maxTurns = 10) {}
  async complete() { return { text: "" }; }
  async *chat(input: LLMChatInput): AsyncIterable<LLMChunk> {
    const turn = input.messages.filter((m) => m.role === "assistant").length;
    if (turn >= this.maxTurns) {
      yield { type: "text_delta", text: "stopping" };
      yield { type: "finish", reason: "stop", usage: NULL_USAGE };
      return;
    }
    const call: LLMToolCall = {
      id: `patch_${turn}`,
      name: "apply_patch",
      args: { patch: "--- /dev/null\n+++ b/X.md\n@@ -0,0 +1,1 @@\n+x\n" },
    };
    yield { type: "tool_call", ...call };
    yield { type: "finish", reason: "tool_use", usage: NULL_USAGE };
  }
}

/** Drives a fixed sequence of tool names; finishes with `stop` after the list. */
class MixedLLM implements ChatLLMProvider {
  readonly name = "mixed-mock";
  readonly model = "mock-model";
  readonly contextWindow = 1_000_000;
  constructor(private readonly sequence: string[]) {}
  async complete() { return { text: "" }; }
  async *chat(input: LLMChatInput): AsyncIterable<LLMChunk> {
    const turn = input.messages.filter((m) => m.role === "assistant").length;
    if (turn >= this.sequence.length) {
      yield { type: "text_delta", text: "stop" };
      yield { type: "finish", reason: "stop", usage: NULL_USAGE };
      return;
    }
    const name = this.sequence[turn] ?? "list_files";
    const args = name === "apply_patch"
      ? { patch: "--- /dev/null\n+++ b/X.md\n@@ -0,0 +1,1 @@\n+x\n" }
      : {};
    yield { type: "tool_call", id: `t_${turn}`, name, args };
    yield { type: "finish", reason: "tool_use", usage: NULL_USAGE };
  }
}
