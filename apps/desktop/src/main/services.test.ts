import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRun, AgentStep } from "@nlc/shared";
import type { Storage as StorageShape } from "@nlc/storage";

const mocked = vi.hoisted(() => ({
  makeStorage: vi.fn(),
  buildPluginBundle: vi.fn(),
  buildExtendedPorts: vi.fn(() => null),
}));

vi.mock("@nlc/storage", () => ({
  Storage: class {
    constructor(_dbPath: string) {
      return mocked.makeStorage();
    }
  },
}));

vi.mock("@nlc/llm", () => {
  const makeProvider = () => ({
    name: "desktop-wiring-test",
    model: "desktop-wiring-test",
    contextWindow: 100_000,
    async complete() {
      return { text: "unused" };
    },
    async *chat() {
      yield { type: "text_delta" as const, text: "continued without plugins" };
      yield {
        type: "finish" as const,
        reason: "stop" as const,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      };
    },
  });
  return {
    createLLMProvider: vi.fn(makeProvider),
    createLLMProviderFromEnv: vi.fn(makeProvider),
  };
});

vi.mock("./settings/store.js", () => ({
  SettingsStore: class {
    getLLMConfig() {
      return { apiKey: "" };
    }

    getSettings() {
      return {
        agent: {
          workspacePath: "",
          allowShellExecution: false,
          requireConfirmationBeforeCommand: false,
          maxAutoSteps: 5,
          sandboxEnabled: false,
          sandboxMode: "whitelist",
          budgetUsd: 0.5,
          readOnly: true,
          multiAgentEnabled: false,
        },
        ui: { language: "en-US" },
      };
    }
  },
}));

vi.mock("./installation-gate.js", () => ({
  InstallationGate: class {
    assertToolAllowed(_toolName: string) {}
  },
}));

vi.mock("./advanced-settings-store.js", () => ({
  AdvancedSettingsStore: class {
    get() {
      return {
        globalMemoryEnabled: false,
        styleProfileEnabled: false,
        pluginsEnabled: true,
      };
    }
  },
}));

vi.mock("./extended-ports.js", () => ({
  buildExtendedPorts: mocked.buildExtendedPorts,
}));

vi.mock("./plugin-runtime.js", () => ({
  buildPluginBundle: mocked.buildPluginBundle,
}));

import { buildServices } from "./services.js";

const roots: string[] = [];
const terminalStates = new Set(["done", "failed", "cancelled", "budget_exceeded"]);

beforeEach(() => {
  mocked.makeStorage.mockReset();
  mocked.buildPluginBundle.mockReset();
  mocked.buildExtendedPorts.mockClear();
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("buildServices dynamic tool wiring", () => {
  it("lets AgentService audit a buildPluginBundle factory failure", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-services-security-"));
    roots.push(dataRoot);
    const workspaceRoot = path.join(dataRoot, "workspace");
    fs.mkdirSync(workspaceRoot);
    const storage = createMemoryStorage(workspaceRoot);
    mocked.makeStorage.mockReturnValue(storage);
    mocked.buildPluginBundle.mockImplementation(() => {
      throw new Error("plugin bundle construction failed");
    });

    const services = buildServices(vi.fn(), { dataRoot });
    const initial = await services.agent.runTask("workspace-1", "exercise desktop wiring");
    const detail = await waitForTerminal(services.agent, storage, initial.run.id);

    expect(mocked.buildPluginBundle).toHaveBeenCalledOnce();
    expect(detail.run.status).toBe("done");
    expect(detail.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          content: expect.stringContaining(
            "[security] Dynamic tools disabled: bundle factory failed " +
              "(plugin bundle construction failed).",
          ),
        }),
      ]),
    );
  });
});

function createMemoryStorage(workspaceRoot: string): StorageShape {
  const workspace = { id: "workspace-1", rootPath: workspaceRoot, openedAt: Date.now() };
  let run: AgentRun | null = null;
  const steps: AgentStep[] = [];

  return {
    finetune: {
      getActiveModel: () => null,
    },
    getWorkspace: (id: string) => (id === workspace.id ? workspace : null),
    createRun: (workspaceId: string, userTask: string) => {
      const now = Date.now();
      run = {
        id: "run-1",
        workspaceId,
        userTask,
        status: "idle",
        createdAt: now,
        updatedAt: now,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        toolCallCount: 0,
        iterationCount: 0,
        modelName: null,
        exitReason: null,
      };
      return run;
    },
    getRun: (runId: string) => (run?.id === runId ? run : null),
    listRuns: () => (run ? [run] : []),
    setRunModel: (_runId: string, modelName: string) => {
      if (run) run = { ...run, modelName };
    },
    updateRunStatus: (_runId: string, status: AgentRun["status"]) => {
      if (!run) throw new Error("Run not found: run-1");
      run = { ...run, status, updatedAt: Date.now() };
      return run;
    },
    addRunUsage: (_runId: string, delta: Record<string, number>) => {
      if (!run) throw new Error("Run not found: run-1");
      run = {
        ...run,
        inputTokens: (run.inputTokens ?? 0) + (delta.inputTokens ?? 0),
        outputTokens: (run.outputTokens ?? 0) + (delta.outputTokens ?? 0),
        costUsd: (run.costUsd ?? 0) + (delta.costUsd ?? 0),
        toolCallCount: (run.toolCallCount ?? 0) + (delta.toolCalls ?? 0),
        iterationCount: (run.iterationCount ?? 0) + (delta.iterations ?? 0),
      };
      return run;
    },
    setRunExitReason: (_runId: string, exitReason: string) => {
      if (run) run = { ...run, exitReason };
    },
    addStep: (runId: string, type: AgentStep["type"], content: string) => {
      const step: AgentStep = {
        id: `step-${steps.length + 1}`,
        runId,
        type,
        content,
        createdAt: Date.now(),
      };
      steps.push(step);
      return step;
    },
    listSteps: (runId: string) => steps.filter((step) => step.runId === runId),
    saveRunMessages: vi.fn(),
  } as unknown as StorageShape;
}

async function waitForTerminal(
  agent: ReturnType<typeof buildServices>["agent"],
  storage: StorageShape,
  runId: string,
) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const current = storage.getRun(runId);
    if (current && terminalStates.has(current.status)) {
      return agent.getDetail(runId);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Desktop wiring test run did not reach a terminal state");
}
