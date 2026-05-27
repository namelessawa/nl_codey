/** Lightweight task-intent detection. Explain tasks must not enter the patch flow. */

const EXPLAIN_PATTERNS = [/解释/, /说明/, /\bexplain\b/i, /\bdescribe\b/i, /如何.*执行/, /执行流程/];

export function isExplainTask(task: string): boolean {
  return EXPLAIN_PATTERNS.some((re) => re.test(task));
}

/** Extract file-path-looking tokens from a task (e.g. "src/agent/core.ts"). */
export function extractFilePaths(task: string): string[] {
  const matches = task.match(/[\w./\\-]+\.[A-Za-z0-9]{1,5}/g) ?? [];
  return [...new Set(matches.map((m) => m.split("\\").join("/")))];
}
