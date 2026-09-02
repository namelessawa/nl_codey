import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentEvent,
  AgentRun,
  AgentRunDetail,
  AgentSettings,
  AgentStep,
  ChatLLMProvider,
  LLMChunk,
  LLMChatInput,
  LLMMessage,
  ToolSchema,
} from "@nlc/shared";
import { DEFAULT_SETTINGS } from "@nlc/shared";
import type { Storage } from "@nlc/storage";
import {
  AgentService,
  filterDynamicBundleForReadOnly,
  formatDynamicBundleFactoryFailureStep,
  type DynamicToolBundle,
  validateDynamicToolBundle,
} from "./service.js";

const READ_SCHEMA: ToolSchema = {
  name: "plugin__demo__read",
  description: "Reads project metadata.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

const WRITE_SCHEMA: ToolSchema = {
  name: "plugin__demo__write",
  description: "Writes project files.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
const terminalStates = new Set(["done", "failed", "cancelled", "budget_exceeded"]);
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("validateDynamicToolBundle", () => {
  it("rejects a missing mutatingNames classification", () => {
    expect(
      validateDynamicToolBundle({
        schemas: [READ_SCHEMA],
        dispatch: vi.fn(),
      }),
    ).toEqual({
      ok: false,
      reason: "mutatingNames classification is required",
    });
  });

  it("rejects a non-array mutatingNames classification", () => {
    expect(
      validateDynamicToolBundle({
        schemas: [READ_SCHEMA],
        dispatch: vi.fn(),
        mutatingNames: "plugin__demo__read",
      }),
    ).toEqual({
      ok: false,
      reason: "mutatingNames must be an array",
    });
  });

  it("rejects a mutating name without a matching schema", () => {
    expect(
      validateDynamicToolBundle({
        schemas: [READ_SCHEMA],
        dispatch: vi.fn(),
        mutatingNames: ["plugin__demo__missing"],
      }),
    ).toEqual({
      ok: false,
      reason: 'mutating tool "plugin__demo__missing" has no matching schema',
    });
  });

  it("rejects duplicate schemas", () => {
    expect(
      validateDynamicToolBundle({
        schemas: [READ_SCHEMA, { ...READ_SCHEMA }],
        dispatch: vi.fn(),
        mutatingNames: [],
      }),
    ).toEqual({
      ok: false,
      reason: 'duplicate dynamic tool schema "plugin__demo__read"',
    });
  });

  it("rejects duplicate mutating names", () => {
    expect(
      validateDynamicToolBundle({
        schemas: [WRITE_SCHEMA],
        dispatch: vi.fn(),
        mutatingNames: [WRITE_SCHEMA.name, WRITE_SCHEMA.name],
      }),
    ).toEqual({
      ok: false,
      reason: 'duplicate mutating tool name "plugin__demo__write"',
    });
  });

  it("rejects built-in tool name collisions", () => {
    expect(
      validateDynamicToolBundle({
        schemas: [{ ...READ_SCHEMA, name: "run_command" }],
        dispatch: vi.fn(),
        mutatingNames: [],
      }),
    ).toEqual({
      ok: false,
      reason: 'dynamic tool "run_command" conflicts with a built-in tool',
    });
  });

  it("rejects write_file as a reserved host tool name", () => {
    expect(
      validateDynamicToolBundle({
        schemas: [{ ...WRITE_SCHEMA, name: "write_file" }],
        dispatch: vi.fn(),
        mutatingNames: [],
      }),
    ).toEqual({
      ok: false,
      reason: 'dynamic tool "write_file" conflicts with a built-in tool',
    });
  });

  it("accepts an explicitly read-only bundle", () => {
    const result = validateDynamicToolBundle({
      schemas: [READ_SCHEMA],
      dispatch: vi.fn(),
      mutatingNames: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bundle.schemas).toEqual([READ_SCHEMA]);
      expect(result.bundle.mutatingNames).toEqual([]);
    }
  });

  it("refuses an undeclared dynamic call before the source dispatcher sees it", async () => {
    const sourceDispatch = vi.fn();
    const result = validateDynamicToolBundle({
      schemas: [READ_SCHEMA],
      dispatch: sourceDispatch,
      mutatingNames: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const execution = await result.bundle.dispatch(
      { id: "call-forged", name: "plugin__demo__hidden", args: {} },
      { workspaceRoot: process.cwd(), runId: "run-1" },
    );

    expect(execution?.isError).toBe(true);
    expect(execution?.resultText).toContain("was not declared");
    expect(sourceDispatch).not.toHaveBeenCalled();
  });
});

describe("dynamic tool read-only boundary", () => {
  it("keeps an explicitly read-only bundle visible and callable", async () => {
    const sourceDispatch = vi.fn(async (call) => ({
      name: call.name,
      resultText: JSON.stringify({ ok: true }),
      isError: false,
    }));
    const result = validateDynamicToolBundle({
      schemas: [READ_SCHEMA],
      dispatch: sourceDispatch,
      mutatingNames: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const filtered = filterDynamicBundleForReadOnly(result.bundle, true);
    const execution = await filtered?.dispatch(
      { id: "call-read", name: READ_SCHEMA.name, args: {} },
      { workspaceRoot: process.cwd(), runId: "run-1" },
    );

    expect(filtered?.schemas.map((schema) => schema.name)).toEqual([READ_SCHEMA.name]);
    expect(execution?.isError).toBe(false);
    expect(sourceDispatch).toHaveBeenCalledOnce();
  });

  it("hides and hard-refuses a forged mutating call", async () => {
    const sourceDispatch = vi.fn();
    const result = validateDynamicToolBundle({
      schemas: [READ_SCHEMA, WRITE_SCHEMA],
      dispatch: sourceDispatch,
      mutatingNames: [WRITE_SCHEMA.name],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const filtered = filterDynamicBundleForReadOnly(result.bundle, true);
    const execution = await filtered?.dispatch(
      { id: "call-write", name: WRITE_SCHEMA.name, args: {} },
      { workspaceRoot: process.cwd(), runId: "run-1" },
    );

    expect(filtered?.schemas.map((schema) => schema.name)).toEqual([READ_SCHEMA.name]);
    expect(execution?.isError).toBe(true);
    expect(execution?.resultText).toContain("read-only");
    expect(sourceDispatch).not.toHaveBeenCalled();
  });
});

describe("dynamic bundle factory failure audit", () => {
  it("caps an overlong error at the persisted step limit", () => {
    const content = formatDynamicBundleFactoryFailureStep(
      new Error(`plugin failed: ${"x".repeat(10_000)}`),
    );

    expect(content.length).toBeLessThanOrEqual(4_000);
    expect(content).toContain("truncated");
  });

  it("redacts Bearer tokens and Authorization header values", () => {
    const content = formatDynamicBundleFactoryFailureStep(
      new Error(
        "Bearer demo-bearer-value; Authorization: Basic demo-authorization-value; " +
          "X-API-Key: demo-api-key-value",
      ),
    );

    expect(content).toContain("[REDACTED]");
    expect(content.includes("demo-bearer-value")).toBe(false);
    expect(content.includes("demo-authorization-value")).toBe(false);
    expect(content.includes("demo-api-key-value")).toBe(false);
  });

  it("redacts URL credentials and sensitive query parameters", () => {
    const content = formatDynamicBundleFactoryFailureStep(
      new Error(
        "request https://demo-user:demo-password@example.test/plugin" +
          "?token=demo-token&api_key=demo-api-key failed",
      ),
    );

    expect(content).toContain("example.test/plugin");
    expect(content).toContain("[REDACTED]");
    expect(content.includes("demo-user")).toBe(false);
    expect(content.includes("demo-password")).toBe(false);
    expect(content.includes("demo-token")).toBe(false);
    expect(content.includes("demo-api-key")).toBe(false);
  });

  it("normalizes multiline and control-character content", () => {
    const content = formatDynamicBundleFactoryFailureStep(
      new Error("plugin registry\nline two\r\nline three\u0000done"),
    );

    expect(content).toContain("plugin registry line two line three done");
    expect(content).not.toMatch(/[\r\n\u0000]/);
  });

  it("keeps a short ordinary error actionable", () => {
    expect(
      formatDynamicBundleFactoryFailureStep(
        new Error("plugin database unavailable"),
      ),
    ).toContain("plugin database unavailable");
  });

  it("does not expose the complete local user directory", () => {
    const home = os.homedir();
    const content = formatDynamicBundleFactoryFailureStep(
      new Error(path.join(home, "plugins", "registry.json")),
    );

    expect(content).toContain("[USER_HOME]");
    expect(content.includes(home)).toBe(false);
  });
});

describe("AgentService dynamic tool integration", () => {
  it("runs a declared read-only tool through the real single-agent path", async () => {
    const sourceDispatch = vi.fn(async (call) => ({
      name: call.name,
      resultText: JSON.stringify({ value: "safe" }),
      isError: false,
    }));
    const llm = scriptedLLM([
      toolTurn(READ_SCHEMA.name),
      stopTurn("finished"),
    ]);
    const harness = createServiceHarness({
      llm,
      readOnly: true,
      dynamicFactory: () => ({
        schemas: [READ_SCHEMA],
        dispatch: sourceDispatch,
        mutatingNames: [],
      }),
    });

    const detail = await runAndWait(harness);

    expect(detail.run.status).toBe("done");
    expect(llm.seenTools[0]).toContain(READ_SCHEMA.name);
    expect(sourceDispatch).toHaveBeenCalledOnce();
    expect(detail.steps.some((step) => step.content.includes('"value":"safe"'))).toBe(true);
  });

  it("does not expose or execute a forged mutating tool on the real read-only path", async () => {
    const sourceDispatch = vi.fn();
    const llm = scriptedLLM([
      toolTurn(WRITE_SCHEMA.name),
      stopTurn("finished"),
    ]);
    const harness = createServiceHarness({
      llm,
      readOnly: true,
      dynamicFactory: () => ({
        schemas: [READ_SCHEMA, WRITE_SCHEMA],
        dispatch: sourceDispatch,
        mutatingNames: [WRITE_SCHEMA.name],
      }),
    });

    const detail = await runAndWait(harness);

    expect(detail.run.status).toBe("done");
    expect(llm.seenTools[0]).toContain(READ_SCHEMA.name);
    expect(llm.seenTools[0]).not.toContain(WRITE_SCHEMA.name);
    expect(sourceDispatch).not.toHaveBeenCalled();
    expect(detail.steps.some((step) => step.content.includes("read-only"))).toBe(true);
  });

  it("records a [security] step when the bundle factory throws", async () => {
    const harness = createServiceHarness({
      llm: scriptedLLM([stopTurn("base tools only")]),
      readOnly: true,
      dynamicFactory: () => {
        throw new Error("plugin database unavailable");
      },
    });

    const detail = await runAndWait(harness);

    expect(detail.run.status).toBe("done");
    expect(detail.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          content: expect.stringContaining(
            "[security] Dynamic tools disabled: bundle factory failed (plugin database unavailable).",
          ),
        }),
      ]),
    );
  });

  it("rejects an invalid bundle on the real multi-agent path", async () => {
    const malformedFactory = () =>
      ({
        schemas: [READ_SCHEMA],
        dispatch: vi.fn(),
      }) as unknown as DynamicToolBundle;
    const harness = createServiceHarness({
      llm: scriptedLLM([stopTurn("no plan")]),
      readOnly: true,
      multiAgentEnabled: true,
      dynamicFactory: malformedFactory,
    });

    const detail = await runAndWait(harness);

    expect(detail.run.status).toBe("failed");
    expect(detail.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          content: expect.stringContaining(
            "[security] Dynamic tools disabled: invalid bundle (mutatingNames classification is required).",
          ),
        }),
      ]),
    );
  });

  it("rejects a mutating dynamic tool on the real degraded-mode path", async () => {
    const sourceDispatch = vi.fn();
    const llm = scriptedLLM([
      toolTurn(WRITE_SCHEMA.name),
      stopTurn("finished"),
    ]);
    const harness = createServiceHarness({
      llm,
      readOnly: false,
      assertToolAllowed: (toolName) => {
        if (toolName === "run_command") {
          throw new Error(`Tool "${toolName}" is disabled in degraded mode`);
        }
      },
      dynamicFactory: () => ({
        schemas: [WRITE_SCHEMA],
        dispatch: sourceDispatch,
        mutatingNames: [WRITE_SCHEMA.name],
      }),
    });

    const detail = await runAndWait(harness);

    expect(detail.run.status).toBe("done");
    expect(llm.seenTools[0]).toContain(WRITE_SCHEMA.name);
    expect(sourceDispatch).not.toHaveBeenCalled();
    expect(detail.steps.some((step) => step.content.includes("degraded mode"))).toBe(true);
  });

  it("denies a mutating dynamic tool when the user rejects its per-call approval", async () => {
    const sourceDispatch = vi.fn();
    const harness = createServiceHarness({
      llm: scriptedLLM([toolTurn(WRITE_SCHEMA.name), stopTurn("must not execute")]),
      readOnly: false,
      mutationDecision: "reject",
      dynamicFactory: () => ({
        schemas: [WRITE_SCHEMA],
        dispatch: sourceDispatch,
        mutatingNames: [WRITE_SCHEMA.name],
      }),
    });

    const detail = await runAndWait(harness);

    expect(detail.run.status).toBe("cancelled");
    expect(sourceDispatch).not.toHaveBeenCalled();
    expect(detail.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "message",
          content: expect.stringContaining(
            `[approval] User rejected ${WRITE_SCHEMA.name} (dynamic.mutate).`,
          ),
        }),
      ]),
    );
  });

  it("executes a mutating dynamic tool once after a matching per-call approval", async () => {
    const sourceDispatch = vi.fn(async (call) => ({
      name: call.name,
      resultText: JSON.stringify({ wrote: true }),
      isError: false,
    }));
    const harness = createServiceHarness({
      llm: scriptedLLM([toolTurn(WRITE_SCHEMA.name), stopTurn("finished")]),
      readOnly: false,
      mutationDecision: "approve",
      dynamicFactory: () => ({
        schemas: [WRITE_SCHEMA],
        dispatch: sourceDispatch,
        mutatingNames: [WRITE_SCHEMA.name],
      }),
    });

    const detail = await runAndWait(harness);

    expect(detail.run.status).toBe("done");
    expect(sourceDispatch).toHaveBeenCalledOnce();
    expect(detail.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "message",
          content: expect.stringContaining(
            `[approval] User approved ${WRITE_SCHEMA.name} (dynamic.mutate).`,
          ),
        }),
      ]),
    );
  });
});

describe("multi-agent dynamic tool role boundary", () => {
  it("rejects a Planner-forged dynamic read tool before shared dispatch", async () => {
    const sourceDispatch = vi.fn();
    const llm = scriptedLLM([
      toolTurn(READ_SCHEMA.name),
      stopTurn("no plan"),
    ]);
    const harness = createServiceHarness({
      llm,
      readOnly: false,
      multiAgentEnabled: true,
      dynamicFactory: () => ({
        schemas: [READ_SCHEMA],
        dispatch: sourceDispatch,
        mutatingNames: [],
      }),
    });

    await runAndWait(harness);

    expectRoleSchemaHidden(llm, "PLANNER role", READ_SCHEMA.name);
    expect(sourceDispatch).not.toHaveBeenCalled();
    expectRoleDeniedResult(llm, "planner", READ_SCHEMA.name);
  });

  it("rejects a Planner-forged dynamic mutating tool before shared dispatch", async () => {
    const sourceDispatch = vi.fn();
    const llm = scriptedLLM([
      toolTurn(WRITE_SCHEMA.name),
      stopTurn("no plan"),
    ]);
    const harness = createServiceHarness({
      llm,
      readOnly: false,
      multiAgentEnabled: true,
      dynamicFactory: () => ({
        schemas: [WRITE_SCHEMA],
        dispatch: sourceDispatch,
        mutatingNames: [WRITE_SCHEMA.name],
      }),
    });

    await runAndWait(harness);

    expectRoleSchemaHidden(llm, "PLANNER role", WRITE_SCHEMA.name);
    expect(sourceDispatch).not.toHaveBeenCalled();
    expectRoleDeniedResult(llm, "planner", WRITE_SCHEMA.name);
  });

  it("rejects a Reviewer-forged dynamic mutating tool before shared dispatch", async () => {
    const sourceDispatch = vi.fn();
    const llm = scriptedLLM([
      toolTurn("propose_task_breakdown", singleNodeBreakdown()),
      stopTurn("plan ready"),
      toolTurn("request_review", reviewRequest()),
      stopTurn("ready for review"),
      toolTurn(WRITE_SCHEMA.name),
      stopTurn(approvedReview()),
    ]);
    const harness = createServiceHarness({
      llm,
      readOnly: false,
      multiAgentEnabled: true,
      autoApprovePlan: true,
      dynamicFactory: () => ({
        schemas: [WRITE_SCHEMA],
        dispatch: sourceDispatch,
        mutatingNames: [WRITE_SCHEMA.name],
      }),
    });

    const detail = await runAndWait(harness);

    expect(detail.run.status).toBe("done");
    expectRoleSchemaHidden(llm, "REVIEWER role", WRITE_SCHEMA.name);
    expect(sourceDispatch).not.toHaveBeenCalled();
    expectRoleDeniedResult(llm, "reviewer", WRITE_SCHEMA.name);
  });

  it("rejects a Coder-forged unauthorized dynamic tool before shared dispatch", async () => {
    const sourceDispatch = vi.fn();
    const llm = scriptedLLM([
      toolTurn("propose_task_breakdown", singleNodeBreakdown()),
      stopTurn("plan ready"),
      toolTurn(READ_SCHEMA.name),
      toolTurn("request_review", reviewRequest()),
      stopTurn("ready for review"),
      stopTurn(approvedReview()),
    ]);
    const harness = createServiceHarness({
      llm,
      readOnly: false,
      multiAgentEnabled: true,
      autoApprovePlan: true,
      dynamicFactory: () => ({
        schemas: [READ_SCHEMA],
        dispatch: sourceDispatch,
        mutatingNames: [],
      }),
    });

    const detail = await runAndWait(harness);

    expect(detail.run.status).toBe("done");
    expectRoleSchemaHidden(llm, "CODER role", READ_SCHEMA.name);
    expect(sourceDispatch).not.toHaveBeenCalled();
    expectRoleDeniedResult(llm, "coder", READ_SCHEMA.name);
  });
});

type ScriptedLLM = ChatLLMProvider & {
  seenTools: string[][];
  seenMessages: LLMMessage[][];
};

function scriptedLLM(turns: LLMChunk[][]): ScriptedLLM {
  const queue = [...turns];
  const seenTools: string[][] = [];
  const seenMessages: LLMMessage[][] = [];
  return {
    name: "dynamic-security-test",
    model: "dynamic-security-test",
    contextWindow: 100_000,
    seenTools,
    seenMessages,
    async complete() {
      return { text: "unused" };
    },
    async *chat(input: LLMChatInput) {
      seenTools.push((input.tools ?? []).map((schema) => schema.name));
      seenMessages.push(input.messages.map((message) => ({ ...message })));
      for (const chunk of queue.shift() ?? stopTurn("finished")) {
        yield chunk;
      }
    },
  };
}

function toolTurn(name: string, args: unknown = {}): LLMChunk[] {
  return [
    { type: "tool_call", id: `call-${name}`, name, args },
    { type: "finish", reason: "tool_use", usage: ZERO_USAGE },
  ];
}

function stopTurn(text: string): LLMChunk[] {
  return [
    { type: "text_delta", text },
    { type: "finish", reason: "stop", usage: ZERO_USAGE },
  ];
}

type ServiceHarness = {
  service: AgentService;
  storage: Storage;
};

function createServiceHarness(options: {
  llm: ChatLLMProvider;
  readOnly: boolean;
  multiAgentEnabled?: boolean;
  autoApprovePlan?: boolean;
  mutationDecision?: "approve" | "reject";
  dynamicFactory: () => DynamicToolBundle | null;
  assertToolAllowed?: (toolName: string) => void;
}): ServiceHarness {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-dynamic-security-"));
  temporaryRoots.push(workspaceRoot);
  const storage = createMemoryStorage(workspaceRoot);
  const settings: AgentSettings = {
    ...DEFAULT_SETTINGS.agent,
    workspacePath: workspaceRoot,
    allowShellExecution: false,
    sandboxEnabled: false,
    sandboxMode: "whitelist",
    readOnly: options.readOnly,
    multiAgentEnabled: options.multiAgentEnabled ?? false,
  };
  let service: AgentService;
  const emit = vi.fn<(event: AgentEvent) => void>((event) => {
    if (options.autoApprovePlan && event.kind === "task_updated") {
      queueMicrotask(() => service.resolvePlanApproval(event.runId, true));
    }
    if (options.mutationDecision && event.kind === "patch_ready") {
      queueMicrotask(() => {
        if (options.mutationDecision === "approve") {
          void service.applyPatch(event.runId);
        } else {
          service.rejectPatch(event.runId);
        }
      });
    }
  });
  const deps: ConstructorParameters<typeof AgentService>[0] = {
    storage,
    resolveLLM: () => options.llm,
    getAgentSettings: () => settings,
    getLanguage: () => "en-US",
    getDynamicTools: options.dynamicFactory,
    emit,
    ...(options.assertToolAllowed
      ? { assertToolAllowed: options.assertToolAllowed }
      : {}),
  };
  service = new AgentService(deps);
  return { service, storage };
}

function singleNodeBreakdown() {
  return {
    root: "task-1",
    tasks: [
      {
        id: "task-1",
        title: "Security boundary test",
        description: "Exercise a role-specific execution boundary.",
        dependsOn: [],
      },
    ],
  };
}

function reviewRequest() {
  return {
    taskNodeId: "task-1",
    diff: "diff --git a/example.ts b/example.ts",
    testOutput: "passed",
  };
}

function approvedReview(): string {
  return JSON.stringify({
    correctness: "pass",
    scope_compliance: "pass",
    regression_risk: "low",
    style_consistency: "pass",
    comments: [],
    verdict: "approved",
  });
}

function expectRoleSchemaHidden(
  llm: ScriptedLLM,
  rolePromptMarker: string,
  toolName: string,
): void {
  const roleSchemaSets = llm.seenMessages.flatMap((messages, index) => {
    const system = messages.find((message) => message.role === "system");
    return system?.content.includes(rolePromptMarker) ? [llm.seenTools[index] ?? []] : [];
  });
  expect(roleSchemaSets.length).toBeGreaterThan(0);
  for (const schemaNames of roleSchemaSets) {
    expect(schemaNames).not.toContain(toolName);
  }
}

function expectRoleDeniedResult(
  llm: ScriptedLLM,
  role: "planner" | "coder" | "reviewer",
  toolName: string,
): void {
  const structuredResults = llm.seenMessages
    .flat()
    .filter(
      (message): message is Extract<LLMMessage, { role: "tool" }> =>
        message.role === "tool",
    )
    .flatMap((message) => {
      try {
        return [JSON.parse(message.content) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
  const denial = structuredResults.find(
    (result) =>
      result.code === "role_tool_denied" &&
      result.role === role &&
      result.toolName === toolName,
  );

  expect(denial).toBeDefined();
  expect(denial?.error).toContain(role);
  expect(denial?.error).toContain(toolName);
}

function createMemoryStorage(workspaceRoot: string): Storage {
  const workspace = { id: "workspace-1", rootPath: workspaceRoot, openedAt: Date.now() };
  let run: AgentRun | null = null;
  const steps: AgentStep[] = [];

  return {
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
    createTaskNode: (node: unknown) => node,
    setTaskNodeStatus: vi.fn(),
    getTaskNode: vi.fn(() => null),
    addRoleMessage: vi.fn(),
  } as unknown as Storage;
}

async function runAndWait(harness: ServiceHarness): Promise<AgentRunDetail> {
  const initial = await harness.service.runTask("workspace-1", "exercise dynamic tools");
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const current = harness.storage.getRun(initial.run.id);
    if (current && terminalStates.has(current.status)) {
      return harness.service.getDetail(current.id);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("AgentService test run did not reach a terminal state");
}
