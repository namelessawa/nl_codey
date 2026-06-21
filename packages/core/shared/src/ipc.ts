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
import type { GlobalPattern, GlobalPatternInput, WorkspaceContributionMode } from "./kg-types.js";
import type { StyleScope, StyleSpec } from "./style-types.js";
import type { FeedbackSignal, FeedbackSignalInput, PreferenceDataset } from "./learning-types.js";
import type {
  FinetuneJob,
  FinetuneJobInput,
  ModelRegistryEntry,
} from "./finetune-types.js";
import type { WorkerNode } from "./cluster-types.js";
import type { Proposal } from "./proposals-types.js";
import type {
  PluginInstallation,
  PluginManifest,
  PluginPermission,
} from "./plugin-types.js";
import type { FrozenSuiteSnapshot } from "./evaluation-types.js";
import type { AdvancedSettings } from "./advanced-settings-types.js";
import type { DockerStartResult, InstallationStatus, InstallationEvent } from "./installation.js";

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
  continueAgentTask: "agent:continueAgentTask",
  applyAgentPatch: "agent:applyAgentPatch",
  rejectAgentPatch: "agent:rejectAgentPatch",
  rollbackRun: "agent:rollbackRun",
  runCommand: "agent:runCommand",
  stopAgentRun: "agent:stopAgentRun",
  getAgentRun: "agent:getAgentRun",
  listAgentRuns: "agent:listAgentRuns",
  clearAgentRuns: "agent:clearAgentRuns",
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
  listRoleMessagesForRun: "role:listForRun",
  // --- Phase 3: git ---
  getGitStatus: "git:status",
  generatePRDescription: "git:generatePR",
  discardAgentBranch: "git:discardBranch",
  // --- Phase 3: sandbox ---
  getSandboxMode: "sandbox:getMode",
  setSandboxMode: "sandbox:setMode",
  // --- Phase 4: global memory + KG ---
  listGlobalPatterns: "phase4:listGlobalPatterns",
  contributeGlobalPattern: "phase4:contributeGlobalPattern",
  retractWorkspaceContribution: "phase4:retractWorkspaceContribution",
  deleteGlobalPattern: "phase4:deleteGlobalPattern",
  getWorkspaceContribution: "phase4:getWorkspaceContribution",
  setWorkspaceContribution: "phase4:setWorkspaceContribution",
  // --- Phase 4: style profile ---
  getStyleSpec: "phase4:getStyleSpec",
  upsertStyleSpec: "phase4:upsertStyleSpec",
  extractStyleSpecFromCodebase: "phase4:extractStyleSpec",
  // --- Phase 4: learning ---
  listFeedbackSignals: "phase4:listFeedbackSignals",
  recordFeedbackSignal: "phase4:recordFeedbackSignal",
  buildPreferenceDataset: "phase4:buildPreferenceDataset",
  listPreferenceDatasets: "phase4:listPreferenceDatasets",
  // --- Phase 4: finetune ---
  listFinetuneJobs: "phase4:listFinetuneJobs",
  createFinetuneJob: "phase4:createFinetuneJob",
  listModels: "phase4:listModels",
  getActiveModel: "phase4:getActiveModel",
  promoteModel: "phase4:promoteModel",
  rollbackToBaseModel: "phase4:rollbackToBase",
  // --- Phase 4: proposals ---
  listProposals: "phase4:listProposals",
  snoozeProposal: "phase4:snoozeProposal",
  dismissProposal: "phase4:dismissProposal",
  convertProposal: "phase4:convertProposal",
  scanDebtNow: "phase4:scanDebt",
  // --- Phase 4: distributed ---
  listWorkerNodes: "phase4:listWorkerNodes",
  registerWorkerNode: "phase4:registerWorkerNode",
  // --- Phase 4: plugins ---
  listPlugins: "phase4:listPlugins",
  installPlugin: "phase4:installPlugin",
  setPluginEnabled: "phase4:setPluginEnabled",
  uninstallPlugin: "phase4:uninstallPlugin",
  // --- Phase 4: evals + frozen suite ---
  listFrozenSnapshots: "phase4:listFrozenSnapshots",
  listEvalRuns: "phase4:listEvalRuns",
  // --- Phase 4: settings ---
  getAdvancedSettings: "phase4:getSettings",
  updateAdvancedSettings: "phase4:updateSettings",
  // --- Installation gate (instruction branch) ---
  getInstallationStatus: "installation:getStatus",
  recheckDocker: "installation:recheckDocker",
  skipInstallationGate: "installation:skipGate",
  resumeInstallationGate: "installation:resumeGate",
  markFirstRunCompleted: "installation:markFirstRunCompleted",
  openDockerInstallPage: "installation:openInstallPage",
  startDocker: "installation:startDocker",
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
  | { kind: "index_status"; workspaceId: string; status: SemanticIndexStatus }
  /** Instruction branch: Docker availability or gate state changed. */
  | InstallationEvent;

export type RunAgentTaskArgs = { workspaceId: string; task: string };
export type ContinueAgentTaskArgs = { runId: string; followUp: string };
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
  /** Continue a finished run with a follow-up task; same runId, shared context. */
  continueAgentTask(args: ContinueAgentTaskArgs): Promise<IpcResult<AgentRunDetail>>;
  applyAgentPatch(args: RunIdArgs): Promise<IpcResult<AgentRunDetail>>;
  rejectAgentPatch(args: RunIdArgs): Promise<IpcResult<AgentRunDetail>>;
  rollbackRun(args: RunIdArgs): Promise<IpcResult<AgentRunDetail>>;
  runCommand(args: RunCommandArgs): Promise<IpcResult<RunCommandOutput>>;
  stopAgentRun(args: RunIdArgs): Promise<IpcResult<AgentRunDetail>>;
  getAgentRun(args: RunIdArgs): Promise<IpcResult<AgentRunDetail>>;
  listAgentRuns(workspaceId: string): Promise<IpcResult<AgentRun[]>>;
  clearAgentRuns(args: WorkspaceIdArgs): Promise<IpcResult<{ deleted: number }>>;
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
  /**
   * Import a project-memory export. The file path is picked by the user via
   * an OS dialog on the main side — the renderer no longer supplies a path
   * (defence against a compromised renderer asking main to read arbitrary
   * host files with main's privileges). Returns `{imported: 0, filePath:
   * null}` when the user cancels the dialog.
   */
  importMemory(args: ImportMemoryArgs): Promise<IpcResult<{ imported: number; filePath: string | null }>>;
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
  listRoleMessagesForRun(args: RunIdArgs): Promise<IpcResult<RoleMessage[]>>;
  // --- Phase 3: git ---
  getGitStatus(args: WorkspaceIdArgs): Promise<IpcResult<GitWorkingTreeStatus>>;
  generatePRDescription(args: RunIdArgs): Promise<IpcResult<PRDescription>>;
  discardAgentBranch(args: RunIdArgs): Promise<IpcResult<{ discarded: boolean }>>;
  // --- Phase 3: sandbox ---
  getSandboxMode(args: WorkspaceIdArgs): Promise<IpcResult<SandboxMode>>;
  setSandboxMode(args: SetSandboxModeArgs): Promise<IpcResult<SandboxMode>>;
  // --- Phase 4: global memory + KG ---
  listGlobalPatterns(): Promise<IpcResult<GlobalPattern[]>>;
  contributeGlobalPattern(args: { input: GlobalPatternInput }): Promise<IpcResult<GlobalPattern>>;
  retractWorkspaceContribution(args: WorkspaceIdArgs): Promise<IpcResult<{ updated: number; deleted: number }>>;
  deleteGlobalPattern(args: { id: string }): Promise<IpcResult<{ deleted: boolean }>>;
  getWorkspaceContribution(args: WorkspaceIdArgs): Promise<IpcResult<WorkspaceContributionMode>>;
  setWorkspaceContribution(args: { workspaceId: string; mode: WorkspaceContributionMode }): Promise<IpcResult<WorkspaceContributionMode>>;
  // --- Phase 4: style profile ---
  getStyleSpec(args: { scope: StyleScope; workspaceId: string | null }): Promise<IpcResult<StyleSpec | null>>;
  upsertStyleSpec(args: { spec: StyleSpec }): Promise<IpcResult<StyleSpec>>;
  extractStyleSpecFromCodebase(args: WorkspaceIdArgs): Promise<IpcResult<StyleSpec>>;
  // --- Phase 4: learning ---
  listFeedbackSignals(args: WorkspaceIdArgs): Promise<IpcResult<FeedbackSignal[]>>;
  recordFeedbackSignal(args: { signal: FeedbackSignalInput }): Promise<IpcResult<FeedbackSignal>>;
  buildPreferenceDataset(args: { workspaceId: string; name?: string }): Promise<IpcResult<{ datasetId: string; built: number; rejected: number }>>;
  listPreferenceDatasets(): Promise<IpcResult<PreferenceDataset[]>>;
  // --- Phase 4: finetune ---
  listFinetuneJobs(): Promise<IpcResult<FinetuneJob[]>>;
  createFinetuneJob(args: { input: FinetuneJobInput }): Promise<IpcResult<FinetuneJob>>;
  listModels(): Promise<IpcResult<ModelRegistryEntry[]>>;
  getActiveModel(): Promise<IpcResult<ModelRegistryEntry | null>>;
  promoteModel(args: { modelId: string }): Promise<IpcResult<ModelRegistryEntry | null>>;
  rollbackToBaseModel(): Promise<IpcResult<ModelRegistryEntry | null>>;
  // --- Phase 4: proposals ---
  listProposals(args: WorkspaceIdArgs): Promise<IpcResult<Proposal[]>>;
  snoozeProposal(args: { id: string; untilTs: number }): Promise<IpcResult<Proposal | null>>;
  dismissProposal(args: { id: string }): Promise<IpcResult<Proposal | null>>;
  convertProposal(args: { id: string }): Promise<IpcResult<Proposal | null>>;
  scanDebtNow(args: WorkspaceIdArgs): Promise<IpcResult<{ created: Proposal[] }>>;
  // --- Phase 4: distributed ---
  listWorkerNodes(): Promise<IpcResult<WorkerNode[]>>;
  registerWorkerNode(args: { node: Omit<WorkerNode, "registeredAt"> }): Promise<IpcResult<WorkerNode>>;
  // --- Phase 4: plugins ---
  listPlugins(): Promise<IpcResult<PluginInstallation[]>>;
  installPlugin(args: { manifest: PluginManifest; installPath: string; approvedPermissions: PluginPermission[] }): Promise<IpcResult<PluginInstallation>>;
  setPluginEnabled(args: { id: string; enabled: boolean }): Promise<IpcResult<PluginInstallation | null>>;
  uninstallPlugin(args: { id: string }): Promise<IpcResult<{ uninstalled: boolean }>>;
  // --- Phase 4: evals ---
  listFrozenSnapshots(args?: { modelId?: string }): Promise<IpcResult<FrozenSuiteSnapshot[]>>;
  listEvalRuns(args?: { taskId?: string; modelId?: string }): Promise<IpcResult<import("./evaluation-types.js").EvalRunResult[]>>;
  // --- Phase 4: settings ---
  getAdvancedSettings(): Promise<IpcResult<AdvancedSettings>>;
  updateAdvancedSettings(args: { settings: AdvancedSettings }): Promise<IpcResult<AdvancedSettings>>;
  // --- Installation gate (instruction branch) ---
  /** Snapshot of Docker availability and the user's skip decision. */
  getInstallationStatus(): Promise<IpcResult<InstallationStatus>>;
  /** Force a fresh probe (user clicked "Re-check" in the modal). */
  recheckDocker(): Promise<IpcResult<InstallationStatus>>;
  /** User clicked "Skip and accept the risk". */
  skipInstallationGate(): Promise<IpcResult<InstallationStatus>>;
  /** User cleared the skip flag from the red badge or settings warning. */
  resumeInstallationGate(): Promise<IpcResult<InstallationStatus>>;
  /** Renderer signals the install modal has been shown at least once. */
  markFirstRunCompleted(): Promise<IpcResult<InstallationStatus>>;
  /** Open the Docker Desktop download page in the user's default browser. */
  openDockerInstallPage(): Promise<IpcResult<{ opened: boolean }>>;
  /**
   * Launch Docker Desktop (when installed but the daemon isn't running) and
   * wait for the daemon to come up. Polls `docker info` in the background;
   * intermediate snapshots are broadcast as `installation_status` events.
   */
  startDocker(): Promise<IpcResult<DockerStartResult>>;
  onAgentEvent(handler: (event: AgentEvent) => void): () => void;
}

// --- Phase 3 arg types ---
export type ListMemoryArgs = { workspaceId: string; filter?: MemoryFilter };
export type CreateMemoryArgs = { workspaceId: string; entry: MemoryEntryInput };
export type UpdateMemoryArgs = { id: string; patch: MemoryEntryPatch };
export type DeleteMemoryArgs = { id: string };
/**
 * Import-memory IPC payload. The legacy `filePath` field is gone — the file
 * is now chosen via the OS dialog on the main side (see {@link AgentApi.importMemory}).
 */
export type ImportMemoryArgs = { workspaceId: string };
export type SemanticSearchArgs = {
  workspaceId: string;
  query: string;
  opts?: SemanticSearchOptions;
};
export type TaskNodeIdArgs = { taskNodeId: string };
export type EditTaskNodeArgs = { taskNodeId: string; patch: TaskNodePatch };
export type SetSandboxModeArgs = { workspaceId: string; mode: SandboxMode };
