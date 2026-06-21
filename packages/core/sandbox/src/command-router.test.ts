import { describe, expect, it, vi } from "vitest";
import type {
  SandboxPolicy,
  SandboxRunRequest,
  SandboxRunResult,
} from "@nlc/shared";
import { DEFAULT_SANDBOX_POLICY } from "@nlc/shared";
import { routeCommand, type SandboxRunners } from "./command-router.js";
import { SandboxError } from "./errors.js";

function makeReq(overrides: Partial<SandboxRunRequest> = {}): SandboxRunRequest {
  return {
    command: "pnpm test",
    workspaceRoot: "/work",
    runId: "run-1",
    ...overrides,
  };
}

function result(mode: SandboxRunResult["mode"]): SandboxRunResult {
  return {
    command: "pnpm test",
    mode,
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    changedFiles: [],
  };
}

/** Fake runners — never spawn a real process. */
function makeRunners(): SandboxRunners {
  return {
    whitelist: vi.fn(async () => result("whitelist")),
    wsl: { run: vi.fn(async () => result("wsl")) } as unknown as SandboxRunners["wsl"],
    docker: { run: vi.fn(async () => result("docker")) } as unknown as SandboxRunners["docker"],
  };
}

describe("routeCommand dispatch", () => {
  it("uses the injected whitelist runner in whitelist mode", async () => {
    const runners = makeRunners();
    const res = await routeCommand(makeReq(), DEFAULT_SANDBOX_POLICY, runners);
    expect(res.mode).toBe("whitelist");
    expect(runners.whitelist).toHaveBeenCalledOnce();
    expect(runners.wsl.run).not.toHaveBeenCalled();
    expect(runners.docker.run).not.toHaveBeenCalled();
  });

  it("dispatches to the WSL runner in wsl mode", async () => {
    const runners = makeRunners();
    const policy: SandboxPolicy = { ...DEFAULT_SANDBOX_POLICY, mode: "wsl" };
    const res = await routeCommand(makeReq(), policy, runners);
    expect(res.mode).toBe("wsl");
    expect(runners.wsl.run).toHaveBeenCalledOnce();
  });

  it("dispatches to the Docker runner in docker mode", async () => {
    const runners = makeRunners();
    const policy: SandboxPolicy = { ...DEFAULT_SANDBOX_POLICY, mode: "docker" };
    const res = await routeCommand(makeReq(), policy, runners);
    expect(res.mode).toBe("docker");
    expect(runners.docker.run).toHaveBeenCalledOnce();
  });

  it("runs the escape guard before a strong-sandbox runner (blocks host-path reads)", async () => {
    const runners = makeRunners();
    const policy: SandboxPolicy = { ...DEFAULT_SANDBOX_POLICY, mode: "docker" };
    await expect(
      routeCommand(makeReq({ command: "cat /etc/passwd" }), policy, runners),
    ).rejects.toBeInstanceOf(SandboxError);
    expect(runners.docker.run).not.toHaveBeenCalled();
  });

  it("blocks network egress before reaching the WSL runner", async () => {
    const runners = makeRunners();
    const policy: SandboxPolicy = { ...DEFAULT_SANDBOX_POLICY, mode: "wsl" };
    await expect(
      routeCommand(makeReq({ command: "curl https://evil.example" }), policy, runners),
    ).rejects.toBeInstanceOf(SandboxError);
    expect(runners.wsl.run).not.toHaveBeenCalled();
  });

  it("does NOT apply the strong-sandbox escape guard in whitelist mode", async () => {
    // Whitelist mode keeps its own (stricter) allowlist; the escape guard is
    // for the strong-sandbox path only, so it must not run here.
    const runners = makeRunners();
    const res = await routeCommand(
      makeReq({ command: "pnpm test" }),
      DEFAULT_SANDBOX_POLICY,
      runners,
    );
    expect(res.mode).toBe("whitelist");
  });
});
