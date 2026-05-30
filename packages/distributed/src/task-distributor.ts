/**
 * Distributes ready TaskNodes (those with all deps satisfied) across available
 * workers. Round-robin with least-loaded preference; never overloads a single
 * node. Single-machine fallback is automatic when no workers are available.
 */
import type { TaskNode, WorkerNode } from "@coding-agent/shared";

export type DistributionPlan = {
  perNode: Map<string, TaskNode[]>;
  /** Tasks the distributor couldn't place (no workers). */
  unassigned: TaskNode[];
};

/** Filter `nodes` by capability match, then round-robin among them. */
export function planDistribution(
  readyTasks: TaskNode[],
  nodes: WorkerNode[],
  capabilityFor: (task: TaskNode) => string[] = () => [],
): DistributionPlan {
  const online = nodes.filter((n) => n.status === "online");
  const perNode = new Map<string, TaskNode[]>();
  for (const node of online) perNode.set(node.id, []);
  const unassigned: TaskNode[] = [];

  for (const task of readyTasks) {
    const required = capabilityFor(task);
    const candidates = online.filter((n) =>
      required.every((cap) => n.capabilities.includes(cap)),
    );
    if (candidates.length === 0) {
      unassigned.push(task);
      continue;
    }
    // Least-loaded by current bucket + previous active assignments.
    candidates.sort((a, b) => {
      const la = (perNode.get(a.id)?.length ?? 0) + a.activeAssignments.length;
      const lb = (perNode.get(b.id)?.length ?? 0) + b.activeAssignments.length;
      return la - lb;
    });
    const target = candidates[0]!;
    perNode.get(target.id)!.push(task);
  }
  return { perNode, unassigned };
}

/** Ready-set computation: a task is ready when all deps are in `completed`. */
export function readyTasks(
  all: TaskNode[],
  completed: Set<string>,
): TaskNode[] {
  return all.filter((t) => {
    if (t.status !== "pending") return false;
    if (completed.has(t.id)) return false;
    return t.dependsOn.every((d) => completed.has(d));
  });
}
