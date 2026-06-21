import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { Storage } from "./storage.js";
import { SCHEMA_SQL } from "./schema.js";

describe("Storage", () => {
  const tempDbPaths: string[] = [];

  afterEach(() => {
    for (const p of tempDbPaths.splice(0)) {
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

  it("upgrades a pre-Phase-2 db whose file_snapshots lacks the iteration column", () => {
    // Arrange: a legacy DB created before the `iteration` column existed. The
    // index idx_snapshots_run_iter references that column, so it must only be
    // created after COLUMN_MIGRATIONS adds it — otherwise construction throws
    // "no such column: iteration".
    const dbPath = path.join(os.tmpdir(), `coding-agent-legacy-${randomUUID()}.db`);
    tempDbPaths.push(dbPath);
    const legacy = new Database(dbPath);
    legacy.exec(`
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
    `);
    legacy.close();

    // Act + Assert: opening the legacy DB must migrate cleanly.
    expect(() => {
      const storage = new Storage(dbPath);
      storage.close();
    }).not.toThrow();
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

    const snap = storage.addSnapshot(run.id, "src/a.ts", "before");
    storage.setSnapshotAfter(snap.id, "after");
    const snaps = storage.listSnapshots(run.id);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.afterContent).toBe("after");

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
});
