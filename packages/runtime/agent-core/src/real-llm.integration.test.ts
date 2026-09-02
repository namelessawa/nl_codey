/**
 * Real-LLM integration smoke test.
 *
 * Drives the autonomous tool loop against the OpenAI-compatible custom
 * provider configured in ignored repository-root custom.txt and asserts that
 * the Phase 3 tool wiring actually reaches the
 * model. We do not assert specific response text — that's too brittle against
 * model drift — only that the model called the read_memory tool we exposed,
 * proving the schema + dispatch round-trip works end-to-end.
 *
 * The dedicated Vitest config is the only supported opt-in:
 *   pnpm test:llm:live
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  ChatLLMProvider,
  LLMToolCall,
  ReadMemoryHit,
  SemanticSearchToolHit,
  WebFetchToolInput,
  WebSearchToolInput,
  WriteMemoryInput,
} from "@nlc/shared";
import { createLLMProvider } from "@nlc/llm";
import { BudgetController } from "./budget.js";
import { runToolLoop } from "./loop.js";
import { agentToolSchemas, createToolExecutor } from "./tools-registry.js";
import { type ExtendedAgentPorts } from "./extended-tools.js";
import { loadLiveLLMConfig } from "./live-llm-config.js";

const LIVE_ENABLED = process.env.NLC_RUN_LIVE_LLM_SMOKE === "1";
const describeReal = LIVE_ENABLED ? describe : describe.skip;

function buildPorts(): {
  ports: ExtendedAgentPorts;
  callLog: { tool: string; args: Record<string, unknown> }[];
} {
  const callLog: { tool: string; args: Record<string, unknown> }[] = [];

  const ports: ExtendedAgentPorts = {
    semanticSearch: {
      async search(query: string): Promise<SemanticSearchToolHit[]> {
        callLog.push({ tool: "semantic_search", args: { query } });
        return [];
      },
    },
    memory: {
      async read(query, kind, max): Promise<ReadMemoryHit[]> {
        const args: Record<string, unknown> = { max };
        if (query !== undefined) args.query = query;
        if (kind !== undefined) args.kind = kind;
        callLog.push({ tool: "read_memory", args });
        // Deterministic single hit so the model has something concrete to
        // report back. The body is unmistakable: that lets us assert below.
        return [
          {
            id: "fact-1",
            kind: "fact",
            title: "Test framework",
            body: "This project uses vitest for all unit and integration tests.",
            tags: ["test", "framework"],
            score: 1,
          },
        ];
      },
      async write(input: WriteMemoryInput) {
        callLog.push({ tool: "write_memory", args: { ...input } });
        return { id: "stub-id", kind: input.kind };
      },
    },
    web: {
      async search(input: WebSearchToolInput) {
        callLog.push({ tool: "web_search", args: { ...input } });
        return { query: input.query, results: [] };
      },
      async fetch(input: WebFetchToolInput) {
        callLog.push({ tool: "web_fetch", args: { ...input } });
        return { url: input.url, text: "", truncated: false };
      },
    },
  };
  return { ports, callLog };
}

describeReal("real-LLM smoke (custom.txt)", () => {
  it(
    "drives a Phase 3 tool call through the real model",
    async () => {
      const config = loadLiveLLMConfig(path.resolve(process.cwd(), "custom.txt"));
      const llm: ChatLLMProvider = createLLMProvider(config);

      const { ports, callLog } = buildPorts();
      const ctx = {
        workspaceRoot: process.cwd(),
        runId: "real-llm-smoke",
        signal: new AbortController().signal,
      };

      // Minimal storage stub — apply_patch etc. are not on the test path.
      const storage = {
        snapshotFile: (): void => undefined,
        addStep: (): void => undefined,
      } as unknown as Parameters<typeof createToolExecutor>[0]["storage"];

      const execute = createToolExecutor({
        ctx,
        storage,
        allowShellExecution: false,
        readOnly: true,
        authorizeMutation: () => ({
          allowed: false,
          reason: "live read-only smoke does not grant mutation capability",
        }),
        phase3Ports: ports,
      });

      const tools = agentToolSchemas({ readOnly: true, phase3Available: true });

      const userTask = [
        "You have read_memory available. Call read_memory to retrieve any project memory",
        'about the test framework (use query = "test framework"). After receiving the',
        "result, reply in plain text with one short sentence stating which test framework",
        "this project uses, citing the memory entry's title.",
      ].join(" ");

      const calls: LLMToolCall[] = [];
      const outcome = await runToolLoop(
        [
          {
            role: "system",
            content:
              "You are a coding assistant in read-only mode. Use the read_memory tool to answer the user's question.",
          },
          { role: "user", content: userTask },
        ],
        {
          llm,
          tools,
          budget: new BudgetController({
            maxIterations: 6,
            maxCostUsd: 1,
            maxToolCalls: 12,
            maxWallTimeMs: 120_000,
          }),
          signal: ctx.signal,
          requiresApproval: () => false,
          waitForApproval: async () => true,
          executeTool: async (call) => {
            calls.push(call);
            const result = await execute(call);
            return result.resultText;
          },
        },
      );

      // The run should land in a terminal state (done / failed / budget). We
      // only assert "not still running"; a model that refuses to call tools is
      // a model regression but not a wiring regression.
      expect(["done", "failed", "budget_exceeded"]).toContain(outcome.state);

      // The actual signal: read_memory was invoked at least once via the
      // Phase 3 dispatcher. This proves schema → tool-call → port wiring
      // works end-to-end with a real model.
      const memCalls = callLog.filter((c) => c.tool === "read_memory");
      expect(memCalls.length).toBeGreaterThan(0);
      // And the LLM emitted that call through the tool API (not as prose).
      const llmMemCalls = calls.filter((c) => c.name === "read_memory");
      expect(llmMemCalls.length).toBeGreaterThan(0);
    },
    180_000,
  );
});

// Always-on placeholder so the file shows up cleanly in test runs even when
// the real test is skipped. Documents the dedicated command.
describe("real-LLM smoke (preflight)", () => {
  it("reports the explicit opt-in command without reading custom.txt", () => {
    if (LIVE_ENABLED) {
      expect(LIVE_ENABLED).toBe(true);
    } else {
      // Visible in vitest output so contributors see why the real test ran 0
      // assertions on their machine.
      // eslint-disable-next-line no-console
      console.log(
        "[real-llm] Skipped: run pnpm test:llm:live for the explicit custom.txt smoke.",
      );
      expect(LIVE_ENABLED).toBe(false);
    }
  });
});
