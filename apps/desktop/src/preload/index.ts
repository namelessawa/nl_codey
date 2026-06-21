import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  IPC_EVENT,
  type AgentApi,
  type AgentEvent,
  type AppSettings,
  type ContinueAgentTaskArgs,
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
} from "@nlc/shared";

const api: AgentApi = {
  openWorkspace: () => ipcRenderer.invoke(IPC.openWorkspace),
  listWorkspaces: () => ipcRenderer.invoke(IPC.listWorkspaces),
  openRecentWorkspace: (args: WorkspaceIdArgs) =>
    ipcRenderer.invoke(IPC.openRecentWorkspace, args),
  listWorkspaceFiles: (workspaceId: string) =>
    ipcRenderer.invoke(IPC.listWorkspaceFiles, workspaceId),
  readFile: (args: ReadFileArgs) => ipcRenderer.invoke(IPC.readFile, args),
  runAgentTask: (args: RunAgentTaskArgs) => ipcRenderer.invoke(IPC.runAgentTask, args),
  continueAgentTask: (args: ContinueAgentTaskArgs) =>
    ipcRenderer.invoke(IPC.continueAgentTask, args),
  applyAgentPatch: (args: RunIdArgs) => ipcRenderer.invoke(IPC.applyAgentPatch, args),
  rejectAgentPatch: (args: RunIdArgs) => ipcRenderer.invoke(IPC.rejectAgentPatch, args),
  rollbackRun: (args: RunIdArgs) => ipcRenderer.invoke(IPC.rollbackRun, args),
  runCommand: (args: RunCommandArgs) => ipcRenderer.invoke(IPC.runCommand, args),
  stopAgentRun: (args: RunIdArgs) => ipcRenderer.invoke(IPC.stopAgentRun, args),
  getAgentRun: (args: RunIdArgs) => ipcRenderer.invoke(IPC.getAgentRun, args),
  listAgentRuns: (workspaceId: string) => ipcRenderer.invoke(IPC.listAgentRuns, workspaceId),
  clearAgentRuns: (args: WorkspaceIdArgs) => ipcRenderer.invoke(IPC.clearAgentRuns, args),
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
  listRoleMessagesForRun: (args: RunIdArgs) =>
    ipcRenderer.invoke(IPC.listRoleMessagesForRun, args),
  // --- Phase 3: git ---
  getGitStatus: (args: WorkspaceIdArgs) => ipcRenderer.invoke(IPC.getGitStatus, args),
  generatePRDescription: (args: RunIdArgs) => ipcRenderer.invoke(IPC.generatePRDescription, args),
  discardAgentBranch: (args: RunIdArgs) => ipcRenderer.invoke(IPC.discardAgentBranch, args),
  // --- Phase 3: sandbox ---
  getSandboxMode: (args: WorkspaceIdArgs) => ipcRenderer.invoke(IPC.getSandboxMode, args),
  setSandboxMode: (args: SetSandboxModeArgs) => ipcRenderer.invoke(IPC.setSandboxMode, args),
  // --- Phase 4: global memory + KG ---
  listGlobalPatterns: () => ipcRenderer.invoke(IPC.listGlobalPatterns),
  contributeGlobalPattern: (args) => ipcRenderer.invoke(IPC.contributeGlobalPattern, args),
  retractWorkspaceContribution: (args) => ipcRenderer.invoke(IPC.retractWorkspaceContribution, args),
  deleteGlobalPattern: (args) => ipcRenderer.invoke(IPC.deleteGlobalPattern, args),
  getWorkspaceContribution: (args) => ipcRenderer.invoke(IPC.getWorkspaceContribution, args),
  setWorkspaceContribution: (args) => ipcRenderer.invoke(IPC.setWorkspaceContribution, args),
  // --- Phase 4: style profile ---
  getStyleSpec: (args) => ipcRenderer.invoke(IPC.getStyleSpec, args),
  upsertStyleSpec: (args) => ipcRenderer.invoke(IPC.upsertStyleSpec, args),
  extractStyleSpecFromCodebase: (args) =>
    ipcRenderer.invoke(IPC.extractStyleSpecFromCodebase, args),
  // --- Phase 4: learning ---
  listFeedbackSignals: (args) => ipcRenderer.invoke(IPC.listFeedbackSignals, args),
  recordFeedbackSignal: (args) => ipcRenderer.invoke(IPC.recordFeedbackSignal, args),
  buildPreferenceDataset: (args) => ipcRenderer.invoke(IPC.buildPreferenceDataset, args),
  listPreferenceDatasets: () => ipcRenderer.invoke(IPC.listPreferenceDatasets),
  // --- Phase 4: finetune ---
  listFinetuneJobs: () => ipcRenderer.invoke(IPC.listFinetuneJobs),
  createFinetuneJob: (args) => ipcRenderer.invoke(IPC.createFinetuneJob, args),
  listModels: () => ipcRenderer.invoke(IPC.listModels),
  getActiveModel: () => ipcRenderer.invoke(IPC.getActiveModel),
  promoteModel: (args) => ipcRenderer.invoke(IPC.promoteModel, args),
  rollbackToBaseModel: () => ipcRenderer.invoke(IPC.rollbackToBaseModel),
  // --- Phase 4: proposals ---
  listProposals: (args) => ipcRenderer.invoke(IPC.listProposals, args),
  snoozeProposal: (args) => ipcRenderer.invoke(IPC.snoozeProposal, args),
  dismissProposal: (args) => ipcRenderer.invoke(IPC.dismissProposal, args),
  convertProposal: (args) => ipcRenderer.invoke(IPC.convertProposal, args),
  scanDebtNow: (args) => ipcRenderer.invoke(IPC.scanDebtNow, args),
  // --- Phase 4: distributed ---
  listWorkerNodes: () => ipcRenderer.invoke(IPC.listWorkerNodes),
  registerWorkerNode: (args) => ipcRenderer.invoke(IPC.registerWorkerNode, args),
  // --- Phase 4: plugins ---
  listPlugins: () => ipcRenderer.invoke(IPC.listPlugins),
  installPlugin: (args) => ipcRenderer.invoke(IPC.installPlugin, args),
  setPluginEnabled: (args) => ipcRenderer.invoke(IPC.setPluginEnabled, args),
  uninstallPlugin: (args) => ipcRenderer.invoke(IPC.uninstallPlugin, args),
  // --- Phase 4: evals ---
  listFrozenSnapshots: (args) => ipcRenderer.invoke(IPC.listFrozenSnapshots, args),
  listEvalRuns: (args) => ipcRenderer.invoke(IPC.listEvalRuns, args),
  // --- Phase 4: settings ---
  getAdvancedSettings: () => ipcRenderer.invoke(IPC.getAdvancedSettings),
  updateAdvancedSettings: (args) => ipcRenderer.invoke(IPC.updateAdvancedSettings, args),
  // --- Installation gate (instruction branch) ---
  getInstallationStatus: () => ipcRenderer.invoke(IPC.getInstallationStatus),
  recheckDocker: () => ipcRenderer.invoke(IPC.recheckDocker),
  skipInstallationGate: () => ipcRenderer.invoke(IPC.skipInstallationGate),
  resumeInstallationGate: () => ipcRenderer.invoke(IPC.resumeInstallationGate),
  markFirstRunCompleted: () => ipcRenderer.invoke(IPC.markFirstRunCompleted),
  openDockerInstallPage: () => ipcRenderer.invoke(IPC.openDockerInstallPage),
  startDocker: () => ipcRenderer.invoke(IPC.startDocker),
  onAgentEvent: (handler: (event: AgentEvent) => void) => {
    const listener = (_e: unknown, payload: AgentEvent): void => handler(payload);
    ipcRenderer.on(IPC_EVENT, listener);
    return () => ipcRenderer.removeListener(IPC_EVENT, listener);
  },
};

contextBridge.exposeInMainWorld("agentApi", api);
