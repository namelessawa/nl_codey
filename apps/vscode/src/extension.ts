import {
  CliHostAdapter,
  type CliHostAdapterOptions,
} from "./host-adapter.js";
import {
  redactSensitiveText,
  type AgentEvent,
} from "@nlc/shared";

type Disposable = { dispose(): unknown };
type ExtensionContext = { subscriptions: Disposable[] };
type OutputChannel = Disposable & {
  append(value: string): void;
  appendLine(value: string): void;
  show(preserveFocus?: boolean): void;
};

type VscodeApi = {
  commands: {
    registerCommand(
      command: string,
      callback: () => unknown,
    ): Disposable;
  };
  workspace: {
    workspaceFolders?: readonly { uri: { fsPath: string } }[];
    getConfiguration(section: string): {
      get<T>(key: string, defaultValue: T): T;
    };
  };
  window: {
    createOutputChannel(name: string): OutputChannel;
    showInputBox(options: {
      title: string;
      prompt: string;
      ignoreFocusOut: boolean;
    }): Promise<string | undefined>;
    showWarningMessage(
      message: string,
      options: { modal: boolean; detail?: string },
      ...items: string[]
    ): Promise<string | undefined>;
    showErrorMessage(message: string): unknown;
    showInformationMessage(message: string): unknown;
  };
};

type Adapter = Pick<CliHostAdapter, "start" | "stop">;
type AdapterFactory = (options: CliHostAdapterOptions) => Adapter;
let activeLifecycle: Disposable | null = null;

export function activate(context: ExtensionContext): void {
  const vscodeApi = require("vscode") as VscodeApi;
  activeLifecycle = registerExtension(vscodeApi, context);
}

export function deactivate(): void {
  activeLifecycle?.dispose();
  activeLifecycle = null;
}

export function registerExtension(
  vscodeApi: VscodeApi,
  context: ExtensionContext,
  createAdapter: AdapterFactory = (options) => new CliHostAdapter(options),
): Disposable {
  const output = vscodeApi.window.createOutputChannel("NL Codey");
  let activeAdapter: Adapter | null = null;

  const run = vscodeApi.commands.registerCommand("nlCodey.runTask", async () => {
    if (activeAdapter) {
      await vscodeApi.window.showWarningMessage(
        "An NL Codey task is already running.",
        { modal: false },
      );
      return;
    }
    const folders = vscodeApi.workspace.workspaceFolders ?? [];
    if (folders.length !== 1) {
      vscodeApi.window.showErrorMessage(
        "NL Codey currently requires exactly one open workspace folder.",
      );
      return;
    }
    const task = await vscodeApi.window.showInputBox({
      title: "NL Codey: Run Task",
      prompt: "Describe the coding task for this workspace",
      ignoreFocusOut: true,
    });
    if (!task?.trim()) return;

    const cliPath = vscodeApi.workspace
      .getConfiguration("nlCodey")
      .get("cliPath", "nlc");
    const nodePath = vscodeApi.workspace
      .getConfiguration("nlCodey")
      .get("nodePath", "node");
    const adapter = createAdapter({
      workspaceRoot: folders[0]!.uri.fsPath,
      cliPath,
      nodePath,
      ui: {
        confirmPatch: async (patch) => {
          output.appendLine("[approval] Workspace mutation requested.");
          output.show(true);
          const choice = await vscodeApi.window.showWarningMessage(
            "NL Codey proposes workspace changes.",
            {
              modal: true,
              detail: boundPatch(patch),
            },
            "Apply",
            "Reject",
          );
          return choice === "Apply";
        },
        onEvent: (event) => renderEvent(output, event),
        onDiagnostic: (message) => {
          output.appendLine(`[diagnostic] ${message}`);
          output.show(true);
        },
      },
    });
    activeAdapter = adapter;
    output.show(true);

    try {
      const result = await adapter.start(task);
      output.appendLine(
        `[host] CLI exited with ${result.code ?? result.signal ?? "unknown"}.`,
      );
    } catch (error) {
      vscodeApi.window.showErrorMessage(
        redactSensitiveText(error, {
          maxLength: 4_000,
          fallback: "NL Codey task failed",
        }),
      );
    } finally {
      if (activeAdapter === adapter) activeAdapter = null;
    }
  });

  const stop = vscodeApi.commands.registerCommand("nlCodey.stopTask", () => {
    if (!activeAdapter?.stop()) {
      vscodeApi.window.showInformationMessage("No NL Codey task is running.");
    }
  });

  const lifecycle = {
    dispose: (): void => {
      activeAdapter?.stop();
      activeAdapter = null;
    },
  };
  context.subscriptions.push(run, stop, output, lifecycle);
  return lifecycle;
}

function renderEvent(output: OutputChannel, event: AgentEvent): void {
  switch (event.kind) {
    case "delta":
      output.append(event.text);
      break;
    case "step_added":
      output.appendLine(
        `[${event.step.type}] ${redactSensitiveText(event.step.content, {
          maxLength: 8_000,
          fallback: "Step unavailable",
        })}`,
      );
      break;
    case "run_updated":
      output.appendLine(`[run] ${event.run.id} -> ${event.run.status}`);
      break;
    case "patch_ready":
      output.appendLine(`[approval] ${event.runId}`);
      break;
    default:
      output.appendLine(`[event] ${event.kind}`);
      break;
  }
}

function boundPatch(patch: string): string {
  const limit = 12_000;
  return patch.length <= limit
    ? patch
    : `${patch.slice(0, limit)}\n... (preview truncated)`;
}
