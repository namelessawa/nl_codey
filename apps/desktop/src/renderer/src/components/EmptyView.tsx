import type { Workspace } from "@coding-agent/shared";
import { Icon } from "./Icons.js";

interface EmptyViewProps {
  recents: Workspace[];
  busy: boolean;
  onPickWorkspace: () => void;
  onOpenRecent: (workspaceId: string) => void;
}

export function EmptyView({
  recents,
  busy,
  onPickWorkspace,
  onOpenRecent,
}: EmptyViewProps): JSX.Element {
  const today = new Date().toLocaleDateString("en-CA");
  return (
    <div className="main-inner">
      <div className="cover-scroll">
        <div className="cover-page">
          <header className="cover-page-head">
            <span>runbook · cover</span>
            <span>p. 001 · {today}</span>
          </header>

          <div className="cover-body">
            <h1 className="cover-title">
              A new <em>runbook.</em>
            </h1>
            <p className="cover-lede">
              Bind this notebook to a project folder. Every conversation, every diff, every
              rollback gets written into the book — one entry per run. Pages tear out cleanly.
            </p>

            <section>
              <div className="cover-label">Bind a project</div>
              <button
                className="cover-drop"
                onClick={onPickWorkspace}
                disabled={busy}
                type="button"
              >
                <div className="cover-drop-icon">
                  <Icon name="folder" size={20} />
                </div>
                <div className="cover-drop-text">
                  <div className="cover-drop-title">
                    {busy ? "Opening…" : "Drop a folder here"}
                  </div>
                  <div className="cover-drop-sub">
                    or click to browse · any local project · nothing leaves your machine
                  </div>
                </div>
                <div className="cover-drop-kbd">
                  <span className="kbdkey">Ctrl+O</span>
                </div>
              </button>
            </section>

            {recents.length > 0 && (
              <section>
                <div className="cover-label">Pick up where you left off</div>
                <ul className="cover-list">
                  {recents.slice(0, 6).map((ws, i) => {
                    const name = workspaceName(ws.rootPath);
                    return (
                      <li key={ws.id} style={{ listStyle: "none" }}>
                        <button
                          type="button"
                          className="cover-entry"
                          onClick={() => onOpenRecent(ws.id)}
                          disabled={busy}
                        >
                          <span className="entry-num">{String(i + 1).padStart(2, "0")}</span>
                          <div className="entry-body">
                            <div className="entry-row1">
                              <span>{name}</span>
                              <span className="entry-dots" />
                            </div>
                            <div className="entry-path">{ws.rootPath}</div>
                          </div>
                          <span className="entry-last">{relativeTime(ws.openedAt)}</span>
                          <Icon name="chev-right" size={13} style={{ color: "var(--muted)" }} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <footer className="cover-foot">
              <span>nothing is written until you sign for it</span>
              <span className="cover-foot-mark">✦</span>
              <span>every change snapshots · every run reverses</span>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}

function workspaceName(rootPath: string): string {
  const normalized = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? rootPath;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
