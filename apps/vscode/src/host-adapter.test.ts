import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  CliHostAdapter,
  type HostProcess,
  type HostSpawnOptions,
} from "./host-adapter.js";

class FakeProcess extends EventEmitter implements HostProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
}

function fixture(confirmPatch = vi.fn(async () => true)) {
  const child = new FakeProcess();
  const calls: Array<{
    command: string;
    args: string[];
    options: HostSpawnOptions;
  }> = [];
  const onEvent = vi.fn();
  const onDiagnostic = vi.fn();
  const adapter = new CliHostAdapter({
    workspaceRoot: "C:\\repo",
    cliPath: "C:\\Program Files\\NL Codey\\nlc.exe",
    ui: { confirmPatch, onEvent, onDiagnostic },
    spawnProcess: (command, args, options) => {
      calls.push({ command, args, options });
      return child;
    },
  });
  return { adapter, child, calls, confirmPatch, onEvent, onDiagnostic };
}

describe("VS Code CLI host adapter", () => {
  it("spawns the shared CLI without a shell or argument interpolation", async () => {
    const { adapter, child, calls } = fixture();
    const task = 'fix "quoted"; Remove-Item -Recurse C:\\outside';
    const result = adapter.start(task);

    expect(calls).toEqual([
      {
        command: "C:\\Program Files\\NL Codey\\nlc.exe",
        args: [
          "run",
          task,
          "--workspace",
          "C:\\repo",
          "--json",
          "--host-protocol",
        ],
        options: {
          cwd: "C:\\repo",
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      },
    ]);

    child.emit("exit", 0, null);
    await expect(result).resolves.toEqual({ code: 0, signal: null });
  });

  it("reassembles NDJSON chunks and returns an exact approval message", async () => {
    const { adapter, child, confirmPatch, onEvent } = fixture();
    const stdin: string[] = [];
    child.stdin.on("data", (chunk) => stdin.push(chunk.toString()));
    const result = adapter.start("fix the test");
    const event = {
      kind: "patch_ready",
      runId: "run-42",
      patch: "*** Begin Patch\n*** End Patch",
    };
    const line = `${JSON.stringify(event)}\n`;
    child.stdout.write(line.slice(0, 17));
    child.stdout.write(line.slice(17));
    await flush();

    expect(onEvent).toHaveBeenCalledWith(event);
    expect(confirmPatch).toHaveBeenCalledWith(event.patch);
    expect(stdin).toEqual([
      '{"kind":"approval","runId":"run-42","decision":"approve"}\n',
    ]);

    child.emit("exit", 0, null);
    await result;
  });

  it("fails closed for malformed and forged approval events", async () => {
    const confirmPatch = vi.fn(async () => false);
    const { adapter, child, onDiagnostic } = fixture(confirmPatch);
    const stdin: string[] = [];
    child.stdin.on("data", (chunk) => stdin.push(chunk.toString()));
    const result = adapter.start("review the patch");

    child.stdout.write("not json\n");
    child.stdout.write(
      `${JSON.stringify({
        kind: "patch_ready",
        runId: "",
        patch: "forged",
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({
        kind: "patch_ready",
        runId: "run-7",
        patch: "real",
      })}\n`,
    );
    await flush();

    expect(onDiagnostic).toHaveBeenCalledTimes(2);
    expect(confirmPatch).toHaveBeenCalledTimes(1);
    expect(stdin).toEqual([
      '{"kind":"approval","runId":"run-7","decision":"reject"}\n',
    ]);

    child.emit("exit", 1, null);
    await result;
  });

  it("bounds and redacts child diagnostics", async () => {
    const { adapter, child, onDiagnostic } = fixture();
    const result = adapter.start("diagnose");
    child.stderr.write(
      `C:\\Users\\Alice\\secret\nAuthorization: Bearer sk-${"a".repeat(32)}`,
    );
    await flush();

    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.stringContaining("[REDACTED]"),
    );
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.stringContaining("[USER_HOME]"),
    );

    child.emit("exit", 1, null);
    await result;
  });

  it("kills an oversized event stream and supports explicit stop", async () => {
    const { adapter, child, onDiagnostic } = fixture();
    const result = adapter.start("large output");
    child.stdout.write("x".repeat(1_048_577));

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.stringContaining("exceeded"),
    );
    expect(adapter.stop()).toBe(true);
    expect(child.kill).toHaveBeenCalledTimes(2);

    child.emit("exit", null, "SIGTERM");
    await result;
  });

  it("supports JS entries and rejects shell shims, invalid paths, and concurrent runs", async () => {
    const { adapter, child } = fixture();
    expect(() => adapter.start("   ")).toThrow(/must not be empty/i);

    expect(
      () =>
        new CliHostAdapter({
          workspaceRoot: "C:\\repo",
          cliPath: "nlc.cmd",
          ui: {
            confirmPatch: async () => false,
            onEvent: () => undefined,
            onDiagnostic: () => undefined,
          },
        }),
    ).toThrow(/shell CLI shims are unsupported/i);

    const scriptChild = new FakeProcess();
    const scriptSpawn = vi.fn(() => scriptChild);
    const scriptAdapter = new CliHostAdapter({
      workspaceRoot: "C:\\repo",
      cliPath: "C:\\tools\\nlc.mjs",
      nodePath: "C:\\node\\node.exe",
      ui: {
        confirmPatch: async () => false,
        onEvent: () => undefined,
        onDiagnostic: () => undefined,
      },
      spawnProcess: scriptSpawn,
    });
    const scriptResult = scriptAdapter.start("script entry");
    expect(scriptSpawn).toHaveBeenCalledWith(
      "C:\\node\\node.exe",
      [
        "C:\\tools\\nlc.mjs",
        "run",
        "script entry",
        "--workspace",
        "C:\\repo",
        "--json",
        "--host-protocol",
      ],
      expect.objectContaining({ shell: false }),
    );
    scriptChild.emit("exit", 0, null);
    await scriptResult;

    const result = adapter.start("first");
    expect(() => adapter.start("second")).toThrow(/already running/i);
    child.emit("exit", 0, null);
    await result;
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
