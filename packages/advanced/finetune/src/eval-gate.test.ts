import { describe, expect, it } from "vitest";
import type { EvalRunResult, EvalTask } from "@nlc/shared";
import { decideStatus, evaluateGate, findPerTaskRegressions, scoreOf } from "./eval-gate.js";
import { compareRecall, decidePromote } from "./embedding-adapter.js";

function task(id: string): EvalTask {
  return {
    id,
    level: "L2",
    title: id,
    description: id,
    frozen: true,
    verifyCommand: "",
    expectedNodes: 1,
    createdAt: 0,
  };
}

function run(taskId: string, pass: boolean, modelId = "m"): EvalRunResult {
  return {
    id: `r-${taskId}-${modelId}`,
    taskId,
    modelId,
    pass,
    corrections: 0,
    transferHits: 0,
    costUsd: 0,
    durationMs: 0,
    errorMessage: null,
    createdAt: 0,
  };
}

describe("eval-gate", () => {
  it("scoreOf computes pass rate", () => {
    expect(scoreOf([run("t1", true), run("t2", false), run("t3", true)])).toBeCloseTo(2 / 3);
  });

  it("scoreOf returns 0 for empty input", () => {
    expect(scoreOf([])).toBe(0);
  });

  it("findPerTaskRegressions flags candidate failures of baseline passes", () => {
    const tasks = [task("t1"), task("t2"), task("t3")];
    const baseline = [run("t1", true), run("t2", true), run("t3", false)];
    const candidate = [run("t1", true), run("t2", false), run("t3", false)];
    expect(findPerTaskRegressions(tasks, baseline, candidate)).toEqual(["t2"]);
  });

  it("evaluateGate PASSES when score ≥ baseline + no regressions + holdout ok", () => {
    const tasks = [task("t1"), task("t2")];
    const result = evaluateGate({
      frozenTasks: tasks,
      baselineRuns: [run("t1", true), run("t2", false)],
      candidateRuns: [run("t1", true), run("t2", true)],
      holdoutBaselineRuns: [run("h1", true), run("h2", true)],
      holdoutCandidateRuns: [run("h1", true), run("h2", true)],
    });
    expect(result.gatePassed).toBe(true);
    expect(decideStatus(result)).toBe("passed");
  });

  it("evaluateGate FAILS on score regression", () => {
    const result = evaluateGate({
      frozenTasks: [task("t1"), task("t2")],
      baselineRuns: [run("t1", true), run("t2", true)],
      candidateRuns: [run("t1", true), run("t2", false)],
      holdoutBaselineRuns: [run("h1", true)],
      holdoutCandidateRuns: [run("h1", true)],
    });
    expect(result.gatePassed).toBe(false);
    expect(result.perTaskRegressions).toContain("t2");
  });

  it("evaluateGate FAILS on catastrophic forgetting (holdout regression)", () => {
    const result = evaluateGate({
      frozenTasks: [task("t1")],
      baselineRuns: [run("t1", true)],
      candidateRuns: [run("t1", true)],
      holdoutBaselineRuns: [run("h1", true), run("h2", true), run("h3", true)],
      holdoutCandidateRuns: [run("h1", false), run("h2", false), run("h3", true)],
    });
    expect(result.gatePassed).toBe(false);
    expect(result.gateReasons.join(" ")).toMatch(/forgetting/i);
  });
});

describe("embedding-adapter AB", () => {
  it("compareRecall flags significant lift", () => {
    const baseline = Array.from({ length: 1000 }).map((_, i) => ({ hitAtK: i < 600 }));
    const candidate = Array.from({ length: 1000 }).map((_, i) => ({ hitAtK: i < 700 }));
    const cmp = compareRecall(baseline, candidate);
    expect(cmp.significant).toBe(true);
    expect(decidePromote(cmp).promote).toBe(true);
  });

  it("compareRecall rejects insignificant lift", () => {
    const baseline = Array.from({ length: 100 }).map((_, i) => ({ hitAtK: i < 60 }));
    const candidate = Array.from({ length: 100 }).map((_, i) => ({ hitAtK: i < 62 }));
    const cmp = compareRecall(baseline, candidate);
    expect(decidePromote(cmp).promote).toBe(false);
  });

  it("compareRecall rejects when candidate worse than baseline", () => {
    const baseline = Array.from({ length: 1000 }).map((_, i) => ({ hitAtK: i < 700 }));
    const candidate = Array.from({ length: 1000 }).map((_, i) => ({ hitAtK: i < 500 }));
    const cmp = compareRecall(baseline, candidate);
    expect(cmp.significant).toBe(false);
  });
});
