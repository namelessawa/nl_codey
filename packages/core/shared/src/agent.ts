/** Core agent + persistence domain types shared across main, packages, and renderer. */

export type Workspace = {
  id: string;
  rootPath: string;
  openedAt: number;
};

export type AgentRunState =
  | "idle"
  | "planning"
  | "searching"
  | "reading"
  | "editing"
  | "tool_use"
  | "waiting_for_user_approval"
  | "applying_patch"
  | "running_command"
  | "verifying"
  | "repairing"
  | "done"
  | "failed"
  | "cancelled"
  | "budget_exceeded";

export type AgentRun = {
  id: string;
  workspaceId: string;
  userTask: string;
  status: AgentRunState;
  createdAt: number;
  updatedAt: number;
  /** Cumulative token/cost/iteration accounting (Phase 2). Optional for
   * backward compatibility with pre-Phase-2 run records and fixtures. */
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  toolCallCount?: number;
  iterationCount?: number;
  /** Model that executed the run, e.g. "gpt-4o". */
  modelName?: string | null;
  /** How the run ended, e.g. "done", "max_cost", "needs_human". */
  exitReason?: string | null;
  /** Stable link to the CLI JSONL session that owns this run, when any. */
  sessionId?: string | null;
  sessionFilePath?: string | null;
  /** Runtime owner used by startup recovery to avoid touching a live peer. */
  runtimeInstanceId?: string | null;
  ownerPid?: number | null;
};

export type AgentStepType =
  | "message"
  | "tool_call"
  | "tool_result"
  | "diff"
  | "command"
  | "error";

export type AgentStep = {
  id: string;
  runId: string;
  type: AgentStepType;
  content: string;
  createdAt: number;
};

/**
 * When a snapshot was taken in a run's lifecycle:
 * - `before_run`: original state before the first apply_patch
 * - `before_iteration`: state before a repair iteration
 * - `after_run`: final state after the run finished
 */
export type SnapshotType = "before_run" | "before_iteration" | "after_run";

export type FileSnapshot = {
  id: string;
  runId: string;
  filePath: string;
  beforeContent: string;
  /**
   * Whether the path existed before the mutation. Legacy snapshots omit this
   * field and are treated conservatively as pre-existing files.
   */
  beforeExisted?: boolean;
  afterContent?: string;
  /** Whether the path existed after the mutation; absent means unknown. */
  afterExisted?: boolean;
  createdAt: number;
  /** Repair-loop iteration this snapshot belongs to (0 = before first patch). */
  iteration?: number;
  snapshotType?: SnapshotType;
};

/** Structured plan the LLM returns during the planning phase. */
export type AgentPlan = {
  summary: string;
  searchQueries: string[];
  likelyFiles: string[];
  suggestedCommands: string[];
};

/** Detected project shape used to suggest validation commands. */
export type ProjectKind =
  | "node"
  | "python"
  | "go"
  | "rust"
  | "unknown";

export type ProjectInfo = {
  kind: ProjectKind;
  suggestedCommands: string[];
};
