import { describe, expect, it } from "vitest";
import type { TestFailureReport } from "@nlc/shared";
import { analyzeRegressions, failureKey, regressionNote } from "./regression.js";

function report(...failures: Array<{ file: string; testName?: string; message?: string; line?: number }>): TestFailureReport {
  return {
    framework: "vitest",
    failures: failures.map((f) => ({ message: "failed", ...f })),
    summary: `${failures.length} failures`,
  };
}

describe("failureKey", () => {
  it("combines file and test name", () => {
    expect(failureKey({ file: "a.ts", testName: "does x", message: "m" })).toBe("a.ts|does x");
  });

  it("falls back to file when there is no test name", () => {
    expect(failureKey({ file: "a.ts", message: "m" })).toBe("a.ts|");
  });
});

describe("analyzeRegressions", () => {
  it("flags failures absent from the baseline as regressions", () => {
    const baseline = report({ file: "a.ts", testName: "old" });
    const current = report({ file: "a.ts", testName: "old" }, { file: "b.ts", testName: "new" });

    const result = analyzeRegressions(baseline, current);

    expect(result.regressions.map((f) => f.testName)).toEqual(["new"]);
    expect(result.preexisting.map((f) => f.testName)).toEqual(["old"]);
    expect(result.fixed).toEqual([]);
  });

  it("reports baseline failures that are now gone as fixed", () => {
    const baseline = report({ file: "a.ts", testName: "old" }, { file: "b.ts", testName: "gone" });
    const current = report({ file: "a.ts", testName: "old" });

    const result = analyzeRegressions(baseline, current);

    expect(result.fixed.map((f) => f.testName)).toEqual(["gone"]);
    expect(result.regressions).toEqual([]);
  });

  it("treats all current failures as pre-existing when there is no baseline", () => {
    const current = report({ file: "a.ts", testName: "x" }, { file: "b.ts", testName: "y" });

    const result = analyzeRegressions(null, current);

    expect(result.regressions).toEqual([]);
    expect(result.preexisting).toHaveLength(2);
  });

  it("finds no regressions when current is a subset of the baseline", () => {
    const baseline = report({ file: "a.ts", testName: "x" });
    const result = analyzeRegressions(baseline, report());
    expect(result.regressions).toEqual([]);
    expect(result.fixed.map((f) => f.testName)).toEqual(["x"]);
  });
});

describe("regressionNote", () => {
  it("returns null when there are no regressions", () => {
    expect(regressionNote({ regressions: [], fixed: [], preexisting: [] })).toBeNull();
  });

  it("lists regressions with file and line for the model", () => {
    const note = regressionNote({
      regressions: [{ file: "b.ts", line: 9, testName: "new", message: "boom" }],
      fixed: [],
      preexisting: [],
    });
    expect(note).toContain("回归");
    expect(note).toContain("b.ts:9");
    expect(note).toContain("new");
  });
});
