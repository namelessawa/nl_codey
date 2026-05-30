/**
 * Node-recovery loop. When a worker disappears, the coordinator must reassign
 * any TaskNode that node was running back to the ready queue, so another
 * worker can pick it up. Idempotent and re-entrant: safe to call repeatedly.
 */
import type { DistributedAssignment, WorkerNode } from "@coding-agent/shared";

export type ReassignmentDecision = {
  failedNodeId: string;
  taskNodeId: string;
  /** Suggested new owner (least-loaded online node), or null if no replacement available. */
  reassignTo: string | null;
};

export function detectFailedNodes(
  nodes: WorkerNode[],
  now = Date.now(),
  maxAgeMs = 30_000,
): WorkerNode[] {
  return nodes.filter((n) => n.status !== "online" || now - n.lastHeartbeat > maxAgeMs);
}

export function planReassignments(
  failedNodes: WorkerNode[],
  assignments: DistributedAssignment[],
  onlineNodes: WorkerNode[],
): ReassignmentDecision[] {
  const failedIds = new Set(failedNodes.map((n) => n.id));
  const candidates = onlineNodes.filter((n) => !failedIds.has(n.id));
  const sortedCandidates = candidates
    .slice()
    .sort((a, b) => a.activeAssignments.length - b.activeAssignments.length);
  let cursor = 0;

  const decisions: ReassignmentDecision[] = [];
  for (const assignment of assignments) {
    if (assignment.status !== "running") continue;
    if (!failedIds.has(assignment.nodeId)) continue;
    const target = sortedCandidates.length > 0
      ? sortedCandidates[cursor % sortedCandidates.length] ?? null
      : null;
    if (target) cursor++;
    decisions.push({
      failedNodeId: assignment.nodeId,
      taskNodeId: assignment.taskNodeId,
      reassignTo: target?.id ?? null,
    });
  }
  return decisions;
}
