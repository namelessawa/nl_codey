import { describe, expect, it } from "vitest";

import type { TaskBreakdown } from "@coding-agent/shared";

import { materializeNodes, validateBreakdown } from "./task-tree.js";

function breakdown(tasks: TaskBreakdown["tasks"], root = tasks[0]?.id ?? ""): TaskBreakdown {
  return { root, tasks };
}

describe("validateBreakdown", () => {
  it("returns no issues for a valid single-node breakdown", () => {
    const b = breakdown([
      { id: "a", title: "A", description: "do a", dependsOn: [] },
    ]);
    expect(validateBreakdown(b)).toEqual([]);
  });

  it("flags an empty task list as out of range", () => {
    const issues = validateBreakdown(breakdown([]));
    expect(issues.some((i) => i.includes("outside the allowed range"))).toBe(true);
  });

  it("flags too many tasks", () => {
    const tasks = Array.from({ length: 13 }, (_, i) => ({
      id: `t${i}`,
      title: `T${i}`,
      description: "x",
      dependsOn: [],
    }));
    const issues = validateBreakdown(breakdown(tasks));
    expect(issues.some((i) => i.includes("outside the allowed range"))).toBe(true);
  });

  it("flags duplicate ids", () => {
    const b = breakdown([
      { id: "a", title: "A", description: "x", dependsOn: [] },
      { id: "a", title: "A2", description: "y", dependsOn: [] },
    ]);
    expect(validateBreakdown(b).some((i) => i.includes("Duplicate"))).toBe(true);
  });

  it("flags dependsOn referencing unknown ids", () => {
    const b = breakdown([
      { id: "a", title: "A", description: "x", dependsOn: ["ghost"] },
    ]);
    expect(validateBreakdown(b).some((i) => i.includes("unknown id"))).toBe(true);
  });

  it("flags missing title and description", () => {
    const b = breakdown([{ id: "a", title: "", description: "", dependsOn: [] }]);
    const issues = validateBreakdown(b);
    expect(issues.some((i) => i.includes("missing a title"))).toBe(true);
    expect(issues.some((i) => i.includes("missing a description"))).toBe(true);
  });

  it("flags cycles", () => {
    const b = breakdown([
      { id: "a", title: "A", description: "x", dependsOn: ["b"] },
      { id: "b", title: "B", description: "y", dependsOn: ["a"] },
    ]);
    expect(validateBreakdown(b).some((i) => i.includes("cycle"))).toBe(true);
  });
});

describe("materializeNodes", () => {
  it("preserves ids and sets pending status with timestamps", () => {
    const b = breakdown([
      {
        id: "a",
        title: "A",
        description: "do a",
        dependsOn: [],
        verifyCommand: "pnpm test",
        filesScope: ["src/a/**"],
      },
    ]);
    const nodes = materializeNodes("run-1", b, 1000);
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.id).toBe("a");
    expect(node.parentRunId).toBe("run-1");
    expect(node.status).toBe("pending");
    expect(node.createdAt).toBe(1000);
    expect(node.updatedAt).toBe(1000);
    expect(node.verifyCommand).toBe("pnpm test");
    expect(node.filesScope).toEqual(["src/a/**"]);
  });

  it("omits empty verifyCommand and filesScope", () => {
    const b = breakdown([
      { id: "a", title: "A", description: "x", dependsOn: [], verifyCommand: null },
    ]);
    const node = materializeNodes("run-1", b, 1000)[0]!;
    expect(node.verifyCommand).toBeUndefined();
    expect(node.filesScope).toBeUndefined();
  });
});
