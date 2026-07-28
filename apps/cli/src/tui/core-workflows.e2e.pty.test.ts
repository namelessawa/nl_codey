import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Storage } from "@nlc/storage";
import { afterEach, describe, expect, it } from "vitest";
import { spawnTuiPty, type TuiPtyHarness } from "./pty-harness.js";

const canRunNativePty =
  process.platform === "win32" &&
  process.env.NLC_SKIP_NATIVE_PTY !== "1";
const describeWindows = canRunNativePty ? describe : describe.skip;
const sessions: TuiPtyHarness[] = [];
const tempRoots: string[] = [];

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
};

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose();
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-tui-e2e-"));
  tempRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  fs.mkdirSync(workspaceRoot);
  fs.mkdirSync(dataRoot);
  return { root, workspaceRoot, dataRoot };
}

function start(fixture: Fixture, env: Record<string, string> = {}): TuiPtyHarness {
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

function readOnlyRunAudit(fixture: Fixture): {
  status: string;
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
    return { status: run.status, steps: storage.listSteps(run.id) };
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

describeWindows("[tui-e2e] core agent workflows", () => {
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
    const audit = readOnlyRunAudit(fixture);
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
    const audit = readOnlyRunAudit(fixture);
    expect(audit.status).toBe("cancelled");
    expect(audit.steps.some((step) => step.type === "command")).toBe(false);

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
