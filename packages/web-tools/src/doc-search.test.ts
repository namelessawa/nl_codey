import { describe, it, expect } from "vitest";
import {
  webSearch,
  mockBackend,
  createDuckDuckGoBackend,
  type SearchBackend,
} from "./doc-search.js";
import type { WebSearchResult } from "@coding-agent/shared";

function makeResults(n: number): WebSearchResult[] {
  return Array.from({ length: n }, (_, i) => ({
    title: `t${i}`,
    url: `https://example.com/${i}`,
    snippet: `s${i}`,
  }));
}

describe("webSearch", () => {
  it("clamps maxResults to the default when unset", async () => {
    let seenMax: number | undefined;
    const backend: SearchBackend = async (input) => {
      seenMax = input.maxResults;
      return makeResults(10);
    };
    const out = await webSearch({ query: "ts" }, backend);
    expect(seenMax).toBe(5);
    expect(out.results.length).toBe(5);
    expect(out.query).toBe("ts");
  });

  it("clamps an over-large maxResults down to the cap", async () => {
    const backend: SearchBackend = async () => makeResults(10);
    const out = await webSearch({ query: "ts", maxResults: 50 }, backend);
    expect(out.results.length).toBe(5);
  });

  it("honors a smaller requested maxResults", async () => {
    const backend: SearchBackend = async () => makeResults(10);
    const out = await webSearch({ query: "ts", maxResults: 2 }, backend);
    expect(out.results.length).toBe(2);
  });

  it("mockBackend returns no results", async () => {
    const out = await webSearch({ query: "anything" }, mockBackend);
    expect(out.results).toEqual([]);
  });
});

describe("createDuckDuckGoBackend", () => {
  it("parses abstract and related topics from JSON", async () => {
    const payload = {
      Heading: "TypeScript",
      AbstractURL: "https://example.com/ts",
      AbstractText: "A typed superset of JavaScript.",
      RelatedTopics: [
        { FirstURL: "https://example.com/a", Text: "A - thing" },
        { Topics: [{ FirstURL: "https://example.com/b", Text: "B - nested" }] },
      ],
    };
    const fetchImpl = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;

    const backend = createDuckDuckGoBackend(fetchImpl);
    const results = await backend({ query: "typescript" });
    expect(results[0]?.url).toBe("https://example.com/ts");
    expect(results.map((r) => r.url)).toContain("https://example.com/a");
    expect(results.map((r) => r.url)).toContain("https://example.com/b");
  });

  it("returns [] on a network error", async () => {
    const fetchImpl = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const backend = createDuckDuckGoBackend(fetchImpl);
    expect(await backend({ query: "x" })).toEqual([]);
  });

  it("returns [] on non-ok status", async () => {
    const fetchImpl = (async () =>
      new Response("", { status: 500 })) as unknown as typeof fetch;
    const backend = createDuckDuckGoBackend(fetchImpl);
    expect(await backend({ query: "x" })).toEqual([]);
  });
});
