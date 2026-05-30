import { describe, expect, it } from "vitest";
import type {
  BudgetLimits,
  ChatLLMProvider,
  LLMChatInput,
  LLMChunk,
  LLMCompleteOutput,
  LLMMessage,
} from "@coding-agent/shared";
import { BudgetController } from "./budget.js";
import { runToolLoop } from "./loop.js";
import { AGENT_TOOL_SCHEMAS } from "./tools-registry.js";

const LIMITS: BudgetLimits = { maxIterations: 15, maxCostUsd: 5, maxToolCalls: 50, maxWallTimeMs: 60_000 };
const ZERO_USAGE = { inputTokens: 1, outputTokens: 1, costUsd: 0 };

/**
 * A deterministic provider scripted for the acceptance scenarios: it proposes a
 * patch, and if the most recent message reports a failed verification it
 * proposes a repair, otherwise it finishes. This mirrors the real verify→repair
 * loop without a network call.
 */
class ScriptedLLM implements ChatLLMProvider {
  readonly name = "scripted";
  readonly model = "scripted-1";
  readonly contextWindow = 100_000;

  async complete(): Promise<LLMCompleteOutput> {
    return { text: "summary" };
  }

  async *chat(input: LLMChatInput): AsyncIterable<LLMChunk> {
    const patchCount = input.messages.filter(
      (m) => m.role === "assistant" && (m.toolCalls ?? []).some((c) => c.name === "apply_patch"),
    ).length;
    const last = input.messages[input.messages.length - 1];
    const lastWasFailure = last?.role === "user" && last.content.includes("验证失败");

    if (patchCount === 0 || lastWasFailure) {
      yield { type: "text_delta", text: patchCount === 0 ? "first attempt" : "repairing" };
      yield { type: "tool_call", id: `p${patchCount + 1}`, name: "apply_patch", args: { patch: "PATCH" } };
      yield { type: "finish", reason: "tool_use", usage: ZERO_USAGE };
      return;
    }
    yield { type: "text_delta", text: "done" };
    yield { type: "finish", reason: "stop", usage: ZERO_USAGE };
  }
}

describe("acceptance: verify → repair → done", () => {
  it("repairs after a failed verification and finishes once it passes", async () => {
    const approvals: string[] = [];
    const executed: string[] = [];
    let verifyCalls = 0;

    const outcome = await runToolLoop([{ role: "user", content: "fix the bug" }], {
      llm: new ScriptedLLM(),
      tools: AGENT_TOOL_SCHEMAS,
      budget: new BudgetController(LIMITS),
      requiresApproval: (c) => c.name === "apply_patch",
      waitForApproval: async (c) => {
        approvals.push(c.name);
        return true;
      },
      executeTool: async (c) => {
        executed.push(c.name);
        return JSON.stringify({ applied: true, changedFiles: ["x.ts"] });
      },
      verifyAfterPatch: async () => {
        verifyCalls += 1;
        return verifyCalls === 1 ? "❌ 自动验证失败：exit 1" : "✅ 自动验证通过";
      },
    });

    expect(executed).toEqual(["apply_patch", "apply_patch"]); // initial + repair
    expect(approvals).toEqual(["apply_patch", "apply_patch"]); // both gated on approval
    expect(verifyCalls).toBe(2);
    expect(outcome.state).toBe("done");
  });
});

describe("acceptance: user rejects the patch", () => {
  it("cancels the run when approval is denied and never executes the patch", async () => {
    const executed: string[] = [];
    const outcome = await runToolLoop([{ role: "user", content: "do it" }], {
      llm: new ScriptedLLM(),
      tools: AGENT_TOOL_SCHEMAS,
      budget: new BudgetController(LIMITS),
      requiresApproval: (c) => c.name === "apply_patch",
      waitForApproval: async () => false,
      executeTool: async (c) => {
        executed.push(c.name);
        return "{}";
      },
    });

    expect(executed).toEqual([]); // patch was never applied
    expect(outcome).toMatchObject({ state: "cancelled" });
  });
});

describe("acceptance: budget circuit breaker", () => {
  it("stops with budget_exceeded when the iteration cap is hit", async () => {
    const messages: LLMMessage[] = [{ role: "user", content: "loop" }];
    const outcome = await runToolLoop(messages, {
      llm: new ScriptedLLM(),
      tools: AGENT_TOOL_SCHEMAS,
      budget: new BudgetController({ ...LIMITS, maxIterations: 1 }),
      requiresApproval: () => true,
      waitForApproval: async () => true,
      executeTool: async () => JSON.stringify({ applied: true }),
      // Verification keeps failing, forcing repair attempts until the budget trips.
      verifyAfterPatch: async () => "❌ 自动验证失败：exit 1",
    });
    expect(outcome.state).toBe("budget_exceeded");
  });
});
