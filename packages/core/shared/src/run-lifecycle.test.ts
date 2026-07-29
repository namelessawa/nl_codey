import { describe, expect, it } from "vitest";
import {
  AgentRunLifecycleError,
  assertAgentRunTransition,
  canTransitionAgentRun,
  classifyAgentRunFailure,
  formatAgentRunStatusCode,
  getAgentRunFailureCode,
  isTerminalAgentRunState,
} from "./run-lifecycle.js";

describe("shared agent Run lifecycle", () => {
  it("accepts the approval and verify-repair paths plus terminal continuation", () => {
    const path = [
      ["idle", "tool_use"],
      ["tool_use", "waiting_for_user_approval"],
      ["waiting_for_user_approval", "applying_patch"],
      ["applying_patch", "verifying"],
      ["verifying", "repairing"],
      ["repairing", "tool_use"],
      ["tool_use", "done"],
      ["done", "tool_use"],
    ] as const;

    for (const [from, to] of path) {
      expect(canTransitionAgentRun(from, to)).toBe(true);
      expect(() => assertAgentRunTransition(from, to)).not.toThrow();
    }
    expect(canTransitionAgentRun("idle", "done")).toBe(true);
    expect(canTransitionAgentRun("tool_use", "tool_use")).toBe(true);
  });

  it("rejects phase jumps out of terminal and approval states", () => {
    expect(canTransitionAgentRun("done", "verifying")).toBe(false);
    expect(canTransitionAgentRun("waiting_for_user_approval", "planning")).toBe(
      false,
    );

    try {
      assertAgentRunTransition("done", "verifying");
      throw new Error("expected transition rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentRunLifecycleError);
      expect(error).toMatchObject({
        code: "invalid_run_transition",
        from: "done",
        to: "verifying",
      });
    }
  });

  it("shares terminal-state and stable failure-code presentation", () => {
    expect(isTerminalAgentRunState("budget_exceeded")).toBe(true);
    expect(isTerminalAgentRunState("repairing")).toBe(false);
    expect(
      formatAgentRunStatusCode({
        status: "failed",
        exitReason: "provider_request",
      }),
    ).toBe("failed [provider_request]");
    expect(
      getAgentRunFailureCode({
        status: "failed",
        exitReason: "legacy free-form reason",
      }),
    ).toBe("internal_failure");
    expect(
      getAgentRunFailureCode({
        status: "done",
        exitReason: "done",
      }),
    ).toBeNull();
    expect(
      formatAgentRunStatusCode({
        status: "budget_exceeded",
        exitReason: "max_iterations",
      }),
    ).toBe("budget_exceeded [max_iterations]");
  });
});

describe("shared agent error taxonomy", () => {
  it("preserves explicit codes and categorizes boundary failures", () => {
    expect(
      classifyAgentRunFailure(
        Object.assign(new Error("request failed"), {
          code: "verification_failure",
        }),
      ),
    ).toBe("verification_failure");
    expect(classifyAgentRunFailure(new Error("HTTP 429 from provider"))).toBe(
      "provider_request",
    );
    expect(
      classifyAgentRunFailure(
        new Error(
          'custom API error HTTP 400: {"message":"invalid provider configuration"}',
        ),
      ),
    ).toBe("provider_request");
    expect(classifyAgentRunFailure(new Error("Missing API key"))).toBe(
      "provider_configuration",
    );
    expect(
      classifyAgentRunFailure(
        Object.assign(new Error("constraint"), { code: "SQLITE_BUSY" }),
      ),
    ).toBe("storage_failure");
    expect(
      classifyAgentRunFailure(
        new Error("Model stopped without tools (reason: max_tokens)"),
      ),
    ).toBe("model_protocol");
  });

  it("uses the caller's bounded fallback for unknown errors", () => {
    expect(
      classifyAgentRunFailure("unclassified fixture", "tool_execution"),
    ).toBe("tool_execution");
  });
});
