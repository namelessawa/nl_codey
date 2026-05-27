import { describe, expect, it } from "vitest";
import type { BudgetLimits, LLMMessage } from "@coding-agent/shared";
import { MockLLMProvider } from "@coding-agent/llm";
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
    expect(outcome).toEqual({ state: "cancelled" });
  });

  it("trips the budget circuit breaker", async () => {
    const outcome = await runToolLoop(
      START,
      deps({ budget: new BudgetController({ ...LIMITS, maxIterations: 1 }) }),
    );
    expect(outcome).toEqual({ state: "budget_exceeded", reason: "max_iterations" });
  });

  it("cancels immediately when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const outcome = await runToolLoop(START, deps({ signal: ac.signal }));
    expect(outcome).toEqual({ state: "cancelled" });
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
});
