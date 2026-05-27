import { useMemo, useState } from "react";
import type { AgentRunDetail, AgentStep, AgentStepType } from "@coding-agent/shared";

type Props = { detail: AgentRunDetail | null };

const TYPE_ICONS: Record<AgentStepType, string> = {
  message: "💬",
  tool_call: "🔧",
  tool_result: "📦",
  diff: "±",
  command: "$",
  error: "⚠",
};

type FilterType = AgentStepType | "all";

/** Visualizes a run's step trace: relative timestamps, type icons, summaries,
 * per-step durations, expand-to-full-content, filtering, search, and export. */
export function TracePanel({ detail }: Props): JSX.Element {
  const [filter, setFilter] = useState<FilterType>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const steps = detail?.steps ?? [];
  const startedAt = steps[0]?.createdAt ?? 0;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return steps.filter((s) => {
      if (filter !== "all" && s.type !== filter) return false;
      if (q && !s.content.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [steps, filter, query]);

  const toggle = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportTrace = (): void => {
    if (!detail) return;
    const payload = JSON.stringify(detail, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trace-${detail.run.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="trace">
      <div className="trace-controls">
        <select value={filter} onChange={(e) => setFilter(e.target.value as FilterType)}>
          <option value="all">all</option>
          <option value="message">message</option>
          <option value="tool_call">tool_call</option>
          <option value="tool_result">tool_result</option>
          <option value="diff">diff</option>
          <option value="command">command</option>
          <option value="error">error</option>
        </select>
        <input
          className="trace-search"
          placeholder="Search steps…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button onClick={exportTrace} disabled={!detail} title="Export trace as JSON">
          Export
        </button>
      </div>
      <ul className="trace-list">
        {visible.length === 0 ? (
          <li className="empty">No matching steps.</li>
        ) : (
          visible.map((step, idx) => {
            const isOpen = expanded.has(step.id);
            return (
              <li key={step.id} className={`trace-row ${step.type}`}>
                <button className="trace-head" onClick={() => toggle(step.id)}>
                  <span className="trace-time">+{relTime(step.createdAt, startedAt)}</span>
                  <span className="trace-icon" aria-hidden="true">
                    {TYPE_ICONS[step.type]}
                  </span>
                  <span className="trace-summary">{summarize(step)}</span>
                  <span className="trace-dur">{stepDuration(visible, idx)}</span>
                </button>
                {isOpen && <pre className="trace-detail">{step.content}</pre>}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

function summarize(step: AgentStep): string {
  const firstLine = step.content.split("\n")[0] ?? "";
  return `${step.type}: ${firstLine.slice(0, 80)}`;
}

function relTime(at: number, startedAt: number): string {
  const sec = Math.max(0, (at - startedAt) / 1000);
  return `${sec.toFixed(1)}s`;
}

function stepDuration(steps: AgentStep[], idx: number): string {
  const cur = steps[idx];
  const next = steps[idx + 1];
  if (!cur || !next) return "";
  const ms = next.createdAt - cur.createdAt;
  return ms > 0 ? `${(ms / 1000).toFixed(1)}s` : "";
}
