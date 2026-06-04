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
  GitAction,
  GitActionKind,
  IndexedChunk,
  LLMMessage,
  MemoryEntry,
  MemoryEntryInput,
  MemoryEntryPatch,
  MemoryFilter,
  MemoryKind,
  RoleMessageRow,
  SnapshotType,
  TaskNode,
  TaskNodePatch,
  TaskNodeStatus,
  Workspace,
} from "@coding-agent/shared";
import {
  COLUMN_MIGRATIONS,
  INDEX_SQL,
  SCHEMA_SQL,
  SCHEMA_VERSION,
  STRUCTURAL_MIGRATIONS,
} from "./schema.js";
import {
  chunkFromRow,
  chunkToBlob,
  embeddingToBlob,
  memoryEmbedding,
  type ChunkRow,
  type GitActionRow,
  type MemoryRow,
  type RoleMessageDbRow,
  type TaskNodeRow,
  toGitAction,
  toMemoryEntry,
  toRoleMessageRow,
  toTaskNode,
} from "./phase3-rows.js";
import { Phase4Storage } from "./phase4-store.js";

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
  /** Phase 4 sub-facade. Lazily created on first access. */
  private phase4Cache: Phase4Storage | null = null;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    // Detect whether this is a fresh DB (no `workspaces` table yet) BEFORE
    // we run SCHEMA_SQL, so we can stamp schema_meta straight to the latest
    // version on first install instead of pretending it's a v1 legacy DB
    // that needs the structural rewrite.
    const isFreshDb = !this.hasTable("workspaces");
    // Order matters: create tables, then add columns to pre-existing tables,
    // then run structural-version migrations, then create indexes. The
    // structural migrations rebuild constrained tables (FK CASCADEs), which
    // must wait for any additive columns from COLUMN_MIGRATIONS so the rebuild
    // copies the full row shape; indexes have to come last because some
    // reference columns added by either migration step.
    this.db.exec(SCHEMA_SQL);
    this.migrate();
    this.applyStructuralMigrations(isFreshDb);
    this.db.exec(INDEX_SQL);
  }

  /** Phase 4 storage facade. Same underlying DB; safe to use freely. */
  get phase4(): Phase4Storage {
    if (!this.phase4Cache) this.phase4Cache = new Phase4Storage(this.db);
    return this.phase4Cache;
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

  /** True when the named table exists in the connected database. */
  private hasTable(name: string): boolean {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name) as { name: string } | undefined;
    return row !== undefined;
  }

  /** Read the on-disk schema version, defaulting to 1 for legacy installs. */
  private readSchemaVersion(): number {
    const row = this.db
      .prepare("SELECT version FROM schema_meta WHERE id = 1")
      .get() as { version: number } | undefined;
    return row?.version ?? 1;
  }

  /** Idempotent upsert of the schema_meta singleton row. */
  private writeSchemaVersion(version: number): void {
    this.db
      .prepare(
        "INSERT INTO schema_meta (id, version, updated_at) VALUES (1, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at",
      )
      .run(version, Date.now());
  }

  /**
   * Run every {@link STRUCTURAL_MIGRATIONS} entry whose `toVersion` is newer
   * than the recorded on-disk version, in order. Each migration runs inside
   * a transaction with `foreign_keys = OFF` so the table-rebuild dance
   * (create temp → copy rows → drop original → rename) doesn't trip the FK
   * rule against the partially-rewritten state. The version stamp is written
   * AFTER the transaction commits; a crash mid-migration re-runs the same
   * step on next startup.
   */
  private applyStructuralMigrations(isFreshDb: boolean): void {
    if (isFreshDb) {
      // Brand-new DB: schema_meta is empty, tables are already at the latest
      // shape via SCHEMA_SQL. Stamp the version directly.
      this.writeSchemaVersion(SCHEMA_VERSION);
      return;
    }
    let current = this.readSchemaVersion();
    if (current >= SCHEMA_VERSION) return;
    for (const migration of STRUCTURAL_MIGRATIONS) {
      if (migration.toVersion <= current) continue;
      this.db.pragma("foreign_keys = OFF");
      try {
        const tx = this.db.transaction(() => {
          for (const step of migration.steps) this.db.exec(step);
        });
        tx();
      } finally {
        this.db.pragma("foreign_keys = ON");
      }
      current = migration.toVersion;
      this.writeSchemaVersion(current);
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

  /**
   * Delete every run for a workspace plus its cascading steps and file
   * snapshots. Returns the number of runs removed. Runs are also returned so
   * callers can purge in-memory state (controllers, approvals, baselines).
   */
  deleteRunsForWorkspace(workspaceId: string): { deleted: number; runIds: string[] } {
    const rows = this.db
      .prepare("SELECT id FROM agent_runs WHERE workspace_id = ?")
      .all(workspaceId) as { id: string }[];
    const runIds = rows.map((r) => r.id);
    if (runIds.length === 0) return { deleted: 0, runIds: [] };
    const tx = this.db.transaction((ids: string[]) => {
      const stepStmt = this.db.prepare("DELETE FROM agent_steps WHERE run_id = ?");
      const msgStmt = this.db.prepare("DELETE FROM agent_run_messages WHERE run_id = ?");
      const snapStmt = this.db.prepare("DELETE FROM file_snapshots WHERE run_id = ?");
      const runStmt = this.db.prepare("DELETE FROM agent_runs WHERE id = ?");
      for (const id of ids) {
        stepStmt.run(id);
        msgStmt.run(id);
        snapStmt.run(id);
        runStmt.run(id);
      }
    });
    tx(runIds);
    return { deleted: runIds.length, runIds };
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

  // --- run conversation (multi-turn) ---

  /**
   * Replace the persisted LLM conversation for a run with `messages`. Stored as
   * one JSON-encoded row per LLMMessage, ordered by seq. Called at the end of
   * each driveLoop turn so continueTask() can resume with the full history
   * (including tool_call / tool result pairs that the user-facing step log
   * doesn't capture verbatim).
   */
  saveRunMessages(runId: string, messages: readonly LLMMessage[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM agent_run_messages WHERE run_id = ?").run(runId);
      const ins = this.db.prepare(
        "INSERT INTO agent_run_messages (id, run_id, seq, message_json, created_at) VALUES (?, ?, ?, ?, ?)",
      );
      const now = Date.now();
      messages.forEach((msg, i) => {
        ins.run(randomUUID(), runId, i, JSON.stringify(msg), now);
      });
    });
    tx();
  }

  /** Load the persisted conversation in seq order. Empty if never saved. */
  loadRunMessages(runId: string): LLMMessage[] {
    const rows = this.db
      .prepare("SELECT message_json FROM agent_run_messages WHERE run_id = ? ORDER BY seq ASC")
      .all(runId) as { message_json: string }[];
    return rows.map((r) => JSON.parse(r.message_json) as LLMMessage);
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

  // --- Phase 3: memory ---

  createMemory(workspaceId: string, input: MemoryEntryInput, embedding?: number[]): MemoryEntry {
    const entry: MemoryEntry = {
      id: randomUUID(),
      workspaceId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      tags: input.tags ?? [],
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      createdAt: Date.now(),
      usefulness: 0,
    };
    this.db
      .prepare(
        "INSERT INTO memory_entries (id, workspace_id, kind, title, body, tags, source_run_id, embedding, created_at, last_used_at, usefulness) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)",
      )
      .run(
        entry.id,
        entry.workspaceId,
        entry.kind,
        entry.title,
        entry.body,
        JSON.stringify(entry.tags),
        entry.sourceRunId ?? null,
        embedding ? embeddingToBlob(embedding) : null,
        entry.createdAt,
      );
    return entry;
  }

  listMemory(workspaceId: string, filter?: MemoryFilter): MemoryEntry[] {
    const clauses = ["workspace_id = ?"];
    const params: (string | number)[] = [workspaceId];
    if (filter?.kind) {
      clauses.push("kind = ?");
      params.push(filter.kind);
    }
    if (!filter?.includeHidden) {
      clauses.push("usefulness > -3");
    }
    if (filter?.search) {
      clauses.push("(title LIKE ? OR body LIKE ?)");
      const like = `%${filter.search}%`;
      params.push(like, like);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM memory_entries WHERE ${clauses.join(" AND ")} ORDER BY usefulness DESC, created_at DESC`,
      )
      .all(...params) as MemoryRow[];
    const entries = rows.map(toMemoryEntry);
    if (filter?.tags && filter.tags.length > 0) {
      const wanted = new Set(filter.tags);
      return entries.filter((e) => e.tags.some((t) => wanted.has(t)));
    }
    return entries;
  }

  /** All entries with their embeddings, for similarity retrieval. */
  listMemoryWithEmbeddings(
    workspaceId: string,
  ): { entry: MemoryEntry; embedding: number[] | null }[] {
    const rows = this.db
      .prepare("SELECT * FROM memory_entries WHERE workspace_id = ? AND usefulness > -3")
      .all(workspaceId) as MemoryRow[];
    return rows.map((r) => ({ entry: toMemoryEntry(r), embedding: memoryEmbedding(r) }));
  }

  getMemory(id: string): MemoryEntry | null {
    const row = this.db.prepare("SELECT * FROM memory_entries WHERE id = ?").get(id) as
      | MemoryRow
      | undefined;
    return row ? toMemoryEntry(row) : null;
  }

  updateMemory(id: string, patch: MemoryEntryPatch): MemoryEntry | null {
    const existing = this.getMemory(id);
    if (!existing) return null;
    const merged: MemoryEntry = {
      ...existing,
      ...patch,
      tags: patch.tags ?? existing.tags,
    };
    this.db
      .prepare(
        "UPDATE memory_entries SET kind = ?, title = ?, body = ?, tags = ?, last_used_at = ?, usefulness = ? WHERE id = ?",
      )
      .run(
        merged.kind,
        merged.title,
        merged.body,
        JSON.stringify(merged.tags),
        merged.lastUsedAt ?? null,
        merged.usefulness,
        id,
      );
    return merged;
  }

  /** Bump usefulness and refresh lastUsedAt when an entry is referenced. */
  touchMemory(id: string, delta = 1): void {
    this.db
      .prepare("UPDATE memory_entries SET usefulness = usefulness + ?, last_used_at = ? WHERE id = ?")
      .run(delta, Date.now(), id);
  }

  deleteMemory(id: string): boolean {
    const info = this.db.prepare("DELETE FROM memory_entries WHERE id = ?").run(id);
    return info.changes > 0;
  }

  // --- Phase 3: semantic chunks ---

  replaceChunksForFile(workspaceId: string, filePath: string, chunks: IndexedChunk[], mtime: number): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM semantic_chunks WHERE workspace_id = ? AND file_path = ?")
        .run(workspaceId, filePath);
      const insert = this.db.prepare(
        "INSERT INTO semantic_chunks (id, workspace_id, file_path, start_line, end_line, kind, content, symbol_name, embedding, file_mtime, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      const now = Date.now();
      for (const c of chunks) {
        insert.run(
          c.id,
          workspaceId,
          c.filePath,
          c.startLine,
          c.endLine,
          c.kind,
          c.content,
          c.symbolName ?? null,
          chunkToBlob(c.embedding),
          mtime,
          now,
        );
      }
    });
    tx();
  }

  deleteChunksForFile(workspaceId: string, filePath: string): void {
    this.db
      .prepare("DELETE FROM semantic_chunks WHERE workspace_id = ? AND file_path = ?")
      .run(workspaceId, filePath);
  }

  listChunks(workspaceId: string): IndexedChunk[] {
    const rows = this.db
      .prepare("SELECT * FROM semantic_chunks WHERE workspace_id = ?")
      .all(workspaceId) as ChunkRow[];
    return rows.map(chunkFromRow);
  }

  /** Map of filePath -> stored mtime, for incremental reindex decisions. */
  getIndexedFileMtimes(workspaceId: string): Map<string, number> {
    const rows = this.db
      .prepare(
        "SELECT file_path, MAX(file_mtime) AS file_mtime FROM semantic_chunks WHERE workspace_id = ? GROUP BY file_path",
      )
      .all(workspaceId) as { file_path: string; file_mtime: number }[];
    return new Map(rows.map((r) => [r.file_path, r.file_mtime]));
  }

  countChunks(workspaceId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM semantic_chunks WHERE workspace_id = ?")
      .get(workspaceId) as { n: number };
    return row.n;
  }

  // --- Phase 3: task nodes ---

  createTaskNode(node: TaskNode): TaskNode {
    this.db
      .prepare(
        "INSERT INTO task_nodes (id, parent_run_id, title, description, status, depends_on, verify_command, files_scope, sub_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        node.id,
        node.parentRunId,
        node.title,
        node.description,
        node.status,
        JSON.stringify(node.dependsOn),
        node.verifyCommand ?? null,
        node.filesScope ? JSON.stringify(node.filesScope) : null,
        node.subRunId ?? null,
        node.createdAt,
        node.updatedAt,
      );
    return node;
  }

  listTaskNodes(parentRunId: string): TaskNode[] {
    const rows = this.db
      .prepare("SELECT * FROM task_nodes WHERE parent_run_id = ? ORDER BY created_at ASC")
      .all(parentRunId) as TaskNodeRow[];
    return rows.map(toTaskNode);
  }

  getTaskNode(id: string): TaskNode | null {
    const row = this.db.prepare("SELECT * FROM task_nodes WHERE id = ?").get(id) as
      | TaskNodeRow
      | undefined;
    return row ? toTaskNode(row) : null;
  }

  updateTaskNode(id: string, patch: TaskNodePatch): TaskNode | null {
    const existing = this.getTaskNode(id);
    if (!existing) return null;
    const merged: TaskNode = { ...existing, ...patch, updatedAt: Date.now() };
    this.db
      .prepare(
        "UPDATE task_nodes SET title = ?, description = ?, status = ?, depends_on = ?, verify_command = ?, files_scope = ?, sub_run_id = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        merged.title,
        merged.description,
        merged.status,
        JSON.stringify(merged.dependsOn),
        merged.verifyCommand ?? null,
        merged.filesScope ? JSON.stringify(merged.filesScope) : null,
        merged.subRunId ?? null,
        merged.updatedAt,
        id,
      );
    return merged;
  }

  setTaskNodeStatus(id: string, status: TaskNodeStatus): void {
    this.db
      .prepare("UPDATE task_nodes SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, Date.now(), id);
  }

  // --- Phase 3: role messages ---

  addRoleMessage(row: RoleMessageRow): void {
    this.db
      .prepare(
        "INSERT INTO role_messages (id, task_node_id, from_role, to_role, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(row.id, row.taskNodeId, row.fromRole, row.toRole, row.kind, row.payload, row.createdAt);
  }

  listRoleMessages(taskNodeId: string): RoleMessageRow[] {
    const rows = this.db
      .prepare("SELECT * FROM role_messages WHERE task_node_id = ? ORDER BY created_at ASC")
      .all(taskNodeId) as RoleMessageDbRow[];
    return rows.map(toRoleMessageRow);
  }

  /**
   * All role messages for every task node belonging to a run, time-ordered.
   * This is the only way the UI's role-timeline can show a Planner →
   * Coder → Reviewer trace without first walking the task tree itself:
   * messages live per-node, but the UI groups them per-run.
   */
  listRoleMessagesForRun(runId: string): RoleMessageRow[] {
    const rows = this.db
      .prepare(
        `SELECT rm.* FROM role_messages rm
         JOIN task_nodes tn ON tn.id = rm.task_node_id
         WHERE tn.parent_run_id = ?
         ORDER BY rm.created_at ASC`,
      )
      .all(runId) as RoleMessageDbRow[];
    return rows.map(toRoleMessageRow);
  }

  // --- Phase 3: git actions ---

  addGitAction(runId: string, action: GitActionKind, ref?: string, payload?: string): GitAction {
    const entry: GitAction = {
      id: randomUUID(),
      runId,
      action,
      ...(ref ? { ref } : {}),
      ...(payload ? { payload } : {}),
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        "INSERT INTO git_actions (id, run_id, action, ref, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(entry.id, entry.runId, entry.action, ref ?? null, payload ?? null, entry.createdAt);
    return entry;
  }

  listGitActions(runId: string): GitAction[] {
    const rows = this.db
      .prepare("SELECT * FROM git_actions WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as GitActionRow[];
    return rows.map(toGitAction);
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
