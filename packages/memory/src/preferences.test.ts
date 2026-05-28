import { describe, expect, it } from "vitest";
import { extractPreferences, recordPreference } from "./preferences.js";
import { FakeMemoryStore } from "./test-helpers.js";
import { listEntries } from "./project-memory.js";

describe("recordPreference", () => {
  it("records a preference-kind entry", () => {
    const store = new FakeMemoryStore();

    recordPreference(store, "ws-1", "Tabs over spaces", "User prefers tabs");

    expect(listEntries(store, "ws-1")[0]?.kind).toBe("preference");
  });
});

describe("extractPreferences", () => {
  it("returns only preference-kind entries from a mixed payload", () => {
    const json = JSON.stringify([
      { kind: "decision", title: "D", body: "" },
      { kind: "preference", title: "P1", body: "" },
      { kind: "preference", title: "P2", body: "" },
      { kind: "failure", title: "F", body: "" },
    ]);

    const result = extractPreferences(json);

    expect(result).toHaveLength(2);
    expect(result.every((e) => e.kind === "preference")).toBe(true);
  });

  it("returns an empty array for malformed JSON", () => {
    expect(extractPreferences("garbage")).toEqual([]);
  });
});
