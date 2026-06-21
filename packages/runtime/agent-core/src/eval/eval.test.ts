import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  evaluateCheck,
  evaluateTask,
  formatReport,
  runEvalSuite,
  summarize,
  type EvalResult,
  type EvalTask,
} from "./eval.js";
import { EVAL_TASKS } from "./tasks.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-test-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("evaluateCheck", () => {
  it("passes file_exists when the file is present", async () => {
    await fs.writeFile(path.join(dir, "a.ts"), "x");
    expect((await evaluateCheck({ kind: "file_exists", path: "a.ts" }, dir)).passed).toBe(true);
  });

  it("fails file_exists when the file is missing", async () => {
    expect((await evaluateCheck({ kind: "file_exists", path: "missing.ts" }, dir)).passed).toBe(false);
  });

  it("evaluates file_contains and file_not_contains via regex", async () => {
    await fs.writeFile(path.join(dir, "a.ts"), "export function add() {}");
    expect((await evaluateCheck({ kind: "file_contains", path: "a.ts", pattern: "export function add" }, dir)).passed).toBe(true);
    expect((await evaluateCheck({ kind: "file_not_contains", path: "a.ts", pattern: "sub" }, dir)).passed).toBe(true);
  });

  it("passes file_absent only when the file does not exist", async () => {
    expect((await evaluateCheck({ kind: "file_absent", path: "gone.ts" }, dir)).passed).toBe(true);
    await fs.writeFile(path.join(dir, "gone.ts"), "x");
    expect((await evaluateCheck({ kind: "file_absent", path: "gone.ts" }, dir)).passed).toBe(false);
  });
});

describe("evaluateTask", () => {
  it("passes only when every check passes", async () => {
    const task: EvalTask = {
      id: "x",
      name: "demo",
      prompt: "p",
      setup: [],
      checks: [
        { kind: "file_exists", path: "a.ts" },
        { kind: "file_contains", path: "a.ts", pattern: "ok" },
      ],
    };
    await fs.writeFile(path.join(dir, "a.ts"), "ok");
    expect((await evaluateTask(task, dir)).passed).toBe(true);

    await fs.writeFile(path.join(dir, "a.ts"), "no");
    expect((await evaluateTask(task, dir)).passed).toBe(false);
  });
});

describe("summarize / formatReport", () => {
  const results: EvalResult[] = [
    { taskId: "a", name: "A", passed: true, checks: [] },
    { taskId: "b", name: "B", passed: false, checks: [{ check: { kind: "file_exists", path: "x" }, passed: false, detail: "file missing" }] },
  ];

  it("computes pass rate", () => {
    const report = summarize(results);
    expect(report).toMatchObject({ passed: 1, total: 2, passRate: 0.5 });
  });

  it("renders PASS/FAIL lines with failure detail and a summary", () => {
    const text = formatReport(summarize(results));
    expect(text).toContain("[PASS] a");
    expect(text).toContain("[FAIL] b");
    expect(text).toContain("file missing");
    expect(text).toContain("1/2 passed (50.0%)");
  });
});

describe("runEvalSuite", () => {
  it("seeds, runs the injected agent, and scores each task", async () => {
    const task: EvalTask = {
      id: "seed",
      name: "seeded",
      prompt: "make it ok",
      setup: [{ path: "src/f.ts", content: "start" }],
      checks: [{ kind: "file_contains", path: "src/f.ts", pattern: "DONE" }],
    };
    // A fake agent that appends DONE to the seeded file.
    const report = await runEvalSuite(
      [task],
      async () => dir,
      async (_t, root) => {
        await fs.appendFile(path.join(root, "src/f.ts"), "\nDONE");
      },
    );
    expect(report.passed).toBe(1);
    expect(report.results[0]?.passed).toBe(true);
  });

  it("scores a crashing agent run as failed instead of throwing", async () => {
    const task: EvalTask = { id: "boom", name: "boom", prompt: "x", setup: [], checks: [{ kind: "file_exists", path: "a" }] };
    const report = await runEvalSuite([task], async () => dir, async () => {
      throw new Error("agent exploded");
    });
    expect(report.passed).toBe(0);
    expect(report.results[0]?.checks[0]?.detail).toContain("agent exploded");
  });
});

describe("EVAL_TASKS", () => {
  it("defines 10 well-formed tasks with unique ids and at least one check each", () => {
    expect(EVAL_TASKS).toHaveLength(10);
    const ids = new Set(EVAL_TASKS.map((t) => t.id));
    expect(ids.size).toBe(10);
    for (const t of EVAL_TASKS) {
      expect(t.prompt.length).toBeGreaterThan(0);
      expect(t.checks.length).toBeGreaterThan(0);
    }
  });
});
