import { describe, expect, it } from "vitest";
import { parseMemoryExtraction, recordDecision } from "./decision-log.js";
import { FakeMemoryStore } from "./test-helpers.js";
import { listEntries } from "./project-memory.js";

describe("recordDecision", () => {
  it("records a decision-kind entry", () => {
    const store = new FakeMemoryStore();

    recordDecision(store, "ws-1", "Use NodeNext", "Bundler resolution", {
      tags: ["build"],
    });

    const entries = listEntries(store, "ws-1");
    expect(entries[0]?.kind).toBe("decision");
    expect(entries[0]?.tags).toEqual(["build"]);
  });
});

describe("parseMemoryExtraction", () => {
  it("parses a plain JSON array of valid entries", () => {
    const json = JSON.stringify([
      { kind: "decision", title: "A", body: "b", tags: ["x"] },
      { kind: "preference", title: "B", body: "", tags: [] },
    ]);

    const result = parseMemoryExtraction(json);

    expect(result).toHaveLength(2);
    expect(result[0]?.title).toBe("A");
  });

  it("strips a markdown code fence before parsing", () => {
    const json = '```json\n[{"kind":"fact","title":"T","body":"x"}]\n```';

    const result = parseMemoryExtraction(json);

    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("fact");
  });

  it("filters out entries with invalid kinds and empty titles", () => {
    const json = JSON.stringify([
      { kind: "bogus", title: "skip" },
      { kind: "fact", title: "" },
      { kind: "fact", title: "keep", body: "" },
    ]);

    const result = parseMemoryExtraction(json);

    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("keep");
  });

  it("returns an empty array for malformed JSON", () => {
    expect(parseMemoryExtraction("not json {{{")).toEqual([]);
    expect(parseMemoryExtraction("")).toEqual([]);
    expect(parseMemoryExtraction('{"not":"an array"}')).toEqual([]);
  });
});
