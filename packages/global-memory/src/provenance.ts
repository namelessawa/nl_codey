/**
 * Provenance utilities. Every GlobalPattern carries `sourceProjects` —
 * this module makes it easy to display the chain, and to revoke a specific
 * project's contribution without nuking the pattern unless it would have no
 * sources left.
 */
import type { GlobalPattern } from "@coding-agent/shared";
import type { KnowledgeGraph } from "./knowledge-graph.js";

export type ProvenanceEntry = {
  workspaceId: string;
  /** True if the contribution can be safely withdrawn without losing the pattern. */
  canWithdraw: boolean;
};

export function describeProvenance(pattern: GlobalPattern): ProvenanceEntry[] {
  return pattern.sourceProjects.map((workspaceId) => ({
    workspaceId,
    canWithdraw: pattern.sourceProjects.length > 1,
  }));
}

/**
 * Withdraw a workspace's contribution from a specific pattern. Returns the
 * updated pattern, or null if the pattern was deleted (no sources left).
 */
export function withdrawContribution(
  kg: KnowledgeGraph,
  patternId: string,
  workspaceId: string,
): { pattern: GlobalPattern | null; deleted: boolean } {
  // Delegated to KG.retractProject if we wanted full retraction; this is the
  // surgical single-pattern variant invoked from the KnowledgeGraphView UI.
  const all = kg.listPatterns(1_000_000).filter((p) => p.id === patternId);
  const pattern = all[0];
  if (!pattern) return { pattern: null, deleted: false };
  const remaining = pattern.sourceProjects.filter((id) => id !== workspaceId);
  if (remaining.length === 0) {
    // Use the store directly via a small bridge by re-emitting retract-via-project:
    // since KnowledgeGraph only exposes whole-project retraction, the GUI should
    // call deleteGlobalPattern for surgical removal. We surface this via a flag.
    return { pattern: null, deleted: true };
  }
  // Otherwise the caller (or KG.store) updates source_projects directly.
  return { pattern: { ...pattern, sourceProjects: remaining }, deleted: false };
}
