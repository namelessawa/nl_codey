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

    session.resize(59, 19);
    await session.waitForScreen(
      (screen) =>
        screen.includes("Terminal 59x19 is too small.") &&
        screen.includes("idle") &&
        !screen.includes("trace"),
    );

    session.resize(120, 40);
    await session.waitForScreen(
      (screen) =>
        screen.includes("NL_Codey") &&
        screen.includes("trace") &&
        !screen.includes("is too small"),
    );

    session.write("/he");
    await session.waitForScreen((screen) => screen.includes("command palette"));
    session.write("\t");
    await session.waitForScreen((screen) => screen.includes('q="/help"'));
    session.write("\r");
    await session.waitForBuffer(
      (buffer) =>
        buffer.includes("/skills-generate") &&
        buffer.includes(
          "Mouse: Experimental - terminal scrollback wheel only;",
        ),
    );

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
    expect(session.mouseTrackingWasEnabled()).toBe(false);
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

  it("edits Unicode paste, preserves a draft across resize and recalls history", async () => {
    const session = start();
    await session.waitForScreen(
      (screen) => screen.includes("(idle)") && screen.includes("❯"),
    );

    session.write("\u001B[200~第一行\r\n第二行\u001B[201~");
    await session.waitForScreen((screen) => screen.includes("第一行↵第二行"));
    session.write("\u001B");
    await session.waitForScreen(
      (screen) =>
        screen.split("\n").some((line) => line.includes("❯")) &&
        !screen.includes("第一行"),
    );

    session.write("helpX");
    await session.waitForScreen((screen) =>
      screen.split("\n").some((line) => line.includes("❯ helpX")),
    );
    session.resize(50, 16);
    await session.waitForScreen(
      (screen) =>
        screen.includes("Terminal 50x16 is too small.") &&
        !screen.includes("trace") &&
        screen.split("\n").some((line) => line.includes("❯ helpX")),
    );

    session.resize(60, 20);
    await session.waitForScreen(
      (screen) =>
        !screen.includes("is too small") &&
        !screen.includes("trace") &&
        screen.split("\n").some((line) => line.includes("❯ helpX")),
    );

    // Insert the slash at Home, then remove the trailing X with
    // End → Left → forward Delete. The result is the public /help command.
    session.write("\u001B[H");
    session.write("/");
    session.write("\u001B[F");
    session.write("\u001B[D");
    session.write("\u001B[3~");
    await session.waitForScreen((screen) =>
      screen.split("\n").some((line) => line.includes("❯ /help")),
    );
    session.write("\r");
    await session.waitForBuffer((buffer) => buffer.includes("/skills-generate"));
    await session.waitForScreen((screen) =>
      screen.split("\n").some((line) => line.includes("❯ ▍")),
    );

    session.write("\u001B[A");
    await session.waitForScreen((screen) =>
      screen.split("\n").some((line) => line.includes("❯ /help")),
    );
    const helpCount = session.bufferText().split("/skills-generate").length - 1;
    session.write("\r");
    await session.waitForBuffer(
      (buffer) => buffer.split("/skills-generate").length - 1 > helpCount,
    );
    await session.waitForScreen((screen) =>
      screen.split("\n").some((line) => line.includes("❯ ▍")),
    );

    // Empty-prompt Ctrl+C retains the established clean-exit contract. The
    // pasted CJK payload above already proves native Unicode input.
    session.write("\u0003");
    const exit = await session.waitForExit();
    expect(exit.exitCode).toBe(0);
  });
});
