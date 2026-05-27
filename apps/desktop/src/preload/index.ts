import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  IPC_EVENT,
  type AgentApi,
  type AgentEvent,
  type AppSettings,
  type ReadFileArgs,
  type RunAgentTaskArgs,
  type RunCommandArgs,
  type RunIdArgs,
  type TestLLMConnectionArgs,
  type WorkspaceIdArgs,
} from "@coding-agent/shared";

const api: AgentApi = {
  openWorkspace: () => ipcRenderer.invoke(IPC.openWorkspace),
  listWorkspaces: () => ipcRenderer.invoke(IPC.listWorkspaces),
  openRecentWorkspace: (args: WorkspaceIdArgs) =>
    ipcRenderer.invoke(IPC.openRecentWorkspace, args),
  listWorkspaceFiles: (workspaceId: string) =>
    ipcRenderer.invoke(IPC.listWorkspaceFiles, workspaceId),
  readFile: (args: ReadFileArgs) => ipcRenderer.invoke(IPC.readFile, args),
  runAgentTask: (args: RunAgentTaskArgs) => ipcRenderer.invoke(IPC.runAgentTask, args),
  applyAgentPatch: (args: RunIdArgs) => ipcRenderer.invoke(IPC.applyAgentPatch, args),
  rejectAgentPatch: (args: RunIdArgs) => ipcRenderer.invoke(IPC.rejectAgentPatch, args),
  rollbackRun: (args: RunIdArgs) => ipcRenderer.invoke(IPC.rollbackRun, args),
  runCommand: (args: RunCommandArgs) => ipcRenderer.invoke(IPC.runCommand, args),
  stopAgentRun: (args: RunIdArgs) => ipcRenderer.invoke(IPC.stopAgentRun, args),
  getAgentRun: (args: RunIdArgs) => ipcRenderer.invoke(IPC.getAgentRun, args),
  listAgentRuns: (workspaceId: string) => ipcRenderer.invoke(IPC.listAgentRuns, workspaceId),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (settings: AppSettings) => ipcRenderer.invoke(IPC.updateSettings, settings),
  resetSettings: () => ipcRenderer.invoke(IPC.resetSettings),
  testLLMConnection: (args: TestLLMConnectionArgs) =>
    ipcRenderer.invoke(IPC.testLLMConnection, args),
  onAgentEvent: (handler: (event: AgentEvent) => void) => {
    const listener = (_e: unknown, payload: AgentEvent): void => handler(payload);
    ipcRenderer.on(IPC_EVENT, listener);
    return () => ipcRenderer.removeListener(IPC_EVENT, listener);
  },
};

contextBridge.exposeInMainWorld("agentApi", api);
