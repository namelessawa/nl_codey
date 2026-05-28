/**
 * Strict structured messaging between roles. There is NO free-form dialogue:
 * every message must match one of the four legal {@link RoleMessageKind} shapes
 * AND a legal from/to role pairing, or it is rejected before persistence.
 */

import { randomUUID } from "node:crypto";

import type {
  AgentRole,
  RoleMessage,
  RoleMessageKind,
  RoleMessageRow,
  ReviewComment,
  ReviewResult,
} from "@coding-agent/shared";

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

/** Legal (fromRole -> toRole) pairing for each message kind. */
const LEGAL_PAIRS: Record<RoleMessageKind, { from: AgentRole; to: AgentRole }> = {
  breakdown: { from: "planner", to: "orchestrator" },
  review_request: { from: "coder", to: "reviewer" },
  review_result: { from: "reviewer", to: "coder" },
  handoff: { from: "orchestrator", to: "coder" },
};

const REVIEW_VERDICTS = new Set(["approved", "changes_requested"]);
const PASS_FAIL = new Set(["pass", "fail"]);
const RISK_LEVELS = new Set(["low", "medium", "high"]);
const SEVERITIES = new Set(["warning", "blocker"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function validateBreakdownPayload(payload: unknown, errors: string[]): void {
  if (!isRecord(payload) || !isRecord(payload.breakdown)) {
    errors.push("breakdown payload must be { breakdown: { root, tasks[] } }.");
    return;
  }
  const breakdown = payload.breakdown;
  if (!isString(breakdown.root)) {
    errors.push("breakdown.root must be a string.");
  }
  if (!Array.isArray(breakdown.tasks)) {
    errors.push("breakdown.tasks must be an array.");
    return;
  }
  breakdown.tasks.forEach((task, i) => {
    if (!isRecord(task) || !isString(task.id) || !isString(task.title)) {
      errors.push(`breakdown.tasks[${i}] must have string id and title.`);
    }
  });
}

function validateReviewRequestPayload(payload: unknown, errors: string[]): void {
  if (!isRecord(payload)) {
    errors.push("review_request payload must be an object.");
    return;
  }
  if (!isString(payload.taskNodeId)) errors.push("review_request.taskNodeId must be a string.");
  if (!isString(payload.diff)) errors.push("review_request.diff must be a string.");
  if (!isString(payload.testOutput)) errors.push("review_request.testOutput must be a string.");
}

function validateReviewComment(comment: unknown, i: number, errors: string[]): void {
  if (!isRecord(comment)) {
    errors.push(`review_result.comments[${i}] must be an object.`);
    return;
  }
  if (!isString(comment.file)) errors.push(`review_result.comments[${i}].file must be a string.`);
  if (typeof comment.line !== "number") errors.push(`review_result.comments[${i}].line must be a number.`);
  if (!isString(comment.message)) errors.push(`review_result.comments[${i}].message must be a string.`);
  if (!SEVERITIES.has(comment.severity as string)) {
    errors.push(`review_result.comments[${i}].severity must be "warning" | "blocker".`);
  }
}

function validateReviewResultPayload(payload: unknown, errors: string[]): void {
  if (!isRecord(payload)) {
    errors.push("review_result payload must be a ReviewResult object.");
    return;
  }
  if (!PASS_FAIL.has(payload.correctness as string)) errors.push("review_result.correctness must be pass|fail.");
  if (!PASS_FAIL.has(payload.scope_compliance as string)) errors.push("review_result.scope_compliance must be pass|fail.");
  if (!PASS_FAIL.has(payload.style_consistency as string)) errors.push("review_result.style_consistency must be pass|fail.");
  if (!RISK_LEVELS.has(payload.regression_risk as string)) errors.push("review_result.regression_risk must be low|medium|high.");
  if (!REVIEW_VERDICTS.has(payload.verdict as string)) errors.push("review_result.verdict must be approved|changes_requested.");
  if (!Array.isArray(payload.comments)) {
    errors.push("review_result.comments must be an array.");
  } else {
    payload.comments.forEach((c, i) => validateReviewComment(c, i, errors));
  }
}

function validateHandoffPayload(payload: unknown, errors: string[]): void {
  if (!isRecord(payload) || !isString(payload.taskNodeId)) {
    errors.push("handoff payload must be { taskNodeId: string }.");
  }
}

const PAYLOAD_VALIDATORS: Record<RoleMessageKind, (p: unknown, e: string[]) => void> = {
  breakdown: validateBreakdownPayload,
  review_request: validateReviewRequestPayload,
  review_result: validateReviewResultPayload,
  handoff: validateHandoffPayload,
};

/**
 * Hand-rolled validation of a role message against its legal shape and the legal
 * from/to pairing for its kind. Returns the list of problems (empty == valid).
 */
export function validateRoleMessage(
  kind: RoleMessageKind,
  fromRole: AgentRole,
  toRole: AgentRole,
  payload: unknown,
): ValidationResult {
  const errors: string[] = [];

  const pair = LEGAL_PAIRS[kind];
  if (!pair) {
    return { ok: false, errors: [`Unknown message kind "${String(kind)}".`] };
  }
  if (fromRole !== pair.from || toRole !== pair.to) {
    errors.push(
      `Illegal routing for "${kind}": expected ${pair.from} -> ${pair.to}, got ${fromRole} -> ${toRole}.`,
    );
  }

  PAYLOAD_VALIDATORS[kind](payload, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export type MessageBusOptions = {
  persist: (row: RoleMessageRow) => void;
  emit?: (msg: RoleMessage) => void;
  logError?: (errors: string[], msg: Omit<RoleMessage, "id" | "createdAt">) => void;
};

/**
 * Validates, persists, and emits structured role messages. Invalid messages
 * throw (and are logged via `logError` when provided) so a malformed message can
 * never silently enter the system.
 */
export class MessageBus {
  private readonly persist: (row: RoleMessageRow) => void;
  private readonly emit: ((msg: RoleMessage) => void) | undefined;
  private readonly logError:
    | ((errors: string[], msg: Omit<RoleMessage, "id" | "createdAt">) => void)
    | undefined;

  constructor(opts: MessageBusOptions) {
    this.persist = opts.persist;
    this.emit = opts.emit;
    this.logError = opts.logError;
  }

  send<K extends RoleMessageKind>(
    msg: Omit<RoleMessage<K>, "id" | "createdAt">,
  ): RoleMessage<K> {
    const result = validateRoleMessage(msg.kind, msg.fromRole, msg.toRole, msg.payload);
    if (!result.ok) {
      if (this.logError) this.logError(result.errors, msg);
      throw new Error(`Invalid role message: ${result.errors.join(" ")}`);
    }

    const full: RoleMessage<K> = {
      ...msg,
      id: randomUUID(),
      createdAt: Date.now(),
    } as RoleMessage<K>;

    this.persist(serializeRow(full));
    if (this.emit) this.emit(full);
    return full;
  }
}

/** Serialize a message to its persisted row form (payload JSON-stringified). */
export function serializeRow(msg: RoleMessage): RoleMessageRow {
  return {
    id: msg.id,
    taskNodeId: msg.taskNodeId,
    fromRole: msg.fromRole,
    toRole: msg.toRole,
    kind: msg.kind,
    payload: JSON.stringify(msg.payload),
    createdAt: msg.createdAt,
  };
}

/** Parse a persisted row back into a structured, validated message. */
export function parseRow(row: RoleMessageRow): RoleMessage {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    throw new Error(`Row ${row.id} has unparseable payload JSON.`);
  }

  const result = validateRoleMessage(row.kind, row.fromRole, row.toRole, payload);
  if (!result.ok) {
    throw new Error(`Row ${row.id} failed validation: ${result.errors.join(" ")}`);
  }

  return {
    id: row.id,
    taskNodeId: row.taskNodeId,
    fromRole: row.fromRole,
    toRole: row.toRole,
    kind: row.kind,
    payload: payload as RoleMessage["payload"],
    createdAt: row.createdAt,
  };
}

export type { ReviewComment, ReviewResult };
