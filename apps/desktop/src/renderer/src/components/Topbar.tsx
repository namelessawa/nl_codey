import type { AgentRun, Workspace } from "@coding-agent/shared";
import { Icon } from "./Icons.js";

interface TopbarProps {
  workspace: Workspace | null;
  activeRun: AgentRun | null;
  llmConnected: boolean;
  onSwitchWorkspace: () => void;
  onOpenSettings: () => void;
}

export function Topbar({
  workspace,
  activeRun,
  llmConnected,
  onSwitchWorkspace,
  onOpenSettings,
}: TopbarProps): JSX.Element {
  const wsName = workspace ? workspaceName(workspace.rootPath) : null;
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">c</div>
        <span>codey</span>
        <span className="brand-version">· coding agent</span>
      </div>

      <button
        className="ws"
        onClick={onSwitchWorkspace}
        title={workspace ? `Switch workspace · ${workspace.rootPath}` : "Open a workspace"}
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
          <span className="ws-empty">No workspace open</span>
        )}
      </button>

      <div className="spacer" />

      {activeRun && (
        <span className="run-counter">
          run #{shortRunId(activeRun.id)}
          {typeof activeRun.iterationCount === "number" && activeRun.iterationCount > 0
            ? ` · iter ${activeRun.iterationCount}`
            : ""}
        </span>
      )}

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
        {llmConnected ? "connected" : "not configured"}
      </span>

      <button
        className="icon-btn"
        title="Settings"
        aria-label="Settings"
        onClick={onOpenSettings}
        type="button"
      >
        <Icon name="gear" size={15} />
      </button>
    </header>
  );
}

function workspaceName(rootPath: string): string {
  const normalized = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? rootPath;
}

function shortRunId(id: string): string {
  return id.length > 6 ? id.slice(-6) : id;
}
