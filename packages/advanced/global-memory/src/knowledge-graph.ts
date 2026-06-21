/**
 * Knowledge graph port + facade. Same pattern as Phase 3 memory: this package
 * never imports `@nlc/storage`. It depends on a `KnowledgeGraphStore`
 * interface; the main process injects the real implementation.
 */
import type {
  GlobalPattern,
  GlobalPatternInput,
  KGEdge,
  WorkspaceContributionMode,
} from "@nlc/shared";

/** Persistence port. Implemented by KgStore in the main process. */
export interface KnowledgeGraphStore {
  createGlobalPattern(input: GlobalPatternInput): GlobalPattern;
  getGlobalPattern(id: string): GlobalPattern | null;
  listGlobalPatterns(limit?: number): GlobalPattern[];
  listGlobalPatternsWithEmbedding(): { pattern: GlobalPattern; embedding: number[] }[];
  updateGlobalPatternConfidence(id: string, confidence: number, appliedAt?: number): void;
  appendGlobalPatternSource(id: string, workspaceId: string): void;
  retractWorkspaceContribution(workspaceId: string): { updated: number; deleted: number };
  deleteGlobalPattern(id: string): boolean;
  insertKGEdge(edge: Omit<KGEdge, "id" | "createdAt">): KGEdge;
  listKGEdges(opts?: { fromId?: string; toId?: string; edgeKind?: string }): KGEdge[];
  getWorkspaceContribution(workspaceId: string): WorkspaceContributionMode;
  setWorkspaceContribution(workspaceId: string, mode: WorkspaceContributionMode): void;
}

/**
 * High-level facade that ties together pattern insertion + edge bookkeeping.
 * Callers should prefer these methods over the raw store for consistency.
 */
export class KnowledgeGraph {
  constructor(private readonly store: KnowledgeGraphStore) {}

  /** Register a new global pattern with edges back to its source projects. */
  contribute(input: GlobalPatternInput): GlobalPattern {
    if (input.sourceProjects.length === 0) {
      throw new Error("GlobalPattern must have at least one source project");
    }
    const pattern = this.store.createGlobalPattern(input);
    for (const projectId of input.sourceProjects) {
      this.store.insertKGEdge({
        fromId: projectId,
        fromKind: "project",
        toId: pattern.id,
        toKind: "pattern",
        edgeKind: "project_has_pattern",
        weight: 1,
      });
    }
    return pattern;
  }

  /** Mark a pattern as applied in a workspace, strengthening its confidence. */
  recordApplication(patternId: string, workspaceId: string, boost = 0.05): GlobalPattern | null {
    const pattern = this.store.getGlobalPattern(patternId);
    if (!pattern) return null;
    const nextConfidence = clamp01(pattern.confidence + boost);
    this.store.updateGlobalPatternConfidence(patternId, nextConfidence, Date.now());
    this.store.insertKGEdge({
      fromId: patternId,
      fromKind: "pattern",
      toId: workspaceId,
      toKind: "project",
      edgeKind: "pattern_applied_in_project",
      weight: boost,
    });
    return { ...pattern, confidence: nextConfidence, lastAppliedAt: Date.now() };
  }

  /** Project-level cascade retraction. Pattern is deleted if no sources remain. */
  retractProject(workspaceId: string): { updated: number; deleted: number } {
    return this.store.retractWorkspaceContribution(workspaceId);
  }

  listPatterns(limit?: number): GlobalPattern[] {
    return this.store.listGlobalPatterns(limit);
  }

  edgesForProject(workspaceId: string): KGEdge[] {
    return [
      ...this.store.listKGEdges({ fromId: workspaceId }),
      ...this.store.listKGEdges({ toId: workspaceId }),
    ];
  }
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
