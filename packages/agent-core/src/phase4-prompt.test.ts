import { describe, expect, it } from "vitest";
import type { GlobalPattern, StyleSpec } from "@nlc/shared";
import {
  buildPhase4PromptAugmentation,
  MODEL_IDENTITY_REMINDER,
} from "./phase4-prompt.js";

function pattern(title: string, sources: string[], confidence: number): GlobalPattern {
  return {
    id: `p-${title}`,
    title,
    description: "desc",
    exampleSnippet: "",
    sourceProjects: sources,
    tags: [],
    confidence,
    embedding: [],
    createdAt: 0,
    lastAppliedAt: 0,
  };
}

describe("buildPhase4PromptAugmentation", () => {
  it("renders empty string when no inputs", () => {
    expect(buildPhase4PromptAugmentation({})).toBe("");
  });

  it("caps patterns at 3 with provenance", () => {
    const patterns: GlobalPattern[] = [
      pattern("A", ["p1"], 0.8),
      pattern("B", ["p1", "p2"], 0.7),
      pattern("C", ["p1"], 0.6),
      pattern("D", ["p1"], 0.5),
    ];
    const text = buildPhase4PromptAugmentation({ globalPatterns: patterns });
    expect(text).toContain("A");
    expect(text).toContain("B");
    expect(text).toContain("C");
    expect(text).not.toContain("D");
    expect(text).toContain("来自");
    expect(text).toContain("置信度");
  });

  it("renders style rules sorted by strength (must > should > prefer)", () => {
    const spec: StyleSpec = {
      scope: "project",
      workspaceId: "w",
      rules: [
        {
          id: "r1",
          category: "naming",
          rule: "prefer rule text",
          examples: [],
          strength: "prefer",
          confidence: 0.5,
          signalCount: 0,
          source: "manual",
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: "r2",
          category: "error-handling",
          rule: "must rule text",
          examples: [],
          strength: "must",
          confidence: 0.9,
          signalCount: 5,
          source: "extracted",
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      derivedFrom: { codebaseStats: {}, acceptedDiffs: 0, rejectedDiffs: 0 },
      version: 1,
      updatedAt: 0,
    };
    const text = buildPhase4PromptAugmentation({ styleSpec: spec });
    const mustIdx = text.indexOf("MUST");
    const preferIdx = text.indexOf("PREFER");
    expect(mustIdx).toBeLessThan(preferIdx);
    expect(text).toContain("风格让步于正确性");
  });

  it("appends model identity reminder when requested", () => {
    const text = buildPhase4PromptAugmentation({ includeModelIdentityReminder: true });
    expect(text).toBe(MODEL_IDENTITY_REMINDER);
    expect(text).toContain("微调");
    expect(text).toContain("verify");
  });
});
