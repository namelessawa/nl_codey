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

  it("applies a V4A update patch by context", async () => {
    fs.writeFileSync(path.join(root, "a.ts"), "const a = 1;\nreturn a;\nconst c = 3;\n");
    const patch = [
      "*** Begin Patch",
      "*** Update File: a.ts",
      " const a = 1;",
      "-return a;",
      "+return a + 1;",
      "*** End Patch",
    ].join("\n");

    const out = await applyPatchTool({ runId: "run-1", patch }, ctx(root), store);
    expect(out.changedFiles).toEqual(["a.ts"]);
    expect(fs.readFileSync(path.join(root, "a.ts"), "utf8")).toBe(
      "const a = 1;\nreturn a + 1;\nconst c = 3;\n",
    );
  });

  it("adds and deletes files via V4A", async () => {
    fs.writeFileSync(path.join(root, "old.ts"), "gone\n");
    const patch = [
      "*** Begin Patch",
      "*** Add File: new.ts",
      "+export const x = 1;",
      "*** Delete File: old.ts",
      "*** End Patch",
    ].join("\n");

    const out = await applyPatchTool({ runId: "run-1", patch }, ctx(root), store);
    expect(out.changedFiles.sort()).toEqual(["new.ts", "old.ts"]);
    expect(fs.readFileSync(path.join(root, "new.ts"), "utf8")).toBe("export const x = 1;");
    expect(fs.existsSync(path.join(root, "old.ts"))).toBe(false);
  });

  it("V4A Add File refuses to overwrite an existing file", async () => {
    fs.writeFileSync(path.join(root, "existing.ts"), "original\n");
    const patch = [
      "*** Begin Patch",
      "*** Add File: existing.ts",
      "+brand new",
      "*** End Patch",
    ].join("\n");

    await expect(applyPatchTool({ runId: "run-1", patch }, ctx(root), store)).rejects.toThrow(
      /already exists.*Use "Update File"/,
    );
    // Crucially, the existing file was NOT clobbered.
    expect(fs.readFileSync(path.join(root, "existing.ts"), "utf8")).toBe("original\n");
  });

  it("rolls back already-written files when a mid-batch write fails", async () => {
    // First file: a normal text file we can prove was restored.
    fs.writeFileSync(path.join(root, "ok.ts"), "original-ok\n");
    // Second file: replace it with a read-only DIRECTORY so writing a file
    // by the same name fails inside the batch — the realistic crash path on
    // Windows when an antivirus locks a target, or when permissions block
    // an overwrite mid-loop.
    fs.mkdirSync(path.join(root, "blocked.ts"));

    const patch = [
      "*** Begin Patch",
      "*** Update File: ok.ts",
      "-original-ok",
      "+updated-ok",
      "*** Add File: blocked.ts",
      "+this can never write because the path is a directory",
      "*** End Patch",
    ].join("\n");

    // The V4A planner notices `blocked.ts` exists as a directory entry, so the
    // Add File rejection fires during planning — workspace stays pristine.
    // To exercise mid-batch rollback specifically, swap the planner check off
    // for this case by using a unified diff that won't trip the V4A "already
    // exists" guard. We instead set up a patch with two updates where the
    // second targets a path that fails at write time.
    fs.rmdirSync(path.join(root, "blocked.ts"));
    fs.writeFileSync(path.join(root, "second.ts"), "original-second\n");
    // Replace the second file with a directory so the write step fails.
    fs.unlinkSync(path.join(root, "second.ts"));
    fs.mkdirSync(path.join(root, "second.ts"));

    const patch2 = [
      "*** Begin Patch",
      "*** Update File: ok.ts",
      "-original-ok",
      "+updated-ok",
      "*** End Patch",
    ].join("\n");
    // First confirm the OK update lands cleanly so we can compare rollback later.
    const okOut = await applyPatchTool({ runId: "run-1", patch: patch2 }, ctx(root), store);
    expect(okOut.applied).toBe(true);
    expect(fs.readFileSync(path.join(root, "ok.ts"), "utf8")).toBe("updated-ok\n");

    // Reset for the rollback case.
    fs.writeFileSync(path.join(root, "ok.ts"), "original-ok\n");
    // Two-step patch: succeed on ok.ts, then fail on second.ts (path is a dir).
    const patch3 = [
      "*** Begin Patch",
      "*** Update File: ok.ts",
      "-original-ok",
      "+updated-ok",
      "*** Add File: second.ts/inner",
      "+nope",
      "*** End Patch",
    ].join("\n");
    // Removing the empty `second.ts` directory so the Add File can be planned
    // (existed=false), but then the write should fail because `second.ts` is
    // a regular file at runtime — we create it after planning, before write.
    // The simplest cross-platform way to force a mid-loop failure is to plan
    // a write into `<dir>/<file>` where `<dir>` is actually a file. Make
    // `second.ts` a file again so writeFile to `second.ts/inner` errors with
    // ENOTDIR partway through.
    fs.rmdirSync(path.join(root, "second.ts"));
    fs.writeFileSync(path.join(root, "second.ts"), "not-a-dir\n");

    await expect(
      applyPatchTool({ runId: "run-1", patch: patch3 }, ctx(root), store),
    ).rejects.toBeInstanceOf(ToolError);

    // Rollback verification: ok.ts must be back to the pre-patch contents.
    expect(fs.readFileSync(path.join(root, "ok.ts"), "utf8")).toBe("original-ok\n");
    // second.ts must still be the original file we placed (Add File rolled back).
    expect(fs.readFileSync(path.join(root, "second.ts"), "utf8")).toBe("not-a-dir\n");
  });

  it("does NOT corrupt files when a V4A context block is not found", async () => {
    const onDisk = "totally different\n";
    fs.writeFileSync(path.join(root, "a.ts"), onDisk);
    const patch = [
      "*** Begin Patch",
      "*** Update File: a.ts",
      " expected line;",
      "-gone;",
      "+new;",
      "*** End Patch",
    ].join("\n");

    await expect(applyPatchTool({ runId: "run-1", patch }, ctx(root), store)).rejects.toBeInstanceOf(
      ToolError,
    );
    expect(fs.readFileSync(path.join(root, "a.ts"), "utf8")).toBe(onDisk);
  });
});
