/** Finetune store: jobs + model registry (active model + rollback). */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  FinetuneJob,
  FinetuneJobInput,
  FinetuneStatus,
  ModelRegistryEntry,
} from "@nlc/shared";
import {
  toFinetuneJob,
  toModelRegistryEntry,
  type FinetuneJobRow,
  type ModelRegistryRow,
} from "../rows/finetune-rows.js";

export class FinetuneStore {
  constructor(private readonly db: Database.Database) {}

  createFinetuneJob(input: FinetuneJobInput): FinetuneJob {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO finetune_jobs (id, name, base_model, dataset_id, method, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(id, input.name, input.baseModel, input.datasetId, input.method, "queued", now, now);
    return this.getFinetuneJob(id)!;
  }

  getFinetuneJob(id: string): FinetuneJob | null {
    const row = this.db
      .prepare("SELECT * FROM finetune_jobs WHERE id = ?")
      .get(id) as FinetuneJobRow | undefined;
    return row ? toFinetuneJob(row) : null;
  }

  listFinetuneJobs(): FinetuneJob[] {
    const rows = this.db
      .prepare("SELECT * FROM finetune_jobs ORDER BY created_at DESC")
      .all() as FinetuneJobRow[];
    return rows.map(toFinetuneJob);
  }

  updateFinetuneJob(
    id: string,
    patch: {
      status?: FinetuneStatus;
      evalResult?: FinetuneJob["evalResult"];
      artifactPath?: string | null;
    },
  ): FinetuneJob | null {
    const existing = this.getFinetuneJob(id);
    if (!existing) return null;
    const next: FinetuneJob = {
      ...existing,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.evalResult !== undefined ? { evalResult: patch.evalResult } : {}),
      ...(patch.artifactPath !== undefined ? { artifactPath: patch.artifactPath } : {}),
      updatedAt: Date.now(),
    };
    this.db
      .prepare(
        "UPDATE finetune_jobs SET status = ?, eval_result_json = ?, artifact_path = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        next.status,
        next.evalResult ? JSON.stringify(next.evalResult) : null,
        next.artifactPath,
        next.updatedAt,
        id,
      );
    return next;
  }

  registerModel(entry: Omit<ModelRegistryEntry, "id" | "createdAt">): ModelRegistryEntry {
    const id = randomUUID();
    const now = Date.now();
    if (entry.active) {
      this.db.prepare("UPDATE model_registry SET active = 0").run();
    }
    this.db
      .prepare(
        `INSERT INTO model_registry (id, name, kind, base_model, active, eval_delta, artifact_path, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        entry.name,
        entry.kind,
        entry.baseModel,
        entry.active ? 1 : 0,
        entry.evalDelta,
        entry.artifactPath,
        now,
      );
    return { ...entry, id, createdAt: now };
  }

  setActiveModel(id: string): ModelRegistryEntry | null {
    const target = this.db
      .prepare("SELECT * FROM model_registry WHERE id = ?")
      .get(id) as ModelRegistryRow | undefined;
    if (!target) return null;
    this.db.prepare("UPDATE model_registry SET active = 0").run();
    this.db.prepare("UPDATE model_registry SET active = 1 WHERE id = ?").run(id);
    return toModelRegistryEntry({ ...target, active: 1 });
  }

  getActiveModel(): ModelRegistryEntry | null {
    const row = this.db
      .prepare("SELECT * FROM model_registry WHERE active = 1 LIMIT 1")
      .get() as ModelRegistryRow | undefined;
    return row ? toModelRegistryEntry(row) : null;
  }

  listModels(): ModelRegistryEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM model_registry ORDER BY created_at DESC")
      .all() as ModelRegistryRow[];
    return rows.map(toModelRegistryEntry);
  }

  rollbackToBase(): ModelRegistryEntry | null {
    const base = this.db
      .prepare("SELECT * FROM model_registry WHERE kind = 'base' ORDER BY created_at ASC LIMIT 1")
      .get() as ModelRegistryRow | undefined;
    if (!base) return null;
    return this.setActiveModel(base.id);
  }
}
