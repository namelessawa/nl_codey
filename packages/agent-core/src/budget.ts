import type {
  BudgetExceededReason,
  BudgetLimits,
  BudgetStatus,
  TokenUsage,
} from "@coding-agent/shared";

/**
 * Tracks consumption against per-run limits and reports when any is exceeded.
 * The agent loop checks {@link exceeded} between iterations and trips the
 * `budget_exceeded` state. A wall-clock function is injectable for testing.
 */
export class BudgetController {
  private iterations = 0;
  private costUsd = 0;
  private toolCalls = 0;
  private readonly startedAt: number;

  constructor(
    private readonly limits: BudgetLimits,
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = now();
  }

  addUsage(usage: TokenUsage): void {
    this.costUsd += usage.costUsd;
  }

  recordToolCall(): void {
    this.toolCalls += 1;
  }

  incrementIteration(): void {
    this.iterations += 1;
  }

  private elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  exceeded(): { exceeded: boolean; reason?: BudgetExceededReason } {
    if (this.iterations >= this.limits.maxIterations) {
      return { exceeded: true, reason: "max_iterations" };
    }
    if (this.costUsd >= this.limits.maxCostUsd) {
      return { exceeded: true, reason: "max_cost" };
    }
    if (this.toolCalls >= this.limits.maxToolCalls) {
      return { exceeded: true, reason: "max_tool_calls" };
    }
    if (this.elapsedMs() >= this.limits.maxWallTimeMs) {
      return { exceeded: true, reason: "max_wall_time" };
    }
    return { exceeded: false };
  }

  status(): BudgetStatus {
    const { exceeded, reason } = this.exceeded();
    return {
      exceeded,
      ...(reason ? { reason } : {}),
      iterations: this.iterations,
      costUsd: Math.round(this.costUsd * 1_000_000) / 1_000_000,
      toolCalls: this.toolCalls,
      elapsedMs: this.elapsedMs(),
      limits: this.limits,
    };
  }
}
