import { describe, it, expect, vi, afterEach } from "vitest";
import {
  MockEmbeddingProvider,
  OpenAIEmbeddingProvider,
  createEmbeddingProvider,
} from "./embedder.js";

describe("MockEmbeddingProvider", () => {
  it("returns deterministic, fixed-dimension vectors", async () => {
    const provider = new MockEmbeddingProvider();
    const [a] = await provider.embed(["hello world"]);
    const [b] = await provider.embed(["hello world"]);

    expect(a).toEqual(b);
    expect(a).toHaveLength(64);
  });

  it("L2-normalizes non-empty text", async () => {
    const provider = new MockEmbeddingProvider();
    const [vec] = await provider.embed(["function search"]);
    const norm = Math.sqrt((vec ?? []).reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("produces different vectors for different text", async () => {
    const provider = new MockEmbeddingProvider();
    const [a] = await provider.embed(["database connection"]);
    const [b] = await provider.embed(["render react component"]);
    expect(a).not.toEqual(b);
  });
});

describe("createEmbeddingProvider", () => {
  it("returns the mock when no apiKey is given", () => {
    const provider = createEmbeddingProvider();
    expect(provider).toBeInstanceOf(MockEmbeddingProvider);
  });

  it("returns the OpenAI provider when an apiKey is given", () => {
    const provider = createEmbeddingProvider({ apiKey: "sk-test" });
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(provider.model).toBe("text-embedding-3-small");
    expect(provider.dimensions).toBe(1536);
  });
});

describe("OpenAIEmbeddingProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts to the embeddings endpoint and returns ordered vectors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0.3, 0.4] },
            { index: 0, embedding: [0.1, 0.2] },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIEmbeddingProvider({ apiKey: "sk-secret", dimensions: 2 });
    const vectors = await provider.embed(["a", "b"]);

    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    const call = fetchMock.mock.calls[0] ?? [];
    expect(call[0]).toBe("https://api.openai.com/v1/embeddings");
    expect((call[1] as RequestInit).method).toBe("POST");
  });

  it("applies shared redaction to non-2xx provider errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        "invalid api key sk-secret\n" +
          "Authorization: Bearer embed-bearer\n" +
          "C:\\Users\\alice\\.config?token=query-secret",
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIEmbeddingProvider({ apiKey: "sk-secret" });
    let caught: unknown;
    try {
      await provider.embed(["x"]);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("[REDACTED]");
    expect(message).toContain("[USER_HOME]");
    expect(message).not.toMatch(
      /sk-secret|embed-bearer|query-secret|alice/,
    );
  });

  it("returns an empty array without calling fetch for empty input", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAIEmbeddingProvider({ apiKey: "sk-secret" });
    expect(await provider.embed([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
