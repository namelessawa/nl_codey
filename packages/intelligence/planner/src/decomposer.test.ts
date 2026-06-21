import { describe, expect, it } from "vitest";

import {
  buildPlannerPrompt,
  decompose,
  singleNodeFallback,
  type GenerateFn,
} from "./decomposer.js";

function fakeGenerate(response: string): GenerateFn {
  return async () => response;
}

describe("buildPlannerPrompt", () => {
  it("includes the user task and node-count bounds", () => {
    const prompt = buildPlannerPrompt("Add a refund endpoint");
    expect(prompt).toContain("Add a refund endpoint");
    expect(prompt).toContain("between 1 and 12");
  });

  it("appends repository context when provided", () => {
    const prompt = buildPlannerPrompt("task", "uses Express");
    expect(prompt).toContain("Repository context:");
    expect(prompt).toContain("uses Express");
  });
});

describe("decompose", () => {
  it("parses a clean JSON breakdown with no issues", async () => {
    const json = JSON.stringify({
      root: "a",
      tasks: [{ id: "a", title: "A", description: "do a", dependsOn: [] }],
    });
    const { breakdown, issues } = await decompose("task", fakeGenerate(json));
    expect(breakdown.tasks).toHaveLength(1);
    expect(issues).toEqual([]);
  });

  it("tolerates markdown code fences and surrounding prose", async () => {
    const wrapped = [
      "Here is the plan:",
      "```json",
      JSON.stringify({
        root: "a",
        tasks: [{ id: "a", title: "A", description: "do a", dependsOn: [] }],
      }),
      "```",
      "Hope that helps!",
    ].join("\n");
    const { breakdown, issues } = await decompose("task", fakeGenerate(wrapped));
    expect(breakdown.tasks[0]?.id).toBe("a");
    expect(issues).toEqual([]);
  });

  it("falls back to a single node on unparseable output", async () => {
    const { breakdown, issues } = await decompose(
      "Build the thing",
      fakeGenerate("sorry, I cannot do that"),
    );
    expect(breakdown.tasks).toHaveLength(1);
    expect(breakdown.tasks[0]?.description).toContain("Build the thing");
    expect(issues.some((i) => i.includes("fell back"))).toBe(true);
  });

  it("returns validation issues for a malformed-but-parsed breakdown", async () => {
    const json = JSON.stringify({
      root: "a",
      tasks: [{ id: "a", title: "A", description: "x", dependsOn: ["ghost"] }],
    });
    const { issues } = await decompose("task", fakeGenerate(json));
    expect(issues.some((i) => i.includes("unknown id"))).toBe(true);
  });
});

describe("singleNodeFallback", () => {
  it("wraps the whole task in one node", () => {
    const b = singleNodeFallback("Do everything");
    expect(b.tasks).toHaveLength(1);
    expect(b.root).toBe(b.tasks[0]?.id);
    expect(b.tasks[0]?.dependsOn).toEqual([]);
  });
});
