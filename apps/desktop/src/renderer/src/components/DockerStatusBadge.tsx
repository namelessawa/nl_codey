import type { InstallationStatus } from "@coding-agent/shared";
import { useLang, useT } from "../lang-context.js";
import { tf } from "../i18n.js";

type Props = {
  status: InstallationStatus;
  onClick: () => void;
};

/**
 * Red "Docker not installed" chip in the top bar. Renders only when the
 * status is actually degraded — installed + running Docker means we don't
 * even occupy pixels. Clicking the badge re-opens the install modal.
 */
export function DockerStatusBadge({ status, onClick }: Props): JSX.Element | null {
  const tr = useT();
  const lang = useLang();
  const dockerUsable = status.docker.installed && status.docker.daemonRunning;
  if (dockerUsable) return null;

  // Two failure modes get slightly different copy:
  // - never installed → "Docker not installed"
  // - installed but daemon stopped → "Docker not running"
  const label = status.docker.installed
    ? tr("docker.notRunning")
    : tr("docker.notInstalled");

  const title = status.gate.userSkipped
    ? tf("docker.badge.degradedTitle", lang, { label })
    : tf("docker.badge.installTitle", lang, { label });

  return (
    <button
      type="button"
      className="docker-status-badge"
      onClick={onClick}
      aria-label={title}
      title={title}
    >
      <span className="dsb-dot" />
      <span className="dsb-label">{label}</span>
      {status.gate.userSkipped ? (
        <span className="dsb-tag">{tr("docker.degraded")}</span>
      ) : null}
    </button>
  );
}
