import type { AgentRun, AgentRunState } from "./agent.js";
import type { BudgetExceededReason } from "./budget.js";

export const AGENT_RUN_STATES = [
  "idle",
  "planning",
  "searching",
  "reading",
  "editing",
  "tool_use",
  "waiting_for_user_approval",
  "applying_patch",
  "running_command",
  "verifying",
  "repairing",
  "done",
  "failed",
  "cancelled",
  "budget_exceeded",
] as const satisfies readonly AgentRunState[];

export const AGENT_RUN_FAILURE_CODES = [
  "provider_configuration",
  "provider_request",
  "model_protocol",
  "policy_denied",
  "tool_execution",
  "verification_failure",
  "storage_failure",
  "interrupted_restart",
  "internal_failure",
] as const;

export type AgentRunFailureCode = (typeof AGENT_RUN_FAILURE_CODES)[number];

export type AgentRunExitReason =
  | "done"
  | "cancelled"
  | "rolled_back"
  | "failed"
  | BudgetExceededReason
  | AgentRunFailureCode;

export type AgentRunLifecycleErrorCode =
  | "run_not_found"
  | "invalid_run_transition";

const TERMINAL_STATES: ReadonlySet<AgentRunState> = new Set([
  "done",
  "failed",
  "cancelled",
  "budget_exceeded",
]);

/**
 * Explicit legal state edges. Same-state writes are idempotent and accepted
 * separately. Terminal -> tool_use is the deliberate multi-turn continuation
 * edge; terminal -> cancelled is reserved for rollback/cancel intent.
 */
export const AGENT_RUN_TRANSITIONS: Readonly<
  Record<AgentRunState, readonly AgentRunState[]>
> = {
  idle: ["planning", "tool_use", "done", "failed", "cancelled"],
  planning: [
    "searching",
    "reading",
    "tool_use",
    "waiting_for_user_approval",
    "failed",
    "cancelled",
    "budget_exceeded",
  ],
  searching: [
    "reading",
    "editing",
    "tool_use",
    "waiting_for_user_approval",
    "failed",
    "cancelled",
    "budget_exceeded",
  ],
  reading: [
    "searching",
    "editing",
    "tool_use",
    "waiting_for_user_approval",
    "failed",
    "cancelled",
    "budget_exceeded",
  ],
  editing: [
    "tool_use",
    "waiting_for_user_approval",
    "applying_patch",
    "failed",
    "cancelled",
    "budget_exceeded",
  ],
  tool_use: [
    "planning",
    "waiting_for_user_approval",
    "applying_patch",
    "running_command",
    "verifying",
    "repairing",
    "done",
    "failed",
    "cancelled",
    "budget_exceeded",
  ],
  waiting_for_user_approval: [
    "tool_use",
    "applying_patch",
    "running_command",
    "failed",
    "cancelled",
    "budget_exceeded",
  ],
  applying_patch: [
    "tool_use",
    "running_command",
    "verifying",
    "repairing",
    "done",
    "failed",
    "cancelled",
    "budget_exceeded",
  ],
  running_command: [
    "tool_use",
    "verifying",
    "repairing",
    "done",
    "failed",
    "cancelled",
    "budget_exceeded",
  ],
  verifying: [
    "tool_use",
    "repairing",
    "done",
    "failed",
    "cancelled",
    "budget_exceeded",
  ],
  repairing: [
    "tool_use",
    "waiting_for_user_approval",
    "applying_patch",
    "verifying",
    "done",
    "failed",
    "cancelled",
    "budget_exceeded",
  ],
  done: ["tool_use", "cancelled"],
  failed: ["tool_use", "cancelled"],
  cancelled: ["tool_use"],
  budget_exceeded: ["tool_use", "cancelled"],
};

export class AgentRunLifecycleError extends Error {
  readonly code: AgentRunLifecycleErrorCode;
  readonly from: AgentRunState | null;
  readonly to: AgentRunState | null;

  constructor(
    code: AgentRunLifecycleErrorCode,
    detail: {
      runId?: string;
      from?: AgentRunState;
      to?: AgentRunState;
    } = {},
  ) {
    const message =
      code === "run_not_found"
        ? `Run not found: ${detail.runId ?? "unknown"}`
        : `Invalid run transition: ${detail.from ?? "unknown"} -> ${detail.to ?? "unknown"}`;
    super(message);
    this.name = "AgentRunLifecycleError";
    this.code = code;
    this.from = detail.from ?? null;
    this.to = detail.to ?? null;
  }
}

export function isAgentRunState(value: unknown): value is AgentRunState {
  return (
    typeof value === "string" &&
    (AGENT_RUN_STATES as readonly string[]).includes(value)
  );
}

export function isTerminalAgentRunState(status: AgentRunState): boolean {
  return TERMINAL_STATES.has(status);
}

export function canTransitionAgentRun(
  from: AgentRunState,
  to: AgentRunState,
): boolean {
  return from === to || AGENT_RUN_TRANSITIONS[from].includes(to);
}

export function assertAgentRunTransition(
  from: AgentRunState,
  to: AgentRunState,
): void {
  if (!canTransitionAgentRun(from, to)) {
    throw new AgentRunLifecycleError("invalid_run_transition", { from, to });
  }
}

export function isAgentRunFailureCode(
  value: unknown,
): value is AgentRunFailureCode {
  return (
    typeof value === "string" &&
    (AGENT_RUN_FAILURE_CODES as readonly string[]).includes(value)
  );
}

/**
 * Convert heterogeneous boundary errors into a stable, non-secret category.
 * The human-readable message remains a separately redacted audit field.
 */
export function classifyAgentRunFailure(
  error: unknown,
  fallback: AgentRunFailureCode = "internal_failure",
): AgentRunFailureCode {
  const explicitCode = getStringProperty(error, "code");
  if (isAgentRunFailureCode(explicitCode)) return explicitCode;
  if (explicitCode?.startsWith("SQLITE_")) return "storage_failure";

  const message = error instanceof Error ? error.message : String(error);
  if (
    /\b(?:http|api error)\s*\d{3}\b|llm stream|network|fetch|request timed? ?out/i.test(
      message,
    )
  ) {
    return "provider_request";
  }
  if (/api[-_\s]?key|provider configuration|missing credential/i.test(message)) {
    return "provider_configuration";
  }
  if (/\bprovider\b/i.test(message)) return "provider_request";
  if (/model stopped without tools|finish reason|max_tokens/i.test(message)) {
    return "model_protocol";
  }
  if (/read-only|not allowed|disabled|denied|policy|approval required/i.test(message)) {
    return "policy_denied";
  }
  if (/verify|verification|test failure|regression/i.test(message)) {
    return "verification_failure";
  }
  if (/tool(?:\s+execution)?\s+(?:failed|error)|unknown tool/i.test(message)) {
    return "tool_execution";
  }
  if (/storage|database|disk|sqlite/i.test(message)) return "storage_failure";
  if (/interrupted.*restart|restart.*interrupted/i.test(message)) {
    return "interrupted_restart";
  }
  return fallback;
}

export function formatAgentRunStatusCode(
  run: Pick<AgentRun, "status" | "exitReason">,
): string {
  if (run.status === "failed") {
    const failure = getAgentRunFailureCode(run);
    return `failed [${failure}]`;
  }
  if (run.status === "budget_exceeded") {
    return `budget_exceeded [${run.exitReason ?? "budget_limit"}]`;
  }
  if (run.status === "cancelled" && run.exitReason === "rolled_back") {
    return "cancelled [rolled_back]";
  }
  return run.status;
}

export function getAgentRunFailureCode(
  run: Pick<AgentRun, "status" | "exitReason">,
): AgentRunFailureCode | null {
  if (run.status !== "failed") return null;
  return isAgentRunFailureCode(run.exitReason)
    ? run.exitReason
    : "internal_failure";
}

export function formatAgentRunFailure(
  code: AgentRunFailureCode,
  message: string,
): string {
  return `[${code}] ${message}`;
}

function getStringProperty(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : null;
}
