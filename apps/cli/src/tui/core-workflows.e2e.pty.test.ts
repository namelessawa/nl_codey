import fs from "node:fs";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Storage } from "@nlc/storage";
import { afterEach, describe, expect, it } from "vitest";
import { loadProviderStore } from "../lib/provider-store.js";
import { spawnTuiPty, type TuiPtyHarness } from "./pty-harness.js";

const canRunNativePty =
  process.platform === "win32" &&
  process.env.NLC_SKIP_NATIVE_PTY !== "1";
const describeWindows = canRunNativePty ? describe : describe.skip;
const dynamicFailureEntry = fileURLToPath(
  new URL("./dynamic-tools-failure.fixture.ts", import.meta.url),
);
const sessions: TuiPtyHarness[] = [];
const tempRoots: string[] = [];
const servers: Server[] = [];

type Fixture = {
  root: string;
  workspaceRoot: string;
  dataRoot: string;
};

type SessionLine = {
  type: string;
  id?: string;
  parentId?: string | null;
  role?: string;
  content?: string;
  parent?: { sessionId: string; messageId: string };
  from?: { provider: string; model: string } | null;
  to?: { provider: string; model: string };
};

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose();
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});

async function startProviderStub(): Promise<{
  invalidBaseUrl: string;
  validBaseUrl: string;
  requests: Array<{
    url: string;
    authorization: string;
    body: Record<string, unknown>;
  }>;
}> {
  const requests: Array<{
    url: string;
    authorization: string;
    body: Record<string, unknown>;
  }> = [];
  const server = http.createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      raw += chunk;
    });
    request.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        body = {};
      }
      requests.push({
        url: request.url ?? "",
        authorization: request.headers.authorization ?? "",
        body,
      });

      if (request.url?.startsWith("/invalid/")) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: { message: "invalid local provider configuration" },
          }),
        );
        return;
      }

      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.end(
        [
          `data: ${JSON.stringify({
            choices: [
              {
                delta: { content: "local provider accepted corrected config" },
                finish_reason: null,
              },
            ],
          })}`,
          `data: ${JSON.stringify({
            choices: [{ delta: {}, finish_reason: "stop" }],
          })}`,
          "data: [DONE]",
          "",
        ].join("\n\n"),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  return {
    invalidBaseUrl: `http://127.0.0.1:${port}/invalid/v1`,
    validBaseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
  };
}

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-tui-e2e-"));
  tempRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  fs.mkdirSync(workspaceRoot);
  fs.mkdirSync(dataRoot);
  return { root, workspaceRoot, dataRoot };
}

function start(
  fixture: Fixture,
  env: Record<string, string> = {},
  entryPath?: string,
): TuiPtyHarness {
  const session = spawnTuiPty({
    cwd: fixture.workspaceRoot,
    cols: 100,
    rows: 30,
    args: [
      "--workspace",
      fixture.workspaceRoot,
      "--data-root",
      fixture.dataRoot,
      "--no-color",
    ],
    ...(entryPath ? { entryPath } : {}),
    env: {
      LLM_PROVIDER: "mock",
      NLC_API_KEY: "",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      DEEPSEEK_API_KEY: "",
      OPENROUTER_API_KEY: "",
      GEMINI_API_KEY: "",
      ...env,
    },
  });
  sessions.push(session);
  return session;
}

function enableCommandConfirmation(fixture: Fixture): void {
  fs.writeFileSync(
    path.join(fixture.dataRoot, "settings.json"),
    JSON.stringify({
      agent: {
        allowShellExecution: true,
        requireConfirmationBeforeCommand: true,
      },
    }),
    "utf8",
  );
}

function enableSingleStepBudget(fixture: Fixture): void {
  fs.writeFileSync(
    path.join(fixture.dataRoot, "settings.json"),
    JSON.stringify({
      agent: { maxAutoSteps: 1 },
      ui: { language: "en-US" },
    }),
    "utf8",
  );
}

function enableReadOnly(fixture: Fixture): void {
  fs.writeFileSync(
    path.join(fixture.dataRoot, "settings.json"),
    JSON.stringify({
      agent: { readOnly: true },
      ui: { language: "en-US" },
    }),
    "utf8",
  );
}

function snapshotWorkspace(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        snapshot[path.relative(root, absolute).replaceAll("\\", "/")] =
          fs.readFileSync(absolute, "utf8");
      }
    }
  };
  visit(root);
  return snapshot;
}

function readRunAudit(fixture: Fixture): {
  status: string;
  exitReason: string | null;
  steps: ReturnType<Storage["listSteps"]>;
} {
  const storage = new Storage(
    path.join(fixture.dataRoot, "data", "workspace-state.db"),
  );
  try {
    const workspace = storage.listWorkspaces(1)[0];
    if (!workspace) throw new Error("command fixture did not create a workspace");
    const run = storage.listRuns(workspace.id)[0];
    if (!run) throw new Error("command fixture did not create a run");
    return {
      status: run.status,
      exitReason: run.exitReason ?? null,
      steps: storage.listSteps(run.id),
    };
  } finally {
    storage.close();
  }
}

async function waitForFile(filePath: string, present: boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (fs.existsSync(filePath) !== present) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${filePath} present=${present}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitForSessionFiles(dataRoot: string, count: number): Promise<string[]> {
  const deadline = Date.now() + 10_000;
  while (true) {
    const files = collectJsonFiles(path.join(dataRoot, "agent.session"));
    if (files.length >= count) return files;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${count} session files under ${dataRoot}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function collectJsonFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...collectJsonFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(absolute);
  }
  return files;
}

function readSession(filePath: string): SessionLine[] {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SessionLine);
}

async function enter(session: TuiPtyHarness, text: string): Promise<void> {
  session.write(text);
  await session.waitForScreen((screen) => screen.includes(`❯ ${text}`));
  session.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 75));
  if (session.viewport().includes(`❯ ${text}`)) session.write("\r");
}

async function exit(session: TuiPtyHarness): Promise<void> {
  await enter(session, "/exit");
  let result;
  try {
    result = await session.waitForExit(2_000);
  } catch {
    session.write("\r");
    result = await session.waitForExit();
  }
  expect(result.exitCode).toBe(0);
}

async function pressCommandDecision(
  session: TuiPtyHarness,
  key: "y" | "n",
  consumed: (screen: string) => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    session.write(key);
    try {
      await session.waitForScreen(consumed, 2_000);
      return;
    } catch {
      // The approval card can paint one tick before its useInput effect mounts.
    }
  }
  await session.waitForScreen(consumed, 1);
}

async function pressModalEnter(
  session: TuiPtyHarness,
  advanced: (screen: string) => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    session.write("\r");
    try {
      // Provider fields can be taller than the active viewport after replayed
      // Static output. The terminal buffer still records the modal transition.
      await session.waitForBuffer(advanced, 2_000);
      return;
    } catch {
      // A modal can paint one tick before its useInput effect mounts.
    }
  }
  await session.waitForBuffer(advanced, 1);
}

async function replaceProviderUrl(
  session: TuiPtyHarness,
  previousUrl: string,
  nextUrl: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    session.write("\x15");
    try {
      await session.waitForScreen(
        (screen) => !screen.includes(`base URL: ${previousUrl}`),
        1_000,
      );
      session.write(nextUrl);
      await session.waitForScreen(
        (screen) => screen.includes(`base URL: ${nextUrl}`),
        2_000,
      );
      return;
    } catch {
      // Retry only while the old URL still occupies the editable input line.
    }
  }
  await session.waitForScreen(
    (screen) => screen.includes(`base URL: ${nextUrl}`),
    1,
  );
}

describeWindows("[tui-e2e] core agent workflows", () => {
  it("reads and searches but refuses a forged write in read-only mode", async () => {
    const fixture = createFixture();
    fs.mkdirSync(path.join(fixture.workspaceRoot, "src"));
    fs.writeFileSync(
      path.join(fixture.workspaceRoot, "README.md"),
      "# Fixture\n\nInspect src/feature.ts without changing the workspace.\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(fixture.workspaceRoot, "src", "feature.ts"),
      'export const marker = "READ_ONLY_ANALYSIS_MARKER";\n',
      "utf8",
    );
    enableReadOnly(fixture);
    const before = snapshotWorkspace(fixture.workspaceRoot);
    const session = start(fixture, {
      NLC_MOCK_SCENARIO: "read-only-analysis",
    });

    await session.waitForScreen(
      (screen) => screen.includes("read-only") && screen.includes("(idle)"),
    );
    await enter(session, "analyze the marker without changing files");
    const buffer = await session.waitForBuffer((output) => {
      const normalized = output.replaceAll('\\"', '"');
      return (
        normalized.includes('Tool "apply_patch" is disabled') &&
        normalized.includes("Read-only analysis complete.") &&
        normalized.includes("forged apply_patch was refused") &&
        normalized.includes("done")
      );
    }, 20_000);
    expect(buffer).toContain("read-only (query) mode");
    expect(buffer).toContain("workspace unchanged");

    const audit = readRunAudit(fixture);
    expect(audit.status).toBe("done");
    const toolCalls = audit.steps
      .filter((step) => step.type === "tool_call")
      .map((step) => step.content);
    expect(toolCalls.some((content) => content.startsWith("read_file "))).toBe(
      true,
    );
    expect(
      toolCalls.some((content) => content.startsWith("search_text ")),
    ).toBe(true);
    expect(
      toolCalls.some((content) => content.startsWith("apply_patch ")),
    ).toBe(true);
    expect(
      audit.steps.some(
        (step) =>
          step.type === "error" &&
          step.content.includes("apply_patch") &&
          step.content.includes("read-only"),
      ),
    ).toBe(true);
    expect(audit.steps.some((step) => step.type === "diff")).toBe(false);
    expect(audit.steps.some((step) => step.type === "command")).toBe(false);
    expect(snapshotWorkspace(fixture.workspaceRoot)).toEqual(before);
    expect(
      fs.existsSync(
        path.join(fixture.workspaceRoot, "READ_ONLY_VIOLATION.md"),
      ),
    ).toBe(false);

    await exit(session);
  });

  it("submits, previews, approves, and rolls back a real patch", async () => {
    const fixture = createFixture();
    const notesPath = path.join(fixture.workspaceRoot, "AGENT_NOTES.md");
    const session = start(fixture);

    await session.waitForScreen((screen) => screen.includes("○ idle"));
    await enter(session, "create the approval fixture");
    await session.waitForBuffer(
      (buffer) =>
        buffer.includes("[verify] pending patch") &&
        buffer.includes("AGENT_NOTES.md"),
      20_000,
    );
    expect(fs.existsSync(notesPath)).toBe(false);

    session.write("y");
    await waitForFile(notesPath, true);
    await session.waitForScreen((screen) => screen.includes("○ done"), 20_000);
    expect(fs.readFileSync(notesPath, "utf8")).toContain("create the approval fixture");

    await enter(session, "/rollback");
    await waitForFile(notesPath, false);
    await session.waitForBuffer((buffer) => buffer.includes("workspace snapshots restored"));

    await exit(session);
  });

  it("rejects a pending patch without changing the workspace", async () => {
    const fixture = createFixture();
    const notesPath = path.join(fixture.workspaceRoot, "AGENT_NOTES.md");
    const session = start(fixture);

    await session.waitForScreen((screen) => screen.includes("○ idle"));
    await enter(session, "reject the approval fixture");
    await session.waitForBuffer(
      (buffer) =>
        buffer.includes("[verify] pending patch") &&
        buffer.includes("AGENT_NOTES.md"),
      20_000,
    );

    session.write("n");
    await session.waitForScreen((screen) => screen.includes("○ cancelled"), 20_000);
    expect(fs.existsSync(notesPath)).toBe(false);
    await enter(session, "/help");
    await session.waitForBuffer((buffer) => buffer.includes("/rollback"));

    await exit(session);
  });

  it("confirms a command before execution and persists its audit output", async () => {
    const fixture = createFixture();
    enableCommandConfirmation(fixture);
    const session = start(fixture, {
      NLC_MOCK_SCENARIO: "command-confirmation",
    });

    await session.waitForScreen((screen) => screen.includes("(idle)"));
    await enter(session, "approve the command fixture");
    await session.waitForBuffer(
      (buffer) =>
        buffer.includes("[verify] pending command") &&
        buffer.includes("$ tsc --noEmit") &&
        buffer.includes("to run"),
      20_000,
    );

    await pressCommandDecision(
      session,
      "y",
      (screen) => !screen.includes("[verify] pending command"),
    );
    await session.waitForScreen((screen) => screen.includes("done"), 30_000);
    const audit = readRunAudit(fixture);
    expect(audit.status).toBe("done");
    expect(
      audit.steps.some(
        (step) =>
          step.type === "command" &&
          step.content.includes("$ tsc --noEmit") &&
          step.content.includes("exit:"),
      ),
    ).toBe(true);

    await exit(session);
  });

  it("rejects a command before execution and records no command step", async () => {
    const fixture = createFixture();
    enableCommandConfirmation(fixture);
    const session = start(fixture, {
      NLC_MOCK_SCENARIO: "command-confirmation",
    });

    await session.waitForScreen((screen) => screen.includes("(idle)"));
    await enter(session, "reject the command fixture");
    await session.waitForBuffer(
      (buffer) =>
        buffer.includes("[verify] pending command") &&
        buffer.includes("$ tsc --noEmit"),
      20_000,
    );

    await pressCommandDecision(
      session,
      "n",
      (screen) => screen.includes("cancelled"),
    );
    const audit = readRunAudit(fixture);
    expect(audit.status).toBe("cancelled");
    expect(audit.steps.some((step) => step.type === "command")).toBe(false);

    await exit(session);
  });

  it("surfaces an exhausted iteration budget and returns prompt control", async () => {
    const fixture = createFixture();
    enableSingleStepBudget(fixture);
    const session = start(fixture);

    await session.waitForScreen((screen) => screen.includes("(idle)"));
    await enter(session, "exhaust the iteration budget");
    await session.waitForBuffer(
      (buffer) => {
        const normalized = buffer.replace(/\s+/g, " ");
        return (
          normalized.includes("Budget exhausted (max_iterations).") &&
          normalized.includes("roll back or continue manually.")
        );
      },
      20_000,
    );

    const audit = readRunAudit(fixture);
    expect(audit.status).toBe("budget_exceeded");
    expect(audit.exitReason).toBe("max_iterations");
    expect(
      audit.steps.some(
        (step) =>
          step.type === "message" &&
          step.content.includes("Budget exhausted (max_iterations)."),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(fixture.workspaceRoot, "AGENT_NOTES.md")),
    ).toBe(false);

    await enter(session, "/help");
    await session.waitForBuffer((buffer) => buffer.includes("/rollback"));
    await exit(session);
  });

  it("rejects invalid provider config, corrects it, and uses it on a new run", async () => {
    const fixture = createFixture();
    const provider = await startProviderStub();
    const apiKey = "sk-local-provider-fixture-1234";
    const session = start(fixture);

    await session.waitForScreen((screen) => screen.includes("(idle)"));
    await enter(session, "/provider");
    await session.waitForScreen(
      (screen) =>
        screen.includes("[provider] select a provider") &&
        screen.includes("OpenAI"),
    );
    await pressModalEnter(
      session,
      (screen) =>
        screen.includes("[provider] base URL") &&
        screen.includes("https://api.openai.com/v1"),
    );

    await replaceProviderUrl(
      session,
      "https://api.openai.com/v1",
      provider.invalidBaseUrl,
    );
    await pressModalEnter(
      session,
      (screen) => screen.includes("[provider] API key"),
    );
    session.write(apiKey);
    await session.waitForScreen((screen) => screen.includes(apiKey.slice(-4)));
    await pressModalEnter(
      session,
      (screen) =>
        screen.includes("[provider] review and save") &&
        screen.includes("gpt-4o"),
    );
    await pressModalEnter(
      session,
      (screen) => screen.includes("provider saved: OpenAI (openai)"),
    );

    await enter(session, "prove invalid provider configuration");
    const invalidBuffer = await session.waitForBuffer(
      (output) =>
        output.includes("invalid local provider configuration") &&
        output.includes("failed"),
      20_000,
    );
    expect(invalidBuffer).not.toContain(apiKey);
    const invalidAudit = readRunAudit(fixture);
    expect(invalidAudit.status).toBe("failed");
    expect(invalidAudit.exitReason).toBe("failed");
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      url: "/invalid/v1/chat/completions",
      authorization: `Bearer ${apiKey}`,
      body: { model: "gpt-4o", stream: true },
    });
    await exit(session);

    const restarted = start(fixture);
    await restarted.waitForScreen((screen) => screen.includes("(idle)"));
    await enter(restarted, "/provider");
    await restarted.waitForScreen((screen) =>
      screen.includes("[provider] select a provider"),
    );
    await pressModalEnter(
      restarted,
      (screen) =>
        screen.includes("[provider] base URL") &&
        screen.includes(provider.invalidBaseUrl),
    );
    await replaceProviderUrl(
      restarted,
      provider.invalidBaseUrl,
      provider.validBaseUrl,
    );
    await pressModalEnter(
      restarted,
      (screen) =>
        screen.includes("[provider] API key") &&
        screen.includes(apiKey.slice(-4)),
    );
    await pressModalEnter(
      restarted,
      (screen) =>
        screen.includes("[provider] review and save") &&
        screen.includes("gpt-4o"),
    );
    await pressModalEnter(
      restarted,
      (screen) => screen.includes("provider saved: OpenAI (openai)"),
    );

    const store = loadProviderStore(fixture.dataRoot);
    expect(store.active).toBe("openai");
    expect(store.providers.openai).toMatchObject({
      key: "openai",
      name: "OpenAI",
      baseUrl: provider.validBaseUrl,
      apiKey,
      model: "gpt-4o",
      protocol: "openai-compat",
    });

    await enter(restarted, "prove corrected provider configuration");
    const validBuffer = await restarted.waitForBuffer(
      (output) =>
        output.includes("local provider accepted corrected config") &&
        output.includes("done"),
      20_000,
    );
    expect(validBuffer).not.toContain(apiKey);
    const validAudit = readRunAudit(fixture);
    expect(validAudit.status).toBe("done");
    expect(validAudit.exitReason).toBe("done");
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]).toMatchObject({
      url: "/v1/chat/completions",
      authorization: `Bearer ${apiKey}`,
      body: { model: "gpt-4o", stream: true },
    });

    const [sessionPath] = await waitForSessionFiles(fixture.dataRoot, 1);
    const modelChanges = readSession(sessionPath!).filter(
      (line) => line.type === "model_change",
    );
    expect(modelChanges).toHaveLength(2);
    expect(modelChanges.at(-1)?.to).toEqual({
      provider: "openai-compat",
      model: "gpt-4o",
    });

    await enter(restarted, "/help");
    await restarted.waitForBuffer((output) => output.includes("/rollback"));
    await exit(restarted);
  });

  it("redacts a dynamic-tool factory failure in TUI, SQLite, and session log", async () => {
    const fixture = createFixture();
    const secret = "tui-dynamic-factory-token-123456789";
    const userHome = os.homedir();
    const session = start(
      fixture,
      { NLC_MOCK_SCENARIO: "large-output" },
      dynamicFailureEntry,
    );

    await session.waitForScreen((screen) => screen.includes("(idle)"));
    await enter(session, "surface the dynamic tool failure safely");
    const buffer = await session.waitForBuffer(
      (output) =>
        output.includes("[security] Dynamic tools disabled") &&
        output.includes("[REDACTED]") &&
        output.includes("[USER_HOME]") &&
        output.includes("done"),
      20_000,
    );
    expect(buffer).not.toContain(secret);
    expect(buffer).not.toContain(userHome);

    const audit = readRunAudit(fixture);
    expect(audit.status).toBe("done");
    expect(audit.exitReason).toBe("done");
    const errorSteps = audit.steps.filter((step) => step.type === "error");
    expect(errorSteps).toHaveLength(1);
    expect(errorSteps[0]?.content).toContain(
      "[security] Dynamic tools disabled: bundle factory failed",
    );
    expect(errorSteps[0]?.content).toContain("[REDACTED]");
    expect(errorSteps[0]?.content).toContain("[USER_HOME]");
    expect(errorSteps[0]?.content).not.toContain(secret);
    expect(errorSteps[0]?.content).not.toContain(userHome);
    expect(errorSteps[0]?.content).not.toMatch(/[\r\n]/);

    const [sessionPath] = await waitForSessionFiles(fixture.dataRoot, 1);
    const sessionText = fs.readFileSync(sessionPath!, "utf8");
    expect(sessionText).toContain("[security] Dynamic tools disabled");
    expect(sessionText).toContain("[REDACTED]");
    expect(sessionText).toContain("[USER_HOME]");
    expect(sessionText).not.toContain(secret);
    expect(sessionText).not.toContain(userHome);

    await enter(session, "/help");
    await session.waitForBuffer((output) => output.includes("/rollback"));
    await exit(session);
  });

  it("bounds long tool output and navigates hundreds of message rows", async () => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.workspaceRoot, "LONG_TOOL_OUTPUT.txt"),
      `TOOL_OUTPUT_HEAD\n${"x".repeat(10_000)}\nTOOL_OUTPUT_TAIL\n`,
      "utf8",
    );
    const session = start(fixture, {
      NLC_MOCK_SCENARIO: "large-tool-output",
    });

    await session.waitForScreen((screen) => screen.includes("(idle)"));
    await enter(session, "exercise bounded large output");
    const buffer = await session.waitForBuffer(
      (output) =>
        output.includes("bulk-message-row-001 retained") &&
        output.includes("bulk-message-row-320 retained") &&
        output.includes("done"),
      30_000,
    );
    expect(buffer.indexOf("bulk-message-row-001 retained")).toBeLessThan(
      buffer.indexOf("bulk-message-row-320 retained"),
    );
    expect(session.scrollbackLineCount()).toBeGreaterThan(250);
    expect(session.viewport()).toContain("bulk-message-row-320 retained");
    expect(session.viewport()).not.toContain("bulk-message-row-001 retained");

    session.scrollLines(-1_000);
    expect(session.viewport()).toContain("bulk-message-row-001 retained");
    session.scrollToBottom();
    expect(session.viewport()).toContain("bulk-message-row-320 retained");

    const audit = readRunAudit(fixture);
    expect(audit.status).toBe("done");
    const toolResult = audit.steps.find(
      (step) =>
        step.type === "tool_result" &&
        step.content.includes("LONG_TOOL_OUTPUT.txt"),
    );
    expect(toolResult).toBeDefined();
    expect(toolResult!.content.length).toBeLessThanOrEqual(4_000);
    expect(toolResult!.content).toContain("TOOL_OUTPUT_HEAD");
    expect(toolResult!.content).toContain("…(truncated)");
    expect(toolResult!.content).not.toContain("TOOL_OUTPUT_TAIL");
    const outputStep = audit.steps.find(
      (step) =>
        step.type === "message" &&
        step.content.includes("bulk-message-row-001 retained"),
    );
    expect(outputStep?.content.split("\n")).toHaveLength(320);
    expect(outputStep?.content).toContain("bulk-message-row-320 retained");

    const [sessionPath] = await waitForSessionFiles(fixture.dataRoot, 1);
    const assistant = readSession(sessionPath!).find(
      (line) =>
        line.type === "message" &&
        line.role === "assistant" &&
        line.content?.includes("bulk-message-row-001 retained"),
    );
    expect(assistant?.content?.split("\n")).toHaveLength(320);
    expect(assistant?.content).toContain("bulk-message-row-320 retained");

    await enter(session, "/help");
    await session.waitForBuffer((output) => output.includes("/rollback"));
    await exit(session);
  });

  it("cancels a streaming run and returns control to the prompt", async () => {
    const fixture = createFixture();
    const notesPath = path.join(fixture.workspaceRoot, "AGENT_NOTES.md");
    const session = start(fixture, { NLC_MOCK_CHUNK_DELAY_MS: "1500" });

    await session.waitForScreen((screen) => screen.includes("○ idle"));
    await enter(session, "cancel the streaming fixture");
    await session.waitForScreen((screen) => screen.includes("ctrl+c cancel"), 10_000);
    session.write("\x03");

    await session.waitForScreen((screen) => screen.includes("○ cancelled"), 20_000);
    expect(fs.existsSync(notesPath)).toBe(false);
    await enter(session, "/help");
    await session.waitForBuffer((buffer) => buffer.includes("Show this command catalogue"));

    await exit(session);
  });

  it("restores, resumes, branches, and restarts append-only sessions", async () => {
    const fixture = createFixture();
    const notesPath = path.join(fixture.workspaceRoot, "AGENT_NOTES.md");
    const first = start(fixture);

    await first.waitForScreen((screen) => screen.includes("○ idle"));
    await enter(first, "persist the restart fixture");
    await first.waitForBuffer((buffer) => buffer.includes("[verify] pending patch"), 20_000);
    first.write("n");
    await first.waitForScreen((screen) => screen.includes("○ cancelled"), 20_000);
    await exit(first);

    const [originalPath] = await waitForSessionFiles(fixture.dataRoot, 1);
    const original = readSession(originalPath!);
    const originalHeader = original.find((line) => line.type === "session")!;
    const originalUser = original.find(
      (line) => line.type === "message" && line.role === "user",
    )!;
    expect(originalHeader.id).toBeTruthy();
    expect(originalUser.content).toBe("persist the restart fixture");
    const linkStorage = new Storage(
      path.join(fixture.dataRoot, "data", "workspace-state.db"),
    );
    const linkedRuns = linkStorage.listRunsForSession(originalHeader.id!);
    linkStorage.close();
    expect(linkedRuns).toHaveLength(1);
    expect(linkedRuns[0]).toMatchObject({
      userTask: "persist the restart fixture",
      sessionId: originalHeader.id,
      sessionFilePath: originalPath,
    });

    const restored = start(fixture);
    await restored.waitForBuffer(
      (buffer) =>
        buffer.includes(`restored ${originalHeader.id}`) &&
        buffer.includes("persist the restart fixture") &&
        buffer.includes("no tools were re-run"),
      15_000,
    );
    expect(fs.existsSync(notesPath)).toBe(false);

    await enter(restored, `/resume ${originalHeader.id!.slice(0, 18)}`);
    await restored.waitForBuffer((buffer) =>
      buffer.includes(`resumed ${originalHeader.id}; replayed`),
    );
    await enter(restored, "/tree");
    await restored.waitForBuffer((buffer) => buffer.includes("persist the restart fixture"));

    await enter(restored, `/branch ${originalUser.id} ${originalHeader.id}`);
    await restored.waitForBuffer((buffer) => buffer.includes("next user message will hang"));
    const filesAfterBranch = await waitForSessionFiles(fixture.dataRoot, 2);
    const childPath = filesAfterBranch.find((file) => file !== originalPath)!;
    const childHeader = readSession(childPath).find((line) => line.type === "session")!;
    expect(childHeader.parent).toEqual({
      sessionId: originalHeader.id,
      messageId: originalUser.id,
    });

    await enter(restored, "branch child fixture");
    await restored.waitForBuffer((buffer) => buffer.includes("[verify] pending patch"), 20_000);
    restored.write("n");
    await restored.waitForScreen((screen) => screen.includes("○ cancelled"), 20_000);
    await exit(restored);

    const child = readSession(childPath);
    const childUser = child.find(
      (line) => line.type === "message" && line.role === "user",
    )!;
    expect(childUser.content).toBe("branch child fixture");
    expect(childUser.parentId).toBe(originalUser.id);

    const restarted = start(fixture);
    await restarted.waitForBuffer(
      (buffer) =>
        buffer.includes(`restored ${childHeader.id}`) &&
        buffer.includes("branch child fixture") &&
        buffer.includes("no tools were re-run"),
      15_000,
    );
    expect(fs.existsSync(notesPath)).toBe(false);
    await exit(restarted);
  });

  it("reconciles a run killed at approval without replaying its patch", async () => {
    const fixture = createFixture();
    const notesPath = path.join(fixture.workspaceRoot, "AGENT_NOTES.md");
    const crashed = start(fixture);

    await crashed.waitForScreen((screen) => screen.includes("○ idle"));
    await enter(crashed, "crash at the approval fixture");
    await crashed.waitForBuffer(
      (buffer) =>
        buffer.includes("[verify] pending patch") &&
        buffer.includes("AGENT_NOTES.md"),
      20_000,
    );
    await crashed.terminate();
    expect(fs.existsSync(notesPath)).toBe(false);

    const [sessionPath] = await waitForSessionFiles(fixture.dataRoot, 1);
    const header = readSession(sessionPath!).find((line) => line.type === "session")!;
    const recovered = start(fixture);
    await recovered.waitForBuffer(
      (buffer) => {
        // winpty serializes visual line wrapping as newlines, while ConPTY
        // keeps this status sentence contiguous. Compare the same rendered
        // content independent of the selected Windows PTY backend.
        const unwrapped = buffer.replaceAll("\n", "");
        return (
          unwrapped.includes("crash at the approval fixture") &&
          unwrapped.includes("recovered 1 interrupted run(s)") &&
          unwrapped.includes("No tools or workspace writes were") &&
          unwrapped.includes("replayed; /rollback remains available")
        );
      },
      20_000,
    );
    expect(fs.existsSync(notesPath)).toBe(false);
    await exit(recovered);

    const dbPath = path.join(fixture.dataRoot, "data", "workspace-state.db");
    const storage = new Storage(dbPath);
    const [run] = storage.listRunsForSession(header.id!);
    const recoveryStepCount = storage
      .listSteps(run!.id)
      .filter((step) =>
        step.content.includes("No tool or workspace write was replayed"),
      ).length;
    storage.close();
    expect(run).toMatchObject({
      userTask: "crash at the approval fixture",
      status: "failed",
      exitReason: "interrupted_restart",
      sessionFilePath: sessionPath,
    });
    expect(run?.ownerPid).toEqual(expect.any(Number));
    expect(recoveryStepCount).toBe(1);

    const secondRestart = start(fixture);
    const secondBuffer = await secondRestart.waitForBuffer(
      (buffer) =>
        buffer.includes(`restored ${header.id}`) &&
        buffer.includes("crash at the approval fixture"),
      15_000,
    );
    expect(secondBuffer).not.toContain("recovered 1 interrupted run(s)");
    await exit(secondRestart);

    const reopened = new Storage(dbPath);
    const reopenedRecoverySteps = reopened
      .listSteps(run!.id)
      .filter((step) =>
        step.content.includes("No tool or workspace write was replayed"),
      );
    reopened.close();
    expect(reopenedRecoverySteps).toHaveLength(1);
  });
});
