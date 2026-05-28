import type {
  AgentEvent,
  AgentRun,
  AgentRunDetail,
  AppSettings,
  GitWorkingTreeStatus,
  IpcResult,
  LLMConfig,
  MemoryEntry,
  MemoryEntryInput,
  MemoryEntryPatch,
  MemoryFilter,
  PRDescription,
  ReadFileOutput,
  RoleMessage,
  RunCommandOutput,
  SandboxMode,
  SemanticHit,
  SemanticIndexStatus,
  SemanticSearchOptions,
  SettingsPayload,
  TaskNode,
  TaskNodePatch,
  TestConnectionResult,
  Workspace,
} from "@coding-agent/shared";

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
  importMemory: (workspaceId: string, filePath: string): Promise<{ imported: number }> =>
    unwrap(window.agentApi.importMemory({ workspaceId, filePath })),
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
  onAgentEvent: (handler: (event: AgentEvent) => void): (() => void) =>
    window.agentApi.onAgentEvent(handler),
};
