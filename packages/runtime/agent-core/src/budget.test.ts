import { describe, expect, it } from "vitest";
import type { BudgetLimits, TokenUsage } from "@nlc/shared";
import { BudgetController } from "./budget.js";

const LIMITS: BudgetLimits = {
  maxIterations: 3,
  maxCostUsd: 0.1,
  maxToolCalls: 5,
  maxWallTimeMs: 1000,
};

function usage(costUsd: number): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, costUsd };
}

describe("BudgetController", () => {
  it("is not exceeded when fresh", () => {
    const b = new BudgetController(LIMITS, () => 0);
    expect(b.exceeded().exceeded).toBe(false);
  });

  it("trips on max iterations", () => {
    const b = new BudgetController(LIMITS, () => 0);
    b.incrementIteration();
    b.incrementIteration();
    b.incrementIteration();
    expect(b.exceeded()).toEqual({ exceeded: true, reason: "max_iterations" });
  });

  it("trips on max cost", () => {
    const b = new BudgetController(LIMITS, () => 0);
    b.addUsage(usage(0.05));
    b.addUsage(usage(0.06));
    expect(b.exceeded()).toEqual({ exceeded: true, reason: "max_cost" });
  });

  it("trips on max tool calls", () => {
    const b = new BudgetController(LIMITS, () => 0);
    for (let i = 0; i < 5; i++) b.recordToolCall();
    expect(b.exceeded()).toEqual({ exceeded: true, reason: "max_tool_calls" });
  });

  it("trips on wall time using the injected clock", () => {
    let t = 0;
    const b = new BudgetController(LIMITS, () => t);
    expect(b.exceeded().exceeded).toBe(false);
    t = 1000;
    expect(b.exceeded()).toEqual({ exceeded: true, reason: "max_wall_time" });
  });

  it("reports a status snapshot for the GUI", () => {
    let t = 0;
    const b = new BudgetController(LIMITS, () => t);
    b.incrementIteration();
    b.recordToolCall();
    b.addUsage(usage(0.02));
    t = 250;
    const s = b.status();
    expect(s).toMatchObject({
      exceeded: false,
      iterations: 1,
      toolCalls: 1,
      costUsd: 0.02,
      elapsedMs: 250,
    });
    expect(s.limits).toEqual(LIMITS);
  });
});
