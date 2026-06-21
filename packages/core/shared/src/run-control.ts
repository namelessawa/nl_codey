/** Pure UI-control logic for the agent Run button, shared so it can be unit-tested
 *  under the node vitest config (the renderer has no test setup). */

import type { AgentRunState } from "./agent.js";

/** States where a run is mid-flight and must not be restarted concurrently. */
const ACTIVE_RUN_STATES: ReadonlySet<AgentRunState> = new Set([
  "planning",
  "searching",
  "reading",
  "editing",
  "tool_use",
  "applying_patch",
  "running_command",
  "verifying",
  "repairing",
]);

/** True while a run is actively executing. */
export function isRunActive(status: AgentRunState): boolean {
  return ACTIVE_RUN_STATES.has(status);
}

/**
 * Whether the Run button should be disabled.
 *
 * Deliberately independent of whether a workspace is open: a missing workspace
 * is handled by {@link runPreconditionError} so the user gets a visible error
 * instead of a silently dead button. Run is blocked only while a run is active.
 */
export function isRunDisabled(status: AgentRunState): boolean {
  return isRunActive(status);
}

/**
 * Returns the precondition error to surface before starting a run, or null when
 * the run can proceed. Workspace is checked first so its message takes priority.
 */
export function runPreconditionError(hasWorkspace: boolean, task: string): string | null {
  if (!hasWorkspace) return "Open a workspace first";
  if (!task.trim()) return "Enter a task";
  return null;
}
