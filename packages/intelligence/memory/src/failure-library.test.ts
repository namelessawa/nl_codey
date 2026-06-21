import { describe, expect, it } from "vitest";
import {
  MEMORY_DECAY_DAYS,
  MEMORY_HIDDEN_THRESHOLD,
  type MemoryHit,
} from "@nlc/shared";
import {
  decayFailures,
  formatPitfalls,
  recordFailure,
} from "./failure-library.js";
import { FakeMemoryStore, makeEntry } from "./test-helpers.js";
import { listEntries } from "./project-memory.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe("recordFailure", () => {
  it("records a failure-kind entry", () => {
    const store = new FakeMemoryStore();

    recordFailure(store, "ws-1", "ABI mismatch", "native module under node");

    expect(listEntries(store, "ws-1")[0]?.kind).toBe("failure");
  });
});

describe("decayFailures", () => {
  it("decays failures older than the decay window", () => {
    const store = new FakeMemoryStore();
    const now = Date.now();
    const stale = makeEntry({
      kind: "failure",
      title: "stale",
      createdAt: now - (MEMORY_DECAY_DAYS + 10) * MS_PER_DAY,
    });
    store.seed(stale, null);

    const decayed = decayFailures(store, "ws-1", now);

    expect(decayed).toBe(1);
    expect(store.getMemory(stale.id)?.usefulness).toBe(-1);
  });

  it("leaves recently-used failures untouched", () => {
    const store = new FakeMemoryStore();
    const now = Date.now();
    const fresh = makeEntry({
      kind: "failure",
      title: "fresh",
      lastUsedAt: now - 1 * MS_PER_DAY,
      createdAt: now - 200 * MS_PER_DAY,
    });
    store.seed(fresh, null);

    const decayed = decayFailures(store, "ws-1", now);

    expect(decayed).toBe(0);
    expect(store.getMemory(fresh.id)?.usefulness).toBe(0);
  });

  it("skips entries already at or below the hidden threshold", () => {
    const store = new FakeMemoryStore();
    const now = Date.now();
    const hidden = makeEntry({
      kind: "failure",
      title: "hidden",
      usefulness: MEMORY_HIDDEN_THRESHOLD,
      createdAt: now - 500 * MS_PER_DAY,
    });
    store.seed(hidden, null);

    const decayed = decayFailures(store, "ws-1", now);

    expect(decayed).toBe(0);
    expect(store.getMemory(hidden.id)?.usefulness).toBe(MEMORY_HIDDEN_THRESHOLD);
  });
});

describe("formatPitfalls", () => {
  it("renders the pitfall section with numbered titles and tags", () => {
    const hits: MemoryHit[] = [
      {
        entry: makeEntry({ kind: "failure", title: "Bad cast", tags: ["ts", "abi"] }),
        score: 1,
      },
    ];

    const md = formatPitfalls(hits);

    expect(md).toContain("## 该项目历史踩坑");
    expect(md).toContain("1. Bad cast（标签: ts, abi）");
  });

  it("caps the list at the max injection count", () => {
    const hits: MemoryHit[] = Array.from({ length: 8 }, (_, i) => ({
      entry: makeEntry({ kind: "failure", title: `F${i}` }),
      score: 1,
    }));

    const md = formatPitfalls(hits);

    // Header + 5 capped lines.
    expect(md.split("\n")).toHaveLength(6);
  });

  it("returns empty string when there are no failure hits", () => {
    const hits: MemoryHit[] = [
      { entry: makeEntry({ kind: "fact", title: "x" }), score: 1 },
    ];

    expect(formatPitfalls(hits)).toBe("");
  });
});
