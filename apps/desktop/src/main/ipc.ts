import fs from "node:fs";
import { BrowserWindow, dialog } from "electron";
import {
  IPC,
  validateSettings,
  type AppSettings,
  type SettingsPayload,
} from "@nlc/shared";
import { scanFiles } from "@nlc/project-indexer";
import { testLLMConnection } from "@nlc/llm";
import { readFileTool } from "@nlc/tools";
import type { Services } from "./services.js";
import { handle } from "./ipc-handle.js";
import { registerMemoryIpc } from "./ipc/memory-ipc.js";
import { registerSemanticIpc } from "./ipc/semantic-ipc.js";
import { registerTaskIpc } from "./ipc/task-ipc.js";
import { registerRoleIpc } from "./ipc/role-ipc.js";
import { registerGitIpc } from "./ipc/git-ipc.js";
import { registerSandboxIpc } from "./ipc/sandbox-ipc.js";
import { registerKgIpc } from "./ipc/kg-ipc.js";
import { registerStyleIpc } from "./ipc/style-ipc.js";
import { registerLearningIpc } from "./ipc/learning-ipc.js";
import { registerFinetuneIpc } from "./ipc/finetune-ipc.js";
import { registerProposalsIpc } from "./ipc/proposals-ipc.js";
import { registerClusterIpc } from "./ipc/cluster-ipc.js";
import { registerPluginIpc } from "./ipc/plugin-ipc.js";
import { registerAdvancedSettingsIpc } from "./ipc/advanced-settings-ipc.js";
import {
  validateContinueAgentTask,
  validateReadFile,
  validateRunAgentTask,
  validateRunCommand,
  validateRunId,
  validateTestLLMConnection,
  validateWorkspaceId,
} from "./validators.js";

export function registerIpc(services: Services): void {
  const { storage, agent, settings, installationGate } = services;

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

  handle(IPC.openRecentWorkspace, (raw) => {
    const { workspaceId } = validateWorkspaceId(raw);
    const ws = storage.getWorkspace(workspaceId);
    if (!ws) throw new Error("Workspace not found");
    if (!fs.existsSync(ws.rootPath)) {
      // L6: don't echo the full filesystem path back to the renderer. On
      // Windows rootPath typically embeds the OS username (`C:\Users\<user>\
      // ...`); the renderer error banner displayed it verbatim — readable by
      // any code that observes the DOM (screen recorders, future plugin
      // panes). The Topbar separately shows the workspace name only.
      console.warn(
        `[openRecentWorkspace] Workspace folder missing: ${ws.rootPath} (id=${workspaceId})`,
      );
      throw new Error("Workspace folder no longer exists. Please open it again.");
    }
    // Re-upsert by path to refresh opened_at so it sorts to the top of recents.
    return storage.upsertWorkspace(ws.rootPath);
  });

  // `listWorkspaceFiles` uniquely takes a bare string (not an object) — kept
  // for renderer back-compat. Tolerate both shapes for defence in depth.
  handle(IPC.listWorkspaceFiles, async (raw) => {
    const workspaceId =
      typeof raw === "string"
        ? raw
        : validateWorkspaceId(raw).workspaceId;
    const root = requireWorkspaceRoot(workspaceId);
    return scanFiles(root);
  });

  handle(IPC.readFile, async (raw) => {
    const { workspaceId, path } = validateReadFile(raw);
    const root = requireWorkspaceRoot(workspaceId);
    return readFileTool.run({ path }, { workspaceRoot: root, runId: "read" });
  });

  handle(IPC.runAgentTask, async (raw) => {
    const { workspaceId, task } = validateRunAgentTask(raw);
    return agent.runTask(workspaceId, task);
  });

  handle(IPC.continueAgentTask, async (raw) => {
    const { runId, followUp } = validateContinueAgentTask(raw);
    return agent.continueTask(runId, followUp);
  });

  handle(IPC.applyAgentPatch, async (raw) => agent.applyPatch(validateRunId(raw).runId));
  handle(IPC.rejectAgentPatch, (raw) => agent.rejectPatch(validateRunId(raw).runId));
  handle(IPC.rollbackRun, (raw) => agent.rollback(validateRunId(raw).runId));
  handle(IPC.stopAgentRun, (raw) => agent.stop(validateRunId(raw).runId));
  handle(IPC.getAgentRun, (raw) => agent.getDetail(validateRunId(raw).runId));
  // `listAgentRuns` takes a bare string like `listWorkspaceFiles`.
  handle(IPC.listAgentRuns, (raw) =>
    agent.listRuns(typeof raw === "string" ? raw : validateWorkspaceId(raw).workspaceId),
  );
  handle(IPC.clearAgentRuns, (raw) => agent.clearRuns(validateWorkspaceId(raw).workspaceId));

  handle(IPC.runCommand, async (raw) => {
    const { workspaceId, command } = validateRunCommand(raw);
    // Installation gate: refuse if Docker is missing and the user skipped.
    // Throws a readable error which the renderer surfaces in the run detail.
    installationGate.assertToolAllowed("run_command");
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

  handle(IPC.testLLMConnection, async (raw) => {
    const { config } = validateTestLLMConnection(raw);
    return testLLMConnection(config);
  });

  // --- Installation gate (instruction branch) ---
  handle(IPC.getInstallationStatus, () => installationGate.status());
  handle(IPC.recheckDocker, () => installationGate.recheck());
  handle(IPC.skipInstallationGate, () => installationGate.skip());
  handle(IPC.resumeInstallationGate, () => installationGate.resume());
  handle(IPC.markFirstRunCompleted, () => installationGate.markFirstRunCompleted());
  handle(IPC.openDockerInstallPage, () => installationGate.openInstallPage());
  handle(IPC.startDocker, () => installationGate.startDocker());

  registerMemoryIpc(services);
  registerSemanticIpc(services, requireWorkspaceRoot);
  registerTaskIpc(services);
  registerRoleIpc(services);
  registerGitIpc(services, requireWorkspaceRoot);
  registerSandboxIpc(services);
  registerKgIpc(services);
  registerStyleIpc(services, requireWorkspaceRoot);
  registerLearningIpc(services);
  registerFinetuneIpc(services, services.dataRoot);
  registerProposalsIpc(services, requireWorkspaceRoot);
  registerClusterIpc(services);
  registerPluginIpc(services);
  registerAdvancedSettingsIpc(services);
}

/** Broadcast an agent event to every open renderer window. */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}
