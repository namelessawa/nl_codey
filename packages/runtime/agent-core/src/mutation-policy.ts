import type { LLMToolCall } from "@nlc/shared";

/** Canonical persistent/process-capable host tool classification. */
export const MUTATING_AGENT_TOOL_NAMES = [
  "apply_patch",
  "run_command",
  "write_memory",
] as const;

/**
 * Reserved for compatibility with older providers/prompts. `write_file` is not
 * advertised or dispatched, but a dynamic source must never claim the name.
 */
export const RESERVED_MUTATING_TOOL_NAMES = ["write_file"] as const;

export type MutationCapability =
  | "workspace.write"
  | "process.execute"
  | "memory.write"
  | "dynamic.mutate";

export type MutationControl =
  | "per_call_approval"
  | "sandbox_writeback_approval"
  | "explicit_user_action"
  | "explicit_modal_confirmation"
  | "capability_grant"
  | "feature_flag"
  | "trusted_recovery"
  | "role_denied"
  | "default_off";

export type MutationAuthorizationProof = {
  approved?: boolean;
  explicitUserAction?: boolean;
  capabilityGranted?: boolean;
  featureEnabled?: boolean;
  trustedRuntime?: boolean;
  auditRecorded?: boolean;
};

export type MutationAuthorizationResult =
  | { allowed: true; reason: string }
  | { allowed: false; reason: string };

/**
 * Shared fail-closed contract used by runtime policy and inventory tests.
 * Persistent mutations require both a gate-specific proof and an audit proof.
 */
export function authorizeMutation(
  control: MutationControl,
  proof: MutationAuthorizationProof,
): MutationAuthorizationResult {
  if (control === "role_denied") {
    return { allowed: false, reason: "role capability denies this mutation" };
  }
  if (control === "default_off") {
    return { allowed: false, reason: "mutation surface is disabled by default" };
  }
  if (proof.auditRecorded !== true) {
    return { allowed: false, reason: "mutation audit record is required" };
  }

  switch (control) {
    case "per_call_approval":
    case "sandbox_writeback_approval":
    case "explicit_modal_confirmation":
      return proof.approved === true
        ? { allowed: true, reason: "explicit approval and audit are present" }
        : { allowed: false, reason: "explicit approval is required" };
    case "explicit_user_action":
      return proof.explicitUserAction === true
        ? { allowed: true, reason: "direct user action and audit are present" }
        : { allowed: false, reason: "direct user action is required" };
    case "capability_grant":
      return proof.capabilityGranted === true
        ? { allowed: true, reason: "capability grant and audit are present" }
        : { allowed: false, reason: "capability grant is required" };
    case "feature_flag":
      return proof.featureEnabled === true
        ? { allowed: true, reason: "feature gate and audit are present" }
        : { allowed: false, reason: "feature gate is disabled" };
    case "trusted_recovery":
      return proof.trustedRuntime === true
        ? { allowed: true, reason: "trusted recovery path and audit are present" }
        : { allowed: false, reason: "trusted recovery context is required" };
  }
}

export type AgentMutationDecision = {
  capability: MutationCapability;
  control: "per_call_approval" | "capability_grant";
  source: "built_in" | "dynamic";
  toolName: string;
};

export type AgentMutationPolicyOptions = {
  dynamicMutatingNames?: readonly string[];
  requireCommandConfirmation: boolean;
};

/**
 * Per-loop authorization store. Approval grants are single-use and bound to a
 * tool-call id + name, so approving one call cannot authorize a later call.
 */
export class AgentMutationAuthorizer {
  private readonly dynamicMutatingNames: ReadonlySet<string>;
  private readonly approvedCalls = new Set<string>();

  constructor(private readonly options: AgentMutationPolicyOptions) {
    this.dynamicMutatingNames = new Set(options.dynamicMutatingNames ?? []);
  }

  classify(call: Pick<LLMToolCall, "name">): AgentMutationDecision | null {
    if (call.name === "apply_patch") {
      return {
        capability: "workspace.write",
        control: "per_call_approval",
        source: "built_in",
        toolName: call.name,
      };
    }
    if (call.name === "write_memory") {
      return {
        capability: "memory.write",
        control: "per_call_approval",
        source: "built_in",
        toolName: call.name,
      };
    }
    if (call.name === "run_command") {
      return {
        capability: "process.execute",
        control: this.options.requireCommandConfirmation
          ? "per_call_approval"
          : "capability_grant",
        source: "built_in",
        toolName: call.name,
      };
    }
    if (this.dynamicMutatingNames.has(call.name)) {
      return {
        capability: "dynamic.mutate",
        control: "per_call_approval",
        source: "dynamic",
        toolName: call.name,
      };
    }
    return null;
  }

  requiresApproval(call: Pick<LLMToolCall, "name">): boolean {
    return this.classify(call)?.control === "per_call_approval";
  }

  grant(call: Pick<LLMToolCall, "id" | "name">): void {
    const decision = this.classify(call);
    if (decision?.control === "per_call_approval") {
      this.approvedCalls.add(callKey(call));
    }
  }

  authorize(call: Pick<LLMToolCall, "id" | "name">): MutationAuthorizationResult {
    const decision = this.classify(call);
    if (!decision) {
      return { allowed: true, reason: "tool is not classified as mutating" };
    }
    if (decision.control === "capability_grant") {
      return authorizeMutation("capability_grant", {
        capabilityGranted: true,
        auditRecorded: true,
      });
    }

    const approved = this.approvedCalls.delete(callKey(call));
    const result = authorizeMutation("per_call_approval", {
      approved,
      auditRecorded: true,
    });
    return result.allowed
      ? result
      : {
          allowed: false,
          reason:
            `Tool "${call.name}" requires a single-use user approval for ` +
            `${decision.capability}; no matching approval grant was found.`,
        };
  }
}

function callKey(call: Pick<LLMToolCall, "id" | "name">): string {
  return `${call.id}\u0000${call.name}`;
}
