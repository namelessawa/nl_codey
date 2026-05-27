import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  AgentRun,
  AgentRunState,
  AgentStep,
  AgentStepType,
  FileSnapshot,
  SnapshotType,
  Workspace,
} from "@coding-agent/shared";
import { COLUMN_MIGRATIONS, SCHEMA_SQL } from "./schema.js";

type WorkspaceRow = { id: string; root_path: string; opened_at: number };
type RunRow = {
  id: string;
  workspace_id: string;
  user_task: string;
  status: string;
  created_at: number;
  updated_at: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  tool_call_count: number;
  iteration_count: number;
  model_name: string | null;
  exit_reason: string | null;
};
type StepRow = { id: string; run_id: string; type: string; content: string; created_at: number };
type SnapshotRow = {
  id: string;
  run_id: string;
  file_path: string;
  before_content: string;
  after_content: string | null;
  created_at: number;
  iteration: number;
  snapshot_type: string;
};

/** Incremental token/cost/iteration usage applied to a run. */
export type RunUsageDelta = {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  toolCalls?: number;
  iterations?: number;
};

/** Thin synchronous persistence layer over SQLite. Construction runs the schema. */
export class Storage {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);
    this.migrate();
  }

  /** Apply additive column migrations, ignoring already-present columns. */
  private migrate(): void {
    for (const stmt of COLUMN_MIGRATIONS) {
      try {
        this.db.exec(stmt);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/duplicate column name/i.test(message)) throw err;
      }
    }
  }

  close(): void {
    this.db.close();
  }

  // --- workspaces ---

  upsertWorkspace(rootPath: string): Workspace {
    const existing = this.db
      .prepare("SELECT * FROM workspaces WHERE root_path = ?")
      .get(rootPath) as WorkspaceRow | undefined;
    if (existing) {
      const openedAt = Date.now();
      this.db.prepare("UPDATE workspaces SET opened_at = ? WHERE id = ?").run(openedAt, existing.id);
      return { id: existing.id, rootPath: existing.root_path, openedAt };
    }
    const ws: Workspace = { id: randomUUID(), rootPath, openedAt: Date.now() };
    this.db
      .prepare("INSERT INTO workspaces (id, root_path, opened_at) VALUES (?, ?, ?)")
      .run(ws.id, ws.rootPath, ws.openedAt);
    return ws;
  }

  getWorkspace(id: string): Workspace | null {
    const row = this.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as
      | WorkspaceRow
      | undefined;
    return row ? { id: row.id, rootPath: row.root_path, openedAt: row.opened_at } : null;
  }

  /** Recently opened workspaces, most recently opened first. */
  listWorkspaces(limit = 10): Workspace[] {
    const rows = this.db
      .prepare("SELECT * FROM workspaces ORDER BY opened_at DESC LIMIT ?")
      .all(limit) as WorkspaceRow[];
    return rows.map((r) => ({ id: r.id, rootPath: r.root_path, openedAt: r.opened_at }));
  }

  // --- runs ---

  createRun(workspaceId: string, userTask: string): AgentRun {
    const now = Date.now();
    const run: AgentRun = {
      id: randomUUID(),
      workspaceId,
      userTask,
      status: "idle",
      createdAt: now,
      updatedAt: now,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      toolCallCount: 0,
      iterationCount: 0,
      modelName: null,
      exitReason: null,
    };
    this.db
      .prepare(
        "INSERT INTO agent_runs (id, workspace_id, user_task, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(run.id, run.workspaceId, run.userTask, run.status, run.createdAt, run.updatedAt);
    return run;
  }

  /** Atomically add token/cost/iteration usage to a run and bump updated_at. */
  addRunUsage(runId: string, delta: RunUsageDelta): AgentRun {
    this.db
      .prepare(
        `UPDATE agent_runs SET
           input_tokens = input_tokens + ?,
           output_tokens = output_tokens + ?,
           cost_usd = cost_usd + ?,
           tool_call_count = tool_call_count + ?,
           iteration_count = iteration_count + ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        delta.inputTokens ?? 0,
        delta.outputTokens ?? 0,
        delta.costUsd ?? 0,
        delta.toolCalls ?? 0,
        delta.iterations ?? 0,
        Date.now(),
        runId,
      );
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }

  setRunModel(runId: string, modelName: string): void {
    this.db.prepare("UPDATE agent_runs SET model_name = ? WHERE id = ?").run(modelName, runId);
  }

  setRunExitReason(runId: string, exitReason: string): void {
    this.db.prepare("UPDATE agent_runs SET exit_reason = ? WHERE id = ?").run(exitReason, runId);
  }

  updateRunStatus(runId: string, status: AgentRunState): AgentRun {
    const updatedAt = Date.now();
    this.db
      .prepare("UPDATE agent_runs SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, updatedAt, runId);
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }

  getRun(runId: string): AgentRun | null {
    const row = this.db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId) as
      | RunRow
      | undefined;
    return row ? toRun(row) : null;
  }

  listRuns(workspaceId: string): AgentRun[] {
    const rows = this.db
      .prepare("SELECT * FROM agent_runs WHERE workspace_id = ? ORDER BY created_at DESC")
      .all(workspaceId) as RunRow[];
    return rows.map(toRun);
  }

  // --- steps ---

  addStep(runId: string, type: AgentStepType, content: string): AgentStep {
    const step: AgentStep = {
      id: randomUUID(),
      runId,
      type,
      content,
      createdAt: Date.now(),
    };
    this.db
      .prepare("INSERT INTO agent_steps (id, run_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(step.id, step.runId, step.type, step.content, step.createdAt);
    return step;
  }

  listSteps(runId: string): AgentStep[] {
    const rows = this.db
      .prepare("SELECT * FROM agent_steps WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as StepRow[];
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      type: r.type as AgentStepType,
      content: r.content,
      createdAt: r.created_at,
    }));
  }

  // --- snapshots ---

  addSnapshot(
    runId: string,
    filePath: string,
    beforeContent: string,
    iteration = 0,
    snapshotType: SnapshotType = "before_run",
  ): FileSnapshot {
    const snap: FileSnapshot = {
      id: randomUUID(),
      runId,
      filePath,
      beforeContent,
      createdAt: Date.now(),
      iteration,
      snapshotType,
    };
    this.db
      .prepare(
        "INSERT INTO file_snapshots (id, run_id, file_path, before_content, after_content, created_at, iteration, snapshot_type) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)",
      )
      .run(snap.id, snap.runId, snap.filePath, snap.beforeContent, snap.createdAt, iteration, snapshotType);
    return snap;
  }

  setSnapshotAfter(snapshotId: string, afterContent: string): void {
    this.db
      .prepare("UPDATE file_snapshots SET after_content = ? WHERE id = ?")
      .run(afterContent, snapshotId);
  }

  listSnapshots(runId: string): FileSnapshot[] {
    const rows = this.db
      .prepare("SELECT * FROM file_snapshots WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as SnapshotRow[];
    return rows.map(toSnapshot);
  }

  /** Snapshots of a given type, oldest first. Used by rollback strategies. */
  listSnapshotsByType(runId: string, snapshotType: SnapshotType): FileSnapshot[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM file_snapshots WHERE run_id = ? AND snapshot_type = ? ORDER BY created_at ASC",
      )
      .all(runId, snapshotType) as SnapshotRow[];
    return rows.map(toSnapshot);
  }

  /** Snapshots taken before a specific repair iteration, oldest first. */
  listSnapshotsByIteration(runId: string, iteration: number): FileSnapshot[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM file_snapshots WHERE run_id = ? AND iteration = ? ORDER BY created_at ASC",
      )
      .all(runId, iteration) as SnapshotRow[];
    return rows.map(toSnapshot);
  }
}

function toRun(row: RunRow): AgentRun {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userTask: row.user_task,
    status: row.status as AgentRunState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    toolCallCount: row.tool_call_count,
    iterationCount: row.iteration_count,
    modelName: row.model_name,
    exitReason: row.exit_reason,
  };
}

function toSnapshot(r: SnapshotRow): FileSnapshot {
  return {
    id: r.id,
    runId: r.run_id,
    filePath: r.file_path,
    beforeContent: r.before_content,
    ...(r.after_content !== null ? { afterContent: r.after_content } : {}),
    createdAt: r.created_at,
    iteration: r.iteration,
    snapshotType: r.snapshot_type as SnapshotType,
  };
}
