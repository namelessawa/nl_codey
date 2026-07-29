import { describe, it, expect } from "vitest";
import type { IndexedChunk } from "@nlc/shared";
import {
  annotateSemanticHitStaleness,
  cosineSimilarity,
  searchChunks,
} from "./vector-store.js";
import { FakeChunkStore } from "./fake-store.js";
import { MockEmbeddingProvider } from "./embedder.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("returns 0 for mismatched lengths or zero vectors", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

function chunk(partial: Partial<IndexedChunk> & { embedding: number[]; content: string }): IndexedChunk {
  return {
    id: partial.id ?? "id",
    workspaceId: "ws",
    filePath: partial.filePath ?? "a.ts",
    startLine: partial.startLine ?? 1,
    endLine: partial.endLine ?? 5,
    kind: partial.kind ?? "code",
    content: partial.content,
    embedding: partial.embedding,
    ...(partial.symbolName ? { symbolName: partial.symbolName } : {}),
  };
}

describe("searchChunks", () => {
  it("ranks the most similar chunk first and never returns the embedding", async () => {
    const store = new FakeChunkStore();
    const embedder = new MockEmbeddingProvider();
    const [dbVec, uiVec] = await embedder.embed([
      "open a database connection pool",
      "render a react button component",
    ]);

    store.replaceChunksForFile(
      "ws",
      "db.ts",
      [chunk({ id: "db", filePath: "db.ts", content: "open a database connection pool", embedding: dbVec ?? [] })],
      1,
    );
    store.replaceChunksForFile(
      "ws",
      "ui.ts",
      [chunk({ id: "ui", filePath: "ui.ts", content: "render a react button component", embedding: uiVec ?? [] })],
      1,
    );

    const hits = await searchChunks(store, embedder, "ws", "database connection pool");
    expect(hits[0]?.filePath).toBe("db.ts");
    expect(hits[0]).not.toHaveProperty("embedding");
    expect(hits[0]?.snippet.length).toBeLessThanOrEqual(200);
    expect(hits[0]?.provenance).toMatchObject({
      source: "semantic_index",
      chunkId: "db",
      indexedMtime: 1,
      currentMtime: null,
      staleness: "unknown",
      rank: 1,
      truncated: false,
    });
    expect(hits[0]?.provenance.selectionReason).toContain(
      "rank 1 by cosine similarity",
    );
  });

  it("filters by kind", async () => {
    const store = new FakeChunkStore();
    const embedder = new MockEmbeddingProvider();
    const [vec] = await embedder.embed(["text"]);

    store.replaceChunksForFile("ws", "a.ts", [chunk({ id: "c", content: "code chunk", kind: "code", embedding: vec ?? [] })], 1);
    store.replaceChunksForFile("ws", "b.md", [chunk({ id: "d", filePath: "b.md", content: "doc chunk", kind: "doc", embedding: vec ?? [] })], 1);

    const hits = await searchChunks(store, embedder, "ws", "text", { kinds: ["doc"] });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe("doc");
  });

  it("respects topK", async () => {
    const store = new FakeChunkStore();
    const embedder = new MockEmbeddingProvider();
    const [vec] = await embedder.embed(["x"]);
    for (let i = 0; i < 5; i++) {
      store.replaceChunksForFile("ws", `f${i}.ts`, [chunk({ id: `c${i}`, filePath: `f${i}.ts`, content: `chunk ${i}`, embedding: vec ?? [] })], 1);
    }
    const hits = await searchChunks(store, embedder, "ws", "chunk", { topK: 2 });
    expect(hits).toHaveLength(2);
  });

  it("returns empty for blank query or empty store", async () => {
    const store = new FakeChunkStore();
    const embedder = new MockEmbeddingProvider();
    expect(await searchChunks(store, embedder, "ws", "   ")).toEqual([]);
    expect(await searchChunks(store, embedder, "ws", "anything")).toEqual([]);
  });

  it("annotates fresh, modified, and missing sources without source content", async () => {
    const store = new FakeChunkStore();
    const embedder = new MockEmbeddingProvider();
    const longContent = `function target() {}\n${"x".repeat(250)}`;
    const [vec] = await embedder.embed([longContent]);
    store.replaceChunksForFile(
      "ws",
      "target.ts",
      [
        chunk({
          id: "target",
          filePath: "target.ts",
          content: longContent,
          embedding: vec ?? [],
          symbolName: "target",
        }),
      ],
      10,
    );

    const [stored] = await searchChunks(store, embedder, "ws", "target");
    expect(stored?.provenance).toMatchObject({
      indexedMtime: 10,
      staleness: "unknown",
      truncated: true,
      originalChars: longContent.length,
    });

    const fresh = annotateSemanticHitStaleness(
      stored ? [stored] : [],
      new Map([["target.ts", 10]]),
    );
    expect(fresh[0]?.provenance).toMatchObject({
      currentMtime: 10,
      staleness: "fresh",
    });

    const modified = annotateSemanticHitStaleness(
      stored ? [stored] : [],
      new Map([["target.ts", 11]]),
    );
    expect(modified[0]?.provenance.staleness).toBe("modified");

    const missing = annotateSemanticHitStaleness(
      stored ? [stored] : [],
      new Map(),
    );
    expect(missing[0]?.provenance).toMatchObject({
      currentMtime: null,
      staleness: "missing",
    });
  });
});
