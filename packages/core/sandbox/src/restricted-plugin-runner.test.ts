import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RestrictedPluginRunner,
  buildRestrictedPluginDockerArgv,
  synthesizePluginPatch,
} from "./restricted-plugin-runner.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("restricted plugin Docker contract", () => {
  it("builds a no-network, non-root, read-only, resource-bounded container", () => {
    const argv = buildRestrictedPluginDockerArgv({
      pluginRoot: "C:\\plugins\\demo",
      stagingRoot: "C:\\temp\\stage",
      toolName: "inspect",
      args: ["--value", "hello world"],
    });

    expect(argv).toEqual(
      expect.arrayContaining([
        "--pull=never",
        "--network=none",
        "--ipc=private",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit",
        "16",
        "nofile=128:128",
        "fsize=16777216:16777216",
        "--memory",
        "256m",
        "--cpus",
        "0.5",
        "1000:1000",
        "node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293",
      ]),
    );
    expect(argv.join("\n")).toContain("target=/plugin,readonly");
    expect(argv.join("\n")).toContain("target=/workspace");
    expect(argv).not.toContain("sh");
    expect(argv).not.toContain("-lc");
    expect(argv.slice(-3)).toEqual([
      "/plugin/tools/inspect.js",
      "--value",
      "hello world",
    ]);
  });

  it("diffs a staging write without mutating the host workspace", async () => {
    const fixture = makeFixture();
    const execute = vi.fn(async (_exe, argv) => {
      const mount = argv.find(
        (value: string) => value.includes("target=/workspace") && !value.includes("readonly"),
      );
      const stagingRoot = mount?.match(/source=(.*),target=\/workspace/)?.[1];
      if (!stagingRoot) throw new Error("missing staging mount");
      expect(fs.existsSync(path.join(stagingRoot, "custom.txt"))).toBe(false);
      fs.mkdirSync(path.join(stagingRoot, "custom.txt"));
      fs.writeFileSync(path.join(stagingRoot, "proposal.txt"), "proposed\n", "utf8");
      return {
        command: "plugin:inspect",
        mode: "docker" as const,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        timedOut: false,
        changedFiles: [],
      };
    });
    const runner = new RestrictedPluginRunner(execute);

    const result = await runner.run({
      pluginRoot: fixture.pluginRoot,
      toolName: "inspect",
      args: [],
      workspaceRoot: fixture.workspaceRoot,
      runId: "run-plugin",
    });

    expect(result.applied).toBe(false);
    expect(result.changes).toEqual([
      { kind: "added", path: "proposal.txt", content: "proposed\n" },
    ]);
    expect(result.proposedPatch).toContain("+++ b/proposal.txt");
    expect(result.proposedPatch).not.toContain("custom.txt");
    expect(fs.readFileSync(path.join(fixture.workspaceRoot, "custom.txt"), "utf8")).toBe(
      "PRIVATE",
    );
    expect(fs.existsSync(path.join(fixture.workspaceRoot, "proposal.txt"))).toBe(false);
  });

  it("rejects a symlinked tool script that escapes the installed plugin", async () => {
    if (process.platform === "win32") return;
    const fixture = makeFixture();
    const outside = path.join(fixture.root, "outside.js");
    fs.writeFileSync(outside, "console.log('outside')", "utf8");
    fs.rmSync(path.join(fixture.pluginRoot, "tools", "inspect.js"));
    fs.symlinkSync(outside, path.join(fixture.pluginRoot, "tools", "inspect.js"));
    const runner = new RestrictedPluginRunner(vi.fn());

    await expect(
      runner.run({
        pluginRoot: fixture.pluginRoot,
        toolName: "inspect",
        args: [],
        workspaceRoot: fixture.workspaceRoot,
        runId: "run-plugin",
      }),
    ).rejects.toThrow(/escapes plugin root/);
  });

  it("renders added, modified, and deleted text as a proposed patch", () => {
    const patch = synthesizePluginPatch([
      { kind: "added", path: "a.txt", content: "a\n" },
      { kind: "modified", path: "b.txt", before: "old\n", after: "new\n" },
      { kind: "deleted", path: "c.txt", before: "gone\n" },
    ]);
    expect(patch).toContain("--- /dev/null\n+++ b/a.txt");
    expect(patch).toContain("@@ -0,0 +1,1 @@");
    expect(patch).toContain("-old\n+new");
    expect(patch).toContain("--- a/c.txt\n+++ /dev/null");
    expect(patch).toContain("@@ -1,1 +0,0 @@");
    expect(() =>
      synthesizePluginPatch([
        { kind: "added", path: "safe\n+++ b/forged.txt", content: "bad\n" },
      ]),
    ).toThrow(/control characters/);
  });
});

function makeFixture(): {
  root: string;
  pluginRoot: string;
  workspaceRoot: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-plugin-runner-"));
  roots.push(root);
  const pluginRoot = path.join(root, "plugin");
  const workspaceRoot = path.join(root, "workspace");
  fs.mkdirSync(path.join(pluginRoot, "tools"), { recursive: true });
  fs.mkdirSync(workspaceRoot);
  fs.writeFileSync(
    path.join(pluginRoot, "tools", "inspect.js"),
    "console.log('ok')",
    "utf8",
  );
  fs.writeFileSync(path.join(workspaceRoot, "existing.txt"), "safe\n", "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "custom.txt"), "PRIVATE", "utf8");
  return { root, pluginRoot, workspaceRoot };
}
