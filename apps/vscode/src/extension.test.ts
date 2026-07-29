import { describe, expect, it, vi } from "vitest";
import {
  registerExtension,
} from "./extension.js";
import type { CliHostAdapterOptions } from "./host-adapter.js";

type Command = () => unknown;

function fixture(folderPaths: string[] = ["C:\\repo"]) {
  const commands = new Map<string, Command>();
  const subscriptions: Array<{ dispose(): unknown }> = [];
  const outputLines: string[] = [];
  const showErrorMessage = vi.fn();
  const showInformationMessage = vi.fn();
  const showWarningMessage = vi.fn(async () => "Apply");
  const showInputBox = vi.fn(async () => "fix the failing test");
  const start = vi.fn(async () => ({ code: 0, signal: null }));
  const stop = vi.fn(() => true);
  const adapterOptions: CliHostAdapterOptions[] = [];
  const vscodeApi = {
    commands: {
      registerCommand: (name: string, callback: Command) => {
        commands.set(name, callback);
        return { dispose: vi.fn() };
      },
    },
    workspace: {
      workspaceFolders: folderPaths.map((fsPath) => ({ uri: { fsPath } })),
      getConfiguration: () => ({
        get: <T>(key: string, _defaultValue: T) =>
          (key === "cliPath"
            ? "C:\\tools\\nlc.exe"
            : "C:\\node\\node.exe") as T,
      }),
    },
    window: {
      createOutputChannel: () => ({
        append: (value: string) => outputLines.push(value),
        appendLine: (value: string) => outputLines.push(`${value}\n`),
        show: vi.fn(),
        dispose: vi.fn(),
      }),
      showInputBox,
      showWarningMessage,
      showErrorMessage,
      showInformationMessage,
    },
  };
  const createAdapter = (options: CliHostAdapterOptions) => {
    adapterOptions.push(options);
    return { start, stop };
  };

  registerExtension(vscodeApi, { subscriptions }, createAdapter);
  return {
    commands,
    subscriptions,
    adapterOptions,
    start,
    stop,
    outputLines,
    showWarningMessage,
    showErrorMessage,
    showInformationMessage,
  };
}

describe("VS Code extension smoke", () => {
  it("registers run/stop commands and routes one workspace through the adapter", async () => {
    const test = fixture();
    expect([...test.commands.keys()]).toEqual([
      "nlCodey.runTask",
      "nlCodey.stopTask",
    ]);
    expect(test.subscriptions).toHaveLength(4);

    await test.commands.get("nlCodey.runTask")!();
    expect(test.adapterOptions[0]).toMatchObject({
      workspaceRoot: "C:\\repo",
      cliPath: "C:\\tools\\nlc.exe",
      nodePath: "C:\\node\\node.exe",
    });
    expect(test.start).toHaveBeenCalledWith("fix the failing test");

    await expect(
      test.adapterOptions[0]!.ui.confirmPatch("preview"),
    ).resolves.toBe(true);
    expect(test.showWarningMessage).toHaveBeenCalledWith(
      "NL Codey proposes workspace changes.",
      expect.objectContaining({ modal: true, detail: "preview" }),
      "Apply",
      "Reject",
    );
  });

  it("rejects ambiguous workspaces and reports an idle stop", async () => {
    const test = fixture(["C:\\one", "C:\\two"]);
    await test.commands.get("nlCodey.runTask")!();
    expect(test.start).not.toHaveBeenCalled();
    expect(test.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("exactly one"),
    );

    test.stop.mockReturnValue(false);
    await test.commands.get("nlCodey.stopTask")!();
    expect(test.showInformationMessage).toHaveBeenCalledWith(
      "No NL Codey task is running.",
    );
  });

  it("stops the child when the extension lifecycle is disposed", async () => {
    const test = fixture();
    let finish: ((value: { code: number; signal: null }) => void) | undefined;
    test.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const running = test.commands.get("nlCodey.runTask")!();
    await new Promise((resolve) => setImmediate(resolve));

    test.subscriptions[3]!.dispose();
    expect(test.stop).toHaveBeenCalledTimes(1);

    finish?.({ code: 0, signal: null });
    await running;
  });
});
