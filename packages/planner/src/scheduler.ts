/** Runtime scheduler over a set of TaskNodes + a static wave computation. */

import type { TaskNode, TaskSchedule } from "@nlc/shared";

import { scopesOverlap, topoOrder } from "./dependency-graph.js";

/**
 * Conceptual cap on how many nodes a single wave proposes to run in parallel.
 * The real worker-pool cap lives in the executor; this is a planning hint so
 * waves don't grow unbounded. Documented here, applied in {@link computeSchedule}.
 */
export const MAX_PARALLELISM = 3;

/**
 * Tracks the live status of a DAG of TaskNodes and answers "what can run now?".
 * Mutating methods return new node snapshots internally rather than editing the
 * caller's objects in place.
 */
export class Scheduler {
  private readonly nodes = new Map<string, TaskNode>();

  constructor(nodes: TaskNode[]) {
    for (const node of nodes) {
      this.nodes.set(node.id, { ...node });
    }
  }

  /** All nodes (snapshot copies), in insertion order. */
  all(): TaskNode[] {
    return [...this.nodes.values()].map((n) => ({ ...n }));
  }

  get(id: string): TaskNode | undefined {
    const node = this.nodes.get(id);
    return node ? { ...node } : undefined;
  }

  /** Pending nodes whose dependencies have all succeeded. */
  ready(): TaskNode[] {
    const out: TaskNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.status !== "pending") continue;
      const depsDone = node.dependsOn.every(
        (dep) => this.nodes.get(dep)?.status === "succeeded",
      );
      if (depsDone) out.push({ ...node });
    }
    return out;
  }

  markRunning(id: string): void {
    this.setStatus(id, "running");
  }

  markSucceeded(id: string): void {
    this.setStatus(id, "succeeded");
  }

  markBlocked(id: string): void {
    this.setStatus(id, "blocked");
  }

  /**
   * Mark a node failed. With `cascade` (default), transitively block every node
   * that depends on it, since those can never become ready.
   */
  markFailed(id: string, cascade = true): void {
    this.setStatus(id, "failed");
    if (cascade) this.cascadeBlock(id);
  }

  /** Block all transitive dependents of `id`. */
  cascadeBlock(id: string): void {
    const dependents = this.buildDependents();
    const queue = [...(dependents.get(id) ?? [])];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const next = queue.shift() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      const node = this.nodes.get(next);
      if (node && node.status !== "failed" && node.status !== "succeeded") {
        this.setStatus(next, "blocked");
      }
      queue.push(...(dependents.get(next) ?? []));
    }
  }

  /** Every node has reached a terminal state (no pending/running left). */
  isComplete(): boolean {
    for (const node of this.nodes.values()) {
      if (node.status === "pending" || node.status === "running") return false;
    }
    return true;
  }

  /** Every node succeeded. */
  allDone(): boolean {
    for (const node of this.nodes.values()) {
      if (node.status !== "succeeded") return false;
    }
    return true;
  }

  private setStatus(id: string, status: TaskNode["status"]): void {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Unknown task node "${id}".`);
    this.nodes.set(id, { ...node, status, updatedAt: Date.now() });
  }

  private buildDependents(): Map<string, string[]> {
    const dependents = new Map<string, string[]>();
    for (const node of this.nodes.values()) dependents.set(node.id, []);
    for (const node of this.nodes.values()) {
      for (const dep of node.dependsOn) {
        dependents.get(dep)?.push(node.id);
      }
    }
    return dependents;
  }
}

/**
 * Compute a topological wave schedule. Within each wave, no two nodes share an
 * overlapping `filesScope` (per {@link scopesOverlap}) — overlapping nodes are
 * pushed to a later wave so they never run concurrently. Each wave is also
 * capped at {@link MAX_PARALLELISM} nodes.
 */
export function computeSchedule(nodes: TaskNode[]): TaskSchedule {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const proposals = nodes.map((n) => ({
    id: n.id,
    title: n.title,
    description: n.description,
    dependsOn: n.dependsOn,
  }));
  const order = topoOrder(proposals);

  const placed = new Map<string, number>(); // node id -> wave index
  const waves: string[][] = [];

  for (const id of order) {
    const node = byId.get(id);
    if (!node) continue;
    const minWave = earliestWaveAfterDeps(node, placed);
    const waveIndex = findWaveSlot(node, byId, waves, minWave);
    if (!waves[waveIndex]) waves[waveIndex] = [];
    (waves[waveIndex] as string[]).push(id);
    placed.set(id, waveIndex);
  }

  return { waves: waves.filter((w) => w.length > 0) };
}

/** A node must land in a wave strictly after all its dependencies' waves. */
function earliestWaveAfterDeps(
  node: TaskNode,
  placed: Map<string, number>,
): number {
  let minWave = 0;
  for (const dep of node.dependsOn) {
    const depWave = placed.get(dep);
    if (depWave != null) minWave = Math.max(minWave, depWave + 1);
  }
  return minWave;
}

/**
 * Find the first wave at or after `minWave` where `node` fits: it must not
 * exceed the parallelism cap and must not overlap any node already in the wave.
 */
function findWaveSlot(
  node: TaskNode,
  byId: Map<string, TaskNode>,
  waves: string[][],
  minWave: number,
): number {
  for (let w = minWave; ; w++) {
    const wave = waves[w] ?? [];
    if (wave.length >= MAX_PARALLELISM) continue;
    const conflict = wave.some((otherId) => {
      const other = byId.get(otherId);
      if (!other) return false;
      return scopesOverlap(node.filesScope ?? [], other.filesScope ?? []);
    });
    if (!conflict) return w;
  }
}
