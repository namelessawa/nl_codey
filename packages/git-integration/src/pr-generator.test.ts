import { describe, it, expect } from "vitest";
import { buildPRDescription, aggregateRisk } from "./pr-generator.js";
import {
  type PRDescriptionInput,
  type TaskChangeSummary,
  PR_DESCRIPTION_MAX_CHARS,
} from "@nlc/shared";

const TASKS: TaskChangeSummary[] = [
  {
    taskNodeId: "t1",
    title: "Add login endpoint",
    changedFiles: ["src/login.ts"],
    testResult: "passed",
    regressionRisk: "low",
  },
  {
    taskNodeId: "t2",
    title: "Refactor auth store",
    changedFiles: ["src/store.ts", "src/login.ts"],
    regressionRisk: "high",
  },
];

const INPUT: PRDescriptionInput = {
  runId: "run-1",
  userRequest: "Build a login feature\nwith session handling",
  branch: "agent/login-123",
  tasks: TASKS,
  testOutput: "All tests passed",
};

describe("buildPRDescription", () => {
  it("uses the first line of the request as the title", () => {
    const pr = buildPRDescription(INPUT);
    expect(pr.title).toBe("Agent: Build a login feature");
  });

  it("includes all required markdown sections", () => {
    const { body } = buildPRDescription(INPUT);
    expect(body).toContain("## Original request");
    expect(body).toContain("## Task overview");
    expect(body).toContain("- Add login endpoint");
    expect(body).toContain("- Refactor auth store");
    expect(body).toContain("## Changes by task");
    expect(body).toContain("`src/login.ts`");
    expect(body).toContain("## Test results");
    expect(body).toContain("All tests passed");
    expect(body).toContain("## How to manually verify");
  });

  it("reports the highest regression risk across tasks", () => {
    const { body } = buildPRDescription(INPUT);
    expect(body).toContain("**high**");
  });

  it("truncates the body to the max char cap with a marker", () => {
    const huge: PRDescriptionInput = {
      ...INPUT,
      userRequest: "x".repeat(PR_DESCRIPTION_MAX_CHARS + 5000),
    };
    const { body } = buildPRDescription(huge);
    expect(body.length).toBeLessThanOrEqual(PR_DESCRIPTION_MAX_CHARS);
    expect(body).toContain("truncated");
  });

  it("handles an empty task list gracefully", () => {
    const { body } = buildPRDescription({ ...INPUT, tasks: [] });
    expect(body).toContain("_No tasks recorded._");
    expect(body).toContain("**low**");
  });
});

describe("aggregateRisk", () => {
  it("defaults to low when no risks are set", () => {
    expect(aggregateRisk([{ taskNodeId: "a", title: "t", changedFiles: [] }])).toBe("low");
  });

  it("returns the highest risk level", () => {
    expect(aggregateRisk(TASKS)).toBe("high");
  });
});
