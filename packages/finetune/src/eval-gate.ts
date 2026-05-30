/**
 * The eval gate — the most important file in this package.
 *
 * **Three rules, all must pass**:
 *   1. candidate frozen-suite score ≥ baseline score
 *   2. NO per-task regression (perTaskRegressions must be empty)
 *   3. catastrophic-forgetting holdout score ≥ baseline holdout score (-tolerance)
 *
 * If any rule fails, gatePassed = false → candidate CANNOT be promoted.
 * No exceptions, no overrides. This is the contract that makes fine-tuning safe.
 */
import type {
  EvalRunResult,
  EvalTask,
  FinetuneEvalResult,
  FinetuneJob,
} from "@coding-agent/shared";

export type GateInputs = {
  frozenTasks: EvalTask[];
  baselineRuns: EvalRunResult[];
  candidateRuns: EvalRunResult[];
  /** General-coding holdout (not in fine-tune data). */
  holdoutBaselineRuns: EvalRunResult[];
  holdoutCandidateRuns: EvalRunResult[];
  /** Allow tiny holdout slippage (e.g. 1% of pass rate). Default 0.01. */
  holdoutTolerance?: number;
};

export const DEFAULT_HOLDOUT_TOLERANCE = 0.01;

export function evaluateGate(inputs: GateInputs): FinetuneEvalResult {
  const tolerance = inputs.holdoutTolerance ?? DEFAULT_HOLDOUT_TOLERANCE;
  const baselineScore = scoreOf(inputs.baselineRuns);
  const candidateScore = scoreOf(inputs.candidateRuns);
  const holdoutBaselineScore = scoreOf(inputs.holdoutBaselineRuns);
  const holdoutScore = scoreOf(inputs.holdoutCandidateRuns);
  const perTaskRegressions = findPerTaskRegressions(
    inputs.frozenTasks,
    inputs.baselineRuns,
    inputs.candidateRuns,
  );

  const reasons: string[] = [];
  let gatePassed = true;

  if (candidateScore < baselineScore) {
    gatePassed = false;
    reasons.push(
      `Frozen-suite score regressed: ${candidateScore.toFixed(3)} < ${baselineScore.toFixed(3)}`,
    );
  } else {
    reasons.push(
      `Frozen-suite score: ${candidateScore.toFixed(3)} ≥ ${baselineScore.toFixed(3)} ✓`,
    );
  }

  if (perTaskRegressions.length > 0) {
    gatePassed = false;
    reasons.push(`Per-task regressions on: ${perTaskRegressions.join(", ")}`);
  } else {
    reasons.push("No per-task regressions ✓");
  }

  if (holdoutScore + tolerance < holdoutBaselineScore) {
    gatePassed = false;
    reasons.push(
      `Catastrophic forgetting detected: holdout ${holdoutScore.toFixed(3)} < baseline ${holdoutBaselineScore.toFixed(3)} (tolerance ${tolerance})`,
    );
  } else {
    reasons.push(
      `Holdout score: ${holdoutScore.toFixed(3)} (baseline ${holdoutBaselineScore.toFixed(3)}) ✓`,
    );
  }

  return {
    baselineScore,
    candidateScore,
    delta: candidateScore - baselineScore,
    perTaskRegressions,
    holdoutScore,
    holdoutBaselineScore,
    gatePassed,
    gateReasons: reasons,
  };
}

/** Per-task regression: candidate fails a task that baseline passed. */
export function findPerTaskRegressions(
  tasks: EvalTask[],
  baseline: EvalRunResult[],
  candidate: EvalRunResult[],
): string[] {
  const baselineMap = new Map<string, boolean>();
  for (const r of baseline) baselineMap.set(r.taskId, r.pass);
  const candidateMap = new Map<string, boolean>();
  for (const r of candidate) candidateMap.set(r.taskId, r.pass);
  const regressions: string[] = [];
  for (const task of tasks) {
    const wasPassing = baselineMap.get(task.id) === true;
    const nowFailing = candidateMap.get(task.id) === false;
    if (wasPassing && nowFailing) regressions.push(task.id);
  }
  return regressions;
}

/** Frozen-suite score = pass-rate. Simple, transparent, hard to game. */
export function scoreOf(runs: EvalRunResult[]): number {
  if (runs.length === 0) return 0;
  const passes = runs.filter((r) => r.pass).length;
  return passes / runs.length;
}

/**
 * High-level decision helper. Given a job and an eval result, this also
 * mutates the job status. The caller — the desktop main process — is the
 * only one who should call promoteIfPassed; promotion still requires user
 * confirmation in the UI.
 */
export function decideStatus(result: FinetuneEvalResult): "passed" | "failed" {
  return result.gatePassed ? "passed" : "failed";
}

export function gateSummary(job: FinetuneJob): string {
  if (!job.evalResult) return `Job ${job.name} has no eval result yet`;
  const r = job.evalResult;
  return [
    `Candidate: ${r.candidateScore.toFixed(3)}`,
    `Baseline: ${r.baselineScore.toFixed(3)}`,
    `Δ: ${(r.delta * 100).toFixed(1)}pp`,
    `Holdout: ${r.holdoutScore.toFixed(3)} vs ${r.holdoutBaselineScore.toFixed(3)}`,
    `Regressions: ${r.perTaskRegressions.length}`,
    `Verdict: ${r.gatePassed ? "PASS" : "FAIL"}`,
  ].join(" | ");
}
