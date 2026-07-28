import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-crash-soak-"));
  tempRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  fs.mkdirSync(workspaceRoot);
  fs.mkdirSync(dataRoot);
  return { root, workspaceRoot, dataRoot };
}

function start(fixture: Fixture): TuiPtyHarness {
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
    },
  });
  sessions.push(session);
  return session;
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

async function waitForPidExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (isPidAlive(pid)) {
    if (Date.now() >= deadline) {
      throw new Error(`PTY root process ${pid} survived bounded termination`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describeWindows("[tui-crash-soak] approval crash cleanup", () => {
  it.each([1, 2, 3, 4, 5])(
    "cycle %i terminates, recovers, exits, and releases its fixture",
    async (cycle) => {
      const fixture = createFixture();
      const notesPath = path.join(fixture.workspaceRoot, "AGENT_NOTES.md");
      const crashed = start(fixture);

      await crashed.waitForScreen((screen) => screen.includes("(idle)"));
      await enter(crashed, `crash cleanup soak ${cycle}`);
      await crashed.waitForBuffer(
        (buffer) =>
          buffer.includes("[verify] pending patch") &&
          buffer.includes("AGENT_NOTES.md"),
        20_000,
      );

      const crashedPid = crashed.pid;
      const started = Date.now();
      await crashed.terminate(10_000);
      expect(Date.now() - started).toBeLessThan(12_000);
      await waitForPidExit(crashedPid);
      expect(fs.existsSync(notesPath)).toBe(false);

      const recovered = start(fixture);
      await recovered.waitForBuffer(
        (buffer) => {
          const unwrapped = buffer.replaceAll("\n", "");
          return (
            unwrapped.includes(`crash cleanup soak ${cycle}`) &&
            unwrapped.includes("recovered 1 interrupted run(s)") &&
            unwrapped.includes("No tools or workspace writes were") &&
            unwrapped.includes("replayed; /rollback remains available")
          );
        },
        20_000,
      );
      expect(fs.existsSync(notesPath)).toBe(false);
      await exit(recovered);

      await crashed.dispose();
      await recovered.dispose();
      fs.rmSync(fixture.root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      });
      expect(fs.existsSync(fixture.root)).toBe(false);
    },
  );
});
