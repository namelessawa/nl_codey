/** Cluster (distributed) row converters: worker nodes + assignments. */

import type { DistributedAssignment, WorkerNode } from "@nlc/shared";

export type WorkerNodeRow = {
  id: string;
  hostname: string;
  endpoint: string;
  status: string;
  capabilities: string;
  active_assignments: string;
  last_heartbeat: number;
  registered_at: number;
};

export function toWorkerNode(r: WorkerNodeRow): WorkerNode {
  return {
    id: r.id,
    hostname: r.hostname,
    endpoint: r.endpoint,
    status: r.status as WorkerNode["status"],
    capabilities: JSON.parse(r.capabilities) as string[],
    activeAssignments: JSON.parse(r.active_assignments) as string[],
    lastHeartbeat: r.last_heartbeat,
    registeredAt: r.registered_at,
  };
}

export type DistributedAssignmentRow = {
  id: string;
  node_id: string;
  task_node_id: string;
  status: string;
  started_at: number;
  finished_at: number | null;
};

export function toDistributedAssignment(r: DistributedAssignmentRow): DistributedAssignment {
  return {
    id: r.id,
    nodeId: r.node_id,
    taskNodeId: r.task_node_id,
    status: r.status as DistributedAssignment["status"],
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}
