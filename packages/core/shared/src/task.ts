/** Phase 3 task decomposition (sub-task DAG) contracts. */

export type TaskNodeStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "cancelled";

export type TaskNode = {
  id: string;
  parentRunId: string;
  /** Short title, e.g. "Add refund method to PaymentService". */
  title: string;
  /** Full description handed to the sub-agent. */
  description: string;
  status: TaskNodeStatus;
  /** Other TaskNode ids this depends on. */
  dependsOn: string[];
  /** This sub-task's own verification command, if any. */
  verifyCommand?: string;
  /** Glob patterns of files this sub-task may modify. */
  filesScope?: string[];
  /** AgentRun id when actually executing. */
  subRunId?: string;
  createdAt: number;
  updatedAt: number;
};

/** Planner-proposed node before persistence (no ids/timestamps yet). */
export type TaskNodeProposal = {
  id: string;
  title: string;
  description: string;
  dependsOn: string[];
  verifyCommand?: string | null;
  filesScope?: string[];
};

/** Full DAG proposal from the Planner role. */
export type TaskBreakdown = {
  root: string;
  tasks: TaskNodeProposal[];
};

export type TaskNodePatch = Partial<
  Pick<TaskNode, "title" | "description" | "status" | "dependsOn" | "verifyCommand" | "filesScope" | "subRunId">
>;

/** A scheduled execution plan: topologically ordered, with parallelizable groups. */
export type TaskSchedule = {
  /** Each entry is a set of node ids that may run in parallel. */
  waves: string[][];
};

/** DAG node-count guardrails enforced by the decomposer/validator. */
export const TASK_MIN_NODES = 1;
export const TASK_MAX_NODES = 12;
/** Per-sub-task verifier loop attempts. */
export const TASK_MAX_VERIFY_ITERATIONS = 3;
