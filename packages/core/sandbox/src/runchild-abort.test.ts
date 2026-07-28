import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createJobObject } from "./job-object.js";
import { runChild } from "./wsl-runner.js";

const SOAK = process.env["SANDBOX_ABORT_SOAK"] === "1";

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for process state");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function abortOnce(delayMs = 50): Promise<number> {
  const controller = new AbortController();
  const promise = runChild(
    process.execPath,
    ["-e", "setTimeout(()=>{}, 5000)"],
    "noop",
    5000,
    "wsl",
    controller.signal,
  );
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  // The contract measures response to the user's abort request, not the
  // intentional pre-abort delay used to ensure the child is running.
  const start = Date.now();
  controller.abort();
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  return Date.now() - start;
}

/**
 * runChild abort plumbing: a user-initiated Stop must kill the spawned child
 * promptly via the abort signal, instead of waiting out the 60s timeout. The
 * runner rejects with AbortError; runCommandWithPolicy + service.ts already
 * recognize that to bypass writeback and avoid emitting stale step events.
 *
 * These tests use `node` as the spawned binary so they exercise the cross-
 * platform code path (both Windows and POSIX have `node` available in the
 * test environment).
 */
describe("runChild AbortSignal plumbing", () => {
  it("does not advertise the unavailable PowerShell Job Object shim", () => {
    const job = createJobObject();
    expect(job.platform).toBe("noop");
    expect(job.handle).toBeNull();
    expect(job.assignProcess(process.pid)).toBe(false);
  });

  it("rejects synchronously with AbortError when signal was already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runChild("node", ["-e", "setTimeout(()=>{}, 5000)"], "noop", 5000, "wsl", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("kills the child and rejects with AbortError when signal fires mid-run", async () => {
    const elapsed = await abortOnce();
    // Must terminate well under the 5s timeout. 1500ms is a generous bound
    // that survives slow CI but still proves we didn't wait out the timer.
    expect(elapsed).toBeLessThan(1500);
  });

  it("kills descendants when aborting a command", async () => {
    const temp = mkdtempSync(join(tmpdir(), "codey-abort-tree-"));
    const pidFile = join(temp, "descendant.pid");
    let descendantPid: number | undefined;
    try {
      const controller = new AbortController();
      const parentScript = [
        "const {spawn}=require('node:child_process');",
        "const {writeFileSync}=require('node:fs');",
        "const child=spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:'ignore'});",
        "writeFileSync(process.argv[1],String(child.pid));",
        "setTimeout(()=>{},10000);",
      ].join("");
      const promise = runChild(
        process.execPath,
        ["-e", parentScript, pidFile],
        "tree",
        10_000,
        "wsl",
        controller.signal,
      );
      await waitFor(() => existsSync(pidFile));
      descendantPid = Number(readFileSync(pidFile, "utf8"));
      expect(isProcessAlive(descendantPid)).toBe(true);
      controller.abort();
      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
      await waitFor(() => !isProcessAlive(descendantPid!));
      expect(isProcessAlive(descendantPid)).toBe(false);
    } finally {
      if (descendantPid !== undefined && isProcessAlive(descendantPid)) {
        if (process.platform === "win32") {
          spawnSync("taskkill.exe", ["/PID", String(descendantPid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
        } else {
          process.kill(descendantPid, "SIGKILL");
        }
      }
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("resolves normally when the child exits before any abort", async () => {
    const controller = new AbortController();
    const result = await runChild(
      "node",
      ["-e", "process.stdout.write('hi')"],
      "echo",
      5000,
      "wsl",
      controller.signal,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hi");
    expect(result.timedOut).toBe(false);
  });

  it("works without a signal (backwards compatible)", async () => {
    const result = await runChild("node", ["-e", "process.stdout.write('ok')"], "echo", 5000);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ok");
  });

  it.runIf(SOAK)("soaks repeated isolated aborts", async () => {
    const durations: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      durations.push(await abortOnce(20 + (index % 3) * 10));
    }
    expect(Math.max(...durations)).toBeLessThan(1500);
  });

  it.runIf(SOAK)("soaks aborts under concurrent child-process load", async () => {
    const durations = await Promise.all(
      Array.from({ length: 8 }, () => abortOnce(30)),
    );
    expect(Math.max(...durations)).toBeLessThan(1500);
  });
});
