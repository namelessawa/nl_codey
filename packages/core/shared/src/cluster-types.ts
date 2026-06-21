/** Distributed execution (cluster) types: worker nodes + assignments. */

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
