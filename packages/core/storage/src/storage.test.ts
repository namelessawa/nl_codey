import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { Storage, StorageMigrationError } from "./storage.js";
import { SCHEMA_SQL } from "./schema.js";

function migrationBackups(dbPath: string): string[] {
  const dir = path.dirname(dbPath);
  const prefix = `${path.basename(dbPath)}.pre-migration-`;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".sqlite"))
    .map((name) => path.join(dir, name));
}

describe("Storage", () => {
  const tempDbPaths: string[] = [];

  afterEach(() => {
    for (const p of tempDbPaths.splice(0)) {
      for (const backup of migrationBackups(p)) {
        try {
          fs.rmSync(backup);
        } catch {
          // best-effort cleanup
        }
      }
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          fs.rmSync(`${p}${suffix}`);
        } catch {
          // best-effort cleanup
        }
      }
    }
  });

  it("initializes an in-memory db and is safe to re-run schema", () => {
    const storage = new Storage(":memory:");
    // Re-running the schema must not throw (idempotent CREATE TABLE IF NOT EXISTS).
    expect(() => new Storage(":memory:")).not.toThrow();
    expect(SCHEMA_SQL).toContain("IF NOT EXISTS");
    storage.close();
  });

  it("does not create migration backups for fresh or current-schema files", () => {
    const dbPath = path.join(
      os.tmpdir(),
      `coding-agent-current-${randomUUID()}.db`,
    );
    tempDbPaths.push(dbPath);

    const fresh = new Storage(dbPath);
    fresh.close();
    expect(migrationBackups(dbPath)).toEqual([]);

    const current = new Storage(dbPath);
    current.close();
    expect(migrationBackups(dbPath)).toEqual([]);
  });

  it("rejects a newer schema without mutating or backing up the file", () => {
    const dbPath = path.join(
      os.tmpdir(),
      `coding-agent-future-${randomUUID()}.db`,
    );
    tempDbPaths.push(dbPath);
    const future = new Database(dbPath);
    future.exec(`
      CREATE TABLE schema_meta (
        id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE future_marker (value TEXT NOT NULL);
      INSERT INTO schema_meta VALUES (1, 999, 1);
      INSERT INTO future_marker VALUES ('untouched');
    `);
    future.close();

    expect(() => new Storage(dbPath)).toThrow(/newer than supported/i);
    expect(migrationBackups(dbPath)).toEqual([]);
    const unchanged = new Database(dbPath, { readonly: true });
    expect(unchanged.prepare("SELECT value FROM future_marker").get()).toEqual({
      value: "untouched",
    });
    unchanged.close();
  });

  it("upgrades a pre-Phase-2 db whose file_snapshots lacks the iteration column", () => {
    // Arrange: a legacy DB created before the `iteration` column existed. The
    // index idx_snapshots_run_iter references that column, so it must only be
    // created after COLUMN_MIGRATIONS adds it — otherwise construction throws
    // "no such column: iteration".
    const dbPath = path.join(os.tmpdir(), `coding-agent-legacy-${randomUUID()}.db`);
    tempDbPaths.push(dbPath);
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        opened_at INTEGER NOT NULL
      );
      CREATE TABLE file_snapshots (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        before_content TEXT NOT NULL,
        after_content TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_task TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO workspaces VALUES ('ws-legacy', 'C:/legacy', 10);
      INSERT INTO agent_runs
        VALUES ('run-legacy', 'ws-legacy', 'legacy task', 'idle', 10, 10);
      INSERT INTO file_snapshots
        VALUES ('snapshot-legacy', 'run-legacy', 'old.txt', 'before', 'after', 10);
    `);
    legacy.close();

    const storage = new Storage(dbPath);
    expect(storage.listSnapshots("run-legacy")).toMatchObject([
      {
        id: "snapshot-legacy",
        filePath: "old.txt",
        beforeContent: "before",
        beforeExisted: true,
        afterContent: "after",
        iteration: 0,
      },
    ]);
    storage.close();
    const migrated = new Database(dbPath, { readonly: true });
    expect(
      migrated.prepare("SELECT version FROM schema_meta WHERE id = 1").get(),
    ).toEqual({ version: 2 });
    expect(
      (
        migrated.prepare("PRAGMA table_info(file_snapshots)").all() as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    ).toEqual(
      expect.arrayContaining([
        "iteration",
        "snapshot_type",
        "before_existed",
        "after_existed",
      ]),
    );
    expect(
      migrated
        .prepare("PRAGMA foreign_key_list(file_snapshots)")
        .all(),
    ).toEqual([
      expect.objectContaining({
        table: "agent_runs",
        from: "run_id",
        on_delete: "CASCADE",
      }),
    ]);
    migrated.close();

    const [backup] = migrationBackups(dbPath);
    expect(backup).toBeTruthy();
    const original = new Database(backup!, { readonly: true });
    const legacyColumns = original
      .prepare("PRAGMA table_info(file_snapshots)")
      .all() as Array<{ name: string }>;
    expect(legacyColumns.map((column) => column.name)).not.toContain("iteration");
    expect(
      original.prepare("SELECT before_content FROM file_snapshots").get(),
    ).toEqual({ before_content: "before" });
    expect(original.pragma("quick_check", { simple: true })).toBe("ok");
    original.close();
  });

  it("closes a failed upgrade and preserves a readable pre-migration backup", () => {
    const dbPath = path.join(
      os.tmpdir(),
      `coding-agent-failed-migration-${randomUUID()}.db`,
    );
    tempDbPaths.push(dbPath);
    const malformed = new Database(dbPath);
    malformed.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL
      );
      INSERT INTO workspaces VALUES ('ws-before-failure', 'C:/recover-me');
    `);
    malformed.close();

    let caught: unknown;
    try {
      new Storage(dbPath);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(StorageMigrationError);
    const [backup] = migrationBackups(dbPath);
    expect((caught as StorageMigrationError).backupPath).toBe(backup);
    const recovery = new Database(backup!, { readonly: true });
    expect(recovery.pragma("quick_check", { simple: true })).toBe("ok");
    expect(recovery.prepare("SELECT * FROM workspaces").get()).toEqual({
      id: "ws-before-failure",
      root_path: "C:/recover-me",
    });
    recovery.close();

    // Constructor failure must release the source handle so support tooling can
    // inspect or move the failed database immediately.
    const failedSource = new Database(dbPath, { readonly: true });
    expect(failedSource.pragma("quick_check", { simple: true })).toBe("ok");
    failedSource.close();
  });

  it("persists a full run lifecycle: workspace -> run -> steps -> snapshot", () => {
    const storage = new Storage(":memory:");
    const ws = storage.upsertWorkspace("C:/projects/demo");
    expect(ws.id).toBeTruthy();

    // upsert on the same path returns the same workspace id
    const ws2 = storage.upsertWorkspace("C:/projects/demo");
    expect(ws2.id).toBe(ws.id);

    const run = storage.createRun(ws.id, "fix the build");
    expect(run.status).toBe("idle");

    storage.updateRunStatus(run.id, "planning");
    expect(storage.getRun(run.id)?.status).toBe("planning");

    storage.addStep(run.id, "message", "starting");
    storage.addStep(run.id, "tool_call", "list_files");
    expect(storage.listSteps(run.id)).toHaveLength(2);

    const snap = storage.addSnapshot(run.id, "src/a.ts", "before", {
      beforeExisted: true,
    });
    storage.setSnapshotAfter(snap.id, "after");
    const snaps = storage.listSnapshots(run.id);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({
      beforeExisted: true,
      afterContent: "after",
      afterExisted: true,
    });

    expect(storage.listRuns(ws.id)).toHaveLength(1);
    storage.close();
  });

  it("remembers opened workspaces and respects the limit", () => {
    const storage = new Storage(":memory:");
    storage.upsertWorkspace("C:/projects/alpha");
    storage.upsertWorkspace("C:/projects/beta");
    // Re-opening an existing path must not create a duplicate entry.
    storage.upsertWorkspace("C:/projects/alpha");

    const recents = storage.listWorkspaces();
    expect(recents).toHaveLength(2);
    expect(recents.map((w) => w.rootPath).sort()).toEqual([
      "C:/projects/alpha",
      "C:/projects/beta",
    ]);

    expect(storage.listWorkspaces(1)).toHaveLength(1);
    storage.close();
  });

  it("redacts and bounds persisted error/command steps without rewriting messages", () => {
    const storage = new Storage(":memory:");
    const workspace = storage.upsertWorkspace("E:\\workspace");
    const run = storage.createRun(workspace.id, "redaction");
    const secret =
      "Authorization: Bearer sqlite-secret\nC:\\Users\\alice\\.ssh\\id_rsa " +
      "x".repeat(5_000);

    const error = storage.addStep(run.id, "error", secret);
    const command = storage.addStep(run.id, "command", secret);
    const message = storage.addStep(run.id, "message", secret);
    const persisted = storage.listSteps(run.id);
    const persistedError = persisted.find((step) => step.type === "error")!;
    const persistedCommand = persisted.find((step) => step.type === "command")!;
    const persistedMessage = persisted.find((step) => step.type === "message")!;

    for (const step of [error, command, persistedError, persistedCommand]) {
      expect(step.content).toContain("[REDACTED]");
      expect(step.content).toContain("[USER_HOME]");
      expect(step.content).not.toMatch(/sqlite-secret|alice/);
      expect(step.content.length).toBeLessThanOrEqual(4_000);
    }
    expect(message.content).toBe(secret);
    expect(persistedMessage.content).toBe(secret);
    storage.close();
  });

  it("redacts evaluation and fine-tune failures before advanced-store persistence", () => {
    const storage = new Storage(":memory:");
    const secret =
      "Authorization: Bearer advanced-secret\n" +
      "C:\\Users\\alice\\.cache?token=query-secret " +
      "x".repeat(5_000);
    storage.evaluation.upsertEvalTask({
      id: "eval-redaction",
      level: "L1",
      title: "redaction",
      description: "safe fixture",
      frozen: false,
      verifyCommand: "pnpm test",
      expectedNodes: 1,
    });

    const evaluation = storage.evaluation.recordEvalRun({
      taskId: "eval-redaction",
      modelId: "model-1",
      pass: false,
      corrections: 0,
      transferHits: 0,
      costUsd: 0,
      durationMs: 1,
      errorMessage: secret,
    });
    const job = storage.finetune.createFinetuneJob({
      name: "redaction",
      baseModel: "base",
      datasetId: "dataset",
      method: "lora",
    });
    const failed = storage.finetune.updateFinetuneJob(job.id, {
      status: "failed",
      evalResult: {
        baselineScore: 0,
        candidateScore: 0,
        delta: 0,
        perTaskRegressions: [],
        holdoutScore: 0,
        holdoutBaselineScore: 0,
        gatePassed: false,
        gateReasons: [secret],
      },
    })!;
    const values = [
      evaluation.errorMessage!,
      storage.evaluation.listEvalRuns()[0]!.errorMessage!,
      failed.evalResult!.gateReasons[0]!,
      storage.finetune.getFinetuneJob(job.id)!.evalResult!.gateReasons[0]!,
    ];

    for (const value of values) {
      expect(value).toContain("[REDACTED]");
      expect(value).toContain("[USER_HOME]");
      expect(value).not.toMatch(/advanced-secret|query-secret|alice/);
      expect(value.length).toBeLessThanOrEqual(4_000);
    }
    storage.close();
  });

  it("[recovery] marks dead and legacy owners once without replaying writes", () => {
    const storage = new Storage(":memory:");
    const workspaceRoot = path.join(
      os.tmpdir(),
      `nlc-recovery-workspace-${randomUUID()}`,
    );
    const untouchedPath = path.join(workspaceRoot, "never-created.txt");
    const ws = storage.upsertWorkspace(workspaceRoot);

    const dead = storage.createRun(ws.id, "dead owner", {
      sessionId: "ses_dead",
      sessionFilePath: path.join(workspaceRoot, "ses_dead.json"),
      runtimeInstanceId: "instance-dead",
      ownerPid: 999_999,
    });
    storage.updateRunStatus(dead.id, "waiting_for_user_approval");
    storage.addSnapshot(dead.id, "never-created.txt", "original bytes");

    const live = storage.createRun(ws.id, "live peer", {
      runtimeInstanceId: "instance-live",
      ownerPid: 4_242,
    });
    storage.updateRunStatus(live.id, "applying_patch");

    const terminal = storage.createRun(ws.id, "already done", {
      ownerPid: 999_998,
    });
    storage.updateRunStatus(terminal.id, "done");

    const legacy = storage.createRun(ws.id, "legacy owner");
    storage.updateRunStatus(legacy.id, "tool_use");

    const recovered = storage.reconcileInterruptedRuns({
      currentPid: 1_234,
      legacyGraceMs: 0,
      isProcessAlive: (pid) => pid === 4_242,
    });

    expect(recovered.map((item) => item.runId).sort()).toEqual(
      [dead.id, legacy.id].sort(),
    );
    expect(storage.getRun(dead.id)).toMatchObject({
      status: "failed",
      exitReason: "interrupted_restart",
      sessionId: "ses_dead",
      runtimeInstanceId: "instance-dead",
      ownerPid: 999_999,
    });
    expect(storage.getRun(live.id)?.status).toBe("applying_patch");
    expect(storage.getRun(terminal.id)?.status).toBe("done");
    expect(storage.listRunsForSession("ses_dead").map((run) => run.id)).toEqual([
      dead.id,
    ]);
    expect(storage.listSnapshots(dead.id)).toMatchObject([
      { filePath: "never-created.txt", beforeContent: "original bytes" },
    ]);
    expect(fs.existsSync(untouchedPath)).toBe(false);
    expect(
      storage
        .listSteps(dead.id)
        .filter((step) => step.content.includes("No tool or workspace write was replayed")),
    ).toHaveLength(1);

    expect(
      storage.reconcileInterruptedRuns({
        currentPid: 1_234,
        legacyGraceMs: 0,
        isProcessAlive: (pid) => pid === 4_242,
      }),
    ).toEqual([]);
    expect(
      storage
        .listSteps(dead.id)
        .filter((step) => step.content.includes("No tool or workspace write was replayed")),
    ).toHaveLength(1);
    storage.close();
  });
});
