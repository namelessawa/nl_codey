/** Phase 3 sandbox execution mode contracts. */

/**
 * Command routing modes:
 * - `whitelist`: Phase 2 behavior — exact-match allowlist (default, safest).
 * - `wsl`: run inside a WSL Ubuntu instance against a workspace copy.
 * - `docker`: run inside an ephemeral container with the workspace bind-mounted.
 */
export type SandboxMode = "whitelist" | "wsl" | "docker";

export type SandboxRunRequest = {
  command: string;
  workspaceRoot: string;
  runId: string;
  timeoutMs?: number;
  /** Per-command opt-in to network egress (otherwise denied). */
  allowNetwork?: boolean;
  /**
   * Optional abort signal. When fired, the runner kills the spawned child (and
   * its job object on Windows) so the sandbox process tree tears down
   * immediately on a user-initiated Stop. Not serialised over IPC — the
   * renderer never constructs a SandboxRunRequest directly.
   */
  signal?: AbortSignal;
};

export type SandboxRunResult = {
  command: string;
  mode: SandboxMode;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Files changed inside the sandbox copy, synced back to the host. */
  changedFiles: string[];
};

export type SandboxPolicy = {
  mode: SandboxMode;
  /** Docker image when mode is `docker`. */
  dockerImage?: string;
  /** WSL distro name when mode is `wsl`. */
  wslDistro?: string;
  /** Default network egress allowance for sandboxed runs. */
  allowNetwork: boolean;
};

export const DEFAULT_SANDBOX_POLICY: SandboxPolicy = {
  mode: "whitelist",
  dockerImage: "node:22-slim",
  wslDistro: "Ubuntu",
  allowNetwork: false,
};

export const SANDBOX_DEFAULT_TIMEOUT_MS = 60_000;
