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
  Workspace,
} from "@coding-agent/shared";
import { SCHEMA_SQL } from "./schema.js";

type WorkspaceRow = { id: string; root_path: string; opened_at: number };
type RunRow = {
  id: string;
  workspace_id: string;
  user_task: string;
  status: string;
  created_at: number;
  updated_at: number;
};
type StepRow = { id: string; run_id: string; type: string; content: string; created_at: number };
type SnapshotRow = {
  id: string;
  run_id: string;
  file_path: string;
  before_content: string;
  after_content: string | null;
  created_at: number;
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
    };
    this.db
      .prepare(
        "INSERT INTO agent_runs (id, workspace_id, user_task, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(run.id, run.workspaceId, run.userTask, run.status, run.createdAt, run.updatedAt);
    return run;
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

  addSnapshot(runId: string, filePath: string, beforeContent: string): FileSnapshot {
    const snap: FileSnapshot = {
      id: randomUUID(),
      runId,
      filePath,
      beforeContent,
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        "INSERT INTO file_snapshots (id, run_id, file_path, before_content, after_content, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
      )
      .run(snap.id, snap.runId, snap.filePath, snap.beforeContent, snap.createdAt);
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
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      filePath: r.file_path,
      beforeContent: r.before_content,
      ...(r.after_content !== null ? { afterContent: r.after_content } : {}),
      createdAt: r.created_at,
    }));
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
  };
}
