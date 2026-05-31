import type { Workspace } from "@coding-agent/shared";
import { Icon } from "./Icons.js";
import { useLang, useT } from "../lang-context.js";
import { tf } from "../i18n.js";

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
  const tr = useT();
  const lang = useLang();
  const today = new Date().toLocaleDateString("en-CA");
  return (
    <div className="main-inner">
      <div className="cover-scroll">
        <div className="cover-page">
          <header className="cover-page-head">
            <span>{tr("empty.runbookCover")}</span>
            <span>
              {tr("empty.pageLabel")} · {today}
            </span>
          </header>

          <div className="cover-body">
            <h1 className="cover-title">
              {tr("empty.titleA")} <em>{tr("empty.titleB")}</em>
            </h1>
            <p className="cover-lede">{tr("empty.lede")}</p>

            <section>
              <div className="cover-label">{tr("empty.bindProject")}</div>
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
                    {busy ? tr("empty.opening") : tr("empty.dropFolder")}
                  </div>
                  <div className="cover-drop-sub">{tr("empty.dropSub")}</div>
                </div>
                <div className="cover-drop-kbd">
                  <span className="kbdkey">Ctrl+O</span>
                </div>
              </button>
            </section>

            {recents.length > 0 && (
              <section>
                <div className="cover-label">{tr("empty.recent")}</div>
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
                          <span className="entry-last">{relativeTime(ws.openedAt, lang)}</span>
                          <Icon name="chev-right" size={13} style={{ color: "var(--muted)" }} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <footer className="cover-foot">
              <span>{tr("empty.footSigned")}</span>
              <span className="cover-foot-mark">✦</span>
              <span>{tr("empty.footSnapshots")}</span>
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

function relativeTime(timestamp: number, lang: "zh-CN" | "en-US"): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return lang === "en-US" ? "just now" : "刚刚";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return tf("time.minutesAgo", lang, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return tf("time.hoursAgo", lang, { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return tf("time.daysAgo", lang, { n: days });
  return new Date(timestamp).toLocaleDateString();
}
