/**
 * Phase 4 row converters and SQL helpers. Mirrors the {@link phase3-rows.ts}
 * pattern: this module knows about SQLite blobs and JSON serialization so the
 * main storage class stays readable.
 */
import type {
  Checkpoint,
  DistributedAssignment,
  EvalRunResult,
  EvalTask,
  FeedbackSignal,
  FinetuneJob,
  FinetuneEvalResult,
  FrozenSuiteSnapshot,
  GlobalPattern,
  KGEdge,
  ModelRegistryEntry,
  PluginInstallation,
  PluginPermission,
  PreferenceDataset,
  PreferencePair,
  Proposal,
  StyleSpec,
  WorkerNode,
  WorkspaceContributionMode,
} from "@coding-agent/shared";

// ----- global_patterns -----

export type GlobalPatternRow = {
  id: string;
  title: string;
  description: string;
  example_snippet: string;
  source_projects: string;
  tags: string;
  confidence: number;
  embedding: Buffer | null;
  created_at: number;
  last_applied_at: number;
};

export function toGlobalPattern(r: GlobalPatternRow): GlobalPattern {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    exampleSnippet: r.example_snippet,
    sourceProjects: JSON.parse(r.source_projects) as string[],
    tags: JSON.parse(r.tags) as string[],
    confidence: r.confidence,
    embedding: r.embedding ? embeddingFromBlob(r.embedding) : [],
    createdAt: r.created_at,
    lastAppliedAt: r.last_applied_at,
  };
}

export function embeddingToBlob(vec: number[]): Buffer {
  const arr = new Float32Array(vec);
  return Buffer.from(arr.buffer);
}

export function embeddingFromBlob(buf: Buffer): number[] {
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(f);
}

// ----- kg_edges -----

export type KGEdgeRow = {
  id: string;
  from_id: string;
  from_kind: string;
  to_id: string;
  to_kind: string;
  edge_kind: string;
  weight: number;
  created_at: number;
};

export function toKGEdge(r: KGEdgeRow): KGEdge {
  return {
    id: r.id,
    fromId: r.from_id,
    fromKind: r.from_kind as KGEdge["fromKind"],
    toId: r.to_id,
    toKind: r.to_kind as KGEdge["toKind"],
    edgeKind: r.edge_kind as KGEdge["edgeKind"],
    weight: r.weight,
    createdAt: r.created_at,
  };
}

// ----- workspace_contribution -----

export type WorkspaceContributionRow = {
  workspace_id: string;
  mode: string;
  updated_at: number;
};

// ----- style_specs -----

export type StyleSpecRow = {
  id: string;
  scope: string;
  workspace_id: string | null;
  spec_json: string;
  version: number;
  updated_at: number;
};

export function toStyleSpec(r: StyleSpecRow): StyleSpec {
  const parsed = JSON.parse(r.spec_json) as Omit<StyleSpec, "version" | "updatedAt">;
  return { ...parsed, version: r.version, updatedAt: r.updated_at };
}

// ----- feedback_signals -----

export type FeedbackSignalRow = {
  id: string;
  workspace_id: string;
  run_id: string;
  task_node_id: string | null;
  kind: string;
  before_text: string;
  after_text: string | null;
  reason: string | null;
  file_path: string | null;
  created_at: number;
};

export function toFeedbackSignal(r: FeedbackSignalRow): FeedbackSignal {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    runId: r.run_id,
    taskNodeId: r.task_node_id,
    kind: r.kind as FeedbackSignal["kind"],
    before: r.before_text,
    after: r.after_text,
    reason: r.reason,
    filePath: r.file_path,
    createdAt: r.created_at,
  };
}

// ----- preference_pairs -----

export type PreferencePairRow = {
  id: string;
  dataset_id: string;
  prompt: string;
  chosen: string;
  rejected: string;
  category: string | null;
  quality_score: number;
  signal_id: string;
  created_at: number;
};

export function toPreferencePair(r: PreferencePairRow): PreferencePair {
  return {
    id: r.id,
    prompt: r.prompt,
    chosen: r.chosen,
    rejected: r.rejected,
    category: r.category,
    qualityScore: r.quality_score,
    signalId: r.signal_id,
    createdAt: r.created_at,
  };
}

export type PreferenceDatasetRow = {
  id: string;
  name: string;
  curation_notes: string;
  created_at: number;
};

export function toPreferenceDataset(
  r: PreferenceDatasetRow,
  pairs: PreferencePair[],
): PreferenceDataset {
  return {
    id: r.id,
    name: r.name,
    pairs,
    curationNotes: r.curation_notes,
    createdAt: r.created_at,
  };
}

// ----- finetune_jobs -----

export type FinetuneJobRow = {
  id: string;
  name: string;
  base_model: string;
  dataset_id: string;
  method: string;
  status: string;
  eval_result_json: string | null;
  artifact_path: string | null;
  created_at: number;
  updated_at: number;
};

export function toFinetuneJob(r: FinetuneJobRow): FinetuneJob {
  return {
    id: r.id,
    name: r.name,
    baseModel: r.base_model,
    datasetId: r.dataset_id,
    method: r.method as FinetuneJob["method"],
    status: r.status as FinetuneJob["status"],
    evalResult: r.eval_result_json
      ? (JSON.parse(r.eval_result_json) as FinetuneEvalResult)
      : null,
    artifactPath: r.artifact_path,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ----- model_registry -----

export type ModelRegistryRow = {
  id: string;
  name: string;
  kind: string;
  base_model: string;
  active: number;
  eval_delta: number | null;
  artifact_path: string | null;
  created_at: number;
};

export function toModelRegistryEntry(r: ModelRegistryRow): ModelRegistryEntry {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as ModelRegistryEntry["kind"],
    baseModel: r.base_model,
    active: r.active === 1,
    evalDelta: r.eval_delta,
    artifactPath: r.artifact_path,
    createdAt: r.created_at,
  };
}

// ----- proposals -----

export type ProposalRow = {
  id: string;
  workspace_id: string;
  kind: string;
  title: string;
  rationale: string;
  estimated_effort: string;
  affected_files: string;
  status: string;
  snoozed_until: number | null;
  converted_run_id: string | null;
  created_at: number;
  updated_at: number;
};

export function toProposal(r: ProposalRow): Proposal {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    kind: r.kind as Proposal["kind"],
    title: r.title,
    rationale: r.rationale,
    estimatedEffort: r.estimated_effort as Proposal["estimatedEffort"],
    affectedFiles: JSON.parse(r.affected_files) as string[],
    status: r.status as Proposal["status"],
    snoozedUntil: r.snoozed_until,
    convertedRunId: r.converted_run_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ----- worker_nodes -----

export type WorkerNodeRow = {
  id: string;
  hostname: string;
  endpoint: string;
  status: string;
  capabilities: string;
  active_assignments: string;
  last_heartbeat: number;
  registered_at: number;
};

export function toWorkerNode(r: WorkerNodeRow): WorkerNode {
  return {
    id: r.id,
    hostname: r.hostname,
    endpoint: r.endpoint,
    status: r.status as WorkerNode["status"],
    capabilities: JSON.parse(r.capabilities) as string[],
    activeAssignments: JSON.parse(r.active_assignments) as string[],
    lastHeartbeat: r.last_heartbeat,
    registeredAt: r.registered_at,
  };
}

export type DistributedAssignmentRow = {
  id: string;
  node_id: string;
  task_node_id: string;
  status: string;
  started_at: number;
  finished_at: number | null;
};

export function toDistributedAssignment(r: DistributedAssignmentRow): DistributedAssignment {
  return {
    id: r.id,
    nodeId: r.node_id,
    taskNodeId: r.task_node_id,
    status: r.status as DistributedAssignment["status"],
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

// ----- plugin_installations -----

export type PluginInstallationRow = {
  id: string;
  manifest_json: string;
  install_path: string;
  enabled: number;
  approved_permissions: string;
  installed_at: number;
};

export function toPluginInstallation(r: PluginInstallationRow): PluginInstallation {
  return {
    id: r.id,
    manifest: JSON.parse(r.manifest_json) as PluginInstallation["manifest"],
    installPath: r.install_path,
    enabled: r.enabled === 1,
    approvedPermissions: JSON.parse(r.approved_permissions) as PluginPermission[],
    installedAt: r.installed_at,
  };
}

// ----- checkpoints -----

export type CheckpointRow = {
  id: string;
  run_id: string;
  task_node_id: string | null;
  kind: string;
  state_json: string;
  progress_report: string;
  created_at: number;
};

export function toCheckpoint(r: CheckpointRow): Checkpoint {
  return {
    id: r.id,
    runId: r.run_id,
    taskNodeId: r.task_node_id,
    kind: r.kind as Checkpoint["kind"],
    state: r.state_json,
    progressReport: r.progress_report,
    createdAt: r.created_at,
  };
}

// ----- evals -----

export type EvalTaskRow = {
  id: string;
  level: string;
  title: string;
  description: string;
  frozen: number;
  verify_command: string;
  expected_nodes: number;
  created_at: number;
};

export function toEvalTask(r: EvalTaskRow): EvalTask {
  return {
    id: r.id,
    level: r.level as EvalTask["level"],
    title: r.title,
    description: r.description,
    frozen: r.frozen === 1,
    verifyCommand: r.verify_command,
    expectedNodes: r.expected_nodes,
    createdAt: r.created_at,
  };
}

export type EvalRunRow = {
  id: string;
  task_id: string;
  model_id: string;
  pass: number;
  corrections: number;
  transfer_hits: number;
  cost_usd: number;
  duration_ms: number;
  error_message: string | null;
  created_at: number;
};

export function toEvalRunResult(r: EvalRunRow): EvalRunResult {
  return {
    id: r.id,
    taskId: r.task_id,
    modelId: r.model_id,
    pass: r.pass === 1,
    corrections: r.corrections,
    transferHits: r.transfer_hits,
    costUsd: r.cost_usd,
    durationMs: r.duration_ms,
    errorMessage: r.error_message,
    createdAt: r.created_at,
  };
}

export type FrozenSuiteSnapshotRow = {
  id: string;
  week_start_ts: number;
  pass_rate: number;
  corrections_per_task: number;
  transfer_hits: number;
  total_tasks: number;
  model_id: string;
};

export function toFrozenSuiteSnapshot(r: FrozenSuiteSnapshotRow): FrozenSuiteSnapshot {
  return {
    weekStartTs: r.week_start_ts,
    passRate: r.pass_rate,
    correctionsPerTask: r.corrections_per_task,
    transferHits: r.transfer_hits,
    totalTasks: r.total_tasks,
    modelId: r.model_id,
  };
}

export type WorkspaceContributionPair = {
  workspaceId: string;
  mode: WorkspaceContributionMode;
  updatedAt: number;
};
