import type { AgentStep } from "./agent.js";

/**
 * One iteration of the agent's edit→verify→repair cycle, derived from the step
 * stream. A new iteration starts at each proposed patch (`diff` step). The
 * iteration's verification outcome is read from the verify result/error steps
 * that follow the patch.
 */
export type IterationStatus = "in_progress" | "verified" | "failed";

export type AgentIteration = {
  /** 1-indexed iteration number. */
  index: number;
  /** Step ids belonging to this iteration, in order. */
  stepIds: string[];
  /** Whether this iteration includes a proposed patch. */
  hasPatch: boolean;
  status: IterationStatus;
  /** Timestamp of the first step in the iteration. */
  startedAt: number;
};

const VERIFY_PASS = "验证通过";
const VERIFY_FAIL = "验证失败";

/**
 * Group a run's steps into edit/verify iterations for the timeline view. Steps
 * before the first patch form iteration 1 (exploration); each subsequent `diff`
 * step opens a new iteration. Pure and UI-agnostic so it can be unit-tested.
 */
export function deriveIterations(steps: AgentStep[]): AgentIteration[] {
  const iterations: AgentIteration[] = [];
  let current: AgentIteration | null = null;

  const open = (step: AgentStep): AgentIteration => {
    const it: AgentIteration = {
      index: iterations.length + 1,
      stepIds: [],
      hasPatch: false,
      status: "in_progress",
      startedAt: step.createdAt,
    };
    iterations.push(it);
    return it;
  };

  for (const step of steps) {
    // A proposed patch starts a fresh iteration (unless the current one has no patch yet).
    if (step.type === "diff") {
      if (!current || current.hasPatch) current = open(step);
      current.hasPatch = true;
    }
    if (!current) current = open(step);
    current.stepIds.push(step.id);

    if (step.type === "tool_result" && step.content.includes(VERIFY_PASS)) {
      current.status = "verified";
    } else if (step.type === "error" && step.content.includes(VERIFY_FAIL)) {
      current.status = "failed";
    }
  }

  return iterations;
}
