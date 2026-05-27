import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPatch } from "diff";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileSnapshot } from "@coding-agent/shared";
import { applyPatchTool } from "./apply-patch.js";
import type { SnapshotStore } from "./deps.js";
import { ToolError } from "./errors.js";

class FakeStore implements SnapshotStore {
  snapshots: FileSnapshot[] = [];
  addSnapshot(runId: string, filePath: string, beforeContent: string): FileSnapshot {
    const snap: FileSnapshot = {
      id: `snap-${this.snapshots.length}`,
      runId,
      filePath,
      beforeContent,
      createdAt: Date.now(),
    };
    this.snapshots.push(snap);
    return snap;
  }
  setSnapshotAfter(snapshotId: string, afterContent: string): void {
    const snap = this.snapshots.find((s) => s.id === snapshotId);
    if (snap) snap.afterContent = afterContent;
  }
}

let root: string;
let store: FakeStore;
const ctx = (workspaceRoot: string) => ({ workspaceRoot, runId: "run-1" });

beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "apply-patch-")));
  store = new FakeStore();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("applyPatchTool", () => {
  it("creates a new file from a /dev/null patch and snapshots empty before-content", async () => {
    const patch = [
      "--- /dev/null",
      "+++ b/NOTES.md",
      "@@ -0,0 +1,2 @@",
      "+# Notes",
      "+hello",
      "",
    ].join("\n");

    const out = await applyPatchTool({ runId: "run-1", patch }, ctx(root), store);
    expect(out.applied).toBe(true);
    expect(out.changedFiles).toEqual(["NOTES.md"]);
    expect(fs.readFileSync(path.join(root, "NOTES.md"), "utf8")).toBe("# Notes\nhello\n");
    expect(store.snapshots[0]?.beforeContent).toBe("");
    expect(store.snapshots[0]?.afterContent).toBe("# Notes\nhello\n");
  });

  it("modifies an existing file", async () => {
    const original = "line1\nline2\nline3\n";
    fs.writeFileSync(path.join(root, "a.txt"), original);
    const updated = "line1\nCHANGED\nline3\n";
    const patch = createPatch("a.txt", original, updated);

    const out = await applyPatchTool({ runId: "run-1", patch }, ctx(root), store);
    expect(out.applied).toBe(true);
    expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe(updated);
    expect(store.snapshots[0]?.beforeContent).toBe(original);
  });

  it("does NOT corrupt the file when a hunk fails to apply", async () => {
    const onDisk = "totally different content\n";
    fs.writeFileSync(path.join(root, "a.txt"), onDisk);
    // Patch built against different base context -> will not apply.
    const patch = createPatch("a.txt", "expected base\nline2\n", "expected base\nCHANGED\n");

    await expect(applyPatchTool({ runId: "run-1", patch }, ctx(root), store)).rejects.toBeInstanceOf(
      ToolError,
    );
    // Original file untouched.
    expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe(onDisk);
  });

  it("rejects an empty / malformed patch", async () => {
    await expect(applyPatchTool({ runId: "run-1", patch: "" }, ctx(root), store)).rejects.toBeInstanceOf(
      ToolError,
    );
  });
});
