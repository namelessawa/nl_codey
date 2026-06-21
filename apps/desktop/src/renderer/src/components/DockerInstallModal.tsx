import { useEffect, useState } from "react";
import type { InstallationStatus } from "@nlc/shared";
import { Icon } from "./Icons.js";
import { useLang, useT } from "../lang-context.js";
import { tf } from "../i18n.js";

type Props = {
  open: boolean;
  status: InstallationStatus;
  rechecking: boolean;
  /** True while the main process is launching Docker and polling for the daemon. */
  starting: boolean;
  onRecheck: () => void;
  onInstall: () => void;
  onSkip: () => void;
  onClose: () => void;
  /**
   * Launch Docker Desktop and wait for the daemon. Resolves with `null` on
   * success (the parent will close the modal because daemonRunning flips to
   * true) or a short error code (`not_found`, `timeout`, …) on failure so we
   * can show a contextual message.
   */
  onStart: () => Promise<string | null>;
};

/**
 * Install reminder shown when Docker is not detected or the daemon is
 * stopped. The exits depend on which situation the user is in:
 *
 *  - Docker not installed → "Install Docker Desktop" (primary) + "Re-check"
 *    + "Skip and accept the risk".
 *  - Docker installed but daemon stopped → "Start Docker Desktop" (primary)
 *    + "Re-check" + "Skip". Starting spawns Docker Desktop detached and
 *    polls `docker info`; the modal auto-closes once the daemon is up.
 *  - Docker installed and running → modal does not open at all.
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
  starting,
  onRecheck,
  onInstall,
  onSkip,
  onClose,
  onStart,
}: Props): JSX.Element | null {
  const tr = useT();
  const lang = useLang();
  const [startError, setStartError] = useState<string | null>(null);

  // Lock body scroll while open — same convention as SettingsModal.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Clear any stale "start failed" message whenever the underlying probe
  // succeeds (the user retried, or another path brought the daemon up).
  useEffect(() => {
    if (status.docker.daemonRunning) setStartError(null);
  }, [status.docker.daemonRunning]);

  if (!open) return null;

  const canDismiss = status.gate.firstRunCompleted;
  const probeFailed = status.docker.error && status.docker.error !== "not_installed";
  const daemonStopped = status.docker.installed && !status.docker.daemonRunning;

  const handleStart = async (): Promise<void> => {
    setStartError(null);
    const error = await onStart();
    if (error) setStartError(error);
  };

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
            {tr("docker.sandboxUnavailable")}
          </span>
          <h2 id="docker-modal-title">{tr("docker.required")}</h2>
          {canDismiss ? (
            <button
              type="button"
              className="dim-close"
              aria-label={tr("docker.close")}
              onClick={onClose}
            >
              <Icon name="x" size={16} />
            </button>
          ) : null}
        </header>

        <section id="docker-modal-body" className="dim-body">
          <p>{tr("docker.body")}</p>

          <ul className="dim-risks">
            <li>
              <Icon name="x" size={12} stroke={2} />
              {tr("docker.risk1")}
            </li>
            <li>
              <Icon name="x" size={12} stroke={2} />
              {tr("docker.risk2")}
            </li>
            <li>
              <Icon name="x" size={12} stroke={2} />
              {tr("docker.risk3")}
            </li>
          </ul>

          <p className="dim-recommendation">{tr("docker.recommendation")}</p>

          {probeFailed ? (
            <div className="dim-probe-error">
              {tr("docker.probeFailed")} <code>{status.docker.error}</code>
            </div>
          ) : null}
          {daemonStopped && !starting ? (
            <div className="dim-probe-error">
              {tf("docker.daemonStopped", lang, { version: status.docker.version ?? "" })}
            </div>
          ) : null}
          {starting ? (
            <div className="dim-starting" role="status" aria-live="polite">
              <span className="dim-spinner" aria-hidden="true" />
              <span>{tr("docker.startingBody")}</span>
            </div>
          ) : null}
          {startError ? (
            <div className="dim-probe-error">
              {tf("docker.startFailed", lang, { error: startError })}
            </div>
          ) : null}
        </section>

        <footer className="dim-foot">
          <button
            type="button"
            className="btn ghost danger"
            onClick={onSkip}
            title={tr("docker.skipTitle")}
            disabled={starting}
          >
            {tr("docker.skip")}
          </button>
          <div className="dim-foot-spacer" />
          <button
            type="button"
            className="btn"
            onClick={onRecheck}
            disabled={rechecking || starting}
          >
            {rechecking ? tr("docker.rechecking") : tr("docker.recheck")}
          </button>
          {daemonStopped ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => void handleStart()}
              disabled={starting}
            >
              <Icon name="sparkle" size={13} />
              {starting ? tr("docker.starting") : tr("docker.start")}
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={onInstall} disabled={starting}>
              <Icon name="folder" size={13} />
              {tr("docker.install")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
