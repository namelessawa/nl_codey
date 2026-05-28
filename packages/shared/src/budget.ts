/**
 * Budget limits and status shared across the agent core, storage, and GUI so
 * the circuit-breaker and the on-screen indicator always agree.
 */

export type BudgetLimits = {
  maxIterations: number;
  maxCostUsd: number;
  maxToolCalls: number;
  maxWallTimeMs: number;
};

export type BudgetExceededReason =
  | "max_iterations"
  | "max_cost"
  | "max_tool_calls"
  | "max_wall_time";

export const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  maxIterations: 15,
  maxCostUsd: 0.5,
  maxToolCalls: 30,
  maxWallTimeMs: 5 * 60 * 1000,
};

/** Absolute ceilings the user cannot exceed even via settings. */
export const BUDGET_HARD_CAPS: BudgetLimits = {
  maxIterations: 100,
  maxCostUsd: 5.0,
  maxToolCalls: 200,
  maxWallTimeMs: 30 * 60 * 1000,
};

/** Live snapshot of budget consumption, suitable for the GUI indicator. */
export type BudgetStatus = {
  exceeded: boolean;
  reason?: BudgetExceededReason;
  iterations: number;
  costUsd: number;
  toolCalls: number;
  elapsedMs: number;
  limits: BudgetLimits;
};

/** Clamp user-provided limits to the hard caps and sane minimums. */
export function clampBudgetLimits(limits: Partial<BudgetLimits>): BudgetLimits {
  const merged = { ...DEFAULT_BUDGET_LIMITS, ...limits };
  return {
    maxIterations: clamp(merged.maxIterations, 1, BUDGET_HARD_CAPS.maxIterations),
    maxCostUsd: clamp(merged.maxCostUsd, 0.01, BUDGET_HARD_CAPS.maxCostUsd),
    maxToolCalls: clamp(merged.maxToolCalls, 1, BUDGET_HARD_CAPS.maxToolCalls),
    maxWallTimeMs: clamp(merged.maxWallTimeMs, 5_000, BUDGET_HARD_CAPS.maxWallTimeMs),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
