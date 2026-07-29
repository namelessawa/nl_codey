import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IPC } from "@nlc/shared";
import type { Services } from "../services.js";

const electron = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (event: unknown, ...args: unknown[]) => Promise<unknown>
  >(),
  handle: vi.fn(),
  showSaveDialog: vi.fn(),
}));

vi.mock("electron", () => ({
  dialog: { showSaveDialog: electron.showSaveDialog },
  ipcMain: {
    handle: electron.handle.mockImplementation(
      (
        channel: string,
        handler: (event: unknown, ...args: unknown[]) => Promise<unknown>,
      ) => {
        electron.handlers.set(channel, handler);
      },
    ),
  },
}));

import { registerDiagnosticsIpc } from "./diagnostics-ipc.js";

const tempDirs: string[] = [];

beforeEach(() => {
  electron.handlers.clear();
  electron.handle.mockClear();
  electron.showSaveDialog.mockReset();
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Desktop Run diagnostics export", () => {
  it("returns a clean cancellation without collecting diagnostic records", async () => {
    const storage = createStorage();
    electron.showSaveDialog.mockResolvedValue({ canceled: true });
    registerDiagnosticsIpc({ storage } as unknown as Services);

    await expect(handler()({}, { runId: "run-1" })).resolves.toEqual({
      ok: true,
      data: { filePath: null },
    });
    expect(storage.listSteps).not.toHaveBeenCalled();
    expect(storage.listSnapshots).not.toHaveBeenCalled();
  });

  it("writes the shared redacted schema to a user-selected path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-diagnostics-"));
    tempDirs.push(dir);
    const target = path.join(dir, "diagnostics.json");
    const storage = createStorage();
    storage.listSteps.mockReturnValue([
      {
        id: "step-1",
        runId: "run-1",
        type: "error",
        content: "Authorization: Bearer desktop-secret",
        createdAt: 2,
      },
    ]);
    electron.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: target,
    });
    registerDiagnosticsIpc({ storage } as unknown as Services);

    await expect(handler()({}, { runId: "run-1" })).resolves.toEqual({
      ok: true,
      data: { filePath: target },
    });

    const serialized = fs.readFileSync(target, "utf8");
    const bundle = JSON.parse(serialized) as {
      schemaVersion: number;
      run: { userTaskChars: number };
      steps: Array<{ detail?: string }>;
    };
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.run.userTaskChars).toBe("private user task".length);
    expect(bundle.steps[0]?.detail).toContain("[REDACTED]");
    expect(serialized).not.toMatch(/private user task|desktop-secret/);
    expect(electron.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.arrayContaining(["showOverwriteConfirmation"]),
      }),
    );
  });

  it("rejects an unknown Run before opening a save dialog", async () => {
    const storage = createStorage();
    storage.getRun.mockReturnValue(null);
    registerDiagnosticsIpc({ storage } as unknown as Services);

    await expect(handler()({}, { runId: "missing" })).resolves.toEqual({
      ok: false,
      error: "Run not found",
    });
    expect(electron.showSaveDialog).not.toHaveBeenCalled();
  });
});

function handler(): (
  event: unknown,
  raw: unknown,
) => Promise<unknown> {
  const registered = electron.handlers.get(IPC.exportRunDiagnostics);
  if (!registered) throw new Error("Diagnostics IPC handler was not registered");
  return registered;
}

function createStorage() {
  return {
    getRun: vi.fn().mockReturnValue({
      id: "run-1",
      workspaceId: "workspace-1",
      userTask: "private user task",
      status: "failed",
      createdAt: 1,
      updatedAt: 3,
    }),
    listSteps: vi.fn().mockReturnValue([]),
    listSnapshots: vi.fn().mockReturnValue([]),
    listTaskNodes: vi.fn().mockReturnValue([]),
    listGitActions: vi.fn().mockReturnValue([]),
  };
}
