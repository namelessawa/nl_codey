import { describe, expect, it } from "vitest";
import { parseTestFailure } from "./parse-test-failure.js";

function run(stdout: string, command: string, stderr = "", exitCode = 1) {
  return parseTestFailure({ stdout, stderr, exitCode, command });
}

describe("parseTestFailure - tsc", () => {
  it("parses TypeScript compiler errors with file/line/column", () => {
    const out = [
      "src/parser.ts(12,7): error TS2304: Cannot find name 'Config'.",
      "src/main.ts(3,1): error TS2552: Cannot find name 'foo'. Did you mean 'bar'?",
    ].join("\n");
    const report = run(out, "npx tsc --noEmit");
    expect(report.framework).toBe("tsc");
    expect(report.failures).toHaveLength(2);
    expect(report.failures[0]).toMatchObject({
      file: "src/parser.ts",
      line: 12,
      column: 7,
      message: "TS2304: Cannot find name 'Config'.",
    });
  });
});

describe("parseTestFailure - vitest", () => {
  it("parses a failing vitest test with location", () => {
    const out = [
      " FAIL  src/math.test.ts > add > adds two numbers",
      "AssertionError: expected 3 to be 4 // Object.is equality",
      " ❯ src/math.test.ts:5:20",
    ].join("\n");
    const report = run(out, "vitest run");
    expect(report.framework).toBe("vitest");
    expect(report.failures[0]).toMatchObject({
      file: "src/math.test.ts",
      testName: "add > adds two numbers",
      line: 5,
      column: 20,
    });
    expect(report.failures[0]?.message).toContain("expected 3 to be 4");
  });
});

describe("parseTestFailure - jest", () => {
  it("parses a failing jest test with stack location", () => {
    const out = [
      "  ● add › adds two numbers",
      "",
      "    expect(received).toBe(expected)",
      "",
      "      at Object.<anonymous> (src/math.test.js:5:19)",
    ].join("\n");
    const report = run(out, "jest --ci");
    expect(report.framework).toBe("jest");
    expect(report.failures[0]).toMatchObject({
      testName: "add > adds two numbers",
      file: "src/math.test.js",
      line: 5,
      column: 19,
    });
  });
});

describe("parseTestFailure - pytest", () => {
  it("parses pytest short summary failures", () => {
    const out = [
      "test_math.py:5: AssertionError",
      "=========================== short test summary info ============================",
      "FAILED test_math.py::test_add - assert 3 == 4",
    ].join("\n");
    const report = run(out, "pytest");
    expect(report.framework).toBe("pytest");
    expect(report.failures[0]).toMatchObject({
      file: "test_math.py",
      testName: "test_add",
      message: "assert 3 == 4",
      line: 5,
    });
  });
});

describe("parseTestFailure - go test", () => {
  it("parses go test failures with file/line", () => {
    const out = [
      "=== RUN   TestAdd",
      "    math_test.go:10: add(1,2) = 3; want 4",
      "--- FAIL: TestAdd (0.00s)",
      "FAIL",
      "FAIL\texample/math\t0.002s",
    ].join("\n");
    const report = run(out, "go test ./...");
    expect(report.framework).toBe("go-test");
    expect(report.failures[0]).toMatchObject({
      testName: "TestAdd",
      file: "math_test.go",
      line: 10,
    });
    expect(report.failures[0]?.message).toContain("want 4");
  });
});

describe("parseTestFailure - cargo test", () => {
  it("parses cargo test panics with file/line", () => {
    const out = [
      "running 1 test",
      "test tests::adds ... FAILED",
      "",
      "failures:",
      "",
      "---- tests::adds stdout ----",
      "thread 'tests::adds' panicked at 'assertion failed', src/lib.rs:12:9",
    ].join("\n");
    const report = run(out, "cargo test");
    expect(report.framework).toBe("cargo-test");
    expect(report.failures[0]).toMatchObject({
      file: "src/lib.rs",
      line: 12,
      column: 9,
      testName: "tests::adds",
    });
  });
});

describe("parseTestFailure - unknown", () => {
  it("falls back to truncated raw output", () => {
    const report = run("some opaque build failure", "make build");
    expect(report.framework).toBe("unknown");
    expect(report.failures).toHaveLength(0);
    expect(report.summary).toContain("opaque build failure");
  });
});
