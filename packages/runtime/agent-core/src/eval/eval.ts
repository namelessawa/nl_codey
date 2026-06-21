import fs from "node:fs/promises";
import { assertInsideWorkspace } from "@nlc/sandbox";
import { runCommandTool } from "@nlc/tools";

/**
 * A single success criterion checked against the workspace after the agent
 * finishes a task. Deterministic — no LLM involved — so eval scoring is
 * reproducible.
 */
export type EvalCheck =
  | { kind: "file_exists"; path: string }
  | { kind: "file_absent"; path: string }
  | { kind: "file_contains"; path: string; pattern: string }
  | { kind: "file_not_contains"; path: string; pattern: string }
  | { kind: "command_succeeds"; command: string };

/** A file written into the task's workspace before the agent runs. */
export type EvalFile = { path: string; content: string };

export type EvalTask = {
  id: string;
  name: string;
  /** The task prompt handed to the agent. */
  prompt: string;
  /** Files seeded into the workspace before the run. */
  setup: EvalFile[];
  /** All checks must pass for the task to count as passed. */
  checks: EvalCheck[];
};

export type CheckResult = { check: EvalCheck; passed: boolean; detail: string };
export type EvalResult = { taskId: string; name: string; passed: boolean; checks: CheckResult[] };
export type EvalReport = {
  results: EvalResult[];
  passed: number;
  total: number;
  /** Fraction in [0, 1], rounded to 4 places. */
  passRate: number;
};

/** Evaluate one check against the workspace. Never throws; failures are detail. */
export async function evaluateCheck(
  check: EvalCheck,
  workspaceRoot: string,
): Promise<CheckResult> {
  try {
    switch (check.kind) {
      case "file_exists": {
        const ok = await fileExists(workspaceRoot, check.path);
        return result(check, ok, ok ? "file exists" : "file missing");
      }
      case "file_absent": {
        const ok = !(await fileExists(workspaceRoot, check.path));
        return result(check, ok, ok ? "file absent" : "file still present");
      }
      case "file_contains": {
        const content = await readOrEmpty(workspaceRoot, check.path);
        const ok = new RegExp(check.pattern).test(content);
        return result(check, ok, ok ? "pattern found" : "pattern not found");
      }
      case "file_not_contains": {
        const content = await readOrEmpty(workspaceRoot, check.path);
        const ok = !new RegExp(check.pattern).test(content);
        return result(check, ok, ok ? "pattern absent" : "pattern still present");
      }
      case "command_succeeds": {
        const out = await runCommandTool.run({ command: check.command }, { workspaceRoot, runId: "eval" });
        const ok = out.exitCode === 0 && !out.timedOut;
        return result(check, ok, `exit ${out.exitCode ?? "null"}${out.timedOut ? " (timeout)" : ""}`);
      }
    }
  } catch (err) {
    return result(check, false, err instanceof Error ? err.message : String(err));
  }
}

/** Run every check for a task and aggregate into a pass/fail result. */
export async function evaluateTask(task: EvalTask, workspaceRoot: string): Promise<EvalResult> {
  const checks: CheckResult[] = [];
  for (const check of task.checks) checks.push(await evaluateCheck(check, workspaceRoot));
  return { taskId: task.id, name: task.name, passed: checks.every((c) => c.passed), checks };
}

/** Summarize per-task results into a report with pass rate. */
export function summarize(results: EvalResult[]): EvalReport {
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const passRate = total === 0 ? 0 : Math.round((passed / total) * 10_000) / 10_000;
  return { results, passed, total, passRate };
}

/** Render a human-readable report (for CLI / logs). */
export function formatReport(report: EvalReport): string {
  const lines = report.results.map((r) => {
    const mark = r.passed ? "PASS" : "FAIL";
    const failed = r.checks.filter((c) => !c.passed).map((c) => `${c.check.kind}: ${c.detail}`);
    const detail = r.passed ? "" : ` — ${failed.join("; ")}`;
    return `[${mark}] ${r.taskId} ${r.name}${detail}`;
  });
  const pct = (report.passRate * 100).toFixed(1);
  return [...lines, `\n${report.passed}/${report.total} passed (${pct}%)`].join("\n");
}

/** Write a task's setup files into the workspace (creating parent dirs). */
export async function seedWorkspace(task: EvalTask, workspaceRoot: string): Promise<void> {
  for (const file of task.setup) {
    const abs = assertInsideWorkspace(workspaceRoot, file.path);
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, file.content, "utf8");
  }
}

/** How an eval drives the agent over a prepared workspace. Injected so the
 * suite is testable without an LLM and decoupled from AgentService/storage. */
export type EvalAgentRunner = (task: EvalTask, workspaceRoot: string) => Promise<void>;

/** Seed, run the agent, then score one task. */
export async function runEvalTask(
  task: EvalTask,
  workspaceRoot: string,
  runAgent: EvalAgentRunner,
): Promise<EvalResult> {
  await seedWorkspace(task, workspaceRoot);
  try {
    await runAgent(task, workspaceRoot);
  } catch (err) {
    // A crashed run still gets scored — its checks will simply fail.
    return {
      taskId: task.id,
      name: task.name,
      passed: false,
      checks: [{ check: { kind: "file_exists", path: "(run)" }, passed: false, detail: `agent run threw: ${err instanceof Error ? err.message : String(err)}` }],
    };
  }
  return evaluateTask(task, workspaceRoot);
}

/**
 * Run a suite: each task gets its own isolated workspace from `makeWorkspace`.
 * Returns a scored report. Tasks run sequentially to keep resource use bounded.
 */
export async function runEvalSuite(
  tasks: EvalTask[],
  makeWorkspace: (task: EvalTask) => Promise<string>,
  runAgent: EvalAgentRunner,
): Promise<EvalReport> {
  const results: EvalResult[] = [];
  for (const task of tasks) {
    const root = await makeWorkspace(task);
    results.push(await runEvalTask(task, root, runAgent));
  }
  return summarize(results);
}

function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx === -1 ? "." : p.slice(0, idx);
}

function result(check: EvalCheck, passed: boolean, detail: string): CheckResult {
  return { check, passed, detail };
}

async function fileExists(root: string, rel: string): Promise<boolean> {
  try {
    await fs.stat(assertInsideWorkspace(root, rel));
    return true;
  } catch {
    return false;
  }
}

async function readOrEmpty(root: string, rel: string): Promise<string> {
  try {
    return await fs.readFile(assertInsideWorkspace(root, rel), "utf8");
  } catch {
    return "";
  }
}
