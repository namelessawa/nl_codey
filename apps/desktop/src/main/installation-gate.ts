/**
 * InstallationGate — main-process owner of the Docker availability state
 * and the user's "skip" choice. Used by:
 *
 *  - boot path (apps/desktop/src/main/index.ts): probes once after the window
 *    is ready; broadcasts the result so the renderer can show the modal.
 *  - IPC handlers (apps/desktop/src/main/ipc.ts): expose getStatus / recheck /
 *    skip / resume / openInstallPage.
 *  - the agent loop (via `Services.installationGate`): consulted before
 *    dispatching any tool flagged `UNSAFE_WITHOUT_SANDBOX_TOOLS`.
 *
 * Persistence lives in `<userData>/installation-gate.json`. We deliberately
 * keep this separate from settings.json — the skip decision is a one-time
 * choice, not a configuration field.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import {
  DEFAULT_DOCKER_STATUS,
  DEFAULT_INSTALLATION_GATE,
  DOCKER_INSTALL_URL,
  UNSAFE_WITHOUT_SANDBOX_TOOLS,
  type AgentEvent,
  type DockerStartResult,
  type DockerStatus,
  type InstallationGateState,
  type InstallationStatus,
} from "@coding-agent/shared";
import {
  probeDockerStatus,
  type DockerProbeResult,
} from "@coding-agent/sandbox";

const STATE_FILE = "installation-gate.json";

/** Outcome of attempting to spawn the Docker Desktop binary. */
export type LaunchResult = { ok: boolean; error: string | null };

/**
 * Defaults tuned for Windows + WSL2: Docker Desktop usually wakes the engine
 * in 20–60s but can drag past 90s on slow disks or when the WSL distro is
 * being upgraded. Poll every 3s — Docker is gentle on rapid `docker info`
 * calls, but a tighter cadence would just spam the daemon for no benefit.
 */
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_POLL_TIMEOUT_MS = 150_000;

/**
 * Optional overrides for tests. Defaults to the real Electron shell and
 * the real Docker probe. Tests inject mocks here instead of stubbing
 * module imports — keeps the production path untouched and the test
 * deterministic.
 */
export type InstallationGateDeps = {
  probeFn?: () => Promise<DockerProbeResult>;
  openExternal?: (url: string) => Promise<void>;
  /** Spawn Docker Desktop. Override in tests to avoid actually launching it. */
  launchDocker?: () => Promise<LaunchResult>;
  /** Sleep used between poll cycles inside `startDocker`. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Interval between `docker info` polls while waiting for the daemon. */
  pollIntervalMs?: number;
  /** Hard deadline for `startDocker` before it gives up with `timeout`. */
  pollTimeoutMs?: number;
};

export class InstallationGate {
  private docker: DockerStatus = DEFAULT_DOCKER_STATUS;
  private gate: InstallationGateState = DEFAULT_INSTALLATION_GATE;
  private readonly statePath: string;
  private readonly probeFn: () => Promise<DockerProbeResult>;
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly launchDocker: () => Promise<LaunchResult>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  /** Guard against double-firing while a `startDocker` is in flight. */
  private starting = false;

  constructor(
    userDataDir: string,
    private readonly emit: (event: AgentEvent) => void,
    deps: InstallationGateDeps = {},
  ) {
    this.statePath = path.join(userDataDir, STATE_FILE);
    this.probeFn = deps.probeFn ?? probeDockerStatus;
    this.openExternal =
      deps.openExternal ??
      (async (url) => {
        await shell.openExternal(url);
      });
    this.launchDocker = deps.launchDocker ?? defaultLaunchDocker;
    this.sleep = deps.sleep ?? defaultSleep;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pollTimeoutMs = deps.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    this.loadFromDisk();
  }

  /** Probe Docker availability and broadcast the new status. */
  async recheck(): Promise<InstallationStatus> {
    const probe = await this.probeFn();
    this.docker = {
      installed: probe.installed,
      version: probe.version,
      daemonRunning: probe.daemonRunning,
      lastCheckedAt: Date.now(),
      error: probe.error,
    };
    const status = this.status();
    this.emit({ kind: "installation_status", status });
    return status;
  }

  /** Snapshot without re-probing. Used by IPC `getStatus`. */
  status(): InstallationStatus {
    return {
      docker: this.docker,
      gate: this.gate,
      degraded: this.isDegraded(),
    };
  }

  /**
   * True when the agent loop should treat the app as running in degraded
   * mode — Docker is missing AND the user has chosen to skip the install
   * prompt. In that mode unsafe tools refuse to execute.
   */
  isDegraded(): boolean {
    const dockerUsable = this.docker.installed && this.docker.daemonRunning;
    return !dockerUsable && this.gate.userSkipped;
  }

  /** True when a tool name is on the "needs sandbox" list. */
  isToolUnsafe(toolName: string): boolean {
    return UNSAFE_WITHOUT_SANDBOX_TOOLS.includes(toolName);
  }

  /**
   * Throw a clear error if the tool is unsafe AND the gate is currently
   * blocking it. Called from agent-core before dispatching a tool.
   */
  assertToolAllowed(toolName: string): void {
    if (!this.isToolUnsafe(toolName)) return;
    if (!this.isDegraded()) return;
    throw new Error(
      `Tool "${toolName}" is disabled while Docker is not installed and the ` +
        "installation gate is in degraded mode. Install Docker Desktop or " +
        "clear the skip flag from the red Docker badge in the top bar.",
    );
  }

  /** User clicked "Skip and accept the risk" in the install modal. */
  skip(): InstallationStatus {
    this.gate = {
      ...this.gate,
      userSkipped: true,
      skippedAt: Date.now(),
      firstRunCompleted: true,
    };
    this.persist();
    const status = this.status();
    this.emit({ kind: "installation_status", status });
    return status;
  }

  /** User cleared the skip from the red badge or settings warning. */
  resume(): InstallationStatus {
    this.gate = { ...this.gate, userSkipped: false, skippedAt: null };
    this.persist();
    const status = this.status();
    this.emit({ kind: "installation_status", status });
    return status;
  }

  /** Renderer signals the install modal has been shown at least once. */
  markFirstRunCompleted(): InstallationStatus {
    if (this.gate.firstRunCompleted) return this.status();
    this.gate = { ...this.gate, firstRunCompleted: true };
    this.persist();
    return this.status();
  }

  /** Open the Docker download page in the user's default browser. */
  async openInstallPage(): Promise<{ opened: boolean }> {
    try {
      await this.openExternal(DOCKER_INSTALL_URL);
      return { opened: true };
    } catch {
      return { opened: false };
    }
  }

  /**
   * Launch Docker Desktop (when installed but the daemon isn't running) and
   * poll until the daemon answers `docker info`. Intermediate snapshots are
   * broadcast as `installation_status` events so the renderer can render the
   * "starting…" state without polling. On success, the gate marks the install
   * as first-run-completed so the modal never re-prompts on subsequent boots.
   */
  async startDocker(): Promise<DockerStartResult> {
    if (this.starting) {
      return { ok: false, error: "already_starting", status: this.status() };
    }
    // No point launching Docker Desktop when the CLI isn't even on PATH —
    // the user needs the install flow, not the start flow.
    if (!this.docker.installed) {
      return { ok: false, error: "not_installed", status: this.status() };
    }
    // Already up — return immediately.
    if (this.docker.daemonRunning) {
      return { ok: true, error: null, status: this.status() };
    }

    this.starting = true;
    try {
      const launch = await this.launchDocker();
      if (!launch.ok) {
        return { ok: false, error: launch.error ?? "launch_failed", status: this.status() };
      }

      const deadline = monotonicNow() + this.pollTimeoutMs;
      // First poll happens after the interval — Docker Desktop's tray icon
      // appears in <1s but the engine itself isn't reachable for many more,
      // so polling immediately is just a wasted round-trip.
      while (monotonicNow() < deadline) {
        await this.sleep(this.pollIntervalMs);
        await this.recheck();
        if (this.docker.daemonRunning) {
          if (!this.gate.firstRunCompleted) {
            this.gate = { ...this.gate, firstRunCompleted: true };
            this.persist();
            const status = this.status();
            this.emit({ kind: "installation_status", status });
            return { ok: true, error: null, status };
          }
          return { ok: true, error: null, status: this.status() };
        }
      }
      return { ok: false, error: "timeout", status: this.status() };
    } finally {
      this.starting = false;
    }
  }

  /* ---------- persistence ---------- */

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.statePath)) return;
      const raw = fs.readFileSync(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<InstallationGateState> | null;
      if (!parsed) return;
      this.gate = {
        userSkipped: Boolean(parsed.userSkipped),
        skippedAt: typeof parsed.skippedAt === "number" ? parsed.skippedAt : null,
        firstRunCompleted: Boolean(parsed.firstRunCompleted),
      };
    } catch {
      // Corrupt file: ignore and use defaults. We never crash the boot path.
      this.gate = { ...DEFAULT_INSTALLATION_GATE };
    }
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.statePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.statePath, JSON.stringify(this.gate, null, 2), "utf8");
    } catch {
      // Disk full / readonly / antivirus held the file. The runtime state is
      // already updated; we just won't survive a restart. That's a tolerable
      // degradation — the user will see the modal again next launch.
    }
  }
}

/* ---------- platform-specific Docker Desktop launcher ---------- */

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function monotonicNow(): number {
  // Use the wall clock — tests inject a fast `sleep` so the deadline check
  // always reaches the next iteration before any real ms have elapsed.
  return Date.now();
}

function asMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Spawn Docker Desktop detached from the Electron process so it survives
 * after the app exits. On Windows we try the two locations the installer
 * uses (Program Files for system-wide, LOCALAPPDATA for per-user). On
 * macOS, `open -a Docker` is the documented way. On Linux we fall back to
 * the systemd user unit Docker Desktop ships.
 */
async function defaultLaunchDocker(): Promise<LaunchResult> {
  if (process.platform === "win32") {
    const candidates = winDockerDesktopPaths();
    const found = candidates.find((p) => safeExists(p));
    if (!found) {
      return { ok: false, error: "not_found" };
    }
    try {
      const child = spawn(found, [], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: asMessage(err) };
    }
  }
  if (process.platform === "darwin") {
    try {
      const child = spawn("open", ["-a", "Docker"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: asMessage(err) };
    }
  }
  // Linux Docker Desktop ships a systemd user unit named docker-desktop.
  try {
    const child = spawn("systemctl", ["--user", "start", "docker-desktop"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: asMessage(err) };
  }
}

function winDockerDesktopPaths(): string[] {
  const programFiles =
    process.env["ProgramFiles"] ?? "C:\\Program Files";
  const localAppData = process.env["LOCALAPPDATA"];
  const paths: string[] = [
    path.join(programFiles, "Docker", "Docker", "Docker Desktop.exe"),
  ];
  if (localAppData) {
    paths.push(path.join(localAppData, "Docker", "Docker Desktop.exe"));
  }
  return paths;
}

function safeExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
