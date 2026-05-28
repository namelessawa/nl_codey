import { describe, it, expect } from "vitest";
import { isIndexableFile, semanticSearch } from "./search.js";
import { FakeChunkStore } from "./fake-store.js";
import { MockEmbeddingProvider } from "./embedder.js";
import { SemanticIndexer } from "./indexer.js";

describe("isIndexableFile", () => {
  it("accepts supported code and doc extensions", () => {
    for (const path of ["a.ts", "b.tsx", "c.js", "d.jsx", "e.py", "f.go", "g.rs", "h.md"]) {
      expect(isIndexableFile(path)).toBe(true);
    }
  });

  it("rejects unsupported or extensionless files", () => {
    expect(isIndexableFile("config.json")).toBe(false);
    expect(isIndexableFile("Makefile")).toBe(false);
    expect(isIndexableFile("data.yaml")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isIndexableFile("Component.TS")).toBe(true);
  });
});

describe("semanticSearch", () => {
  it("delegates to the vector store and finds indexed content", async () => {
    const store = new FakeChunkStore();
    const embedder = new MockEmbeddingProvider();
    const indexer = new SemanticIndexer(store, embedder);

    await indexer.indexFile(
      "ws",
      "auth.ts",
      "function authenticate(user, password) {\n  return checkCredentials(user, password);\n}",
      1,
    );

    const hits = await semanticSearch(store, embedder, "ws", "authenticate user password");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.filePath).toBe("auth.ts");
  });
});
