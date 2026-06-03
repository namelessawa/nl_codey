import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceSandbox } from "./workspace-sandbox.js";

describe("WorkspaceSandbox", () => {
  let workspace: string;
  let stagings: string[];

  beforeEach(async () => {
    workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "codey-test-ws-"));
    stagings = [];
  });

  afterEach(async () => {
    await fsp.rm(workspace, { recursive: true, force: true });
    for (const s of stagings) await WorkspaceSandbox.cleanup(s);
  });

  async function writeFile(rel: string, content: string): Promise<void> {
    const abs = path.join(workspace, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, "utf8");
  }

  async function writeStaging(stagingRoot: string, rel: string, content: string): Promise<void> {
    const abs = path.join(stagingRoot, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, "utf8");
  }

  async function rmStaging(stagingRoot: string, rel: string): Promise<void> {
    await fsp.rm(path.join(stagingRoot, rel), { force: true });
  }

  it("copies workspace into a fresh staging directory", async () => {
    await writeFile("a.txt", "alpha");
    await writeFile("sub/b.txt", "beta");

    const staging = await WorkspaceSandbox.prepare(workspace, "run-1");
    stagings.push(staging);

    expect(fs.existsSync(staging)).toBe(true);
    expect(await fsp.readFile(path.join(staging, "a.txt"), "utf8")).toBe("alpha");
    expect(await fsp.readFile(path.join(staging, "sub/b.txt"), "utf8")).toBe("beta");
  });

  it("skips HARD_IGNORE directories (node_modules / .git)", async () => {
    await writeFile("app.ts", "ok");
    await writeFile("node_modules/dep/index.js", "huge");
    await writeFile(".git/HEAD", "ref");
    await writeFile("dist/bundle.js", "built");

    const staging = await WorkspaceSandbox.prepare(workspace, "run-ignore");
    stagings.push(staging);

    expect(fs.existsSync(path.join(staging, "app.ts"))).toBe(true);
    expect(fs.existsSync(path.join(staging, "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(staging, ".git"))).toBe(false);
    expect(fs.existsSync(path.join(staging, "dist"))).toBe(false);
  });

  it("diff returns empty when nothing changed", async () => {
    await writeFile("a.txt", "alpha");
    await writeFile("sub/b.txt", "beta");
    const staging = await WorkspaceSandbox.prepare(workspace, "run-noop");
    stagings.push(staging);

    const result = await WorkspaceSandbox.diff(workspace, staging);
    expect(result.changes).toEqual([]);
    expect(result.binaryConflicts).toEqual([]);
  });

  it("diff reports added/modified/deleted text files", async () => {
    await writeFile("keep.txt", "unchanged");
    await writeFile("edit.txt", "before");
    await writeFile("remove.txt", "doomed");

    const staging = await WorkspaceSandbox.prepare(workspace, "run-diff");
    stagings.push(staging);

    await writeStaging(staging, "new.txt", "freshly added");
    await writeStaging(staging, "edit.txt", "after");
    await rmStaging(staging, "remove.txt");

    const result = await WorkspaceSandbox.diff(workspace, staging);
    expect(result.binaryConflicts).toEqual([]);

    const byPath = new Map(result.changes.map((c) => [c.path, c]));
    expect(byPath.get("new.txt")).toEqual({
      kind: "added",
      path: "new.txt",
      content: "freshly added",
    });
    expect(byPath.get("edit.txt")).toEqual({
      kind: "modified",
      path: "edit.txt",
      before: "before",
      after: "after",
    });
    expect(byPath.get("remove.txt")).toEqual({
      kind: "deleted",
      path: "remove.txt",
      before: "doomed",
    });
    expect(byPath.has("keep.txt")).toBe(false);
  });

  it("diff surfaces binary additions/modifications as conflicts (never as text)", async () => {
    await writeFile("readme.md", "hi");
    const staging = await WorkspaceSandbox.prepare(workspace, "run-binary");
    stagings.push(staging);

    // Binary file added inside staging.
    const binPath = path.join(staging, "blob.bin");
    await fsp.writeFile(binPath, Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]));

    const result = await WorkspaceSandbox.diff(workspace, staging);
    expect(result.binaryConflicts).toEqual([{ path: "blob.bin", kind: "added" }]);
    expect(result.changes.find((c) => c.path === "blob.bin")).toBeUndefined();
  });

  it("cleanup removes the staging directory", async () => {
    await writeFile("a.txt", "alpha");
    const staging = await WorkspaceSandbox.prepare(workspace, "run-cleanup");
    expect(fs.existsSync(staging)).toBe(true);

    await WorkspaceSandbox.cleanup(staging);
    expect(fs.existsSync(staging)).toBe(false);
  });

  it("cleanup is idempotent and never throws on missing dirs", async () => {
    await expect(WorkspaceSandbox.cleanup(path.join(os.tmpdir(), "does-not-exist-xyz"))).resolves.toBeUndefined();
  });

  it("prepare on a missing workspace throws a readable SandboxError", async () => {
    await expect(
      WorkspaceSandbox.prepare(path.join(os.tmpdir(), "no-such-dir-xyz"), "run-x"),
    ).rejects.toThrow(/Workspace root does not exist/);
  });
});
