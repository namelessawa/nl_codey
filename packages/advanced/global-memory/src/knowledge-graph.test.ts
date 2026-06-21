import { describe, expect, it } from "vitest";
import type {
  GlobalPattern,
  GlobalPatternInput,
  KGEdge,
  WorkspaceContributionMode,
} from "@nlc/shared";
import { KnowledgeGraph, type KnowledgeGraphStore } from "./knowledge-graph.js";

function makeStore(): KnowledgeGraphStore {
  const patterns: GlobalPattern[] = [];
  const edges: KGEdge[] = [];
  const contribution = new Map<string, WorkspaceContributionMode>();

  return {
    createGlobalPattern(input: GlobalPatternInput) {
      const now = Date.now();
      const pattern: GlobalPattern = {
        id: `p-${patterns.length}`,
        ...input,
        createdAt: now,
        lastAppliedAt: now,
      };
      patterns.push(pattern);
      return pattern;
    },
    getGlobalPattern(id) {
      return patterns.find((p) => p.id === id) ?? null;
    },
    listGlobalPatterns() {
      return [...patterns];
    },
    listGlobalPatternsWithEmbedding() {
      return patterns.map((p) => ({ pattern: p, embedding: p.embedding }));
    },
    updateGlobalPatternConfidence(id, confidence, appliedAt) {
      const p = patterns.find((x) => x.id === id);
      if (p) {
        p.confidence = confidence;
        if (appliedAt) p.lastAppliedAt = appliedAt;
      }
    },
    appendGlobalPatternSource(id, workspaceId) {
      const p = patterns.find((x) => x.id === id);
      if (p && !p.sourceProjects.includes(workspaceId)) {
        p.sourceProjects.push(workspaceId);
      }
    },
    retractWorkspaceContribution(workspaceId) {
      let updated = 0;
      let deleted = 0;
      for (let i = patterns.length - 1; i >= 0; i--) {
        const p = patterns[i]!;
        if (!p.sourceProjects.includes(workspaceId)) continue;
        const remaining = p.sourceProjects.filter((s) => s !== workspaceId);
        if (remaining.length === 0) {
          patterns.splice(i, 1);
          deleted++;
        } else {
          p.sourceProjects = remaining;
          updated++;
        }
      }
      return { updated, deleted };
    },
    deleteGlobalPattern(id) {
      const idx = patterns.findIndex((p) => p.id === id);
      if (idx < 0) return false;
      patterns.splice(idx, 1);
      return true;
    },
    insertKGEdge(edge) {
      const stamped = { ...edge, id: `e-${edges.length}`, createdAt: Date.now() };
      edges.push(stamped);
      return stamped;
    },
    listKGEdges(opts = {}) {
      return edges.filter(
        (e) =>
          (!opts.fromId || e.fromId === opts.fromId) &&
          (!opts.toId || e.toId === opts.toId) &&
          (!opts.edgeKind || e.edgeKind === opts.edgeKind),
      );
    },
    getWorkspaceContribution(workspaceId) {
      return contribution.get(workspaceId) ?? "isolated";
    },
    setWorkspaceContribution(workspaceId, mode) {
      contribution.set(workspaceId, mode);
    },
  };
}

describe("KnowledgeGraph", () => {
  it("contribute creates pattern and source edges", () => {
    const store = makeStore();
    const kg = new KnowledgeGraph(store);
    const input: GlobalPatternInput = {
      title: "Wrap fallible IO in Result",
      description: "Use Result<T,E> to make IO fail-safe",
      exampleSnippet: "type Result<T,E> = ...",
      sourceProjects: ["proj-a", "proj-b"],
      tags: ["error-handling", "types"],
      confidence: 0.6,
      embedding: [],
    };
    const pattern = kg.contribute(input);
    expect(pattern.id).toBeDefined();
    const edges = store.listKGEdges({ toId: pattern.id });
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.fromId).sort()).toEqual(["proj-a", "proj-b"]);
  });

  it("rejects empty source list", () => {
    const kg = new KnowledgeGraph(makeStore());
    expect(() =>
      kg.contribute({
        title: "x",
        description: "x",
        exampleSnippet: "",
        sourceProjects: [],
        tags: [],
        confidence: 0.5,
        embedding: [],
      }),
    ).toThrow();
  });

  it("recordApplication boosts confidence and adds edge", () => {
    const store = makeStore();
    const kg = new KnowledgeGraph(store);
    const pattern = kg.contribute({
      title: "x",
      description: "x",
      exampleSnippet: "",
      sourceProjects: ["proj-a"],
      tags: [],
      confidence: 0.4,
      embedding: [],
    });
    const result = kg.recordApplication(pattern.id, "proj-b", 0.1);
    expect(result?.confidence).toBeCloseTo(0.5);
    const edges = store.listKGEdges({ edgeKind: "pattern_applied_in_project" });
    expect(edges).toHaveLength(1);
  });

  it("confidence stays within [0,1] after repeated boosts", () => {
    const store = makeStore();
    const kg = new KnowledgeGraph(store);
    const p = kg.contribute({
      title: "x",
      description: "x",
      exampleSnippet: "",
      sourceProjects: ["proj-a"],
      tags: [],
      confidence: 0.95,
      embedding: [],
    });
    kg.recordApplication(p.id, "proj-b", 0.5);
    const final = store.getGlobalPattern(p.id);
    expect(final?.confidence).toBe(1);
  });

  it("retractProject deletes patterns that lose all sources", () => {
    const store = makeStore();
    const kg = new KnowledgeGraph(store);
    kg.contribute({
      title: "shared",
      description: "",
      exampleSnippet: "",
      sourceProjects: ["proj-a", "proj-b"],
      tags: [],
      confidence: 0.5,
      embedding: [],
    });
    kg.contribute({
      title: "solo",
      description: "",
      exampleSnippet: "",
      sourceProjects: ["proj-a"],
      tags: [],
      confidence: 0.5,
      embedding: [],
    });
    const result = kg.retractProject("proj-a");
    expect(result.updated).toBe(1);
    expect(result.deleted).toBe(1);
    const remaining = store.listGlobalPatterns();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.title).toBe("shared");
  });
});
