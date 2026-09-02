import path from "node:path";
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import {
  redactSensitiveText,
  type AgentEvent,
} from "@nlc/shared";

const MAX_TASK_CHARS = 20_000;
const MAX_EVENT_BYTES = 1_048_576;
const MAX_CLI_PATH_CHARS = 2_048;

export type HostExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

export type HostProcess = {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  once(
    event: "error",
    listener: (error: Error) => void,
  ): HostProcess;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): HostProcess;
  kill(): boolean;
};

export type HostSpawnOptions = {
  cwd: string;
  shell: false;
  windowsHide: true;
  stdio: ["pipe", "pipe", "pipe"];
};

export type SpawnHostProcess = (
  command: string,
  args: string[],
  options: HostSpawnOptions,
) => HostProcess;

export type HostAdapterUi = {
  confirmPatch(patch: string): Promise<boolean>;
  onEvent(event: AgentEvent): void;
  onDiagnostic(message: string): void;
};

export type CliHostAdapterOptions = {
  workspaceRoot: string;
  cliPath?: string;
  nodePath?: string;
  ui: HostAdapterUi;
  spawnProcess?: SpawnHostProcess;
};

export class CliHostAdapter {
  readonly #workspaceRoot: string;
  readonly #launch: { command: string; prefixArgs: string[] };
  readonly #ui: HostAdapterUi;
  readonly #spawnProcess: SpawnHostProcess;
  #child: HostProcess | null = null;
  #stdoutBuffer = "";
  #approvalChain: Promise<void> = Promise.resolve();

  constructor(options: CliHostAdapterOptions) {
    this.#workspaceRoot = path.resolve(options.workspaceRoot);
    this.#launch = resolveLaunch(
      options.cliPath ?? "nlc",
      options.nodePath ?? "node",
    );
    this.#ui = options.ui;
    this.#spawnProcess = options.spawnProcess ?? defaultSpawn;
  }

  get active(): boolean {
    return this.#child !== null;
  }

  start(task: string): Promise<HostExit> {
    if (this.#child) throw new Error("An NL Codey task is already running.");
    const normalizedTask = task.trim();
    if (!normalizedTask) throw new Error("Task must not be empty.");
    if (normalizedTask.length > MAX_TASK_CHARS) {
      throw new Error(`Task exceeds ${MAX_TASK_CHARS} characters.`);
    }

    const args = [
      ...this.#launch.prefixArgs,
      "run",
      normalizedTask,
      "--workspace",
      this.#workspaceRoot,
      "--json",
      "--host-protocol",
    ];
    const child = this.#spawnProcess(this.#launch.command, args, {
      cwd: this.#workspaceRoot,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;
    this.#stdoutBuffer = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#consumeStdout(child, chunk));
    child.stderr.on("data", (chunk: string) => {
      this.#diagnostic(chunk, "CLI diagnostic unavailable");
    });

    return new Promise<HostExit>((resolve, reject) => {
      let settled = false;
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        this.#clearChild(child);
        reject(
          new Error(
            redactSensitiveText(error, {
              maxLength: 4_000,
              fallback: "Unable to start the NL Codey CLI",
            }),
          ),
        );
      });
      child.once("exit", (code, signal) => {
        if (settled) return;
        settled = true;
        if (this.#stdoutBuffer.trim()) {
          this.#consumeLine(child, this.#stdoutBuffer);
        }
        this.#clearChild(child);
        resolve({ code, signal });
      });
    });
  }

  stop(): boolean {
    return this.#child?.kill() ?? false;
  }

  #consumeStdout(child: HostProcess, chunk: string): void {
    if (this.#child !== child) return;
    this.#stdoutBuffer += chunk;
    if (Buffer.byteLength(this.#stdoutBuffer, "utf8") > MAX_EVENT_BYTES) {
      this.#stdoutBuffer = "";
      this.#diagnostic(
        `CLI event exceeded the ${MAX_EVENT_BYTES}-byte host limit.`,
        "CLI event exceeded the host limit",
      );
      child.kill();
      return;
    }

    let newline = this.#stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
      if (line.trim()) this.#consumeLine(child, line);
      newline = this.#stdoutBuffer.indexOf("\n");
    }
  }

  #consumeLine(child: HostProcess, line: string): void {
    const event = parseAgentEvent(line);
    if (!event) {
      this.#diagnostic(line, "Malformed CLI event");
      return;
    }

    try {
      this.#ui.onEvent(event);
    } catch (error) {
      this.#diagnostic(error, "Host event rendering failed");
    }
    if (event.kind !== "patch_ready") return;

    this.#approvalChain = this.#approvalChain.then(async () => {
      let approved = false;
      try {
        approved = await this.#ui.confirmPatch(event.patch);
      } catch (error) {
        this.#diagnostic(error, "Approval prompt failed");
      }
      if (
        this.#child !== child ||
        child.stdin.destroyed ||
        !child.stdin.writable
      ) {
        return;
      }
      child.stdin.write(
        `${JSON.stringify({
          kind: "approval",
          runId: event.runId,
          decision: approved ? "approve" : "reject",
        })}\n`,
      );
    });
  }

  #diagnostic(value: unknown, fallback: string): void {
    try {
      this.#ui.onDiagnostic(
        redactSensitiveText(value, { maxLength: 4_000, fallback }),
      );
    } catch {
      // A broken presentation surface must not crash the child-process bridge.
    }
  }

  #clearChild(child: HostProcess): void {
    if (this.#child === child) this.#child = null;
    this.#stdoutBuffer = "";
  }
}

function normalizeExecutable(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > MAX_CLI_PATH_CHARS ||
    normalized.includes("\0") ||
    normalized.includes("\r") ||
    normalized.includes("\n")
  ) {
    throw new Error("NL Codey executable path is invalid.");
  }
  return normalized;
}

function resolveLaunch(
  cliPath: string,
  nodePath: string,
): { command: string; prefixArgs: string[] } {
  const configured = normalizeExecutable(cliPath);
  if (/\.(?:cmd|bat)$/i.test(configured)) {
    throw new Error(
      "Command-shell CLI shims are unsupported. Configure nlCodey.cliPath " +
        "to nlc.exe or the package's .js/.mjs entry.",
    );
  }
  if (/\.(?:[cm]?js)$/i.test(configured)) {
    const node = normalizeExecutable(nodePath);
    if (/\.(?:cmd|bat)$/i.test(node)) {
      throw new Error("nlCodey.nodePath must be a Node executable, not a shell shim.");
    }
    return {
      command: node,
      prefixArgs: [path.resolve(configured)],
    };
  }
  return {
    command:
      process.platform === "win32" && configured.toLowerCase() === "nlc"
        ? "nlc.exe"
        : configured,
    prefixArgs: [],
  };
}

function parseAgentEvent(line: string): AgentEvent | null {
  if (Buffer.byteLength(line, "utf8") > MAX_EVENT_BYTES) return null;
  let candidate: unknown;
  try {
    candidate = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(candidate) || typeof candidate.kind !== "string") return null;
  if (
    candidate.kind === "patch_ready" &&
    (typeof candidate.runId !== "string" ||
      candidate.runId.length === 0 ||
      typeof candidate.patch !== "string")
  ) {
    return null;
  }
  return candidate as AgentEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const defaultSpawn: SpawnHostProcess = (command, args, options) =>
  spawn(command, args, options) as HostProcess;
