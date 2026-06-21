/** Coding style profile types. */

export type StyleScope = "global" | "team" | "project";
export type StyleCategory =
  | "naming"
  | "error-handling"
  | "imports"
  | "testing"
  | "comments"
  | "structure";
export type StyleStrength = "must" | "should" | "prefer";

export type StyleRule = {
  id: string;
  category: StyleCategory;
  rule: string;
  examples: { good: string; bad: string }[];
  strength: StyleStrength;
  /** 0..1; derived from sample size and consistency. */
  confidence: number;
  /** How many feedback signals shaped this rule. */
  signalCount: number;
  /** Source-of-record tag for explainability. */
  source: "extracted" | "feedback" | "manual";
  createdAt: number;
  updatedAt: number;
};

export type StyleRulePatch = Partial<Omit<StyleRule, "id" | "createdAt">>;

export type StyleSpec = {
  scope: StyleScope;
  /** workspaceId when scope === 'project', else null. */
  workspaceId: string | null;
  rules: StyleRule[];
  derivedFrom: {
    codebaseStats: Record<string, number | string>;
    acceptedDiffs: number;
    rejectedDiffs: number;
  };
  version: number;
  updatedAt: number;
};
