import { useMemo, useState } from "react";
import type { AgentRun } from "@coding-agent/shared";
import { Icon } from "./Icons.js";

type ThreadStatus = "waiting" | "running" | "applied" | "failed" | "rollback" | "rejected" | "empty";

interface ThreadsSidebarProps {
  runs: AgentRun[];
  activeRunId: string | null;
  isComposingNew: boolean;
  userLabel: string;
  onSelectRun: (runId: string) => void;
  onNewRun: () => void;
}

export function ThreadsSidebar({
  runs,
  activeRunId,
  isComposingNew,
  userLabel,
  onSelectRun,
  onNewRun,
}: ThreadsSidebarProps): JSX.Element {
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
            New run
          </span>
          <span className="kbd">Ctrl+N</span>
        </button>
      </div>
      <div className="side-search">
        <input
          placeholder="Search runs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <ul className="thread-list">
        {groups.length === 0 ? (
          <li className="thread-empty">No runs yet. Start one with a task above.</li>
        ) : (
          groups.map(([key, group]) => (
            <ThreadGroup
              key={key}
              label={group.label}
              runs={group.items}
              activeRunId={isComposingNew ? null : activeRunId}
              onSelectRun={onSelectRun}
            />
          ))
        )}
      </ul>

      <div className="side-foot">
        <span className="side-foot-user">{userLabel}</span>
        <button className="icon-btn" title="History" type="button" aria-label="History">
          <Icon name="history" size={15} />
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
                <span className="title-text">{run.userTask || "(untitled run)"}</span>
                {status === "waiting" && <span className="pill awaiting">awaiting</span>}
                {status === "running" && <span className="pill live">live</span>}
              </span>
              <span className="meta">
                <span>{metaForRun(run)}</span>
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

function metaForRun(run: AgentRun): string {
  const elapsed = relativeTime(run.updatedAt);
  if (run.status === "done") return `applied · ${elapsed}`;
  if (run.status === "failed") return `failed · ${elapsed}`;
  if (run.status === "budget_exceeded") return `over budget · ${elapsed}`;
  if (run.status === "cancelled") return `stopped · ${elapsed}`;
  if (run.status === "waiting_for_user_approval") return `awaiting · ${elapsed}`;
  return `${run.status.replace(/_/g, " ")} · ${elapsed}`;
}

interface RecencyGroup {
  label: string;
  items: AgentRun[];
}

function groupRunsByRecency(runs: AgentRun[]): Array<[string, RecencyGroup]> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfThisWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;

  const today: RecencyGroup = { label: "today", items: [] };
  const yesterday: RecencyGroup = { label: "yesterday", items: [] };
  const earlier: RecencyGroup = { label: "this week", items: [] };
  const older: RecencyGroup = { label: "older", items: [] };

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

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
