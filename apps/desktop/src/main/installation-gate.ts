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

import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import {
  DEFAULT_DOCKER_STATUS,
  DEFAULT_INSTALLATION_GATE,
  DOCKER_INSTALL_URL,
  UNSAFE_WITHOUT_SANDBOX_TOOLS,
  type AgentEvent,
  type DockerStatus,
  type InstallationGateState,
  type InstallationStatus,
} from "@coding-agent/shared";
import {
  probeDockerStatus,
  type DockerProbeResult,
} from "@coding-agent/sandbox";

const STATE_FILE = "installation-gate.json";

/**
 * Optional overrides for tests. Defaults to the real Electron shell and
 * the real Docker probe. Tests inject mocks here instead of stubbing
 * module imports — keeps the production path untouched and the test
 * deterministic.
 */
export type InstallationGateDeps = {
  probeFn?: () => Promise<DockerProbeResult>;
  openExternal?: (url: string) => Promise<void>;
};

export class InstallationGate {
  private docker: DockerStatus = DEFAULT_DOCKER_STATUS;
  private gate: InstallationGateState = DEFAULT_INSTALLATION_GATE;
  private readonly statePath: string;
  private readonly probeFn: () => Promise<DockerProbeResult>;
  private readonly openExternal: (url: string) => Promise<void>;

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
