import { describe, expect, it } from "vitest";
import type { MemoryEntry } from "@coding-agent/shared";
import { KnowledgeGraph } from "./knowledge-graph.js";
import {
  DEFAULT_EXTRACTION_CONFIG,
  extractAndPromote,
  groupCandidates,
} from "./pattern-extractor.js";

function entry(workspaceId: string, title: string, body: string): MemoryEntry {
  return {
    id: `${workspaceId}-${title}`,
    workspaceId,
    kind: "decision",
    title,
    body,
    tags: ["error-handling"],
    createdAt: 0,
    usefulness: 1,
  };
}

describe("pattern-extractor", () => {
  it("groups entries with similar titles across projects", () => {
    const sources = [
      {
        workspaceId: "proj-a",
        entries: [entry("proj-a", "Wrap fallible IO in Result", "...")],
      },
      {
        workspaceId: "proj-b",
        entries: [entry("proj-b", "Wrap fallible IO in Result type", "...")],
      },
    ];
    const clusters = groupCandidates(sources);
    const sized = Array.from(clusters.values()).filter((c) => c.projects.size >= 2);
    expect(sized).toHaveLength(1);
    expect(sized[0]?.projects.size).toBe(2);
  });

  it("does not promote single-project entries", () => {
    const sources = [
      {
        workspaceId: "proj-a",
        entries: [entry("proj-a", "Solo pattern", "...")],
      },
    ];
    const kg = makeStubKG();
    const promoted = extractAndPromote(sources, kg);
    expect(promoted).toHaveLength(0);
  });

  it("respects weekly limit", () => {
    const sources: Parameters<typeof extractAndPromote>[0] = [];
    for (let i = 0; i < 20; i++) {
      sources.push({
        workspaceId: `proj-a-${i}`,
        entries: [entry(`proj-a-${i}`, `Pattern ${i}`, `body ${i}`)],
      });
      sources.push({
        workspaceId: `proj-b-${i}`,
        entries: [entry(`proj-b-${i}`, `Pattern ${i}`, `body ${i}`)],
      });
    }
    const kg = makeStubKG();
    const promoted = extractAndPromote(sources, kg, {
      ...DEFAULT_EXTRACTION_CONFIG,
      weeklyLimit: 3,
    });
    expect(promoted).toHaveLength(3);
  });
});

function makeStubKG(): KnowledgeGraph {
  // We just need a KG that records contributions; reuse the test store from above.
  const patterns: { id: string; sources: string[] }[] = [];
  return new KnowledgeGraph({
    createGlobalPattern(input) {
      const id = `p-${patterns.length}`;
      patterns.push({ id, sources: input.sourceProjects });
      return {
        id,
        ...input,
        createdAt: Date.now(),
        lastAppliedAt: Date.now(),
      };
    },
    getGlobalPattern: () => null,
    listGlobalPatterns: () => [],
    listGlobalPatternsWithEmbedding: () => [],
    updateGlobalPatternConfidence: () => {},
    appendGlobalPatternSource: () => {},
    retractWorkspaceContribution: () => ({ updated: 0, deleted: 0 }),
    deleteGlobalPattern: () => true,
    insertKGEdge: (e) => ({ ...e, id: "e", createdAt: Date.now() }),
    listKGEdges: () => [],
    getWorkspaceContribution: () => "isolated",
    setWorkspaceContribution: () => {},
  });
}
