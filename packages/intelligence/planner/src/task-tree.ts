/** Validation + materialization of a planner TaskBreakdown into TaskNodes. */

import {
  TASK_MAX_NODES,
  TASK_MIN_NODES,
  type TaskBreakdown,
  type TaskNode,
  type TaskNodeProposal,
} from "@nlc/shared";

import { detectCycles } from "./dependency-graph.js";

/**
 * Validate a breakdown and return a list of human-readable issues.
 * An empty array means the breakdown is structurally valid.
 */
export function validateBreakdown(b: TaskBreakdown): string[] {
  const issues: string[] = [];
  const tasks = b.tasks ?? [];

  if (tasks.length < TASK_MIN_NODES || tasks.length > TASK_MAX_NODES) {
    issues.push(
      `Node count ${tasks.length} is outside the allowed range [${TASK_MIN_NODES}, ${TASK_MAX_NODES}].`,
    );
  }

  const ids = new Set<string>();
  const duplicates = new Set<string>();
  for (const t of tasks) {
    if (ids.has(t.id)) duplicates.add(t.id);
    ids.add(t.id);
  }
  for (const dup of duplicates) {
    issues.push(`Duplicate task id "${dup}".`);
  }

  for (const t of tasks) {
    if (!t.title || t.title.trim() === "") {
      issues.push(`Task "${t.id}" is missing a title.`);
    }
    if (!t.description || t.description.trim() === "") {
      issues.push(`Task "${t.id}" is missing a description.`);
    }
    for (const dep of t.dependsOn ?? []) {
      if (!ids.has(dep)) {
        issues.push(`Task "${t.id}" depends on unknown id "${dep}".`);
      }
      if (dep === t.id) {
        issues.push(`Task "${t.id}" depends on itself.`);
      }
    }
  }

  if (b.root && !ids.has(b.root)) {
    issues.push(`Root id "${b.root}" does not match any task.`);
  }

  const cycleIds = detectCycles(tasks);
  if (cycleIds.length > 0) {
    issues.push(`Dependency cycle detected among [${cycleIds.sort().join(", ")}].`);
  }

  return issues;
}

/**
 * Turn planner proposals into fully-formed TaskNodes for persistence.
 * Ids are preserved; status starts as "pending"; timestamps default to `now`.
 */
export function materializeNodes(
  parentRunId: string,
  b: TaskBreakdown,
  now: number = Date.now(),
): TaskNode[] {
  return (b.tasks ?? []).map((proposal) => proposalToNode(parentRunId, proposal, now));
}

function proposalToNode(
  parentRunId: string,
  proposal: TaskNodeProposal,
  now: number,
): TaskNode {
  const node: TaskNode = {
    id: proposal.id,
    parentRunId,
    title: proposal.title,
    description: proposal.description,
    status: "pending",
    dependsOn: [...(proposal.dependsOn ?? [])],
    createdAt: now,
    updatedAt: now,
  };
  if (proposal.verifyCommand != null && proposal.verifyCommand !== "") {
    node.verifyCommand = proposal.verifyCommand;
  }
  if (proposal.filesScope && proposal.filesScope.length > 0) {
    node.filesScope = [...proposal.filesScope];
  }
  return node;
}
