/** Long-horizon checkpoint + eval-suite types (L1–L4 and frozen regression). */

// =============================================================================
// Checkpoint / resume
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
