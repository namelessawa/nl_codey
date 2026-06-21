import { useEffect, useState } from "react";
import type { AgentRun } from "@nlc/shared";
import { DEFAULT_BUDGET_LIMITS, isRunActive } from "@nlc/shared";

type Props = { run: AgentRun | null };

const WARN_RATIO = 0.8;

/** Top-bar indicator of budget consumption: cost, iterations, tools, elapsed time.
 * Reads cumulative usage off the run; limits mirror the agent's defaults. */
export function BudgetIndicator({ run }: Props): JSX.Element | null {
  const active = run ? isRunActive(run.status) : false;
  const [now, setNow] = useState<number>(() => Date.now());

  // Tick the elapsed-time display only while a run is active.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  if (!run) return null;

  const limits = DEFAULT_BUDGET_LIMITS;
  const cost = run.costUsd ?? 0;
  const iterations = run.iterationCount ?? 0;
  const tools = run.toolCallCount ?? 0;
  const elapsedMs = Math.max(0, now - run.createdAt);

  return (
    <div className="budget" title="Run budget consumption">
      <Pill label="Cost" value={`$${cost.toFixed(3)}`} limit={`$${limits.maxCostUsd.toFixed(2)}`} ratio={cost / limits.maxCostUsd} />
      <Pill label="Iter" value={String(iterations)} limit={String(limits.maxIterations)} ratio={iterations / limits.maxIterations} />
      <Pill label="Tools" value={String(tools)} limit={String(limits.maxToolCalls)} ratio={tools / limits.maxToolCalls} />
      <Pill label="Time" value={formatDuration(elapsedMs)} limit={formatDuration(limits.maxWallTimeMs)} ratio={elapsedMs / limits.maxWallTimeMs} />
    </div>
  );
}

type PillProps = { label: string; value: string; limit: string; ratio: number };

function Pill({ label, value, limit, ratio }: PillProps): JSX.Element {
  const level = ratio >= 1 ? "over" : ratio >= WARN_RATIO ? "warn" : "ok";
  return (
    <span className={`budget-pill budget-${level}`}>
      <span className="budget-label">{label}</span>
      <span className="budget-value">
        {value}
        <span className="budget-limit"> / {limit}</span>
      </span>
    </span>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
