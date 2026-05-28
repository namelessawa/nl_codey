/** Type-safe IPC contract between renderer (via preload bridge) and main process. */

import type { AgentRun, AgentStep, Workspace } from "./agent.js";
import type { ReadFileOutput, RunCommandOutput } from "./tools.js";
import type { AppSettings, LLMConfig } from "./settings.js";
import type {
  MemoryEntry,
  MemoryEntryInput,
  MemoryEntryPatch,
  MemoryFilter,
} from "./memory.js";
import type { SemanticHit, SemanticIndexStatus, SemanticSearchOptions } from "./semantic.js";
import type { TaskNode, TaskNodePatch } from "./task.js";
import type { RoleMessage } from "./roles.js";
import type { GitWorkingTreeStatus, PRDescription } from "./git.js";
import type { SandboxMode } from "./sandbox.js";

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
  // --- Phase 3: memory ---
  listMemoryEntries: "memory:list",
  createMemoryEntry: "memory:create",
  updateMemoryEntry: "memory:update",
  deleteMemoryEntry: "memory:delete",
  exportMemory: "memory:export",
  importMemory: "memory:import",
  // --- Phase 3: semantic index ---
  rebuildSemanticIndex: "semantic:rebuild",
  getSemanticIndexStatus: "semantic:status",
  semanticSearch: "semantic:search",
  // --- Phase 3: task tree ---
  getTaskTree: "task:getTree",
  approveTaskTree: "task:approveTree",
  editTaskNode: "task:editNode",
  cancelTaskNode: "task:cancelNode",
  // --- Phase 3: role messages ---
  listRoleMessages: "role:list",
  // --- Phase 3: git ---
  getGitStatus: "git:status",
  generatePRDescription: "git:generatePR",
  discardAgentBranch: "git:discardBranch",
  // --- Phase 3: sandbox ---
  getSandboxMode: "sandbox:getMode",
  setSandboxMode: "sandbox:setMode",
} as const;

/** Push channel: main -> renderer live updates while a run progresses. */
export const IPC_EVENT = "agent:event" as const;

export type AgentEvent =
  | { kind: "run_updated"; run: AgentRun }
  | { kind: "step_added"; step: AgentStep }
  | { kind: "patch_ready"; runId: string; patch: string }
  /** Streaming assistant text for the in-progress turn (token-by-token). */
  | { kind: "delta"; runId: string; text: string }
  /** Phase 3: a TaskNode changed (status/scope/etc). */
  | { kind: "task_updated"; runId: string; node: TaskNode }
  /** Phase 3: a new inter-role message was emitted. */
  | { kind: "role_message"; runId: string; message: RoleMessage }
  /** Phase 3: semantic index build progress. */
  | { kind: "index_status"; workspaceId: string; status: SemanticIndexStatus };

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
  // --- Phase 3: memory ---
  listMemoryEntries(args: ListMemoryArgs): Promise<IpcResult<MemoryEntry[]>>;
  createMemoryEntry(args: CreateMemoryArgs): Promise<IpcResult<MemoryEntry>>;
  updateMemoryEntry(args: UpdateMemoryArgs): Promise<IpcResult<MemoryEntry>>;
  deleteMemoryEntry(args: DeleteMemoryArgs): Promise<IpcResult<{ deleted: boolean }>>;
  exportMemory(args: WorkspaceIdArgs): Promise<IpcResult<{ filePath: string }>>;
  importMemory(args: ImportMemoryArgs): Promise<IpcResult<{ imported: number }>>;
  // --- Phase 3: semantic index ---
  rebuildSemanticIndex(args: WorkspaceIdArgs): Promise<IpcResult<SemanticIndexStatus>>;
  getSemanticIndexStatus(args: WorkspaceIdArgs): Promise<IpcResult<SemanticIndexStatus>>;
  semanticSearch(args: SemanticSearchArgs): Promise<IpcResult<SemanticHit[]>>;
  // --- Phase 3: task tree ---
  getTaskTree(args: RunIdArgs): Promise<IpcResult<TaskNode[]>>;
  approveTaskTree(args: RunIdArgs): Promise<IpcResult<{ approved: boolean }>>;
  editTaskNode(args: EditTaskNodeArgs): Promise<IpcResult<TaskNode>>;
  cancelTaskNode(args: TaskNodeIdArgs): Promise<IpcResult<TaskNode>>;
  // --- Phase 3: role messages ---
  listRoleMessages(args: TaskNodeIdArgs): Promise<IpcResult<RoleMessage[]>>;
  // --- Phase 3: git ---
  getGitStatus(args: WorkspaceIdArgs): Promise<IpcResult<GitWorkingTreeStatus>>;
  generatePRDescription(args: RunIdArgs): Promise<IpcResult<PRDescription>>;
  discardAgentBranch(args: RunIdArgs): Promise<IpcResult<{ discarded: boolean }>>;
  // --- Phase 3: sandbox ---
  getSandboxMode(args: WorkspaceIdArgs): Promise<IpcResult<SandboxMode>>;
  setSandboxMode(args: SetSandboxModeArgs): Promise<IpcResult<SandboxMode>>;
  onAgentEvent(handler: (event: AgentEvent) => void): () => void;
}

// --- Phase 3 arg types ---
export type ListMemoryArgs = { workspaceId: string; filter?: MemoryFilter };
export type CreateMemoryArgs = { workspaceId: string; entry: MemoryEntryInput };
export type UpdateMemoryArgs = { id: string; patch: MemoryEntryPatch };
export type DeleteMemoryArgs = { id: string };
export type ImportMemoryArgs = { workspaceId: string; filePath: string };
export type SemanticSearchArgs = {
  workspaceId: string;
  query: string;
  opts?: SemanticSearchOptions;
};
export type TaskNodeIdArgs = { taskNodeId: string };
export type EditTaskNodeArgs = { taskNodeId: string; patch: TaskNodePatch };
export type SetSandboxModeArgs = { workspaceId: string; mode: SandboxMode };
