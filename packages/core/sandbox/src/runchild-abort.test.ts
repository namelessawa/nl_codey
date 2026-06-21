import { describe, expect, it } from "vitest";
import { runChild } from "./wsl-runner.js";

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
  it("rejects synchronously with AbortError when signal was already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runChild("node", ["-e", "setTimeout(()=>{}, 5000)"], "noop", 5000, "wsl", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("kills the child and rejects with AbortError when signal fires mid-run", async () => {
    const controller = new AbortController();
    const start = Date.now();
    const promise = runChild(
      "node",
      ["-e", "setTimeout(()=>{}, 5000)"],
      "noop",
      5000,
      "wsl",
      controller.signal,
    );
    // Give the child a brief moment to actually spawn before aborting so we
    // test the mid-flight abort path, not the pre-spawn check above.
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    // Must terminate well under the 5s timeout. 1500ms is a generous bound
    // that survives slow CI but still proves we didn't wait out the timer.
    expect(Date.now() - start).toBeLessThan(1500);
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
});
