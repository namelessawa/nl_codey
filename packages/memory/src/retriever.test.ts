import { describe, expect, it } from "vitest";
import type { EmbeddingProvider, MemoryEntry } from "@coding-agent/shared";
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

  // ----- B3: relative floor + embedder fail-open --------------------------
  // Mirrors MiMo memory/service.ts:79-133 (BM25 magnitudes are corpus-
  // dependent; an absolute floor wipes real hits in small corpora — use a
  // RELATIVE floor that always keeps the top-1).

  it("B3 floorRatio drops tail hits whose score is below top × ratio", async () => {
    const store = new FakeMemoryStore();
    // Use a high-dim fake embedder so token-bucket collisions don't inflate
    // the cosine of a genuinely-unrelated entry.
    const embedder = new FakeEmbeddingProvider(256);
    // Strong match (lots of overlapping tokens with the query).
    await embedSeed(
      store,
      embedder,
      makeEntry({ id: "top", title: "database migration sqlite schema rows" }),
    );
    // Moderate match (some overlap).
    await embedSeed(
      store,
      embedder,
      makeEntry({ id: "mid", title: "database query result rows" }),
    );
    // Weak match (almost no overlap with the query terms).
    await embedSeed(
      store,
      embedder,
      makeEntry({ id: "weak", title: "css animation styling color" }),
    );

    const retriever = new MemoryRetriever(store, embedder);
    const noFloor = await retriever.retrieve("database migration sqlite", {
      workspaceId: "ws-1",
    });
    expect(noFloor.length).toBe(3);

    const withFloor = await retriever.retrieve("database migration sqlite", {
      workspaceId: "ws-1",
      floorRatio: 0.3,
    });
    // Top hit must always survive; the weak hit must be trimmed.
    expect(withFloor[0]?.entry.id).toBe("top");
    expect(withFloor.some((h) => h.entry.id === "weak")).toBe(false);
    // And every kept hit must be at least top × ratio.
    const top = withFloor[0]!.score;
    for (const h of withFloor) expect(h.score).toBeGreaterThanOrEqual(top * 0.3);
  });

  it("B3 floorRatio always keeps top-1 even when only one candidate exists", async () => {
    const store = new FakeMemoryStore();
    const embedder = new FakeEmbeddingProvider();
    await embedSeed(store, embedder, makeEntry({ id: "only", title: "lonely topic" }));

    const retriever = new MemoryRetriever(store, embedder);
    const hits = await retriever.retrieve("lonely topic", {
      workspaceId: "ws-1",
      floorRatio: 0.99, // aggressive cutoff
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]?.entry.id).toBe("only");
  });

  it("B3 floorRatio=0 (default) preserves all hits up to maxEntries", async () => {
    const store = new FakeMemoryStore();
    const embedder = new FakeEmbeddingProvider();
    for (let i = 0; i < 5; i += 1) {
      await embedSeed(
        store,
        embedder,
        makeEntry({ id: `e${i}`, title: `topic word${i}` }),
      );
    }
    const retriever = new MemoryRetriever(store, embedder);
    const hits = await retriever.retrieve("topic", { workspaceId: "ws-1" });
    expect(hits.length).toBe(5);
  });

  it("B3 embedder fail-open: a throwing embedder falls back to keyword overlap", async () => {
    const store = new FakeMemoryStore();
    const realEmbedder = new FakeEmbeddingProvider();
    // Seed with the real embedder so entries DO have embeddings on disk —
    // the fail-open path must still kick in because the QUERY embedding
    // can't be computed.
    await embedSeed(
      store,
      realEmbedder,
      makeEntry({ id: "match", title: "alpha beta gamma" }),
    );
    await embedSeed(
      store,
      realEmbedder,
      makeEntry({ id: "miss", title: "unrelated delta epsilon" }),
    );

    const throwing: EmbeddingProvider = {
      model: "throwing",
      dimensions: 16,
      embed: async () => {
        throw new Error("embedder unavailable");
      },
    };

    const retriever = new MemoryRetriever(store, throwing);
    // Must not throw.
    const hits = await retriever.retrieve("alpha beta", { workspaceId: "ws-1" });

    expect(hits.length).toBeGreaterThan(0);
    // Keyword-overlap fallback should still rank the matching entry first.
    expect(hits[0]?.entry.id).toBe("match");
  });
});
