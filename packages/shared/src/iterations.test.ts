import { describe, expect, it } from "vitest";
import type { AgentStep } from "./agent.js";
import { deriveIterations } from "./iterations.js";

let seq = 0;
function step(type: AgentStep["type"], content: string): AgentStep {
  seq += 1;
  return { id: `s${seq}`, runId: "r", type, content, createdAt: seq };
}

describe("deriveIterations", () => {
  it("groups pre-patch exploration into the first iteration", () => {
    const steps = [step("tool_call", "list_files"), step("tool_result", "files")];
    const iterations = deriveIterations(steps);
    expect(iterations).toHaveLength(1);
    expect(iterations[0]).toMatchObject({ index: 1, hasPatch: false, status: "in_progress" });
  });

  it("opens a new iteration at each proposed patch", () => {
    const steps = [
      step("tool_call", "list_files"),
      step("diff", "patch 1"),
      step("error", "自动验证失败：exit 1"),
      step("diff", "patch 2"),
      step("tool_result", "✅ 自动验证通过"),
    ];
    const iterations = deriveIterations(steps);
    expect(iterations).toHaveLength(2);
    expect(iterations[0]).toMatchObject({ index: 1, hasPatch: true, status: "failed" });
    expect(iterations[1]).toMatchObject({ index: 2, hasPatch: true, status: "verified" });
  });

  it("marks an iteration verified when the verify pass note appears", () => {
    const steps = [step("diff", "patch"), step("tool_result", "✅ 自动验证通过：`pnpm test`")];
    expect(deriveIterations(steps)[0]?.status).toBe("verified");
  });

  it("returns no iterations for an empty step list", () => {
    expect(deriveIterations([])).toEqual([]);
  });
});
