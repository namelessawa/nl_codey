import { ipcMain } from "electron";
import {
  redactSensitiveText,
  type IpcResult,
  type RunCommandOutput,
} from "@nlc/shared";

/** Wrap a handler so every IPC call returns a consistent { ok, ... } envelope. */
export function handle<T>(channel: string, fn: (...args: unknown[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: formatIpcError(err) };
    }
  });
}

export function formatIpcError(err: unknown): string {
  return redactSensitiveText(err, {
    maxLength: 4_000,
    fallback: "Unknown IPC error",
  });
}

export function redactCommandErrorOutput(
  output: RunCommandOutput,
): RunCommandOutput {
  if (output.exitCode === 0 && !output.timedOut) return output;
  return {
    ...output,
    command: redactSensitiveText(output.command, {
      maxLength: 1_000,
      fallback: "(unknown command)",
    }),
    stdout: redactSensitiveText(output.stdout, {
      maxLength: 16_000,
      fallback: "",
    }),
    stderr: redactSensitiveText(output.stderr, {
      maxLength: 16_000,
      fallback: "",
    }),
  };
}
