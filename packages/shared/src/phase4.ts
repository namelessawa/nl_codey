/**
 * Phase 4 shared types: cross-project memory, style profile, learning, fine-tune,
 * distributed, proactive, plugins, evals. Every module is feature-flagged so the
 * system gracefully degrades to Phase 3 when disabled.
 */

// =============================================================================
// Cross-project knowledge graph
// =============================================================================

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

// =============================================================================
// Coding style profile
// =============================================================================

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

// =============================================================================
// Learning loop
// =============================================================================

export type FeedbackSignalKind =
  | "diff_accepted"
  | "diff_rejected"
  | "diff_edited"
  | "review_overturned"
  | "manual_correction";

export type FeedbackSignal = {
  id: string;
  workspaceId: string;
  runId: string;
  taskNodeId: string | null;
  kind: FeedbackSignalKind;
  /** Agent's pre-edit version (always present). */
  before: string;
  /** Human's edited version when applicable. */
  after: string | null;
  reason: string | null;
  /** Path of the file the signal relates to (for grouping). */
  filePath: string | null;
  createdAt: number;
};

export type FeedbackSignalInput = Omit<FeedbackSignal, "id" | "createdAt">;

/** A (prompt, chosen, rejected) tuple suitable for preference fine-tuning. */
export type PreferencePair = {
  id: string;
  /** The original task / context block used as prompt. */
  prompt: string;
  /** Preferred completion (typically the human edit). */
  chosen: string;
  /** Rejected completion (typically the agent's raw output). */
  rejected: string;
  /** Optional category for stratified sampling. */
  category: string | null;
  /** Quality score from curator: lower = noisier. */
  qualityScore: number;
  /** Signal id this pair was distilled from. */
  signalId: string;
  createdAt: number;
};

export type PreferenceDataset = {
  id: string;
  name: string;
  pairs: PreferencePair[];
  /** Filtering applied during curation. */
  curationNotes: string;
  createdAt: number;
};

// =============================================================================
// Fine-tune (optional)
// =============================================================================

export type FinetuneMethod = "lora" | "qlora";
export type FinetuneStatus =
  | "queued"
  | "training"
  | "evaluating"
  | "passed"
  | "failed"
  | "promoted"
  | "rolled_back";

export type FinetuneEvalResult = {
  baselineScore: number;
  candidateScore: number;
  delta: number;
  /** Empty when no per-task regression. Otherwise lists offending task ids. */
  perTaskRegressions: string[];
  /** General-coding holdout score (catastrophic forgetting probe). */
  holdoutScore: number;
  holdoutBaselineScore: number;
  gatePassed: boolean;
  gateReasons: string[];
};

export type FinetuneJob = {
  id: string;
  name: string;
  baseModel: string;
  datasetId: string;
  method: FinetuneMethod;
  status: FinetuneStatus;
  evalResult: FinetuneEvalResult | null;
  artifactPath: string | null;
  createdAt: number;
  updatedAt: number;
};

export type FinetuneJobInput = {
  name: string;
  baseModel: string;
  datasetId: string;
  method: FinetuneMethod;
};

export type ModelRegistryEntry = {
  id: string;
  name: string;
  kind: "base" | "lora_adapter" | "embedding_adapter";
  baseModel: string;
  /** When active, all runs use this model. Exactly one base is active by default. */
  active: boolean;
  /** Embedded eval delta vs. base for quick UI display. */
  evalDelta: number | null;
  /** Path to adapter weights (LoRA) or null for base. */
  artifactPath: string | null;
  createdAt: number;
};

// =============================================================================
// Distributed execution
// =============================================================================

export type NodeStatus = "online" | "busy" | "offline" | "degraded";

export type WorkerNode = {
  id: string;
  hostname: string;
  endpoint: string;
  status: NodeStatus;
  /** Currently assigned task-node ids. */
  activeAssignments: string[];
  /** Capabilities advertised by the node (sandbox modes, models available). */
  capabilities: string[];
  lastHeartbeat: number;
  registeredAt: number;
};

export type DistributedAssignment = {
  id: string;
  nodeId: string;
  taskNodeId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "reassigned";
  startedAt: number;
  finishedAt: number | null;
};

// =============================================================================
// Proactive proposals
// =============================================================================

export type ProposalKind =
  | "refactor"
  | "add_tests"
  | "tech_debt"
  | "dependency_update"
  | "doc_gap";
export type ProposalEffort = "S" | "M" | "L";
export type ProposalStatus = "new" | "snoozed" | "dismissed" | "converted_to_task";

export type Proposal = {
  id: string;
  workspaceId: string;
  kind: ProposalKind;
  title: string;
  rationale: string;
  estimatedEffort: ProposalEffort;
  affectedFiles: string[];
  status: ProposalStatus;
  /** When snoozed, the timestamp it should reappear. */
  snoozedUntil: number | null;
  /** Set when status transitions to converted_to_task. */
  convertedRunId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ProposalInput = Omit<
  Proposal,
  "id" | "status" | "snoozedUntil" | "convertedRunId" | "createdAt" | "updatedAt"
>;

// =============================================================================
// Plugin SDK
// =============================================================================

export type PluginPermission =
  | "run_command"
  | "read_workspace"
  | "write_workspace"
  | "read_memory"
  | `network:${string}`;

export type PluginToolParameter = {
  type: "string" | "number" | "boolean";
  description?: string;
  enum?: string[];
};

export type PluginToolManifest = {
  name: string;
  description: string;
  parameters: Record<string, PluginToolParameter>;
  permissions: PluginPermission[];
};

export type PluginManifest = {
  name: string;
  version: string;
  description?: string;
  author?: string;
  tools: PluginToolManifest[];
  sandbox: "whitelist" | "wsl" | "docker";
};

export type PluginInstallation = {
  id: string;
  manifest: PluginManifest;
  /** Absolute path to plugin folder. */
  installPath: string;
  enabled: boolean;
  /** Permissions the user has explicitly approved. */
  approvedPermissions: PluginPermission[];
  installedAt: number;
};

// =============================================================================
// Long-horizon checkpoint / resume
// =============================================================================

export type CheckpointKind = "task_node_complete" | "iteration_boundary" | "manual";

export type Checkpoint = {
  id: string;
  runId: string;
  taskNodeId: string | null;
  kind: CheckpointKind;
  /** Serialized run state snapshot (JSON). */
  state: string;
  /** Markdown progress report written for the user to read async. */
  progressReport: string;
  createdAt: number;
};

// =============================================================================
// Eval suite (L4 + frozen regression)
// =============================================================================

export type EvalLevel = "L1" | "L2" | "L3" | "L4";

export type EvalTask = {
  id: string;
  level: EvalLevel;
  title: string;
  description: string;
  /** Whether this task is in the frozen regression suite (immutable). */
  frozen: boolean;
  /** Validation command run after agent finishes. */
  verifyCommand: string;
  /** Expected number of TaskNodes (rough budget). */
  expectedNodes: number;
  createdAt: number;
};

export type EvalRunResult = {
  id: string;
  taskId: string;
  modelId: string;
  pass: boolean;
  corrections: number;
  transferHits: number;
  costUsd: number;
  durationMs: number;
  errorMessage: string | null;
  createdAt: number;
};

/** Weekly aggregate over the frozen regression suite. */
export type FrozenSuiteSnapshot = {
  weekStartTs: number;
  passRate: number;
  correctionsPerTask: number;
  transferHits: number;
  totalTasks: number;
  modelId: string;
};

// =============================================================================
// Phase 4 settings (feature flags)
// =============================================================================

export type Phase4Settings = {
  globalMemoryEnabled: boolean;
  styleProfileEnabled: boolean;
  learningEnabled: boolean;
  finetuneEnabled: boolean;
  distributedEnabled: boolean;
  proactiveEnabled: boolean;
  pluginsEnabled: boolean;
  /** When true, this workspace contributes to the global pattern pool. */
  contributionMode: WorkspaceContributionMode;
  /** Background scan cadence for proactive mode (minutes between scans). */
  proactiveScanIntervalMin: number;
};

export const DEFAULT_PHASE4_SETTINGS: Phase4Settings = {
  globalMemoryEnabled: false,
  styleProfileEnabled: true,
  learningEnabled: true,
  finetuneEnabled: false,
  distributedEnabled: false,
  proactiveEnabled: false,
  pluginsEnabled: false,
  contributionMode: "isolated",
  proactiveScanIntervalMin: 30,
};

export function mergePhase4Settings(
  partial: Partial<Phase4Settings> | null | undefined,
): Phase4Settings {
  return { ...DEFAULT_PHASE4_SETTINGS, ...(partial ?? {}) };
}
