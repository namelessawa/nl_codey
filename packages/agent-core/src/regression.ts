import type { TestFailureItem, TestFailureReport } from "@coding-agent/shared";

/**
 * Identity of a single failure for set comparison across runs. File + test
 * name is stable across re-runs; frameworks without a test name (e.g. tsc)
 * group by file, which is the right granularity for "this file regressed".
 */
export function failureKey(f: TestFailureItem): string {
  return `${f.file}|${f.testName ?? ""}`;
}

export type RegressionAnalysis = {
  /** Failures present now that were NOT in the baseline — likely introduced. */
  regressions: TestFailureItem[];
  /** Failures in the baseline that are now gone — fixed. */
  fixed: TestFailureItem[];
  /** Failures present in both — pre-existing, not caused by this run. */
  preexisting: TestFailureItem[];
};

/**
 * Compare the latest verification against the pristine baseline captured before
 * the agent made any change. A `null` baseline means no baseline was captured
 * (shell disabled / no command) — then nothing can be classified as a
 * regression, so all current failures are treated as pre-existing.
 */
export function analyzeRegressions(
  baseline: TestFailureReport | null,
  current: TestFailureReport,
): RegressionAnalysis {
  const baseKeys = new Set((baseline?.failures ?? []).map(failureKey));
  const curKeys = new Set(current.failures.map(failureKey));
  const regressions: TestFailureItem[] = [];
  const preexisting: TestFailureItem[] = [];

  for (const f of current.failures) {
    if (baseline === null || baseKeys.has(failureKey(f))) preexisting.push(f);
    else regressions.push(f);
  }
  const fixed = (baseline?.failures ?? []).filter((f) => !curKeys.has(failureKey(f)));
  return { regressions, fixed, preexisting };
}

const MAX_LISTED = 10;

/**
 * A guard note for the model when the latest verification introduced failures
 * absent from the baseline. Returns null when there are no regressions.
 */
export function regressionNote(analysis: RegressionAnalysis): string | null {
  if (analysis.regressions.length === 0) return null;
  const listed = analysis.regressions.slice(0, MAX_LISTED).map((f) => {
    const loc = f.line !== undefined ? `:${f.line}` : "";
    const name = f.testName ? ` [${f.testName}]` : "";
    return `- ${f.file || "(unknown)"}${loc}${name}: ${f.message}`;
  });
  const more = analysis.regressions.length > MAX_LISTED
    ? `\n…(还有 ${analysis.regressions.length - MAX_LISTED} 个)`
    : "";
  return (
    `🚨 回归警告：以下 ${analysis.regressions.length} 个失败在你开始修改前并不存在，` +
    `很可能是本次改动引入的回归，必须修复后才能完成任务：\n${listed.join("\n")}${more}\n` +
    `不要把任务前就已存在的失败当作本次回归处理。`
  );
}
