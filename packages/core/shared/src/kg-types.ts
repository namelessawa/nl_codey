/** Cross-project knowledge graph types. */

export type GlobalPatternId = string;

export type GlobalPattern = {
  id: GlobalPatternId;
  title: string;
  description: string;
  exampleSnippet: string;
  /** Workspace ids that contributed evidence for this pattern. */
  sourceProjects: string[];
  tags: string[];
  /** 0..1; rises as more projects independently validate. */
  confidence: number;
  /** Embedding for similarity-based retrieval; serialized as Float32Array bytes. */
  embedding: number[];
  createdAt: number;
  lastAppliedAt: number;
};

export type GlobalPatternInput = Omit<GlobalPattern, "id" | "createdAt" | "lastAppliedAt">;

/** Graph edges connecting projects, patterns, failures, preferences. */
export type KGEdgeKind =
  | "project_has_pattern"
  | "pattern_derived_from_failure"
  | "pattern_reinforces_preference"
  | "project_contributed"
  | "pattern_applied_in_project";

export type KGEdge = {
  id: string;
  fromId: string;
  fromKind: "project" | "pattern" | "failure" | "preference";
  toId: string;
  toKind: "project" | "pattern" | "failure" | "preference";
  edgeKind: KGEdgeKind;
  weight: number;
  createdAt: number;
};

/** Per-workspace privacy setting controlling cross-project contribution. */
export type WorkspaceContributionMode = "isolated" | "contribute" | "team_shared";
