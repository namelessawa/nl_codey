import type { ForwardedRef } from "react";
import { forwardRef } from "react";
import type { AgentRun, InstallationStatus, Workspace } from "@coding-agent/shared";
import { Icon } from "./Icons.js";
import { DockerStatusBadge } from "./DockerStatusBadge.js";
import { useT } from "../lang-context.js";

interface TopbarProps {
  workspace: Workspace | null;
  activeRun: AgentRun | null;
  llmConnected: boolean;
  currentModel: string;
  /** Docker availability + gate state for the red badge. */
  installation: InstallationStatus;
  /** Whether the left/right side panels are currently collapsed. */
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onSwitchWorkspace: () => void;
  onOpenModelSwitcher: () => void;
  onOpenSettings: () => void;
  /** Re-open the install reminder modal (also used by the red badge). */
  onOpenInstallReminder: () => void;
}

/**
 * Top bar. The model chip (sparkle + current model name + chevron) anchors the
 * ModelSwitcher popover — we forward the ref so the parent can capture the
 * button's bounding rect for positioning.
 */
export const Topbar = forwardRef(function Topbar(
  {
    workspace,
    activeRun,
    llmConnected,
    currentModel,
    installation,
    leftCollapsed,
    rightCollapsed,
    onToggleLeft,
    onToggleRight,
    onSwitchWorkspace,
    onOpenModelSwitcher,
    onOpenSettings,
    onOpenInstallReminder,
  }: TopbarProps,
  modelChipRef: ForwardedRef<HTMLButtonElement>,
): JSX.Element {
  const tr = useT();
  const wsName = workspace ? workspaceName(workspace.rootPath) : null;
  const leftLabel = leftCollapsed ? tr("topbar.expandLeft") : tr("topbar.collapseLeft");
  const rightLabel = rightCollapsed ? tr("topbar.expandRight") : tr("topbar.collapseRight");
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">c</div>
        <span>codey</span>
        <span className="brand-version">· v0.2 · phase 1</span>
      </div>

      <button
        className={`icon-btn${leftCollapsed ? "" : " active"}`}
        title={leftLabel}
        aria-label={leftLabel}
        aria-pressed={!leftCollapsed}
        onClick={onToggleLeft}
        type="button"
      >
        <Icon name="panel-left" size={16} stroke={2} />
      </button>

      <button
        className="ws"
        onClick={onSwitchWorkspace}
        title={
          workspace
            ? `${tr("topbar.switchWorkspace")} · ${workspace.rootPath}`
            : tr("topbar.openWorkspace")
        }
        type="button"
      >
        <Icon name="folder" size={13} />
        {workspace ? (
          <>
            <span className="ws-name">{wsName}</span>
            <span style={{ color: "var(--muted)" }}>·</span>
            <span className="ws-path">{workspace.rootPath}</span>
            <Icon name="chev-right" size={11} stroke={2} style={{ opacity: 0.6 }} />
          </>
        ) : (
          <span className="ws-empty">{tr("topbar.noWorkspace")}</span>
        )}
      </button>

      <div className="spacer" />

      {activeRun && (
        <span className="run-counter">
          {tr("topbar.runHash")} #{shortRunId(activeRun.id)}
          {typeof activeRun.iterationCount === "number" && activeRun.iterationCount > 0
            ? ` · ${tr("topbar.iter")} ${activeRun.iterationCount}`
            : ""}
        </span>
      )}

      <button
        ref={modelChipRef}
        className="model-chip"
        title={tr("topbar.switchModel")}
        type="button"
        onClick={onOpenModelSwitcher}
      >
        <Icon name="sparkle" size={12} />
        <span className="mc-name">{currentModel || tr("topbar.noModel")}</span>
        <Icon
          name="chev-right"
          size={10}
          stroke={2}
          style={{ transform: "rotate(90deg)", opacity: 0.6 }}
        />
      </button>

      <span className="pill-status">
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 99,
            background: llmConnected ? "var(--green)" : "var(--muted)",
            display: "inline-block",
          }}
        />
        {llmConnected ? tr("topbar.connected") : tr("topbar.notConfigured")}
      </span>

      <DockerStatusBadge status={installation} onClick={onOpenInstallReminder} />

      <button
        className={`icon-btn${rightCollapsed ? "" : " active"}`}
        title={rightLabel}
        aria-label={rightLabel}
        aria-pressed={!rightCollapsed}
        onClick={onToggleRight}
        type="button"
      >
        <Icon name="panel-right" size={16} stroke={2} />
      </button>

      <button
        className="icon-btn"
        title={tr("topbar.settings")}
        aria-label={tr("topbar.settings")}
        onClick={onOpenSettings}
        type="button"
      >
        <Icon name="gear" size={16} stroke={2} />
      </button>
    </header>
  );
});

function workspaceName(rootPath: string): string {
  const normalized = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? rootPath;
}

function shortRunId(id: string): string {
  return id.length > 6 ? id.slice(-6) : id;
}
