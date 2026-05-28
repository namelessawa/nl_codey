import { describe, it, expect } from "vitest";

import { BudgetController } from "./budget-controller.js";

describe("BudgetController", () => {
  it("charges within the limit and tracks spend + remaining", async () => {
    const budget = new BudgetController(1.0);

    const ok = await budget.charge(0.4, 1000);

    expect(ok).toBe(true);
    expect(budget.spent()).toBeCloseTo(0.4);
    expect(budget.remaining()).toBeCloseTo(0.6);
    expect(budget.tokensSpent()).toBe(1000);
  });

  it("rejects a charge that would exceed the limit without deducting", async () => {
    const budget = new BudgetController(1.0);
    await budget.charge(0.8, 100);

    const ok = await budget.charge(0.5, 100);

    expect(ok).toBe(false);
    expect(budget.spent()).toBeCloseTo(0.8);
  });

  it("serializes concurrent charges so the limit is never exceeded", async () => {
    const budget = new BudgetController(1.0);

    // Fire ten 0.2 charges at once; only five can fit under a 1.0 limit.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => budget.charge(0.2, 10)),
    );

    const accepted = results.filter(Boolean).length;
    expect(accepted).toBe(5);
    expect(budget.spent()).toBeCloseTo(1.0);
  });
});
