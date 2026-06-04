/**
 * End-to-end exercise of every agent tool against a real workspace, with
 * `run_command` actually executing inside Docker. Built in response to the
 * sandbox-routing bug — proves the full tool surface works once the docker
 * path is wired up, not just `list_files` / `apply_patch` / `run_command`
 * that the GUI happened to drive.
 *
 * Run with: `pnpm exec vitest run packages/tools/src/e2e-docker.test.ts`
 *
 * Requirements: Docker Desktop running, `python:3.12-slim` will be auto-pulled
 * on first run. Skips Docker-dependent cases when `docker version` fails so
 * CI runs without Docker stay green.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { FileSnapshot, SandboxPolicy, ToolContext } from "@coding-agent/shared";
import {
  applyPatchTool,
  findSymbolTool,
  gitDiff,
  gitStatus,
  listFilesTool,
  parseTestFailure,
  readFileRangeTool,
  readFileTool,
  runCommandWithPolicy,
  searchTextTool,
  writeFileTool,
  defaultDockerImage,
  type SnapshotStore,
} from "./index.js";

// Resolve test/ relative to this file, not process.cwd() — vitest may launch
// from anywhere. The test file lives at packages/tools/src/, so the workspace
// is three levels up: packages/tools/src/ → packages/tools/ → packages/ →
// repo root, then `test`.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path
  .resolve(HERE, "..", "..", "..", "test")
  .replace(/\\/g, "/");

const dockerAvailable = ((): boolean => {
  try {
    execFileSync("docker", ["version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
})();
const itDocker = dockerAvailable ? it : it.skip;

/** Pure in-memory SnapshotStore. apply_patch / write_file need it to record
 *  before/after content but never read it back, so a Map plus a counter is
 *  enough for verification. */
class MemSnapshots implements SnapshotStore {
  private counter = 0;
  public readonly entries = new Map<string, FileSnapshot>();
  addSnapshot(runId: string, filePath: string, beforeContent: string): FileSnapshot {
    const id = `snap-${(++this.counter).toString()}`;
    const snap: FileSnapshot = {
      id,
      runId,
      filePath,
      beforeContent,
      createdAt: Date.now(),
    };
    this.entries.set(id, snap);
    return snap;
  }
  setSnapshotAfter(snapshotId: string, afterContent: string): void {
    const snap = this.entries.get(snapshotId);
    if (snap) this.entries.set(snapshotId, { ...snap, afterContent });
  }
}

const RUN_ID = "e2e-run-1";
const ctx: ToolContext = { workspaceRoot: WORKSPACE, runId: RUN_ID };
const dockerPolicy: SandboxPolicy = { mode: "docker", allowNetwork: false };

/** Seed files we'll exercise across the test. Kept out of any beforeEach so the
 *  apply_patch / write_file cases can observe the writes from prior cases. */
beforeAll(() => {
  if (!existsSync(WORKSPACE)) mkdirSync(WORKSPACE, { recursive: true });
  writeFileSync(
    path.join(WORKSPACE, "sample.py"),
    [
      "def fizzbuzz(n):",
      '    """Return the FizzBuzz list 1..n."""',
      "    out = []",
      "    for i in range(1, n + 1):",
      "        if i % 15 == 0:",
      "            out.append('FizzBuzz')",
      "        elif i % 3 == 0:",
      "            out.append('Fizz')",
      "        elif i % 5 == 0:",
      "            out.append('Buzz')",
      "        else:",
      "            out.append(str(i))",
      "    return out",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(path.join(WORKSPACE, "requirements.txt"), "pytest\n", "utf8");
});

afterAll(() => {
  // Best-effort cleanup of files this harness created. The agent-generated
  // fizzbuzz.py / test_fizzbuzz.py from the GUI run remain so the workspace
  // stays in the "verified working" state.
  for (const f of [
    "sample.py",
    "harness_patch.txt",
    "harness_write.txt",
    "sandbox-only.txt",
    "auto-write.txt",
    "rejected-write.txt",
  ]) {
    const p = path.join(WORKSPACE, f);
    if (existsSync(p)) rmSync(p);
  }
});

describe("agent tools end-to-end in docker workspace", () => {
  it("list_files: enumerates workspace files", async () => {
    const out = await listFilesTool.run({}, ctx);
    expect(out.files.length).toBeGreaterThan(0);
    expect(out.files).toContain("sample.py");
  });

  it("read_file: returns content of a known file", async () => {
    const out = await readFileTool.run({ path: "sample.py" }, ctx);
    expect(out.path).toBe("sample.py");
    expect(out.content).toContain("def fizzbuzz");
  });

  it("read_file_range: returns an inclusive line slice", async () => {
    const out = await readFileRangeTool.run(
      { path: "sample.py", startLine: 1, endLine: 2 },
      ctx,
    );
    expect(out.startLine).toBe(1);
    expect(out.endLine).toBe(2);
    expect(out.totalLines).toBeGreaterThan(2);
    expect(out.content.split("\n")[0]).toContain("def fizzbuzz");
  });

  it("search_text: ripgreps for a literal", async () => {
    const out = await searchTextTool.run({ query: "FizzBuzz" }, ctx);
    expect(out.matches.length).toBeGreaterThan(0);
    // ripgrep returns paths relative to its --cwd; on Windows the leading
    // `.\` or `./` segment depends on the rg version. Match by suffix.
    expect(out.matches.some((m) => m.path.endsWith("sample.py"))).toBe(true);
  });

  it("find_symbol: locates a Python function definition", async () => {
    const out = await findSymbolTool.run({ name: "fizzbuzz", path: "sample.py" }, ctx);
    expect(out.symbols.length).toBeGreaterThan(0);
    expect(out.symbols[0]!.name).toBe("fizzbuzz");
    expect(out.symbols[0]!.kind).toBe("function");
  });

  it("apply_patch: V4A Add File writes through SnapshotStore", async () => {
    const store = new MemSnapshots();
    const patch = [
      "*** Begin Patch",
      "*** Add File: harness_patch.txt",
      "+hello from apply_patch",
      "*** End Patch",
      "",
    ].join("\n");
    const out = await applyPatchTool({ runId: RUN_ID, patch }, ctx, store);
    expect(out.applied).toBe(true);
    expect(out.changedFiles).toEqual(["harness_patch.txt"]);
    const disk = readFileSync(path.join(WORKSPACE, "harness_patch.txt"), "utf8");
    // V4A "Add File" writes lines verbatim; a single `+hello from apply_patch`
    // produces no trailing newline. Other tests cover multi-line patches.
    expect(disk).toBe("hello from apply_patch");
    expect(store.entries.size).toBe(1);
  });

  it("write_file: writes a UTF-8 file + snapshot", async () => {
    const store = new MemSnapshots();
    const out = await writeFileTool(
      { runId: RUN_ID, path: "harness_write.txt", content: "hello from write_file" },
      ctx,
      store,
    );
    expect(out.bytesWritten).toBe(21);
    const disk = readFileSync(path.join(WORKSPACE, "harness_write.txt"), "utf8");
    expect(disk).toBe("hello from write_file");
    expect(store.entries.size).toBe(1);
  });

  it("git_status: returns parent repo status (test/ has no .git of its own)", async () => {
    const out = await gitStatus(ctx);
    // We don't assert specific files (the parent repo is dirty during this run);
    // we only assert the call completed with a branch name.
    expect(typeof out.branch).toBe("string");
  });

  it("git_diff: returns a unified diff string", async () => {
    const out = await gitDiff({}, ctx);
    expect(typeof out.diff).toBe("string");
  });

  it("parse_test_failure: extracts failures from a synthetic pytest run", () => {
    const report = parseTestFailure({
      command: "python -m pytest -v",
      exitCode: 1,
      stdout: [
        "FAILED test_sample.py::test_add - assert 3 == 4",
        "FAILED test_sample.py::test_sub - AssertionError: 1 != 2",
        "=== 2 failed in 0.02s ===",
      ].join("\n"),
      stderr: "",
    });
    expect(report.framework).toBe("pytest");
    expect(report.failures.length).toBeGreaterThanOrEqual(2);
  });

  it("defaultDockerImage: picks python image for python projects", () => {
    expect(defaultDockerImage("python")).toBe("python:3.12-slim");
    expect(defaultDockerImage("node")).toBe("node:22-slim");
  });

  itDocker(
    "run_command (docker): python --version runs inside python:3.12-slim",
    async () => {
      const out = await runCommandWithPolicy(
        { command: "python --version" },
        ctx,
        { policy: dockerPolicy, writeback: { kind: "discard" } },
      );
      expect(out.exitCode).toBe(0);
      // python --version writes to stdout on 3.12, stderr on <3.4. Accept either.
      const combined = `${out.stdout}${out.stderr}`;
      expect(combined).toMatch(/Python 3\.\d+\.\d+/);
    },
    180_000,
  );

  itDocker(
    "run_command (docker): exits non-zero when the script fails",
    async () => {
      const out = await runCommandWithPolicy(
        { command: "python -c 'raise SystemExit(7)'" },
        ctx,
        { policy: dockerPolicy, writeback: { kind: "discard" } },
      );
      expect(out.exitCode).toBe(7);
    },
    180_000,
  );

  itDocker(
    "run_command (docker): network egress is denied by default",
    async () => {
      const out = await runCommandWithPolicy(
        { command: "python -c 'import urllib.request as u; u.urlopen(\"http://example.com\", timeout=3); print(\"NET_OK\")'" },
        ctx,
        { policy: dockerPolicy, writeback: { kind: "discard" } },
      );
      expect(out.exitCode).not.toBe(0);
      const combined = `${out.stdout}${out.stderr}`.toLowerCase();
      expect(combined).not.toContain("net_ok");
    },
    180_000,
  );

  itDocker(
    "run_command (docker): can read a file the agent wrote into the workspace",
    async () => {
      const out = await runCommandWithPolicy(
        { command: "python -c 'print(open(\"sample.py\").read().count(chr(10)))'" },
        ctx,
        { policy: dockerPolicy, writeback: { kind: "discard" } },
      );
      expect(out.exitCode).toBe(0);
      // sample.py was written via String#join("\n") of 14 elements, so the
      // file ends with the empty 14th element → 13 newline characters.
      expect(out.stdout.trim()).toBe("13");
    },
    180_000,
  );

  itDocker(
    "run_command (docker): writeback=discard keeps host workspace pristine",
    async () => {
      const guard = path.join(WORKSPACE, "sandbox-only.txt");
      if (existsSync(guard)) rmSync(guard);

      const out = await runCommandWithPolicy(
        { command: "sh -c 'echo pwned > sandbox-only.txt'" },
        ctx,
        { policy: dockerPolicy, writeback: { kind: "discard" } },
      );
      expect(out.exitCode).toBe(0);
      expect(out.changes.length).toBe(1);
      expect(out.changes[0]!.kind).toBe("added");
      expect(out.applied).toBe(false);
      // The host workspace MUST still be untouched. This is the P0 security
      // property we just fixed: docker writes never reach the host without a
      // writeback step that explicitly approved them.
      expect(existsSync(guard)).toBe(false);
    },
    180_000,
  );

  itDocker(
    "run_command (docker): writeback=auto applies the change + snapshots it",
    async () => {
      const store = new MemSnapshots();
      const target = path.join(WORKSPACE, "auto-write.txt");
      if (existsSync(target)) rmSync(target);

      const out = await runCommandWithPolicy(
        { command: "sh -c 'echo applied > auto-write.txt'" },
        ctx,
        { policy: dockerPolicy, writeback: { kind: "auto" }, snapshotStore: store },
      );
      expect(out.exitCode).toBe(0);
      expect(out.applied).toBe(true);
      expect(existsSync(target)).toBe(true);
      expect(readFileSync(target, "utf8")).toContain("applied");
      // Snapshot recorded so rollback can undo the sync.
      expect(store.entries.size).toBe(1);
    },
    180_000,
  );

  itDocker(
    "run_command (docker): writeback=approve(false) discards the change",
    async () => {
      const store = new MemSnapshots();
      const target = path.join(WORKSPACE, "rejected-write.txt");
      if (existsSync(target)) rmSync(target);

      let approvalCalled = false;
      const out = await runCommandWithPolicy(
        { command: "sh -c 'echo rejected > rejected-write.txt'" },
        ctx,
        {
          policy: dockerPolicy,
          writeback: {
            kind: "approve",
            onApprove: async (changes) => {
              approvalCalled = true;
              expect(changes.length).toBe(1);
              expect(changes[0]!.path).toBe("rejected-write.txt");
              return false;
            },
          },
          snapshotStore: store,
        },
      );
      expect(out.exitCode).toBe(0);
      expect(approvalCalled).toBe(true);
      expect(out.applied).toBe(false);
      // User rejected → no host write + no snapshot.
      expect(existsSync(target)).toBe(false);
      expect(store.entries.size).toBe(0);
    },
    180_000,
  );

  it("run_command (whitelist fallback): rejects non-allowlisted command", async () => {
    // assertCommandAllowed throws SandboxError before spawn; the promise
    // rejects. We assert the rejection message mentions the whitelist so
    // a future refactor that changes the error format gets noticed.
    await expect(
      runCommandWithPolicy(
        { command: "echo hello" },
        ctx,
        { policy: { mode: "whitelist", allowNetwork: false }, writeback: { kind: "discard" } },
      ),
    ).rejects.toThrow(/whitelist|dangerous/i);
  });

  it("run_command (whitelist fallback): allows an allowlisted command", async () => {
    const out = await runCommandWithPolicy(
      { command: "tsc --noEmit" },
      ctx,
      { policy: { mode: "whitelist", allowNetwork: false }, writeback: { kind: "discard" } },
    );
    // tsc may or may not be installed; the only thing we assert is that the
    // dispatch did NOT reject with "Command not in whitelist". exitCode may
    // be anything (0, non-zero, or null on spawn error).
    expect(out.command).toBe("tsc --noEmit");
  });
});
