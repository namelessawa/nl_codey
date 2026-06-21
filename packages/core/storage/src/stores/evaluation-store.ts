/** Evaluation store: checkpoints + eval tasks/runs + frozen-suite snapshots. */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  Checkpoint,
  CheckpointKind,
  EvalRunResult,
  EvalTask,
  FrozenSuiteSnapshot,
} from "@nlc/shared";
import {
  toCheckpoint,
  toEvalRunResult,
  toEvalTask,
  toFrozenSuiteSnapshot,
  type CheckpointRow,
  type EvalRunRow,
  type EvalTaskRow,
  type FrozenSuiteSnapshotRow,
} from "../rows/evaluation-rows.js";

export class EvaluationStore {
  constructor(private readonly db: Database.Database) {}

  createCheckpoint(
    runId: string,
    taskNodeId: string | null,
    kind: CheckpointKind,
    state: string,
    progressReport: string,
  ): Checkpoint {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO checkpoints (id, run_id, task_node_id, kind, state_json, progress_report, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(id, runId, taskNodeId, kind, state, progressReport, now);
    return { id, runId, taskNodeId, kind, state, progressReport, createdAt: now };
  }

  latestCheckpoint(runId: string): Checkpoint | null {
    const row = this.db
      .prepare("SELECT * FROM checkpoints WHERE run_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(runId) as CheckpointRow | undefined;
    return row ? toCheckpoint(row) : null;
  }

  listCheckpoints(runId: string): Checkpoint[] {
    const rows = this.db
      .prepare("SELECT * FROM checkpoints WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as CheckpointRow[];
    return rows.map(toCheckpoint);
  }

  upsertEvalTask(input: Omit<EvalTask, "createdAt">): EvalTask {
    const now = Date.now();
    const existing = this.db
      .prepare("SELECT * FROM eval_tasks WHERE id = ?")
      .get(input.id) as EvalTaskRow | undefined;
    if (existing) {
      // Frozen tasks: only allow non-frozen->frozen promotion, no description changes.
      if (
        existing.frozen === 1 &&
        (existing.description !== input.description ||
          existing.verify_command !== input.verifyCommand)
      ) {
        throw new Error(`Cannot modify frozen eval task ${input.id}`);
      }
      this.db
        .prepare(
          "UPDATE eval_tasks SET level = ?, title = ?, description = ?, frozen = ?, verify_command = ?, expected_nodes = ? WHERE id = ?",
        )
        .run(
          input.level,
          input.title,
          input.description,
          input.frozen ? 1 : 0,
          input.verifyCommand,
          input.expectedNodes,
          input.id,
        );
      return { ...input, createdAt: existing.created_at };
    }
    this.db
      .prepare(
        `INSERT INTO eval_tasks (id, level, title, description, frozen, verify_command, expected_nodes, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.level,
        input.title,
        input.description,
        input.frozen ? 1 : 0,
        input.verifyCommand,
        input.expectedNodes,
        now,
      );
    return { ...input, createdAt: now };
  }

  listEvalTasks(opts: { frozenOnly?: boolean } = {}): EvalTask[] {
    const sql = opts.frozenOnly
      ? "SELECT * FROM eval_tasks WHERE frozen = 1 ORDER BY level, id"
      : "SELECT * FROM eval_tasks ORDER BY level, id";
    return (this.db.prepare(sql).all() as EvalTaskRow[]).map(toEvalTask);
  }

  recordEvalRun(input: Omit<EvalRunResult, "id" | "createdAt">): EvalRunResult {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO eval_runs (id, task_id, model_id, pass, corrections, transfer_hits, cost_usd, duration_ms, error_message, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.taskId,
        input.modelId,
        input.pass ? 1 : 0,
        input.corrections,
        input.transferHits,
        input.costUsd,
        input.durationMs,
        input.errorMessage,
        now,
      );
    return { ...input, id, createdAt: now };
  }

  listEvalRuns(taskId?: string, modelId?: string): EvalRunResult[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (taskId) {
      where.push("task_id = ?");
      params.push(taskId);
    }
    if (modelId) {
      where.push("model_id = ?");
      params.push(modelId);
    }
    const sql = `SELECT * FROM eval_runs${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC`;
    return (this.db.prepare(sql).all(...params) as EvalRunRow[]).map(toEvalRunResult);
  }

  recordFrozenSuiteSnapshot(snapshot: FrozenSuiteSnapshot): FrozenSuiteSnapshot {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO frozen_suite_snapshots
         (id, week_start_ts, pass_rate, corrections_per_task, transfer_hits, total_tasks, model_id)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(week_start_ts, model_id) DO UPDATE SET
           pass_rate = excluded.pass_rate,
           corrections_per_task = excluded.corrections_per_task,
           transfer_hits = excluded.transfer_hits,
           total_tasks = excluded.total_tasks`,
      )
      .run(
        id,
        snapshot.weekStartTs,
        snapshot.passRate,
        snapshot.correctionsPerTask,
        snapshot.transferHits,
        snapshot.totalTasks,
        snapshot.modelId,
      );
    return snapshot;
  }

  listFrozenSuiteSnapshots(modelId?: string): FrozenSuiteSnapshot[] {
    const sql = modelId
      ? "SELECT * FROM frozen_suite_snapshots WHERE model_id = ? ORDER BY week_start_ts ASC"
      : "SELECT * FROM frozen_suite_snapshots ORDER BY week_start_ts ASC";
    const params = modelId ? [modelId] : [];
    return (this.db.prepare(sql).all(...params) as FrozenSuiteSnapshotRow[]).map(
      toFrozenSuiteSnapshot,
    );
  }
}
