import { useMemo, useState } from "react";
import type { AgentRun } from "@nlc/shared";
import { Icon } from "./Icons.js";
import { useLang, useT } from "../lang-context.js";
import { tf, t as translate, type I18nKey } from "../i18n.js";

type ThreadStatus = "waiting" | "running" | "applied" | "failed" | "rollback" | "rejected" | "empty";

interface ThreadsSidebarProps {
  runs: AgentRun[];
  activeRunId: string | null;
  isComposingNew: boolean;
  userLabel: string;
  quickPrefsOpen: boolean;
  /** True when a workspace is open — clearing is meaningless otherwise. */
  canClear: boolean;
  onSelectRun: (runId: string) => void;
  onNewRun: () => void;
  onClearRuns: () => void;
  onOpenQuickPrefs: () => void;
}

export function ThreadsSidebar({
  runs,
  activeRunId,
  isComposingNew,
  userLabel,
  quickPrefsOpen,
  canClear,
  onSelectRun,
  onNewRun,
  onClearRuns,
  onOpenQuickPrefs,
}: ThreadsSidebarProps): JSX.Element {
  const tr = useT();
  const lang = useLang();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    if (!query.trim()) return runs;
    const q = query.trim().toLowerCase();
    return runs.filter((r) => r.userTask.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
  }, [runs, query]);
  const groups = useMemo(() => groupRunsByRecency(filtered), [filtered]);

  return (
    <aside className="side">
      <div className="side-head">
        <button className="btn-new" onClick={onNewRun} type="button">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="plus" size={14} stroke={2} />
            {tr("threads.new")}
          </span>
          <span className="kbd">Ctrl+N</span>
        </button>
      </div>
      <div className="side-search">
        <input
          placeholder={tr("threads.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="btn ghost side-clear"
          title={tr("threads.clearTitle")}
          aria-label={tr("threads.clearTitle")}
          disabled={!canClear || runs.length === 0}
          onClick={() => {
            if (window.confirm(tf("threads.clearConfirm", lang, { n: runs.length }))) {
              onClearRuns();
            }
          }}
        >
          <Icon name="x" size={12} stroke={2.2} /> {tr("threads.clear")}
        </button>
      </div>

      <ul className="thread-list">
        {groups.length === 0 ? (
          <li className="thread-empty">{tr("threads.empty")}</li>
        ) : (
          groups.map(([key, group]) => (
            <ThreadGroup
              key={key}
              label={translate(group.labelKey, lang)}
              runs={group.items}
              activeRunId={isComposingNew ? null : activeRunId}
              onSelectRun={onSelectRun}
            />
          ))
        )}
      </ul>

      <div className="side-foot">
        <span className="side-foot-user">{userLabel}</span>
        <button
          className="icon-btn"
          title={tr("threads.history")}
          type="button"
          aria-label={tr("threads.history")}
        >
          <Icon name="history" size={16} stroke={2} />
        </button>
        <button
          className={`icon-btn${quickPrefsOpen ? " active" : ""}`}
          title={tr("quickprefs.title")}
          type="button"
          aria-label={tr("quickprefs.title")}
          onClick={onOpenQuickPrefs}
        >
          <Icon name="gear" size={16} stroke={2} />
        </button>
      </div>
    </aside>
  );
}

interface ThreadGroupProps {
  label: string;
  runs: AgentRun[];
  activeRunId: string | null;
  onSelectRun: (id: string) => void;
}

function ThreadGroup({ label, runs, activeRunId, onSelectRun }: ThreadGroupProps): JSX.Element {
  const tr = useT();
  const lang = useLang();
  return (
    <>
      <li className="side-section">{label}</li>
      {runs.map((run) => {
        const status = threadStatusForRun(run);
        const active = activeRunId === run.id;
        return (
          <li key={run.id} style={{ listStyle: "none" }}>
            <button
              type="button"
              className={`thread ${status} ${active ? "active" : ""}`}
              onClick={() => onSelectRun(run.id)}
            >
              <span className="dot" />
              <span className="title">
                <span className="title-text">{run.userTask || tr("threads.untitled")}</span>
                {status === "waiting" && (
                  <span className="pill awaiting">{tr("threads.pill.awaiting")}</span>
                )}
                {status === "running" && (
                  <span className="pill live">{tr("threads.pill.live")}</span>
                )}
              </span>
              <span className="meta">
                <span>{metaForRun(run, lang)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </>
  );
}

function threadStatusForRun(run: AgentRun): ThreadStatus {
  switch (run.status) {
    case "waiting_for_user_approval":
      return "waiting";
    case "planning":
    case "searching":
    case "reading":
    case "editing":
    case "tool_use":
    case "applying_patch":
    case "running_command":
    case "verifying":
    case "repairing":
      return "running";
    case "done":
      return "applied";
    case "failed":
    case "budget_exceeded":
      return "failed";
    case "cancelled":
      return "rejected";
    case "idle":
    default:
      return "empty";
  }
}

function metaForRun(run: AgentRun, lang: "zh-CN" | "en-US"): string {
  const elapsed = relativeTime(run.updatedAt, lang);
  if (run.status === "done") return `${translate("threads.meta.applied", lang)} · ${elapsed}`;
  if (run.status === "failed") return `${translate("threads.meta.failed", lang)} · ${elapsed}`;
  if (run.status === "budget_exceeded") return `${translate("threads.meta.overBudget", lang)} · ${elapsed}`;
  if (run.status === "cancelled") return `${translate("threads.meta.stopped", lang)} · ${elapsed}`;
  if (run.status === "waiting_for_user_approval")
    return `${translate("threads.meta.awaiting", lang)} · ${elapsed}`;
  return `${run.status.replace(/_/g, " ")} · ${elapsed}`;
}

interface RecencyGroup {
  labelKey: I18nKey;
  items: AgentRun[];
}

function groupRunsByRecency(runs: AgentRun[]): Array<[string, RecencyGroup]> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfThisWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;

  const today: RecencyGroup = { labelKey: "threads.group.today", items: [] };
  const yesterday: RecencyGroup = { labelKey: "threads.group.yesterday", items: [] };
  const earlier: RecencyGroup = { labelKey: "threads.group.thisWeek", items: [] };
  const older: RecencyGroup = { labelKey: "threads.group.older", items: [] };

  const sorted = [...runs].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const run of sorted) {
    if (run.updatedAt >= startOfToday) today.items.push(run);
    else if (run.updatedAt >= startOfYesterday) yesterday.items.push(run);
    else if (run.updatedAt >= startOfThisWeek) earlier.items.push(run);
    else older.items.push(run);
  }
  const ordered: Array<[string, RecencyGroup]> = [
    ["today", today],
    ["yesterday", yesterday],
    ["earlier", earlier],
    ["older", older],
  ];
  return ordered.filter(([, g]) => g.items.length > 0);
}

function relativeTime(timestamp: number, lang: "zh-CN" | "en-US"): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 30) return translate("time.justNow", lang);
  if (seconds < 60) return tf("time.secondsAgo", lang, { n: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return tf("time.minutesAgo", lang, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return tf("time.hoursAgo", lang, { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return tf("time.daysAgo", lang, { n: days });
  return new Date(timestamp).toLocaleDateString();
}
