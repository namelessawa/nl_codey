import { describe, expect, it } from "vitest";
import type { MemoryEntry } from "@coding-agent/shared";
import { MemoryRetriever, cosineSimilarity } from "./retriever.js";
import {
  FakeEmbeddingProvider,
  FakeMemoryStore,
  makeEntry,
} from "./test-helpers.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("returns 0 for empty or mismatched-length input", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
  });
});

async function embedSeed(
  store: FakeMemoryStore,
  embedder: FakeEmbeddingProvider,
  entry: MemoryEntry,
): Promise<void> {
  const [vec] = await embedder.embed([`${entry.title} ${entry.body}`]);
  store.seed(entry, vec ?? null);
}

describe("MemoryRetriever.retrieve", () => {
  it("ranks the semantically closest entry first", async () => {
    const store = new FakeMemoryStore();
    const embedder = new FakeEmbeddingProvider();
    await embedSeed(
      store,
      embedder,
      makeEntry({ id: "match", title: "database migration sqlite schema" }),
    );
    await embedSeed(
      store,
      embedder,
      makeEntry({ id: "other", title: "unrelated css animation styling" }),
    );

    const retriever = new MemoryRetriever(store, embedder);
    const hits = await retriever.retrieve("database migration sqlite", {
      workspaceId: "ws-1",
    });

    expect(hits[0]?.entry.id).toBe("match");
  });

  it("flat-boosts preferred kinds so they surface above neutral hits", async () => {
    const store = new FakeMemoryStore();
    const embedder = new FakeEmbeddingProvider();
    await embedSeed(
      store,
      embedder,
      makeEntry({ id: "pref", kind: "preference", title: "zzz unrelated" }),
    );
    await embedSeed(
      store,
      embedder,
      makeEntry({ id: "fact", kind: "fact", title: "query topic match here" }),
    );

    const retriever = new MemoryRetriever(store, embedder);
    const hits = await retriever.retrieve("query topic match", {
      workspaceId: "ws-1",
      preferKinds: ["preference"],
    });

    expect(hits[0]?.entry.id).toBe("pref");
  });

  it("falls back to keyword overlap when an entry has no embedding", async () => {
    const store = new FakeMemoryStore();
    const embedder = new FakeEmbeddingProvider();
    store.seed(
      makeEntry({ id: "kw", title: "rollback snapshot restore" }),
      null,
    );

    const retriever = new MemoryRetriever(store, embedder);
    const hits = await retriever.retrieve("snapshot rollback", {
      workspaceId: "ws-1",
    });

    expect(hits[0]?.entry.id).toBe("kw");
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it("filters out hits below minScore", async () => {
    const store = new FakeMemoryStore();
    const embedder = new FakeEmbeddingProvider();
    store.seed(makeEntry({ id: "weak", title: "completely different words" }), null);

    const retriever = new MemoryRetriever(store, embedder);
    const hits = await retriever.retrieve("nothing matches xyz", {
      workspaceId: "ws-1",
      minScore: 0.5,
    });

    expect(hits).toHaveLength(0);
  });

  it("caps results at maxEntries", async () => {
    const store = new FakeMemoryStore();
    const embedder = new FakeEmbeddingProvider();
    for (let i = 0; i < 10; i += 1) {
      await embedSeed(store, embedder, makeEntry({ title: `topic item ${i}` }));
    }

    const retriever = new MemoryRetriever(store, embedder);
    const hits = await retriever.retrieve("topic item", {
      workspaceId: "ws-1",
      maxEntries: 3,
    });

    expect(hits).toHaveLength(3);
  });

  it("does not mutate the entries it returns", async () => {
    const store = new FakeMemoryStore();
    const embedder = new FakeEmbeddingProvider();
    await embedSeed(store, embedder, makeEntry({ id: "e1", title: "topic" }));

    const retriever = new MemoryRetriever(store, embedder);
    await retriever.retrieve("topic", { workspaceId: "ws-1" });

    expect(store.getMemory("e1")?.usefulness).toBe(0);
    expect(store.getMemory("e1")?.lastUsedAt).toBeUndefined();
  });

  it("returns an empty array when the workspace has no memory", async () => {
    const store = new FakeMemoryStore();
    const embedder = new FakeEmbeddingProvider();
    const retriever = new MemoryRetriever(store, embedder);

    expect(await retriever.retrieve("anything", { workspaceId: "ws-1" })).toEqual(
      [],
    );
  });
});
