import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@coding-agent/shared";
import type { DockerProbeResult } from "@coding-agent/sandbox";

// Electron isn't available under vitest. The gate consults `shell.openExternal`
// inside `openInstallPage`, but the constructor only references `shell` via a
// fallback closure that is overridden in tests by `openExternal`. We still
// mock the module so the import resolves.
vi.mock("electron", () => ({
  shell: { openExternal: vi.fn(async () => undefined) },
}));

import { InstallationGate } from "./installation-gate.js";

function makeProbe(result: Partial<DockerProbeResult>): () => Promise<DockerProbeResult> {
  return async () => ({
    installed: false,
    version: null,
    daemonRunning: false,
    error: null,
    ...result,
  });
}

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "install-gate-test-"));
  return dir;
}

describe("InstallationGate — initial state", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  it("starts with default Docker status and gate state when nothing is persisted", () => {
    const events: AgentEvent[] = [];
    const gate = new InstallationGate(dir, (e) => events.push(e), {
      probeFn: makeProbe({}),
      openExternal: async () => undefined,
    });
    const status = gate.status();
    expect(status.docker.installed).toBe(false);
    expect(status.gate.userSkipped).toBe(false);
    expect(status.gate.firstRunCompleted).toBe(false);
    expect(status.degraded).toBe(false); // no skip → no degradation yet
    expect(events).toHaveLength(0); // constructor doesn't broadcast
  });
});

describe("InstallationGate — recheck flow", () => {
  it("marks Docker as usable and broadcasts when the probe succeeds", async () => {
    const dir = tmpDir();
    const events: AgentEvent[] = [];
    const gate = new InstallationGate(dir, (e) => events.push(e), {
      probeFn: makeProbe({
        installed: true,
        version: "Docker version 24.0.0",
        daemonRunning: true,
      }),
      openExternal: async () => undefined,
    });
    const status = await gate.recheck();
    expect(status.docker.installed).toBe(true);
    expect(status.docker.daemonRunning).toBe(true);
    expect(status.docker.lastCheckedAt).toBeGreaterThan(0);
    expect(status.degraded).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "installation_status" });
  });

  it("marks Docker as installed-but-not-running when the daemon is down", async () => {
    const gate = new InstallationGate(
      tmpDir(),
      () => undefined,
      {
        probeFn: makeProbe({
          installed: true,
          version: "Docker version 24.0.0",
          daemonRunning: false,
          error: "exit 1",
        }),
        openExternal: async () => undefined,
      },
    );
    const status = await gate.recheck();
    expect(status.docker.installed).toBe(true);
    expect(status.docker.daemonRunning).toBe(false);
  });
});

describe("InstallationGate — degraded mode + skip / resume", () => {
  it("only becomes degraded after the user explicitly skips with Docker absent", async () => {
    const gate = new InstallationGate(
      tmpDir(),
      () => undefined,
      { probeFn: makeProbe({ installed: false }), openExternal: async () => undefined },
    );
    expect(gate.status().degraded).toBe(false);
    gate.skip();
    expect(gate.status().degraded).toBe(true);
    expect(gate.status().gate.userSkipped).toBe(true);
    expect(gate.status().gate.firstRunCompleted).toBe(true);
  });

  it("clears degraded mode after the user resumes the install flow", () => {
    const gate = new InstallationGate(
      tmpDir(),
      () => undefined,
      { probeFn: makeProbe({}), openExternal: async () => undefined },
    );
    gate.skip();
    expect(gate.status().degraded).toBe(true);
    gate.resume();
    expect(gate.status().degraded).toBe(false);
    expect(gate.status().gate.userSkipped).toBe(false);
    // firstRunCompleted is sticky — resuming does NOT reset it. The modal
    // should only auto-open once per install.
    expect(gate.status().gate.firstRunCompleted).toBe(true);
  });

  it("is not degraded when Docker is usable even if the user previously skipped", async () => {
    const gate = new InstallationGate(
      tmpDir(),
      () => undefined,
      {
        probeFn: makeProbe({ installed: true, daemonRunning: true }),
        openExternal: async () => undefined,
      },
    );
    gate.skip();
    expect(gate.status().degraded).toBe(true);
    await gate.recheck(); // Docker now usable
    expect(gate.status().degraded).toBe(false);
  });
});

describe("InstallationGate — assertToolAllowed contract", () => {
  it("allows everything when not degraded", () => {
    const gate = new InstallationGate(
      tmpDir(),
      () => undefined,
      { probeFn: makeProbe({}), openExternal: async () => undefined },
    );
    expect(() => gate.assertToolAllowed("run_command")).not.toThrow();
    expect(() => gate.assertToolAllowed("read_file")).not.toThrow();
  });

  it("throws for run_command / apply_patch / write_file in degraded mode", () => {
    const gate = new InstallationGate(
      tmpDir(),
      () => undefined,
      { probeFn: makeProbe({ installed: false }), openExternal: async () => undefined },
    );
    gate.skip();
    expect(() => gate.assertToolAllowed("run_command")).toThrow(/disabled/i);
    expect(() => gate.assertToolAllowed("apply_patch")).toThrow(/disabled/i);
    expect(() => gate.assertToolAllowed("write_file")).toThrow(/disabled/i);
  });

  it("never blocks safe read-only tools regardless of mode", () => {
    const gate = new InstallationGate(
      tmpDir(),
      () => undefined,
      { probeFn: makeProbe({ installed: false }), openExternal: async () => undefined },
    );
    gate.skip();
    expect(() => gate.assertToolAllowed("read_file")).not.toThrow();
    expect(() => gate.assertToolAllowed("list_files")).not.toThrow();
    expect(() => gate.assertToolAllowed("search_text")).not.toThrow();
  });
});

describe("InstallationGate — persistence", () => {
  it("writes the gate state to disk on skip and reloads it from disk on next boot", () => {
    const dir = tmpDir();
    const first = new InstallationGate(dir, () => undefined, {
      probeFn: makeProbe({}),
      openExternal: async () => undefined,
    });
    first.skip();

    const persisted = JSON.parse(
      fs.readFileSync(path.join(dir, "installation-gate.json"), "utf8"),
    ) as { userSkipped: boolean; firstRunCompleted: boolean };
    expect(persisted.userSkipped).toBe(true);
    expect(persisted.firstRunCompleted).toBe(true);

    // Fresh gate over the same user-data dir = a second app boot.
    const second = new InstallationGate(dir, () => undefined, {
      probeFn: makeProbe({}),
      openExternal: async () => undefined,
    });
    expect(second.status().gate.userSkipped).toBe(true);
    expect(second.status().gate.firstRunCompleted).toBe(true);
  });

  it("treats a corrupt state file as missing rather than crashing", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "installation-gate.json"), "{not json}", "utf8");
    const gate = new InstallationGate(dir, () => undefined, {
      probeFn: makeProbe({}),
      openExternal: async () => undefined,
    });
    expect(gate.status().gate).toMatchObject({
      userSkipped: false,
      firstRunCompleted: false,
    });
  });
});

describe("InstallationGate — startDocker", () => {
  it("returns ok=true and marks first-run completed once the daemon comes up", async () => {
    const events: AgentEvent[] = [];
    // The probe starts as installed+stopped, then flips to installed+running
    // on the second invocation — mimicking Docker Desktop finishing its boot.
    let calls = 0;
    const gate = new InstallationGate(tmpDir(), (e) => events.push(e), {
      probeFn: async () => {
        calls += 1;
        return {
          installed: true,
          version: "Docker version 24.0.0",
          daemonRunning: calls >= 2,
          error: calls >= 2 ? null : "exit 1",
        };
      },
      openExternal: async () => undefined,
      launchDocker: async () => ({ ok: true, error: null }),
      sleep: async () => undefined,
      pollIntervalMs: 0,
      pollTimeoutMs: 1_000,
    });

    // Initial recheck primes the "installed but stopped" state.
    await gate.recheck();
    expect(gate.status().docker.installed).toBe(true);
    expect(gate.status().docker.daemonRunning).toBe(false);

    const result = await gate.startDocker();
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.status.docker.daemonRunning).toBe(true);
    expect(result.status.gate.firstRunCompleted).toBe(true);
    // Last broadcast should reflect the successful state.
    expect(events.at(-1)).toMatchObject({
      kind: "installation_status",
      status: { docker: { daemonRunning: true } },
    });
  });

  it("returns ok=false with the launcher's error when Docker Desktop can't be spawned", async () => {
    const gate = new InstallationGate(tmpDir(), () => undefined, {
      probeFn: makeProbe({ installed: true, daemonRunning: false, error: "exit 1" }),
      openExternal: async () => undefined,
      launchDocker: async () => ({ ok: false, error: "not_found" }),
      sleep: async () => undefined,
      pollIntervalMs: 0,
      pollTimeoutMs: 1_000,
    });
    await gate.recheck();
    const result = await gate.startDocker();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_found");
  });

  it("returns ok=false with timeout when the daemon never comes up", async () => {
    const gate = new InstallationGate(tmpDir(), () => undefined, {
      probeFn: makeProbe({ installed: true, daemonRunning: false, error: "exit 1" }),
      openExternal: async () => undefined,
      launchDocker: async () => ({ ok: true, error: null }),
      sleep: async () => undefined,
      // 0ms timeout means the first deadline check fails immediately after
      // the first poll cycle that still sees daemonRunning=false.
      pollIntervalMs: 0,
      pollTimeoutMs: 5,
    });
    await gate.recheck();
    const result = await gate.startDocker();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("timeout");
  });

  it("refuses to start when Docker isn't installed (caller should use the install flow)", async () => {
    const gate = new InstallationGate(tmpDir(), () => undefined, {
      probeFn: makeProbe({ installed: false }),
      openExternal: async () => undefined,
      launchDocker: async () => ({ ok: true, error: null }),
      sleep: async () => undefined,
      pollIntervalMs: 0,
      pollTimeoutMs: 1_000,
    });
    await gate.recheck();
    const result = await gate.startDocker();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_installed");
  });

  it("returns ok=true immediately when the daemon is already running", async () => {
    let launches = 0;
    const gate = new InstallationGate(tmpDir(), () => undefined, {
      probeFn: makeProbe({ installed: true, daemonRunning: true }),
      openExternal: async () => undefined,
      launchDocker: async () => {
        launches += 1;
        return { ok: true, error: null };
      },
      sleep: async () => undefined,
      pollIntervalMs: 0,
      pollTimeoutMs: 1_000,
    });
    await gate.recheck();
    const result = await gate.startDocker();
    expect(result.ok).toBe(true);
    // We should not have wasted a spawn on an already-running daemon.
    expect(launches).toBe(0);
  });
});

describe("InstallationGate — install page", () => {
  it("returns opened=true when the external open succeeds", async () => {
    let called = "";
    const gate = new InstallationGate(tmpDir(), () => undefined, {
      probeFn: makeProbe({}),
      openExternal: async (url) => {
        called = url;
      },
    });
    const result = await gate.openInstallPage();
    expect(result.opened).toBe(true);
    expect(called).toContain("docker.com");
  });

  it("returns opened=false when the external open throws", async () => {
    const gate = new InstallationGate(tmpDir(), () => undefined, {
      probeFn: makeProbe({}),
      openExternal: async () => {
        throw new Error("no browser available");
      },
    });
    const result = await gate.openInstallPage();
    expect(result.opened).toBe(false);
  });
});
