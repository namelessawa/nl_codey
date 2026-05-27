import fs from "node:fs";
import { BrowserWindow, dialog, ipcMain } from "electron";
import {
  IPC,
  validateSettings,
  type AppSettings,
  type IpcResult,
  type ReadFileArgs,
  type RunAgentTaskArgs,
  type RunCommandArgs,
  type RunIdArgs,
  type SettingsPayload,
  type TestLLMConnectionArgs,
  type WorkspaceIdArgs,
} from "@coding-agent/shared";
import { scanFiles } from "@coding-agent/project-indexer";
import { testLLMConnection } from "@coding-agent/llm";
import { readFileTool } from "@coding-agent/tools";
import type { Services } from "./services.js";

/** Wrap a handler so every IPC call returns a consistent { ok, ... } envelope. */
function handle<T>(channel: string, fn: (...args: unknown[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export function registerIpc(services: Services): void {
  const { storage, agent, settings } = services;

  const settingsPayload = (): SettingsPayload => ({
    settings: settings.getSettings(),
    secretsPersistent: settings.secretsArePersistent(),
  });

  const requireWorkspaceRoot = (workspaceId: string): string => {
    const ws = storage.getWorkspace(workspaceId);
    if (!ws) throw new Error("No workspace open");
    return ws.rootPath;
  };

  handle(IPC.openWorkspace, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Open project workspace",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return storage.upsertWorkspace(result.filePaths[0] as string);
  });

  handle(IPC.listWorkspaces, () => storage.listWorkspaces());

  handle(IPC.openRecentWorkspace, (args) => {
    const { workspaceId } = args as WorkspaceIdArgs;
    const ws = storage.getWorkspace(workspaceId);
    if (!ws) throw new Error("Workspace not found");
    if (!fs.existsSync(ws.rootPath)) {
      throw new Error(`Folder no longer exists: ${ws.rootPath}`);
    }
    // Re-upsert by path to refresh opened_at so it sorts to the top of recents.
    return storage.upsertWorkspace(ws.rootPath);
  });

  handle(IPC.listWorkspaceFiles, async (workspaceId) => {
    const root = requireWorkspaceRoot(workspaceId as string);
    return scanFiles(root);
  });

  handle(IPC.readFile, async (args) => {
    const { workspaceId, path } = args as ReadFileArgs;
    const root = requireWorkspaceRoot(workspaceId);
    return readFileTool.run({ path }, { workspaceRoot: root, runId: "read" });
  });

  handle(IPC.runAgentTask, async (args) => {
    const { workspaceId, task } = args as RunAgentTaskArgs;
    return agent.runTask(workspaceId, task);
  });

  handle(IPC.applyAgentPatch, async (args) => agent.applyPatch((args as RunIdArgs).runId));
  handle(IPC.rejectAgentPatch, (args) => agent.rejectPatch((args as RunIdArgs).runId));
  handle(IPC.rollbackRun, (args) => agent.rollback((args as RunIdArgs).runId));
  handle(IPC.stopAgentRun, (args) => agent.stop((args as RunIdArgs).runId));
  handle(IPC.getAgentRun, (args) => agent.getDetail((args as RunIdArgs).runId));
  handle(IPC.listAgentRuns, (workspaceId) => agent.listRuns(workspaceId as string));

  handle(IPC.runCommand, async (args) => {
    const { workspaceId, command } = args as RunCommandArgs;
    return agent.runCommandDirect(workspaceId, command);
  });

  handle(IPC.getSettings, () => settingsPayload());

  handle(IPC.updateSettings, (args) => {
    const next = args as AppSettings;
    const result = validateSettings(next);
    if (!result.valid) {
      throw new Error(result.issues.map((i) => `${i.field}: ${i.message}`).join("; "));
    }
    settings.updateSettings(next);
    return settingsPayload();
  });

  handle(IPC.resetSettings, () => {
    settings.resetSettings();
    return settingsPayload();
  });

  handle(IPC.testLLMConnection, async (args) => {
    const { config } = args as TestLLMConnectionArgs;
    return testLLMConnection(config);
  });
}

/** Broadcast an agent event to every open renderer window. */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}
