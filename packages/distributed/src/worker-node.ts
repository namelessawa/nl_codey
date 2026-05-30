/**
 * Worker node port. Implemented on the worker machine to receive task-node
 * submissions from the coordinator. This package only defines the contract;
 * the desktop main process implements transport (mTLS over HTTPS).
 */
import type { TaskNode, TaskNodeStatus } from "@coding-agent/shared";

export type WorkerJob = {
  task: TaskNode;
  /** Git ref to check out before starting. */
  baseRef: string;
  /** Where to push results (a coordination branch). */
  resultBranch: string;
};

export interface WorkerExecutor {
  /** Execute one TaskNode in the local sandbox; return its terminal status. */
  execute(job: WorkerJob): Promise<TaskNodeStatus>;
}

export type WorkerInfo = {
  id: string;
  hostname: string;
  endpoint: string;
  capabilities: string[];
};

/** Heartbeat payload pushed from worker → coordinator. */
export type Heartbeat = {
  nodeId: string;
  status: "online" | "busy" | "degraded";
  activeAssignments: string[];
  timestamp: number;
};

export function makeHeartbeat(
  nodeId: string,
  activeAssignments: string[],
  status: Heartbeat["status"] = "online",
): Heartbeat {
  return { nodeId, status, activeAssignments, timestamp: Date.now() };
}
