/**
 * Frozen regression suite manifest. These task IDs are sacred — once an entry
 * is in the suite (frozen=true), it must never be modified or removed.
 *
 * Score time series: pass-rate per week per model. The LearningDashboard
 * displays this as the ground truth for "is the agent getting better?".
 */
import type { EvalTask, FrozenSuiteSnapshot } from "@coding-agent/shared";

/** Initial frozen suite seed. Concrete-but-tiny so we can verify the plumbing. */
export const INITIAL_FROZEN_TASKS: Omit<EvalTask, "createdAt">[] = [
  {
    id: "frozen-l1-typo",
    level: "L1",
    title: "Fix a typo in README",
    description: "Open README.md and correct a single typo in the first paragraph.",
    frozen: true,
    verifyCommand: "",
    expectedNodes: 1,
  },
  {
    id: "frozen-l2-add-test",
    level: "L2",
    title: "Add a single unit test for an existing utility",
    description: "Pick one untested utility function and write one passing unit test.",
    frozen: true,
    verifyCommand: "pnpm test",
    expectedNodes: 2,
  },
  {
    id: "frozen-l3-refactor-extract",
    level: "L3",
    title: "Extract a helper from a >100-line function",
    description: "Identify any function over 100 lines and extract a focused helper. Tests must stay green.",
    frozen: true,
    verifyCommand: "pnpm test",
    expectedNodes: 4,
  },
  {
    id: "frozen-l3-error-narrow",
    level: "L3",
    title: "Narrow an `any` to `unknown` and add a type guard",
    description: "Find one `any`-typed unknown-source value and replace it with `unknown` + a type guard.",
    frozen: true,
    verifyCommand: "pnpm typecheck",
    expectedNodes: 3,
  },
  {
    id: "frozen-l4-mini-migration",
    level: "L4",
    title: "Mini CommonJS → ESM migration of one folder",
    description: "Pick a folder and migrate all .js files in it from CommonJS to ESM imports.",
    frozen: true,
    verifyCommand: "pnpm build && pnpm test",
    expectedNodes: 12,
  },
];

export type WeeklyTrendPoint = {
  weekStartTs: number;
  passRate: number;
  correctionsPerTask: number;
  modelId: string;
};

/** Render a single time series for the LearningDashboard chart. */
export function buildWeeklyTrend(snapshots: FrozenSuiteSnapshot[]): WeeklyTrendPoint[] {
  return snapshots
    .slice()
    .sort((a, b) => a.weekStartTs - b.weekStartTs)
    .map((s) => ({
      weekStartTs: s.weekStartTs,
      passRate: s.passRate,
      correctionsPerTask: s.correctionsPerTask,
      modelId: s.modelId,
    }));
}

/**
 * Detect monotonic non-decreasing pass rate over the given window. Used by
 * the dashboard to award the "still improving" badge.
 */
export function isMonotonicNonDecreasing(
  snapshots: FrozenSuiteSnapshot[],
  windowWeeks = 4,
): boolean {
  if (snapshots.length < windowWeeks) return false;
  const tail = snapshots
    .slice()
    .sort((a, b) => a.weekStartTs - b.weekStartTs)
    .slice(-windowWeeks);
  for (let i = 1; i < tail.length; i++) {
    const prev = tail[i - 1]!;
    const cur = tail[i]!;
    if (cur.passRate < prev.passRate) return false;
  }
  return true;
}

/** "Visible improvement" — strict > between window endpoints. */
export function hasVisibleImprovement(
  snapshots: FrozenSuiteSnapshot[],
  windowWeeks = 4,
): boolean {
  if (snapshots.length < windowWeeks) return false;
  const tail = snapshots
    .slice()
    .sort((a, b) => a.weekStartTs - b.weekStartTs)
    .slice(-windowWeeks);
  const first = tail[0]!.passRate;
  const last = tail[tail.length - 1]!.passRate;
  return last > first;
}
