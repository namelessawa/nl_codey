import { describe, expect, it } from "vitest";
import type { MemoryExport } from "@coding-agent/shared";
import {
  createEntry,
  deleteEntry,
  exportMemory,
  importMemory,
  listEntries,
  updateEntry,
} from "./project-memory.js";
import { FakeMemoryStore, makeEntry } from "./test-helpers.js";

describe("project-memory facade", () => {
  it("creates and lists an entry for a workspace", () => {
    const store = new FakeMemoryStore();

    createEntry(store, "ws-1", {
      kind: "decision",
      title: "Use SQLite",
      body: "Chosen for local persistence",
    });

    const entries = listEntries(store, "ws-1");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe("Use SQLite");
  });

  it("updates an existing entry immutably via the store", () => {
    const store = new FakeMemoryStore();
    const created = createEntry(store, "ws-1", {
      kind: "fact",
      title: "old",
      body: "",
    });

    const updated = updateEntry(store, created.id, { title: "new" });

    expect(updated?.title).toBe("new");
    expect(created.title).toBe("old");
  });

  it("deletes an entry and returns true", () => {
    const store = new FakeMemoryStore();
    const created = createEntry(store, "ws-1", {
      kind: "fact",
      title: "x",
      body: "",
    });

    expect(deleteEntry(store, created.id)).toBe(true);
    expect(listEntries(store, "ws-1")).toHaveLength(0);
  });
});

describe("exportMemory / importMemory", () => {
  it("exports a version-1 envelope with all entries", () => {
    const store = new FakeMemoryStore();
    createEntry(store, "ws-1", { kind: "fact", title: "a", body: "" });
    createEntry(store, "ws-1", { kind: "decision", title: "b", body: "" });

    const exported = exportMemory(store, "ws-1");

    expect(exported.version).toBe(1);
    expect(exported.workspaceId).toBe("ws-1");
    expect(exported.entries).toHaveLength(2);
  });

  it("imports entries into a target workspace and returns the count", () => {
    const source = new FakeMemoryStore();
    createEntry(source, "ws-1", { kind: "fact", title: "a", body: "" });
    const data = exportMemory(source, "ws-1");

    const target = new FakeMemoryStore();
    const count = importMemory(target, "ws-2", data);

    expect(count).toBe(1);
    expect(listEntries(target, "ws-2")).toHaveLength(1);
  });

  it("throws on an unsupported export version", () => {
    const store = new FakeMemoryStore();
    const bad = { version: 99, workspaceId: "ws", exportedAt: 0, entries: [] };

    expect(() =>
      importMemory(store, "ws", bad as unknown as MemoryExport),
    ).toThrow(/version/i);
  });

  it("tolerates entries missing optional fields and skips invalid kinds", () => {
    const store = new FakeMemoryStore();
    const data: MemoryExport = {
      version: 1,
      workspaceId: "ws-1",
      exportedAt: Date.now(),
      entries: [
        makeEntry({ kind: "fact", title: "valid", tags: ["t"] }),
        // Invalid: bogus kind -> skipped.
        makeEntry({ title: "bad" }),
      ],
    };
    // Corrupt the second entry's kind after construction.
    (data.entries[1] as { kind: string }).kind = "nope";

    const count = importMemory(store, "ws-1", data);

    expect(count).toBe(1);
  });
});
