import { useMemo } from "react";
import type { AgentRunDetail, IterationStatus } from "@coding-agent/shared";
import { deriveIterations } from "@coding-agent/shared";

type Props = { detail: AgentRunDetail | null };

const STATUS_LABEL: Record<IterationStatus, string> = {
  in_progress: "进行中",
  verified: "已验证",
  failed: "验证失败",
};

const STATUS_ICON: Record<IterationStatus, string> = {
  in_progress: "◷",
  verified: "✓",
  failed: "✗",
};

/**
 * Iteration timeline: visualizes the agent's edit→verify→repair cycles, one
 * card per iteration with its status, whether it proposed a patch, and how many
 * steps it spans. Derived purely from the step stream.
 */
export function IterationTimeline({ detail }: Props): JSX.Element {
  const steps = detail?.steps ?? [];
  const iterations = useMemo(() => deriveIterations(steps), [steps]);
  const startedAt = steps[0]?.createdAt ?? 0;

  if (iterations.length === 0) {
    return <div className="empty">Run a task to see the iteration timeline.</div>;
  }

  return (
    <div className="timeline">
      {iterations.map((it) => {
        const offsetMs = it.startedAt - startedAt;
        return (
          <div key={it.index} className={`timeline-item iter-${it.status}`}>
            <div className="timeline-marker" aria-hidden>
              {STATUS_ICON[it.status]}
            </div>
            <div className="timeline-body">
              <div className="timeline-head">
                <strong>Iteration {it.index}</strong>
                <span className={`iter-badge iter-${it.status}`}>{STATUS_LABEL[it.status]}</span>
                {it.hasPatch && <span className="iter-badge iter-patch">patch</span>}
                <span className="iter-meta">+{formatOffset(offsetMs)}</span>
              </div>
              <div className="iter-meta">{it.stepIds.length} step{it.stepIds.length === 1 ? "" : "s"}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatOffset(ms: number): string {
  if (ms < 1000) return `${Math.max(0, ms)}ms`;
  const s = Math.round(ms / 100) / 10;
  return `${s}s`;
}
