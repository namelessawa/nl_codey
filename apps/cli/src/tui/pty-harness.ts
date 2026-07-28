import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import { spawn, type IPty } from "node-pty";
import stripAnsi from "strip-ansi";

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const cliEntry = fileURLToPath(new URL("../index.ts", import.meta.url));

export type PtyExit = {
  exitCode: number;
  signal: number;
};

export type TuiPtyOptions = {
  cwd: string;
  args: readonly string[];
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
};

export class TuiPtyHarness {
  readonly pid: number;
  private readonly terminal: Terminal;
  private readonly serializer: SerializeAddon;
  private readonly pty: IPty;
  private readonly exitPromise: Promise<PtyExit>;
  private exited = false;

  constructor(options: TuiPtyOptions) {
    const cols = options.cols ?? 100;
    const rows = options.rows ?? 30;
    this.terminal = new Terminal({
      cols,
      rows,
      allowProposedApi: true,
      scrollback: 1_000,
    });
    this.serializer = new SerializeAddon();
    this.terminal.loadAddon(this.serializer);
    this.pty = spawn(process.execPath, [tsxCli, cliEntry, ...options.args], {
      name: "xterm-256color",
      cwd: options.cwd,
      cols,
      rows,
      useConpty: process.platform === "win32",
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        ...options.env,
      },
    });
    this.pid = this.pty.pid;
    this.pty.onData((data) => {
      this.terminal.write(data);
    });
    this.exitPromise = new Promise((resolve) => {
      this.pty.onExit((event) => {
        this.exited = true;
        resolve({ exitCode: event.exitCode, signal: event.signal ?? 0 });
      });
    });
  }

  write(data: string): void {
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
    this.pty.resize(cols, rows);
  }

  viewport(): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (
      let index = buffer.viewportY;
      index < buffer.viewportY + this.terminal.rows;
      index += 1
    ) {
      lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
    }
    return lines.join("\n");
  }

  bufferText(): string {
    return stripAnsi(this.serializer.serialize()).replaceAll("\r", "");
  }

  async waitForScreen(
    predicate: (screen: string) => boolean,
    timeoutMs = 10_000,
  ): Promise<string> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const screen = this.viewport();
      if (predicate(screen)) return screen;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
    }
    throw new Error(
      `Timed out waiting for PTY screen after ${timeoutMs} ms.\n${this.viewport()}`,
    );
  }

  async waitForBuffer(
    predicate: (buffer: string) => boolean,
    timeoutMs = 10_000,
  ): Promise<string> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const buffer = this.bufferText();
      if (predicate(buffer)) return buffer;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
    }
    throw new Error(
      `Timed out waiting for PTY buffer after ${timeoutMs} ms.\n${this.bufferText()}`,
    );
  }

  async waitForExit(timeoutMs = 10_000): Promise<PtyExit> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.exitPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`PTY process ${this.pid} did not exit within ${timeoutMs} ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async dispose(): Promise<void> {
    if (!this.exited) this.pty.kill();
    if (!this.exited) {
      try {
        await this.waitForExit(5_000);
      } catch {
        // The test assertion reports the original failure; cleanup stays best-effort.
      }
    }
    this.terminal.dispose();
  }
}

export function spawnTuiPty(options: TuiPtyOptions): TuiPtyHarness {
  return new TuiPtyHarness(options);
}
