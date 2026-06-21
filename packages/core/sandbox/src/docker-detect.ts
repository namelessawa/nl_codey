/**
 * Docker availability probe. Used by the installation gate to decide
 * whether to disable unsafe tool calls and lock the Settings Agent panel.
 *
 * The probe runs two short-fused commands:
 *  - `docker --version` — confirms the CLI is on PATH (cheap; ~100ms when
 *    present).
 *  - `docker info --format "{{.ServerVersion}}"` — confirms the engine is
 *    running and reachable (slower; ~1.5s when present and warm).
 *
 * Both run with a hard timeout so the boot path never hangs. If either
 * binary is missing, spawning throws `ENOENT`; we map that to a clean
 * "not installed" result rather than propagating.
 */

import { spawn } from "node:child_process";

export type DockerProbeResult = {
  installed: boolean;
  version: string | null;
  daemonRunning: boolean;
  error: string | null;
};

const VERSION_TIMEOUT_MS = 3_000;
const INFO_TIMEOUT_MS = 5_000;

/** Low-level: run a single command, capture stdout/stderr, return exit info. */
async function runOnce(
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ ok: boolean; stdout: string; stderr: string; error: string | null }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    let child;
    try {
      child = spawn(command, args, { windowsHide: true });
    } catch (err) {
      // Synchronous spawn failure (rare; usually ENOENT shows up async).
      resolve({ ok: false, stdout: "", stderr: "", error: asMessage(err) });
      return;
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve({ ok: false, stdout, stderr, error: "timeout" });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const message = asMessage(err);
      // ENOENT == binary not on PATH. Cleanest signal that Docker is missing.
      resolve({
        ok: false,
        stdout,
        stderr,
        error: message.includes("ENOENT") ? "not_installed" : message,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        stdout,
        stderr,
        error: code === 0 ? null : `exit ${code}`,
      });
    });
  });
}

/**
 * Probe Docker availability. Returns a structured result — never throws,
 * never logs. Caller decides whether to surface the error to UI.
 */
export async function probeDockerStatus(): Promise<DockerProbeResult> {
  const version = await runOnce("docker", ["--version"], VERSION_TIMEOUT_MS);
  if (!version.ok || version.error === "not_installed") {
    return {
      installed: false,
      version: null,
      daemonRunning: false,
      error: version.error,
    };
  }

  const versionLine = version.stdout.trim().split("\n")[0] ?? null;
  // Probe the daemon. If `docker info` fails, the CLI is there but the
  // engine isn't running — that's still a "Docker not usable" signal for
  // our purposes (we can't bind-mount and start a container).
  const info = await runOnce(
    "docker",
    ["info", "--format", "{{.ServerVersion}}"],
    INFO_TIMEOUT_MS,
  );

  return {
    installed: true,
    version: versionLine,
    daemonRunning: info.ok && info.stdout.trim().length > 0,
    error: info.ok ? null : info.error,
  };
}

/**
 * Convenience: probe and reduce to a single boolean for callers that only
 * care whether Docker is "usable right now" (binary present + daemon up).
 */
export async function detectDocker(): Promise<boolean> {
  const result = await probeDockerStatus();
  return result.installed && result.daemonRunning;
}

function asMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
