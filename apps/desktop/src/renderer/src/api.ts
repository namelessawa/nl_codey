import type {
  AgentEvent,
  AgentRun,
  AgentRunDetail,
  AppSettings,
  DockerStartResult,
  InstallationStatus,
  EvalRunResult,
  FeedbackSignal,
  FeedbackSignalInput,
  FinetuneJob,
  FinetuneJobInput,
  FrozenSuiteSnapshot,
  GitWorkingTreeStatus,
  GlobalPattern,
  GlobalPatternInput,
  IpcResult,
  LLMConfig,
  MemoryEntry,
  MemoryEntryInput,
  MemoryEntryPatch,
  MemoryFilter,
  ModelRegistryEntry,
  PRDescription,
  Phase4Settings,
  PluginInstallation,
  PluginManifest,
  PluginPermission,
  PreferenceDataset,
  Proposal,
  ReadFileOutput,
  RoleMessage,
  RunCommandOutput,
  SandboxMode,
  SemanticHit,
  SemanticIndexStatus,
  SemanticSearchOptions,
  SettingsPayload,
  StyleScope,
  StyleSpec,
  TaskNode,
  TaskNodePatch,
  TestConnectionResult,
  WorkerNode,
  Workspace,
  WorkspaceContributionMode,
} from "@nlc/shared";

async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const result = await p;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

/** Thin renderer-side wrapper that unwraps the IPC envelope into values/throws. */
export const api = {
  openWorkspace: (): Promise<Workspace | null> => unwrap(window.agentApi.openWorkspace()),
  listWorkspaces: (): Promise<Workspace[]> => unwrap(window.agentApi.listWorkspaces()),
  openRecentWorkspace: (workspaceId: string): Promise<Workspace> =>
    unwrap(window.agentApi.openRecentWorkspace({ workspaceId })),
  listWorkspaceFiles: (workspaceId: string): Promise<string[]> =>
    unwrap(window.agentApi.listWorkspaceFiles(workspaceId)),
  readFile: (workspaceId: string, path: string): Promise<ReadFileOutput> =>
    unwrap(window.agentApi.readFile({ workspaceId, path })),
  runAgentTask: (workspaceId: string, task: string): Promise<AgentRunDetail> =>
    unwrap(window.agentApi.runAgentTask({ workspaceId, task })),
  continueAgentTask: (runId: string, followUp: string): Promise<AgentRunDetail> =>
    unwrap(window.agentApi.continueAgentTask({ runId, followUp })),
  applyAgentPatch: (runId: string): Promise<AgentRunDetail> =>
    unwrap(window.agentApi.applyAgentPatch({ runId })),
  rejectAgentPatch: (runId: string): Promise<AgentRunDetail> =>
    unwrap(window.agentApi.rejectAgentPatch({ runId })),
  rollbackRun: (runId: string): Promise<AgentRunDetail> =>
    unwrap(window.agentApi.rollbackRun({ runId })),
  runCommand: (workspaceId: string, command: string): Promise<RunCommandOutput> =>
    unwrap(window.agentApi.runCommand({ workspaceId, command })),
  stopAgentRun: (runId: string): Promise<AgentRunDetail> =>
    unwrap(window.agentApi.stopAgentRun({ runId })),
  getAgentRun: (runId: string): Promise<AgentRunDetail> =>
    unwrap(window.agentApi.getAgentRun({ runId })),
  listAgentRuns: (workspaceId: string): Promise<AgentRun[]> =>
    unwrap(window.agentApi.listAgentRuns(workspaceId)),
  clearAgentRuns: (workspaceId: string): Promise<{ deleted: number }> =>
    unwrap(window.agentApi.clearAgentRuns({ workspaceId })),
  getSettings: (): Promise<SettingsPayload> => unwrap(window.agentApi.getSettings()),
  updateSettings: (settings: AppSettings): Promise<SettingsPayload> =>
    unwrap(window.agentApi.updateSettings(settings)),
  resetSettings: (): Promise<SettingsPayload> => unwrap(window.agentApi.resetSettings()),
  testLLMConnection: (config: LLMConfig): Promise<TestConnectionResult> =>
    unwrap(window.agentApi.testLLMConnection({ config })),
  // --- Phase 3: memory ---
  listMemoryEntries: (workspaceId: string, filter?: MemoryFilter): Promise<MemoryEntry[]> =>
    unwrap(window.agentApi.listMemoryEntries({ workspaceId, filter })),
  createMemoryEntry: (workspaceId: string, entry: MemoryEntryInput): Promise<MemoryEntry> =>
    unwrap(window.agentApi.createMemoryEntry({ workspaceId, entry })),
  updateMemoryEntry: (id: string, patch: MemoryEntryPatch): Promise<MemoryEntry> =>
    unwrap(window.agentApi.updateMemoryEntry({ id, patch })),
  deleteMemoryEntry: (id: string): Promise<{ deleted: boolean }> =>
    unwrap(window.agentApi.deleteMemoryEntry({ id })),
  exportMemory: (workspaceId: string): Promise<{ filePath: string }> =>
    unwrap(window.agentApi.exportMemory({ workspaceId })),
  /**
   * Import a project-memory JSON file. The file is chosen by the user via an
   * OS dialog on the main side — no `filePath` argument any more. Resolves
   * with `imported: 0, filePath: null` if the user cancels.
   */
  importMemory: (workspaceId: string): Promise<{ imported: number; filePath: string | null }> =>
    unwrap(window.agentApi.importMemory({ workspaceId })),
  // --- Phase 3: semantic index ---
  rebuildSemanticIndex: (workspaceId: string): Promise<SemanticIndexStatus> =>
    unwrap(window.agentApi.rebuildSemanticIndex({ workspaceId })),
  getSemanticIndexStatus: (workspaceId: string): Promise<SemanticIndexStatus> =>
    unwrap(window.agentApi.getSemanticIndexStatus({ workspaceId })),
  semanticSearch: (
    workspaceId: string,
    query: string,
    opts?: SemanticSearchOptions,
  ): Promise<SemanticHit[]> =>
    unwrap(window.agentApi.semanticSearch({ workspaceId, query, opts })),
  // --- Phase 3: task tree ---
  getTaskTree: (runId: string): Promise<TaskNode[]> =>
    unwrap(window.agentApi.getTaskTree({ runId })),
  approveTaskTree: (runId: string): Promise<{ approved: boolean }> =>
    unwrap(window.agentApi.approveTaskTree({ runId })),
  editTaskNode: (taskNodeId: string, patch: TaskNodePatch): Promise<TaskNode> =>
    unwrap(window.agentApi.editTaskNode({ taskNodeId, patch })),
  cancelTaskNode: (taskNodeId: string): Promise<TaskNode> =>
    unwrap(window.agentApi.cancelTaskNode({ taskNodeId })),
  // --- Phase 3: role messages ---
  listRoleMessages: (taskNodeId: string): Promise<RoleMessage[]> =>
    unwrap(window.agentApi.listRoleMessages({ taskNodeId })),
  listRoleMessagesForRun: (runId: string): Promise<RoleMessage[]> =>
    unwrap(window.agentApi.listRoleMessagesForRun({ runId })),
  // --- Phase 3: git ---
  getGitStatus: (workspaceId: string): Promise<GitWorkingTreeStatus> =>
    unwrap(window.agentApi.getGitStatus({ workspaceId })),
  generatePRDescription: (runId: string): Promise<PRDescription> =>
    unwrap(window.agentApi.generatePRDescription({ runId })),
  discardAgentBranch: (runId: string): Promise<{ discarded: boolean }> =>
    unwrap(window.agentApi.discardAgentBranch({ runId })),
  // --- Phase 3: sandbox ---
  getSandboxMode: (workspaceId: string): Promise<SandboxMode> =>
    unwrap(window.agentApi.getSandboxMode({ workspaceId })),
  setSandboxMode: (workspaceId: string, mode: SandboxMode): Promise<SandboxMode> =>
    unwrap(window.agentApi.setSandboxMode({ workspaceId, mode })),
  // --- Phase 4: global memory + KG ---
  listGlobalPatterns: (): Promise<GlobalPattern[]> =>
    unwrap(window.agentApi.listGlobalPatterns()),
  contributeGlobalPattern: (input: GlobalPatternInput): Promise<GlobalPattern> =>
    unwrap(window.agentApi.contributeGlobalPattern({ input })),
  retractWorkspaceContribution: (workspaceId: string): Promise<{ updated: number; deleted: number }> =>
    unwrap(window.agentApi.retractWorkspaceContribution({ workspaceId })),
  deleteGlobalPattern: (id: string): Promise<{ deleted: boolean }> =>
    unwrap(window.agentApi.deleteGlobalPattern({ id })),
  getWorkspaceContribution: (workspaceId: string): Promise<WorkspaceContributionMode> =>
    unwrap(window.agentApi.getWorkspaceContribution({ workspaceId })),
  setWorkspaceContribution: (workspaceId: string, mode: WorkspaceContributionMode): Promise<WorkspaceContributionMode> =>
    unwrap(window.agentApi.setWorkspaceContribution({ workspaceId, mode })),
  // --- Phase 4: style profile ---
  getStyleSpec: (scope: StyleScope, workspaceId: string | null): Promise<StyleSpec | null> =>
    unwrap(window.agentApi.getStyleSpec({ scope, workspaceId })),
  upsertStyleSpec: (spec: StyleSpec): Promise<StyleSpec> =>
    unwrap(window.agentApi.upsertStyleSpec({ spec })),
  extractStyleSpecFromCodebase: (workspaceId: string): Promise<StyleSpec> =>
    unwrap(window.agentApi.extractStyleSpecFromCodebase({ workspaceId })),
  // --- Phase 4: learning ---
  listFeedbackSignals: (workspaceId: string): Promise<FeedbackSignal[]> =>
    unwrap(window.agentApi.listFeedbackSignals({ workspaceId })),
  recordFeedbackSignal: (signal: FeedbackSignalInput): Promise<FeedbackSignal> =>
    unwrap(window.agentApi.recordFeedbackSignal({ signal })),
  buildPreferenceDataset: (workspaceId: string, name?: string): Promise<{ datasetId: string; built: number; rejected: number }> =>
    unwrap(window.agentApi.buildPreferenceDataset({ workspaceId, name })),
  listPreferenceDatasets: (): Promise<PreferenceDataset[]> =>
    unwrap(window.agentApi.listPreferenceDatasets()),
  // --- Phase 4: finetune ---
  listFinetuneJobs: (): Promise<FinetuneJob[]> =>
    unwrap(window.agentApi.listFinetuneJobs()),
  createFinetuneJob: (input: FinetuneJobInput): Promise<FinetuneJob> =>
    unwrap(window.agentApi.createFinetuneJob({ input })),
  listModels: (): Promise<ModelRegistryEntry[]> =>
    unwrap(window.agentApi.listModels()),
  getActiveModel: (): Promise<ModelRegistryEntry | null> =>
    unwrap(window.agentApi.getActiveModel()),
  promoteModel: (modelId: string): Promise<ModelRegistryEntry | null> =>
    unwrap(window.agentApi.promoteModel({ modelId })),
  rollbackToBaseModel: (): Promise<ModelRegistryEntry | null> =>
    unwrap(window.agentApi.rollbackToBaseModel()),
  // --- Phase 4: proposals ---
  listProposals: (workspaceId: string): Promise<Proposal[]> =>
    unwrap(window.agentApi.listProposals({ workspaceId })),
  snoozeProposal: (id: string, untilTs: number): Promise<Proposal | null> =>
    unwrap(window.agentApi.snoozeProposal({ id, untilTs })),
  dismissProposal: (id: string): Promise<Proposal | null> =>
    unwrap(window.agentApi.dismissProposal({ id })),
  convertProposal: (id: string): Promise<Proposal | null> =>
    unwrap(window.agentApi.convertProposal({ id })),
  scanDebtNow: (workspaceId: string): Promise<{ created: Proposal[] }> =>
    unwrap(window.agentApi.scanDebtNow({ workspaceId })),
  // --- Phase 4: distributed ---
  listWorkerNodes: (): Promise<WorkerNode[]> =>
    unwrap(window.agentApi.listWorkerNodes()),
  registerWorkerNode: (node: Omit<WorkerNode, "registeredAt">): Promise<WorkerNode> =>
    unwrap(window.agentApi.registerWorkerNode({ node })),
  // --- Phase 4: plugins ---
  listPlugins: (): Promise<PluginInstallation[]> =>
    unwrap(window.agentApi.listPlugins()),
  installPlugin: (
    manifest: PluginManifest,
    installPath: string,
    approvedPermissions: PluginPermission[],
  ): Promise<PluginInstallation> =>
    unwrap(window.agentApi.installPlugin({ manifest, installPath, approvedPermissions })),
  setPluginEnabled: (id: string, enabled: boolean): Promise<PluginInstallation | null> =>
    unwrap(window.agentApi.setPluginEnabled({ id, enabled })),
  uninstallPlugin: (id: string): Promise<{ uninstalled: boolean }> =>
    unwrap(window.agentApi.uninstallPlugin({ id })),
  // --- Phase 4: evals ---
  listFrozenSnapshots: (modelId?: string): Promise<FrozenSuiteSnapshot[]> =>
    unwrap(window.agentApi.listFrozenSnapshots({ modelId })),
  listEvalRuns: (taskId?: string, modelId?: string): Promise<EvalRunResult[]> =>
    unwrap(window.agentApi.listEvalRuns({ taskId, modelId })),
  // --- Phase 4: settings ---
  getPhase4Settings: (): Promise<Phase4Settings> =>
    unwrap(window.agentApi.getPhase4Settings()),
  updatePhase4Settings: (settings: Phase4Settings): Promise<Phase4Settings> =>
    unwrap(window.agentApi.updatePhase4Settings({ settings })),
  // --- Installation gate (instruction branch) ---
  getInstallationStatus: (): Promise<InstallationStatus> =>
    unwrap(window.agentApi.getInstallationStatus()),
  recheckDocker: (): Promise<InstallationStatus> =>
    unwrap(window.agentApi.recheckDocker()),
  skipInstallationGate: (): Promise<InstallationStatus> =>
    unwrap(window.agentApi.skipInstallationGate()),
  resumeInstallationGate: (): Promise<InstallationStatus> =>
    unwrap(window.agentApi.resumeInstallationGate()),
  markFirstRunCompleted: (): Promise<InstallationStatus> =>
    unwrap(window.agentApi.markFirstRunCompleted()),
  openDockerInstallPage: (): Promise<{ opened: boolean }> =>
    unwrap(window.agentApi.openDockerInstallPage()),
  startDocker: (): Promise<DockerStartResult> =>
    unwrap(window.agentApi.startDocker()),
  onAgentEvent: (handler: (event: AgentEvent) => void): (() => void) =>
    window.agentApi.onAgentEvent(handler),
};
