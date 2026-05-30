import { useEffect, useMemo, useState } from "react";
import type {
  AgentRunDetail,
  AgentStep,
  GitWorkingTreeStatus,
  Workspace,
} from "@coding-agent/shared";
import { isRunActive } from "@coding-agent/shared";
import { api } from "../api.js";

/** Canonical ops shown in the OpsPanel — order matches the design. */
const OP_ORDER = [
  "read_file",
  "search_text",
  "run_command",
  "apply_patch",
  "write_file",
  "list_dir",
] as const;

interface RightPanelProps {
  detail: AgentRunDetail | null;
  workspace: Workspace | null;
  /** Bump to force a git status refetch (e.g. after a run finishes). */
  refreshTick: number;
}

export function RightPanel({ detail, workspace, refreshTick }: RightPanelProps): JSX.Element {
  if (!workspace) {
    return (
      <aside className="rightpanel empty">
        <div className="rp-empty">
          <div className="rp-empty-mark">∅</div>
          <div className="rp-empty-title">No workspace</div>
          <div className="rp-empty-sub">
            Open a folder to see operations and git status.
          </div>
        </div>
      </aside>
    );
  }
  if (!detail) {
    return (
      <aside className="rightpanel">
        <GitPanel workspace={workspace} refreshTick={refreshTick} />
      </aside>
    );
  }
  return (
    <aside className="rightpanel">
      <OpsPanel detail={detail} />
      <div className="rp-divider" />
      <GitPanel workspace={workspace} refreshTick={refreshTick} />
    </aside>
  );
}

// ─────────────────────  Ops panel  ─────────────────────

interface OpStat {
  name: string;
  n: number;
  running: boolean;
  pending: boolean;
}

function tallyOps(steps: AgentStep[]): { rows: OpStat[]; total: number; toolsUsed: number } {
  const counts = new Map<string, OpStat>();
  for (const name of OP_ORDER) {
    counts.set(name, { name, n: 0, running: false, pending: false });
  }
  let lastUnresolved: string | null = null;
  for (const step of steps) {
    if (step.type === "tool_call") {
      const first = step.content.trim().split(/\s+/)[0] ?? "tool";
      const stat = counts.get(first) ?? { name: first, n: 0, running: false, pending: false };
      stat.n += 1;
      counts.set(first, stat);
      lastUnresolved = first;
      continue;
    }
    if (step.type === "tool_result" || step.type === "command") {
      lastUnresolved = null;
      continue;
    }
    if (step.type === "error") {
      lastUnresolved = null;
      continue;
    }
  }
  if (lastUnresolved) {
    const stat = counts.get(lastUnresolved);
    if (stat) stat.running = true;
  }
  const rows = Array.from(counts.values());
  const total = rows.reduce((s, r) => s + r.n, 0);
  const toolsUsed = rows.filter((r) => r.n > 0).length;
  return { rows, total, toolsUsed };
}

function OpsPanel({ detail }: { detail: AgentRunDetail }): JSX.Element {
  const { rows, total, toolsUsed } = useMemo(() => tallyOps(detail.steps), [detail.steps]);
  const max = Math.max(1, ...rows.map((r) => r.n));
  const elapsed = formatElapsed(detail.run.createdAt, detail.run.updatedAt);
  const live = isRunActive(detail.run.status);
  const waiting = detail.run.status === "waiting_for_user_approval";

  // Mark apply_patch as pending while the run is waiting for approval.
  const annotated = rows.map((r) => ({
    ...r,
    pending: r.name === "apply_patch" && waiting,
  }));

  const label =
    detail.run.status === "done"
      ? "applied"
      : detail.run.status === "failed" || detail.run.status === "budget_exceeded"
        ? "failed"
        : detail.run.status === "waiting_for_user_approval"
          ? "awaiting"
          : live
            ? "running"
            : detail.run.status;

  return (
    <section className="rp-section">
      <header className="rp-head">
        <span className="rp-label">operations</span>
        <span className="rp-meta">{label}</span>
      </header>

      <div className="rp-stat-row">
        <div className="rp-stat">
          <div className="rp-stat-n">{total}</div>
          <div className="rp-stat-l">tool calls</div>
        </div>
        <div className="rp-stat">
          <div className="rp-stat-n">{elapsed}</div>
          <div className="rp-stat-l">elapsed</div>
        </div>
        <div className="rp-stat">
          <div className="rp-stat-n">
            {toolsUsed}
            <span style={{ color: "var(--muted)" }}>/{rows.length}</span>
          </div>
          <div className="rp-stat-l">tools used</div>
        </div>
      </div>

      <div className="op-list">
        {annotated.map((row) => (
          <OpRow key={row.name} {...row} max={max} />
        ))}
      </div>
    </section>
  );
}

function OpRow({
  name,
  n,
  running,
  pending,
  max,
}: OpStat & { max: number }): JSX.Element {
  const pct = max > 0 ? Math.max(n > 0 ? 2 : 0, (n / max) * 100) : 0;
  const isZero = n === 0;
  const cls = [
    "op-row",
    isZero ? "zero" : "",
    running ? "running" : "",
    pending ? "pending" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <span className="op-pill">{name}</span>
      <div className="op-bar" aria-hidden="true">
        <div className="op-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="op-n">
        {n}
        {running && <span className="op-tag run">live</span>}
        {pending && <span className="op-tag pend">queued</span>}
      </span>
    </div>
  );
}

// ─────────────────────  Git panel  ─────────────────────

interface GitPanelProps {
  workspace: Workspace;
  refreshTick: number;
}

function GitPanel({ workspace, refreshTick }: GitPanelProps): JSX.Element {
  const [status, setStatus] = useState<GitWorkingTreeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .getGitStatus(workspace.id)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return (): void => {
      cancelled = true;
    };
  }, [workspace.id, refreshTick]);

  const files = useMemo(() => mergeFiles(status), [status]);
  const counts = {
    m: status?.modified.length ?? 0,
    a: status?.staged.length ?? 0,
    q: status?.untracked.length ?? 0,
  };

  return (
    <section className="rp-section">
      <header className="rp-head">
        <span className="rp-label">workspace · git</span>
        <span className="rp-meta">{workspaceName(workspace.rootPath)}</span>
      </header>

      {error && (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--muted)",
            padding: "8px 10px",
            background: "var(--surface-2)",
            borderRadius: 6,
          }}
        >
          git: {error}
        </div>
      )}

      {status && (
        <>
          <div className="git-branch">
            <span className="gb-icon">⎇</span>
            <span className="gb-name" title={status.branch}>
              {status.branch || "detached"}
            </span>
            {status.ahead > 0 && <span className="gb-tag ahead">↑{status.ahead}</span>}
            {status.behind > 0 && <span className="gb-tag dirty">↓{status.behind}</span>}
            {!status.clean && (
              <span className="gb-tag dirty">●{files.length}</span>
            )}
          </div>
          <div className="git-base">
            {status.clean ? (
              <>working tree <span className="mono">clean</span></>
            ) : (
              <>
                {status.staged.length} staged · {status.modified.length} modified ·{" "}
                {status.untracked.length} untracked
              </>
            )}
          </div>

          <div className="git-legend">
            <span>
              <span className="dot a" /> add · {counts.a}
            </span>
            <span>
              <span className="dot m" /> mod · {counts.m}
            </span>
            <span>
              <span className="dot" style={{ background: "var(--border-2)" }} /> ? · {counts.q}
            </span>
          </div>

          <div className="tree">
            {files.length === 0 && (
              <div
                style={{
                  padding: "12px 8px",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--muted)",
                }}
              >
                no changes
              </div>
            )}
            {files.map((f) => (
              <TreeFileRow key={`${f.mark}:${f.path}`} mark={f.mark} path={f.path} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

interface MergedFile {
  path: string;
  mark: "a" | "m" | "q"; // q = untracked (renders as "?")
}

function mergeFiles(status: GitWorkingTreeStatus | null): MergedFile[] {
  if (!status) return [];
  const seen = new Set<string>();
  const out: MergedFile[] = [];
  for (const p of status.staged) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({ path: p, mark: "a" });
  }
  for (const p of status.modified) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({ path: p, mark: "m" });
  }
  for (const p of status.untracked) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({ path: p, mark: "q" });
  }
  // Sort by path within mark groups already preserved by insertion order.
  return out;
}

function TreeFileRow({ mark, path }: { mark: "a" | "m" | "q"; path: string }): JSX.Element {
  const display = path.length > 48 ? `…${path.slice(-46)}` : path;
  return (
    <div className={`tr-row file has-mark mark-${mark}`} style={{ paddingLeft: 8 }} title={path}>
      <span className="tr-twig">·</span>
      <span className="tr-name">{display}</span>
      <span className={`tr-mark ${mark}`}>
        {mark === "a" ? "A" : mark === "m" ? "M" : "?"}
      </span>
    </div>
  );
}

// ─────────────────────  helpers  ─────────────────────

function formatElapsed(createdAt: number, updatedAt: number): string {
  const seconds = Math.max(0, Math.floor((updatedAt - createdAt) / 1000));
  if (seconds < 60) {
    const ss = String(seconds).padStart(2, "0");
    return `0:${ss}`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const ss = String(seconds % 60).padStart(2, "0");
    return `${minutes}:${ss}`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function workspaceName(rootPath: string): string {
  const normalized = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? rootPath;
}
