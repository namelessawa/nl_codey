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

function createFixture(): { workspaceRoot: string; dataRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-conpty-"));
  tempRoots.push(tempRoot);
  const workspaceRoot = path.join(tempRoot, "workspace");
  const dataRoot = path.join(tempRoot, "data");
  fs.mkdirSync(workspaceRoot);
  fs.mkdirSync(dataRoot);
  return { workspaceRoot, dataRoot };
}

function start(cols = 100): TuiPtyHarness {
  const fixture = createFixture();
  const session = spawnTuiPty({
    cwd: fixture.workspaceRoot,
    cols,
    rows: 30,
    args: [
      "--workspace",
      fixture.workspaceRoot,
      "--data-root",
      fixture.dataRoot,
      "--no-color",
    ],
  });
  sessions.push(session);
  return session;
}

describeWindows("[tui-pty] Windows PTY lifecycle", () => {
  it("renders, resizes, completes /help and exits cleanly", async () => {
    const session = start();
    expect(session.pid).toBeGreaterThan(0);

    await session.waitForScreen(
      (screen) =>
        screen.includes("NL_Codey") &&
        screen.includes("trace") &&
        screen.includes("(idle)"),
    );

    session.resize(60, 24);
    await session.waitForScreen(
      (screen) => screen.includes("NL_Codey") && !screen.includes("trace"),
    );

    session.write("/he");
    await session.waitForScreen((screen) => screen.includes("command palette"));
    session.write("\t");
    await session.waitForScreen((screen) => screen.includes('q="/help"'));
    session.write("\r");
    await session.waitForBuffer((buffer) => buffer.includes("/skills-generate"));

    session.write("/exit");
    // The help catalogue itself contains "/exit", so wait for the prompt row
    // specifically. Otherwise the Enter write can overtake the text write in
    // the PTY and leave a visible but unsubmitted "/exit" behind.
    await session.waitForScreen((screen) =>
      screen.split("\n").some((line) => line.includes("❯ /exit")),
    );
    session.write("\r");
    const exit = await session.waitForExit();

    expect(exit.exitCode).toBe(0);
  });

  it("turns idle Ctrl+C into deterministic process cleanup", async () => {
    const session = start(80);
    await session.waitForScreen(
      (screen) => screen.includes("(idle)") && screen.includes("/exit quit"),
    );

    // Prove Ink's raw-input handlers are mounted before sending Ctrl+C.
    // A status/header render can arrive a tick earlier than the input effect,
    // in which case the PTY forwards Ctrl+C as SIGINT and Node exits with 1.
    session.write("x");
    await session.waitForScreen((screen) =>
      screen.split("\n").some((line) => line.includes("❯ x")),
    );
    session.write("\u0015");
    await session.waitForScreen(
      (screen) =>
        screen.split("\n").some((line) => line.includes("❯") && !line.includes("❯ x")),
    );

    const started = Date.now();
    session.write("\u0003");
    const exit = await session.waitForExit();

    expect(exit.exitCode).toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
