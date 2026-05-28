/** DAG primitives for the Planner: glob scope overlap, cycle detection, topo order. */

import type { TaskNodeProposal } from "@coding-agent/shared";

/**
 * Compile a glob into a RegExp anchored to the whole path.
 * Supported tokens:
 *   - `**` matches any number of path segments (including `/`).
 *   - `*`  matches anything except a path separator.
 *   - `?`  matches a single non-separator character.
 * All other regex metacharacters are escaped literally.
 */
export function globToRegExp(glob: string): RegExp {
  const normalized = normalizeGlob(glob);
  let out = "";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        // `**` -> any chars including separators. Swallow a trailing slash.
        out += ".*";
        i++;
        if (normalized[i + 1] === "/") i++;
      } else {
        // `*` -> any chars except a separator.
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += escapeRegExpChar(ch as string);
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * Conservative overlap heuristic between two sets of globs.
 *
 * Two scopes overlap if ANY glob `ga` in `a` could touch the same files as
 * ANY glob `gb` in `b`. For a single pair we treat them as overlapping when:
 *   1. They are equal after normalization, OR
 *   2. One's literal prefix (the leading path before the first wildcard) is a
 *      parent directory of — or equal to — the other's literal prefix
 *      (nested prefixes), OR
 *   3. Either glob, when compiled, matches the other's literal prefix.
 *
 * This is intentionally conservative: it prefers reporting a possible overlap
 * (serializing two sub-tasks) over missing a real one (letting them clobber
 * each other's files). It can produce false positives but not false negatives
 * for prefix-nested scopes.
 */
export function scopesOverlap(a: string[], b: string[]): boolean {
  for (const ga of a) {
    for (const gb of b) {
      if (pairOverlaps(ga, gb)) return true;
    }
  }
  return false;
}

function pairOverlaps(ga: string, gb: string): boolean {
  const na = normalizeGlob(ga);
  const nb = normalizeGlob(gb);
  if (na === nb) return true;

  const pa = literalPrefix(na);
  const pb = literalPrefix(nb);

  // Nested literal prefixes (one is a parent dir of the other, or equal).
  if (isPrefixDir(pa, pb) || isPrefixDir(pb, pa)) return true;

  // A glob may match the other's literal prefix directory path.
  if (pb.length > 0 && globToRegExp(na).test(pb)) return true;
  if (pa.length > 0 && globToRegExp(nb).test(pa)) return true;

  return false;
}

/** Leading literal path of a glob, up to (not including) the first wildcard. */
function literalPrefix(glob: string): string {
  const wildcardAt = glob.search(/[*?]/);
  const head = wildcardAt === -1 ? glob : glob.slice(0, wildcardAt);
  // Trim back to the last complete segment.
  const lastSlash = head.lastIndexOf("/");
  if (wildcardAt === -1) return head;
  return lastSlash === -1 ? "" : head.slice(0, lastSlash);
}

/** True if `parent` is the same directory as, or an ancestor of, `child`. */
function isPrefixDir(parent: string, child: string): boolean {
  if (parent === "") return true;
  if (parent === child) return true;
  return child.startsWith(`${parent}/`);
}

function normalizeGlob(glob: string): string {
  return glob.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function escapeRegExpChar(ch: string): string {
  return /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

/**
 * Return the ids of all nodes that participate in at least one dependency
 * cycle. Returns an empty array when the graph is a DAG.
 */
export function detectCycles(tasks: TaskNodeProposal[]): string[] {
  const adjacency = buildAdjacency(tasks);
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of adjacency.keys()) color.set(id, WHITE);

  const inCycle = new Set<string>();
  const stack: string[] = [];

  const visit = (node: string): void => {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      if (!adjacency.has(next)) continue; // unknown dep: handled by validator
      const c = color.get(next);
      if (c === GRAY) {
        // Found a back-edge: everything from `next` up the stack is in a cycle.
        const start = stack.lastIndexOf(next);
        for (let i = start; i < stack.length; i++) {
          inCycle.add(stack[i] as string);
        }
      } else if (c === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  };

  for (const id of adjacency.keys()) {
    if (color.get(id) === WHITE) visit(id);
  }
  return [...inCycle];
}

/**
 * Topologically order task ids (dependencies first). Throws if the graph
 * contains a cycle.
 */
export function topoOrder(tasks: TaskNodeProposal[]): string[] {
  const cycleIds = detectCycles(tasks);
  if (cycleIds.length > 0) {
    throw new Error(`Cannot topologically sort: cycle among [${cycleIds.join(", ")}]`);
  }

  const adjacency = buildAdjacency(tasks);
  const indegree = new Map<string, number>();
  for (const id of adjacency.keys()) indegree.set(id, 0);
  for (const deps of adjacency.values()) {
    for (const dep of deps) {
      if (indegree.has(dep)) indegree.set(dep, (indegree.get(dep) ?? 0) + 1);
    }
  }

  // A node is "ready" once all of its dependents that point INTO it are done.
  // We treat edges as dependency -> dependent for ordering, so build the
  // reverse: emit a node only after its dependencies are emitted.
  const dependents = new Map<string, string[]>();
  for (const id of adjacency.keys()) dependents.set(id, []);
  const remainingDeps = new Map<string, number>();
  for (const t of tasks) {
    remainingDeps.set(
      t.id,
      t.dependsOn.filter((d) => adjacency.has(d)).length,
    );
  }
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (adjacency.has(dep)) dependents.get(dep)?.push(t.id);
    }
  }

  const queue = [...remainingDeps.entries()]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort();
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    const newlyReady: string[] = [];
    for (const dependent of dependents.get(id) ?? []) {
      const left = (remainingDeps.get(dependent) ?? 0) - 1;
      remainingDeps.set(dependent, left);
      if (left === 0) newlyReady.push(dependent);
    }
    // Keep deterministic ordering within a level.
    queue.push(...newlyReady.sort());
  }
  return order;
}

function buildAdjacency(tasks: TaskNodeProposal[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const t of tasks) adjacency.set(t.id, [...t.dependsOn]);
  return adjacency;
}
