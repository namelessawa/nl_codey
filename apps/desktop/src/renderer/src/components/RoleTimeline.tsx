import { useCallback, useEffect, useState } from "react";
import type { AgentRole, RoleMessage, RoleMessageKind } from "@nlc/shared";
import { api } from "../api.js";

interface RoleTimelineProps {
  /**
   * Run id whose role-message trace to render. Role messages are stored
   * per-task-node, but the UI shows them grouped per-run; the renderer
   * aggregates them via {@link api.listRoleMessagesForRun} which joins
   * task_nodes server-side. Passing a task-node id here used to be the
   * contract — the join fixes the historical mismatch where IntelligencePanel
   * passed a run id that returned an empty list.
   */
  runId: string;
}

const LANES: { role: AgentRole; label: string }[] = [
  { role: "planner", label: "Planner" },
  { role: "coder", label: "Coder" },
  { role: "reviewer", label: "Reviewer" },
];

const KIND_LABEL: Record<RoleMessageKind, string> = {
  breakdown: "breakdown",
  review_request: "review request",
  review_result: "review result",
  handoff: "handoff",
};

/**
 * Role swimlanes: Planner / Coder / Reviewer columns where each message is a
 * block in its sender's lane, time-ordered; clicking a block toggles its
 * JSON payload. Color-coded by message kind.
 */
export function RoleTimeline({ runId }: RoleTimelineProps): JSX.Element {
  const [messages, setMessages] = useState<RoleMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setMessages(await api.listRoleMessagesForRun(runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live updates: refetch whenever a Planner/Coder/Reviewer message lands
  // for this run. Without this the swimlanes would only fill in on
  // panel-reopen.
  useEffect(() => {
    return api.onAgentEvent((event) => {
      if (event.kind === "role_message" && event.runId === runId) {
        void load();
      }
    });
  }, [runId, load]);

  const ordered = [...messages].sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div className="role-timeline">
      {error && <div className="error-banner">{error}</div>}

      {ordered.length === 0 ? (
        <div className="empty">No role messages for this task.</div>
      ) : (
        <div className="role-lanes">
          {LANES.map(({ role, label }) => (
            <div key={role} className="role-lane">
              <div className="role-lane-head">{label}</div>
              {ordered
                .filter((m) => m.fromRole === role)
                .map((m) => {
                  const isOpen = openId === m.id;
                  return (
                    <div key={m.id} className="role-block-wrap">
                      <button
                        className={`role-block role-kind-${m.kind}`}
                        onClick={() => setOpenId(isOpen ? null : m.id)}
                      >
                        <span className="role-block-kind">{KIND_LABEL[m.kind]}</span>
                        <span className="iter-meta">→ {m.toRole}</span>
                      </button>
                      {isOpen && (
                        <pre className="role-payload">{JSON.stringify(m.payload, null, 2)}</pre>
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
