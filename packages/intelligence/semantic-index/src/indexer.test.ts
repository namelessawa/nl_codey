import { describe, it, expect } from "vitest";
import { SemanticIndexer } from "./indexer.js";
import { FakeChunkStore } from "./fake-store.js";
import { MockEmbeddingProvider } from "./embedder.js";

const WS = "ws";

describe("SemanticIndexer.indexFile", () => {
  it("chunks, embeds, and stores chunks with ids and embeddings", async () => {
    const store = new FakeChunkStore();
    const indexer = new SemanticIndexer(store, new MockEmbeddingProvider());

    await indexer.indexFile(WS, "a.ts", "function foo() {\n  return 1;\n}", 100);

    const chunks = store.listChunks(WS);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.id).toBeTruthy();
    expect(chunks[0]?.embedding.length).toBe(64);
    expect(chunks[0]?.symbolName).toBe("foo");
  });
});

describe("SemanticIndexer.reindexChanged (incremental)", () => {
  it("removes OLD chunks and indexes NEW chunks when a file changes", async () => {
    const store = new FakeChunkStore();
    const indexer = new SemanticIndexer(store, new MockEmbeddingProvider());

    // Initial index.
    const original = "function original() {\n  return 'OLD_MARKER';\n}";
    await indexer.reindexChanged(WS, [{ path: "a.ts", content: original, mtime: 1 }]);

    const afterFirst = store.listChunks(WS);
    expect(afterFirst.some((c) => c.content.includes("OLD_MARKER"))).toBe(true);
    expect(store.replaceCalls).toHaveLength(1);

    // Change the file (new mtime + new content).
    const updated = "function updated() {\n  return 'NEW_MARKER';\n}";
    await indexer.reindexChanged(WS, [{ path: "a.ts", content: updated, mtime: 2 }]);

    const afterSecond = store.listChunks(WS);
    // OLD chunks gone, NEW chunks present.
    expect(afterSecond.some((c) => c.content.includes("OLD_MARKER"))).toBe(false);
    expect(afterSecond.some((c) => c.content.includes("NEW_MARKER"))).toBe(true);
    // replaceChunksForFile was called again for the changed file.
    expect(store.replaceCalls).toHaveLength(2);
    expect(store.replaceCalls[1]?.filePath).toBe("a.ts");
  });

  it("skips files whose mtime is unchanged", async () => {
    const store = new FakeChunkStore();
    const indexer = new SemanticIndexer(store, new MockEmbeddingProvider());

    await indexer.reindexChanged(WS, [{ path: "a.ts", content: "function f() {}", mtime: 5 }]);
    expect(store.replaceCalls).toHaveLength(1);

    // Same mtime -> no reindex.
    await indexer.reindexChanged(WS, [{ path: "a.ts", content: "function f() {}", mtime: 5 }]);
    expect(store.replaceCalls).toHaveLength(1);
  });

  it("deletes chunks for files no longer present", async () => {
    const store = new FakeChunkStore();
    const indexer = new SemanticIndexer(store, new MockEmbeddingProvider());

    await indexer.reindexChanged(WS, [
      { path: "a.ts", content: "function a() {}", mtime: 1 },
      { path: "b.ts", content: "function b() {}", mtime: 1 },
    ]);

    // b.ts disappears.
    await indexer.reindexChanged(WS, [{ path: "a.ts", content: "function a() {}", mtime: 1 }]);

    expect(store.deleteCalls.some((d) => d.filePath === "b.ts")).toBe(true);
    expect(store.getIndexedFileMtimes(WS).has("b.ts")).toBe(false);
  });
});

describe("SemanticIndexer.indexFiles", () => {
  it("reports progress per file", async () => {
    const store = new FakeChunkStore();
    const indexer = new SemanticIndexer(store, new MockEmbeddingProvider());
    const seen: number[] = [];

    await indexer.indexFiles(
      WS,
      [
        { path: "a.ts", content: "function a() {}", mtime: 1 },
        { path: "b.ts", content: "function b() {}", mtime: 1 },
      ],
      (p) => seen.push(p.processed),
    );

    expect(seen).toEqual([1, 2]);
  });
});

describe("SemanticIndexer.status", () => {
  it("reports fresh, changed, new, and missing source coverage", async () => {
    const store = new FakeChunkStore();
    const indexer = new SemanticIndexer(store, new MockEmbeddingProvider());
    await indexer.indexFile(WS, "a.ts", "function a() {}", 42);
    await indexer.indexFile(WS, "removed.ts", "function removed() {}", 50);

    const status = indexer.status(
      WS,
      [
        { path: "a.ts", mtime: 43 },
        { path: "new.ts", mtime: 60 },
      ],
      100,
    );
    expect(status).toEqual({
      totalFiles: 2,
      indexedFiles: 2,
      freshFiles: 0,
      staleFiles: 2,
      missingFiles: 1,
      isStale: true,
      lastUpdated: 50,
      lastChecked: 100,
      building: false,
    });
  });

  it("reports a current index when every scanned mtime matches", async () => {
    const store = new FakeChunkStore();
    const indexer = new SemanticIndexer(store, new MockEmbeddingProvider());
    await indexer.indexFile(WS, "a.ts", "function a() {}", 42);

    expect(indexer.status(WS, [{ path: "a.ts", mtime: 42 }], 101)).toMatchObject({
      freshFiles: 1,
      staleFiles: 0,
      missingFiles: 0,
      isStale: false,
      lastChecked: 101,
    });
  });
});
