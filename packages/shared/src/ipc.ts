/** Type-safe IPC contract between renderer (via preload bridge) and main process. */

import type { AgentRun, AgentStep, Workspace } from "./agent.js";
import type { ReadFileOutput, RunCommandOutput } from "./tools.js";
import type { AppSettings, LLMConfig } from "./settings.js";

/** Consistent response envelope for every IPC call. */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export const IPC = {
  openWorkspace: "agent:openWorkspace",
  listWorkspaces: "agent:listWorkspaces",
  openRecentWorkspace: "agent:openRecentWorkspace",
  listWorkspaceFiles: "agent:listWorkspaceFiles",
  readFile: "agent:readFile",
  runAgentTask: "agent:runAgentTask",
  applyAgentPatch: "agent:applyAgentPatch",
  rejectAgentPatch: "agent:rejectAgentPatch",
  rollbackRun: "agent:rollbackRun",
  runCommand: "agent:runCommand",
  stopAgentRun: "agent:stopAgentRun",
  getAgentRun: "agent:getAgentRun",
  listAgentRuns: "agent:listAgentRuns",
  getSettings: "settings:get",
  updateSettings: "settings:update",
  resetSettings: "settings:reset",
  testLLMConnection: "settings:testLLMConnection",
} as const;

/** Push channel: main -> renderer live updates while a run progresses. */
export const IPC_EVENT = "agent:event" as const;

export type AgentEvent =
  | { kind: "run_updated"; run: AgentRun }
  | { kind: "step_added"; step: AgentStep }
  | { kind: "patch_ready"; runId: string; patch: string };

export type RunAgentTaskArgs = { workspaceId: string; task: string };
export type RunIdArgs = { runId: string };
export type WorkspaceIdArgs = { workspaceId: string };
export type RunCommandArgs = { workspaceId: string; command: string };
export type ReadFileArgs = { workspaceId: string; path: string };

/** Settings payload returned to the renderer, with backend capability flags. */
export type SettingsPayload = {
  settings: AppSettings;
  /** False when the OS cannot encrypt secrets; the key won't persist. */
  secretsPersistent: boolean;
};

export type TestConnectionResult = { ok: boolean; message: string };
export type TestLLMConnectionArgs = { config: LLMConfig };

export type AgentRunDetail = {
  run: AgentRun;
  steps: AgentStep[];
  /** Pending unified diff awaiting approval, if any. */
  pendingPatch: string | null;
};

/** The surface exposed on `window.agentApi` by the preload bridge. */
export interface AgentApi {
  openWorkspace(): Promise<IpcResult<Workspace | null>>;
  /** Recently opened workspaces, most recent first. */
  listWorkspaces(): Promise<IpcResult<Workspace[]>>;
  /** Re-open a remembered workspace by id, refreshing its opened-at timestamp. */
  openRecentWorkspace(args: WorkspaceIdArgs): Promise<IpcResult<Workspace>>;
  listWorkspaceFiles(workspaceId: string): Promise<IpcResult<string[]>>;
  readFile(args: ReadFileArgs): Promise<IpcResult<ReadFileOutput>>;
  runAgentTask(args: RunAgentTaskArgs): Promise<IpcResult<AgentRunDetail>>;
  applyAgentPatch(args: RunIdArgs): Promise<IpcResult<AgentRunDetail>>;
  rejectAgentPatch(args: RunIdArgs): Promise<IpcResult<AgentRunDetail>>;
  rollbackRun(args: RunIdArgs): Promise<IpcResult<AgentRunDetail>>;
  runCommand(args: RunCommandArgs): Promise<IpcResult<RunCommandOutput>>;
  stopAgentRun(args: RunIdArgs): Promise<IpcResult<AgentRunDetail>>;
  getAgentRun(args: RunIdArgs): Promise<IpcResult<AgentRunDetail>>;
  listAgentRuns(workspaceId: string): Promise<IpcResult<AgentRun[]>>;
  getSettings(): Promise<IpcResult<SettingsPayload>>;
  updateSettings(settings: AppSettings): Promise<IpcResult<SettingsPayload>>;
  resetSettings(): Promise<IpcResult<SettingsPayload>>;
  testLLMConnection(args: TestLLMConnectionArgs): Promise<IpcResult<TestConnectionResult>>;
  onAgentEvent(handler: (event: AgentEvent) => void): () => void;
}
