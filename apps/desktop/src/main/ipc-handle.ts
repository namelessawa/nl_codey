import { ipcMain } from "electron";
import type { IpcResult } from "@coding-agent/shared";

/** Wrap a handler so every IPC call returns a consistent { ok, ... } envelope. */
export function handle<T>(channel: string, fn: (...args: unknown[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
