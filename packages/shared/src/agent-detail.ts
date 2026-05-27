/** Pure reducer for the renderer's live agent-run view. Extracted so the
 *  streaming-update logic can be unit-tested under the node vitest config. */

import type { AgentRunDetail, AgentEvent } from "./ipc.js";

/**
 * Fold a live {@link AgentEvent} into the current run detail.
 *
 * Crucially, a `run_updated` event *seeds* the detail when there is none yet
 * (and adopts a newer run). The renderer only learns a run's id when
 * `runAgentTask` resolves — which, for a real LLM provider, is many seconds
 * after the click. Seeding from the first event lets the UI react immediately
 * and stream steps as the run progresses instead of appearing frozen.
 */
export function reduceAgentDetail(
  prev: AgentRunDetail | null,
  event: AgentEvent,
): AgentRunDetail | null {
  if (event.kind === "run_updated") {
    if (!prev) {
      return { run: event.run, steps: [], pendingPatch: null };
    }
    if (event.run.id === prev.run.id) {
      return { ...prev, run: event.run };
    }
    // A different run: adopt it only if it is newer, so a second run streams
    // live while a stale event for an older run is ignored.
    if (event.run.createdAt >= prev.run.createdAt) {
      return { run: event.run, steps: [], pendingPatch: null };
    }
    return prev;
  }

  // step_added / patch_ready carry no run object, so they cannot seed a detail.
  if (!prev) return null;

  if (event.kind === "step_added" && event.step.runId === prev.run.id) {
    return { ...prev, steps: [...prev.steps, event.step] };
  }
  if (event.kind === "patch_ready" && event.runId === prev.run.id) {
    return { ...prev, pendingPatch: event.patch };
  }
  return prev;
}
