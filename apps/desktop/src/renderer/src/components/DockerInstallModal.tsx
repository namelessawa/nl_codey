import { useEffect } from "react";
import type { InstallationStatus } from "@coding-agent/shared";
import { Icon } from "./Icons.js";

type Props = {
  open: boolean;
  status: InstallationStatus;
  rechecking: boolean;
  onRecheck: () => void;
  onInstall: () => void;
  onSkip: () => void;
  onClose: () => void;
};

/**
 * Install reminder shown when Docker is not detected. The user has three
 * exits:
 *
 *  - "Install Docker Desktop" — opens the download page; we leave the modal
 *    open so the user can re-check after running the installer.
 *  - "Re-check" — re-probes Docker (the user just installed it).
 *  - "Skip and accept the risk" — sets the persistent skip flag; the app
 *    enters degraded mode (unsafe tools disabled, Agent settings locked).
 *
 * The scrim does NOT close the modal — the user must make an explicit
 * choice. The "x" in the corner is also intentionally absent on first run;
 * it appears only after `firstRunCompleted` so the badge can re-open the
 * modal later without coercing the user.
 */
export function DockerInstallModal({
  open,
  status,
  rechecking,
  onRecheck,
  onInstall,
  onSkip,
  onClose,
}: Props): JSX.Element | null {
  // Lock body scroll while open — same convention as SettingsModal.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const canDismiss = status.gate.firstRunCompleted;
  const probeFailed = status.docker.error && status.docker.error !== "not_installed";

  return (
    <div
      className="modal-scrim docker-install-scrim"
      // Block backdrop-click dismissal: the choice must be explicit.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="docker-install-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="docker-modal-title"
        aria-describedby="docker-modal-body"
      >
        <header className="dim-head">
          <span className="dim-eyebrow">
            <span className="dim-dot dim-dot-red" />
            Sandbox unavailable
          </span>
          <h2 id="docker-modal-title">Docker is required for safe operation</h2>
          {canDismiss ? (
            <button
              type="button"
              className="dim-close"
              aria-label="Close"
              onClick={onClose}
            >
              <Icon name="x" size={16} />
            </button>
          ) : null}
        </header>

        <section id="docker-modal-body" className="dim-body">
          <p>
            This coding agent runs commands and edits files in your workspace.
            Without a container sandbox, any tool call—test runners, build
            scripts, generated code—executes <strong>directly on your machine</strong>
            with the full permissions of your user account.
          </p>

          <ul className="dim-risks">
            <li>
              <Icon name="x" size={12} stroke={2} />
              A buggy or malicious tool can delete files anywhere you have access
            </li>
            <li>
              <Icon name="x" size={12} stroke={2} />
              Credentials and SSH keys outside the workspace are reachable
            </li>
            <li>
              <Icon name="x" size={12} stroke={2} />
              Network egress is unrestricted — leaks and exfiltration are possible
            </li>
          </ul>

          <p className="dim-recommendation">
            <strong>Install Docker Desktop</strong> to confine every command to an
            ephemeral container with the workspace bind-mounted and the network
            blocked by default. This is the same isolation Claude Code uses on
            Linux/macOS.
          </p>

          {probeFailed ? (
            <div className="dim-probe-error">
              Last probe failed: <code>{status.docker.error}</code>
            </div>
          ) : null}
          {status.docker.installed && !status.docker.daemonRunning ? (
            <div className="dim-probe-error">
              Docker CLI found ({status.docker.version}) but the daemon isn't
              running. Start Docker Desktop and click "Re-check".
            </div>
          ) : null}
        </section>

        <footer className="dim-foot">
          <button
            type="button"
            className="btn ghost danger"
            onClick={onSkip}
            title="Disables run_command, apply_patch, write_file until cleared"
          >
            Skip and accept the risk
          </button>
          <div className="dim-foot-spacer" />
          <button
            type="button"
            className="btn"
            onClick={onRecheck}
            disabled={rechecking}
          >
            {rechecking ? "Re-checking…" : "Re-check"}
          </button>
          <button type="button" className="btn primary" onClick={onInstall}>
            <Icon name="folder" size={13} />
            Install Docker Desktop
          </button>
        </footer>
      </div>
    </div>
  );
}
