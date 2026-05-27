import type {
  AgentEvent,
  AgentRun,
  AgentRunDetail,
  AppSettings,
  IpcResult,
  LLMConfig,
  ReadFileOutput,
  RunCommandOutput,
  SettingsPayload,
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
  onAgentEvent: (handler: (event: AgentEvent) => void): (() => void) =>
    window.agentApi.onAgentEvent(handler),
};
