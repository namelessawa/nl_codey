import { describe, expect, it } from "vitest";
import type { RunCommandOutput } from "@nlc/shared";
import { evaluateVerification } from "./verifier.js";

function out(overrides: Partial<RunCommandOutput>): RunCommandOutput {
  return { command: "pnpm test", exitCode: 0, stdout: "", stderr: "", timedOut: false, ...overrides };
}

describe("evaluateVerification", () => {
  it("passes on exit 0 without a timeout", () => {
    const result = evaluateVerification(out({ exitCode: 0 }));
    expect(result.passed).toBe(true);
    expect(result.message).toContain("验证通过");
    expect(result.message).toContain("pnpm test");
  });

  it("fails on a non-zero exit code", () => {
    const result = evaluateVerification(out({ exitCode: 1 }));
    expect(result.passed).toBe(false);
    expect(result.message).toContain("验证失败");
    expect(result.message).toContain("exit 1");
  });

  it("fails when the command timed out even with a zero exit code", () => {
    const result = evaluateVerification(out({ exitCode: 0, timedOut: true }));
    expect(result.passed).toBe(false);
    expect(result.message).toContain("超时");
  });

  it("treats a null exit code as a failure", () => {
    const result = evaluateVerification(out({ exitCode: null }));
    expect(result.passed).toBe(false);
    expect(result.message).toContain("未知");
  });

  it("includes parsed file/line failures in the feedback for the model", () => {
    const tsc = "src/foo.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.";
    const result = evaluateVerification(
      out({ command: "tsc --noEmit", exitCode: 2, stdout: tsc }),
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain("tsc");
    expect(result.message).toContain("src/foo.ts:12");
    expect(result.message).toContain("apply_patch");
  });
});
