/** Phase 3 multi-agent (controlled) role + message-bus contracts. */

export type AgentRole = "planner" | "coder" | "reviewer" | "orchestrator";

/**
 * The only four legal inter-role message kinds. Anything not matching one of
 * these structures is rejected at the message-bus layer.
 */
export type RoleMessageKind =
  | "breakdown" // Planner -> Orchestrator: DAG proposal
  | "review_request" // Coder -> Reviewer: TaskNode + diff + test results
  | "review_result" // Reviewer -> Coder: verdict + comments
  | "handoff"; // Orchestrator -> Coder: assign a TaskNode

export type ReviewSeverity = "warning" | "blocker";

export type ReviewComment = {
  file: string;
  line: number;
  severity: ReviewSeverity;
  message: string;
};

export type ReviewVerdict = "approved" | "changes_requested";

/** Structured Reviewer output (固化 in the prompt). */
export type ReviewResult = {
  correctness: "pass" | "fail";
  scope_compliance: "pass" | "fail";
  regression_risk: "low" | "medium" | "high";
  style_consistency: "pass" | "fail";
  comments: ReviewComment[];
  verdict: ReviewVerdict;
};

import type { TaskBreakdown } from "./task.js";

/** Discriminated payloads keyed by message kind. */
export type RoleMessagePayloadMap = {
  breakdown: { breakdown: TaskBreakdown };
  review_request: {
    taskNodeId: string;
    diff: string;
    testOutput: string;
  };
  review_result: ReviewResult;
  handoff: { taskNodeId: string };
};

export type RoleMessage<K extends RoleMessageKind = RoleMessageKind> = {
  id: string;
  taskNodeId: string;
  fromRole: AgentRole;
  toRole: AgentRole;
  kind: K;
  payload: RoleMessagePayloadMap[K];
  createdAt: number;
};

/** Persisted form (payload serialized to JSON). */
export type RoleMessageRow = {
  id: string;
  taskNodeId: string;
  fromRole: AgentRole;
  toRole: AgentRole;
  kind: RoleMessageKind;
  payload: string;
  createdAt: number;
};

/** Max review iterations per TaskNode before escalating to ask_human. */
export const REVIEW_MAX_ITERATIONS = 2;
