/** Cluster store: worker-node registry + distributed task assignments. */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { DistributedAssignment, WorkerNode } from "@nlc/shared";
import {
  toDistributedAssignment,
  toWorkerNode,
  type DistributedAssignmentRow,
  type WorkerNodeRow,
} from "../rows/cluster-rows.js";

export class ClusterStore {
  constructor(private readonly db: Database.Database) {}

  upsertWorkerNode(node: Omit<WorkerNode, "registeredAt">): WorkerNode {
    const existing = this.db
      .prepare("SELECT * FROM worker_nodes WHERE id = ?")
      .get(node.id) as WorkerNodeRow | undefined;
    if (existing) {
      this.db
        .prepare(
          "UPDATE worker_nodes SET hostname = ?, endpoint = ?, status = ?, capabilities = ?, active_assignments = ?, last_heartbeat = ? WHERE id = ?",
        )
        .run(
          node.hostname,
          node.endpoint,
          node.status,
          JSON.stringify(node.capabilities),
          JSON.stringify(node.activeAssignments),
          node.lastHeartbeat,
          node.id,
        );
      return { ...node, registeredAt: existing.registered_at };
    }
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO worker_nodes
         (id, hostname, endpoint, status, capabilities, active_assignments, last_heartbeat, registered_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        node.id,
        node.hostname,
        node.endpoint,
        node.status,
        JSON.stringify(node.capabilities),
        JSON.stringify(node.activeAssignments),
        node.lastHeartbeat,
        now,
      );
    return { ...node, registeredAt: now };
  }

  listWorkerNodes(): WorkerNode[] {
    const rows = this.db
      .prepare("SELECT * FROM worker_nodes ORDER BY registered_at ASC")
      .all() as WorkerNodeRow[];
    return rows.map(toWorkerNode);
  }

  recordAssignment(assignment: Omit<DistributedAssignment, "id">): DistributedAssignment {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO distributed_assignments (id, node_id, task_node_id, status, started_at, finished_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(
        id,
        assignment.nodeId,
        assignment.taskNodeId,
        assignment.status,
        assignment.startedAt,
        assignment.finishedAt,
      );
    return { ...assignment, id };
  }

  listAssignments(nodeId?: string): DistributedAssignment[] {
    const rows = (
      nodeId
        ? this.db
            .prepare(
              "SELECT * FROM distributed_assignments WHERE node_id = ? ORDER BY started_at DESC",
            )
            .all(nodeId)
        : this.db.prepare("SELECT * FROM distributed_assignments ORDER BY started_at DESC").all()
    ) as DistributedAssignmentRow[];
    return rows.map(toDistributedAssignment);
  }
}
