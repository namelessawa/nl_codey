import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  IPC_EVENT,
  type AgentApi,
  type AgentEvent,
  type AppSettings,
  type CreateMemoryArgs,
  type DeleteMemoryArgs,
  type EditTaskNodeArgs,
  type ImportMemoryArgs,
  type ListMemoryArgs,
  type ReadFileArgs,
  type RunAgentTaskArgs,
  type RunCommandArgs,
  type RunIdArgs,
  type SemanticSearchArgs,
  type SetSandboxModeArgs,
  type TaskNodeIdArgs,
  type TestLLMConnectionArgs,
  type UpdateMemoryArgs,
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
  // --- Phase 3: memory ---
  listMemoryEntries: (args: ListMemoryArgs) => ipcRenderer.invoke(IPC.listMemoryEntries, args),
  createMemoryEntry: (args: CreateMemoryArgs) => ipcRenderer.invoke(IPC.createMemoryEntry, args),
  updateMemoryEntry: (args: UpdateMemoryArgs) => ipcRenderer.invoke(IPC.updateMemoryEntry, args),
  deleteMemoryEntry: (args: DeleteMemoryArgs) => ipcRenderer.invoke(IPC.deleteMemoryEntry, args),
  exportMemory: (args: WorkspaceIdArgs) => ipcRenderer.invoke(IPC.exportMemory, args),
  importMemory: (args: ImportMemoryArgs) => ipcRenderer.invoke(IPC.importMemory, args),
  // --- Phase 3: semantic index ---
  rebuildSemanticIndex: (args: WorkspaceIdArgs) =>
    ipcRenderer.invoke(IPC.rebuildSemanticIndex, args),
  getSemanticIndexStatus: (args: WorkspaceIdArgs) =>
    ipcRenderer.invoke(IPC.getSemanticIndexStatus, args),
  semanticSearch: (args: SemanticSearchArgs) => ipcRenderer.invoke(IPC.semanticSearch, args),
  // --- Phase 3: task tree ---
  getTaskTree: (args: RunIdArgs) => ipcRenderer.invoke(IPC.getTaskTree, args),
  approveTaskTree: (args: RunIdArgs) => ipcRenderer.invoke(IPC.approveTaskTree, args),
  editTaskNode: (args: EditTaskNodeArgs) => ipcRenderer.invoke(IPC.editTaskNode, args),
  cancelTaskNode: (args: TaskNodeIdArgs) => ipcRenderer.invoke(IPC.cancelTaskNode, args),
  // --- Phase 3: role messages ---
  listRoleMessages: (args: TaskNodeIdArgs) => ipcRenderer.invoke(IPC.listRoleMessages, args),
  // --- Phase 3: git ---
  getGitStatus: (args: WorkspaceIdArgs) => ipcRenderer.invoke(IPC.getGitStatus, args),
  generatePRDescription: (args: RunIdArgs) => ipcRenderer.invoke(IPC.generatePRDescription, args),
  discardAgentBranch: (args: RunIdArgs) => ipcRenderer.invoke(IPC.discardAgentBranch, args),
  // --- Phase 3: sandbox ---
  getSandboxMode: (args: WorkspaceIdArgs) => ipcRenderer.invoke(IPC.getSandboxMode, args),
  setSandboxMode: (args: SetSandboxModeArgs) => ipcRenderer.invoke(IPC.setSandboxMode, args),
  onAgentEvent: (handler: (event: AgentEvent) => void) => {
    const listener = (_e: unknown, payload: AgentEvent): void => handler(payload);
    ipcRenderer.on(IPC_EVENT, listener);
    return () => ipcRenderer.removeListener(IPC_EVENT, listener);
  },
};

contextBridge.exposeInMainWorld("agentApi", api);
