import { describe, expect, it } from "vitest";

import type { TaskNode } from "@coding-agent/shared";

import { computeSchedule, MAX_PARALLELISM, Scheduler } from "./scheduler.js";

function node(
  id: string,
  dependsOn: string[] = [],
  filesScope?: string[],
): TaskNode {
  const base: TaskNode = {
    id,
    parentRunId: "run-1",
    title: id,
    description: id,
    status: "pending",
    dependsOn,
    createdAt: 0,
    updatedAt: 0,
  };
  return filesScope ? { ...base, filesScope } : base;
}

describe("Scheduler.ready", () => {
  it("returns nodes with no dependencies first", () => {
    const s = new Scheduler([node("a"), node("b", ["a"])]);
    expect(s.ready().map((n) => n.id)).toEqual(["a"]);
  });

  it("unlocks a dependent only after its dep succeeds", () => {
    const s = new Scheduler([node("a"), node("b", ["a"])]);
    s.markRunning("a");
    s.markSucceeded("a");
    expect(s.ready().map((n) => n.id)).toEqual(["b"]);
  });
});

describe("Scheduler cascade", () => {
  it("blocks transitive dependents when a node fails", () => {
    const s = new Scheduler([
      node("a"),
      node("b", ["a"]),
      node("c", ["b"]),
    ]);
    s.markFailed("a");
    expect(s.get("b")?.status).toBe("blocked");
    expect(s.get("c")?.status).toBe("blocked");
  });

  it("does not mutate the caller's node objects", () => {
    const original = node("a");
    const s = new Scheduler([original]);
    s.markSucceeded("a");
    expect(original.status).toBe("pending");
  });
});

describe("Scheduler completion", () => {
  it("isComplete is true when all nodes are terminal", () => {
    const s = new Scheduler([node("a"), node("b", ["a"])]);
    s.markSucceeded("a");
    expect(s.isComplete()).toBe(false);
    s.markSucceeded("b");
    expect(s.isComplete()).toBe(true);
    expect(s.allDone()).toBe(true);
  });

  it("allDone is false if any node failed", () => {
    const s = new Scheduler([node("a")]);
    s.markFailed("a");
    expect(s.isComplete()).toBe(true);
    expect(s.allDone()).toBe(false);
  });
});

describe("computeSchedule", () => {
  it("produces topological waves with independent nodes together", () => {
    const schedule = computeSchedule([
      node("a"),
      node("b"),
      node("c", ["a", "b"]),
    ]);
    expect(schedule.waves[0]?.sort()).toEqual(["a", "b"]);
    expect(schedule.waves[1]).toEqual(["c"]);
  });

  it("splits overlapping file scopes into separate waves", () => {
    const schedule = computeSchedule([
      node("a", [], ["src/api/**"]),
      node("b", [], ["src/api/handler.ts"]),
    ]);
    // Overlapping scopes must never share a wave.
    for (const wave of schedule.waves) {
      expect(wave).not.toEqual(expect.arrayContaining(["a", "b"]));
    }
    expect(schedule.waves.length).toBe(2);
  });

  it("caps a wave at MAX_PARALLELISM nodes", () => {
    const nodes = Array.from({ length: MAX_PARALLELISM + 2 }, (_, i) =>
      node(`t${i}`),
    );
    const schedule = computeSchedule(nodes);
    for (const wave of schedule.waves) {
      expect(wave.length).toBeLessThanOrEqual(MAX_PARALLELISM);
    }
  });
});
