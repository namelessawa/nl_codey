import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@nlc/shared";
import { Storage } from "@nlc/storage";
import { writeFileTool } from "@nlc/tools";
import { AgentService } from "./service.js";

describe("[rollback-recovery] durable workspace rollback", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("restores a pre-existing empty file after process restart", async () => {
    const fixture = createFixture();
    const emptyPath = path.join(fixture.workspaceRoot, "empty.txt");
    fs.writeFileSync(emptyPath, Buffer.alloc(0));
    const run = fixture.storage.createRun(fixture.workspace.id, "single-file rollback");

    await writeFileTool(
      { runId: run.id, path: "empty.txt", content: "agent bytes\r\n" },
      { runId: run.id, workspaceRoot: fixture.workspaceRoot },
      fixture.storage,
    );
    fixture.storage.updateRunStatus(run.id, "done");
    fixture.storage.close();

    const restarted = new Storage(fixture.dbPath);
    const detail = createService(restarted).rollback(run.id);

    expect(fs.existsSync(emptyPath)).toBe(true);
    expect(fs.readFileSync(emptyPath)).toEqual(Buffer.alloc(0));
    expect(detail.run).toMatchObject({
      status: "cancelled",
      exitReason: "rolled_back",
    });
    expect(restarted.listSnapshots(run.id)).toMatchObject([
      {
        filePath: "empty.txt",
        beforeContent: "",
        beforeExisted: true,
        afterContent: "agent bytes\r\n",
        afterExisted: true,
      },
    ]);
    restarted.close();
  });

  it("restores exact bytes for many and partially recorded changes after restart", () => {
    const fixture = createFixture();
    const original = Buffer.from("\uFEFFalpha\r\n\u03B2eta\n", "utf8");
    const originalPath = path.join(fixture.workspaceRoot, "src", "original.txt");
    const deletedPath = path.join(fixture.workspaceRoot, "deleted.txt");
    const createdPath = path.join(fixture.workspaceRoot, "nested", "created.txt");
    const partialPath = path.join(fixture.workspaceRoot, "partial.txt");
    fs.mkdirSync(path.dirname(originalPath), { recursive: true });
    fs.writeFileSync(originalPath, original);
    fs.writeFileSync(deletedPath, "restore me\r\n", "utf8");
    fs.writeFileSync(partialPath, "partial before\n", "utf8");
    const run = fixture.storage.createRun(fixture.workspace.id, "many-file rollback");

    const first = fixture.storage.addSnapshot(
      run.id,
      "src/original.txt",
      original.toString("utf8"),
      { beforeExisted: true },
    );
    fs.writeFileSync(originalPath, "middle\n", "utf8");
    fixture.storage.setSnapshotAfter(first.id, "middle\n");
    const second = fixture.storage.addSnapshot(run.id, "src/original.txt", "middle\n", {
      beforeExisted: true,
    });
    fs.writeFileSync(originalPath, "final\n", "utf8");
    fixture.storage.setSnapshotAfter(second.id, "final\n");

    const deleted = fixture.storage.addSnapshot(run.id, "deleted.txt", "restore me\r\n", {
      beforeExisted: true,
    });
    fs.rmSync(deletedPath);
    fixture.storage.setSnapshotAfter(deleted.id, "", false);

    const created = fixture.storage.addSnapshot(run.id, "nested/created.txt", "", {
      beforeExisted: false,
    });
    fs.mkdirSync(path.dirname(createdPath), { recursive: true });
    fs.writeFileSync(createdPath, "created\n", "utf8");
    fixture.storage.setSnapshotAfter(created.id, "created\n");

    // Simulate interruption between the workspace write and setSnapshotAfter.
    fixture.storage.addSnapshot(run.id, "partial.txt", "partial before\n", {
      beforeExisted: true,
    });
    fs.writeFileSync(partialPath, "partially applied bytes", "utf8");
    fixture.storage.updateRunStatus(run.id, "failed");
    fixture.storage.close();

    const restarted = new Storage(fixture.dbPath);
    const detail = createService(restarted).rollback(run.id);

    expect(fs.readFileSync(originalPath)).toEqual(original);
    expect(fs.readFileSync(deletedPath)).toEqual(Buffer.from("restore me\r\n", "utf8"));
    expect(fs.existsSync(createdPath)).toBe(false);
    expect(fs.readFileSync(partialPath)).toEqual(Buffer.from("partial before\n", "utf8"));
    expect(detail.run).toMatchObject({
      status: "cancelled",
      exitReason: "rolled_back",
    });
    expect(
      detail.steps.filter((step) => step.content === "Rolled back changes"),
    ).toHaveLength(1);
    restarted.close();
  });

  it("keeps the run state unchanged when rollback preflight fails", () => {
    const fixture = createFixture();
    const run = fixture.storage.createRun(fixture.workspace.id, "invalid snapshot");
    fixture.storage.updateRunStatus(run.id, "failed");
    fixture.storage.setRunExitReason(run.id, "interrupted_restart");
    fixture.storage.addSnapshot(run.id, "../outside.txt", "outside", {
      beforeExisted: true,
    });
    fixture.storage.close();

    const restarted = new Storage(fixture.dbPath);
    expect(() => createService(restarted).rollback(run.id)).toThrow(/Rollback failed/i);
    expect(restarted.getRun(run.id)).toMatchObject({
      status: "failed",
      exitReason: "interrupted_restart",
    });
    expect(
      restarted
        .listSteps(run.id)
        .some((step) => step.content.includes("Rollback preflight failed")),
    ).toBe(true);
    restarted.close();
  });

  function createFixture(): {
    workspaceRoot: string;
    dbPath: string;
    storage: Storage;
    workspace: ReturnType<Storage["upsertWorkspace"]>;
  } {
    const root = path.join(os.tmpdir(), `nlc-rollback-${randomUUID()}`);
    const workspaceRoot = path.join(root, "workspace");
    const dbPath = path.join(root, "state.db");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    tempRoots.push(root);
    const storage = new Storage(dbPath);
    const workspace = storage.upsertWorkspace(workspaceRoot);
    return { workspaceRoot, dbPath, storage, workspace };
  }
});

function createService(storage: Storage): AgentService {
  return new AgentService({
    storage,
    resolveLLM: () => {
      throw new Error("LLM is not used by rollback recovery tests");
    },
    getAgentSettings: () => DEFAULT_SETTINGS.agent,
    emit: () => {},
  });
}
