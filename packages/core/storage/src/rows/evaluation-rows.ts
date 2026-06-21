/** Checkpoint + eval row converters. */

import type {
  Checkpoint,
  EvalRunResult,
  EvalTask,
  FrozenSuiteSnapshot,
} from "@nlc/shared";

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
