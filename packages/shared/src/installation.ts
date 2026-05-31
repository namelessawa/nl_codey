/**
 * Installation gate: Docker availability detection + user choice to skip.
 *
 * When Docker isn't installed the user is shown an install reminder modal
 * on first launch. They can either follow the install link or click "Skip
 * and disable unsafe tools". The skip choice persists; thereafter:
 *
 *  - The Topbar shows a red "Docker not installed" badge that re-opens the
 *    same modal on click.
 *  - Settings → Agent panel renders a warning row and disables every input
 *    in the panel except the "open install guide" button.
 *  - The agent loop refuses to execute any tool flagged `unsafeWithoutSandbox`
 *    (run_command, write_file, apply_patch) until either Docker is detected
 *    or the user clears the skip and re-enters the install flow.
 */

/** What we know about the local Docker installation. */
export type DockerStatus = {
  /** True when `docker --version` returned a non-empty version line. */
  installed: boolean;
  /** Raw version string from `docker --version`, or null. */
  version: string | null;
  /** Did the daemon answer `docker info` within the probe window? */
  daemonRunning: boolean;
  /** Unix-ms timestamp of the last successful probe. */
  lastCheckedAt: number;
  /** Set when the probe itself failed (binary missing, permission denied). */
  error: string | null;
};

/** Persisted user choices for the installation gate. */
export type InstallationGateState = {
  /** Has the user clicked "Skip and accept the risk" in the install modal? */
  userSkipped: boolean;
  /** Unix-ms when the user dismissed the modal (for "remind me later" UX). */
  skippedAt: number | null;
  /** True after the user has seen the initial modal at least once. */
  firstRunCompleted: boolean;
};

/** Combined snapshot returned to the renderer on every status query. */
export type InstallationStatus = {
  docker: DockerStatus;
  gate: InstallationGateState;
  /**
   * True when the agent loop and renderer should treat the app as "running
   * in degraded mode" — disable unsafe tools, mask the Agent settings panel.
   * Equivalent to `gate.userSkipped && !docker.installed`.
   */
  degraded: boolean;
};

export const DEFAULT_INSTALLATION_GATE: InstallationGateState = {
  userSkipped: false,
  skippedAt: null,
  firstRunCompleted: false,
};

export const DEFAULT_DOCKER_STATUS: DockerStatus = {
  installed: false,
  version: null,
  daemonRunning: false,
  lastCheckedAt: 0,
  error: null,
};

/** Official Docker Desktop download URL. */
export const DOCKER_INSTALL_URL = "https://www.docker.com/products/docker-desktop/";

/**
 * Tools the agent loop must refuse to execute while the app is in degraded
 * mode (Docker missing + user skipped). The check happens in agent-core's
 * tool dispatcher, not at the renderer — defense in depth.
 */
export const UNSAFE_WITHOUT_SANDBOX_TOOLS: readonly string[] = [
  "run_command",
  "apply_patch",
  "write_file",
];

/** Push channel payload for live Docker status changes. */
export type InstallationEvent = {
  kind: "installation_status";
  status: InstallationStatus;
};
