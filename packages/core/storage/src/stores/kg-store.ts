/** Knowledge-graph store: global patterns + edges + workspace contribution. */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  GlobalPattern,
  GlobalPatternInput,
  KGEdge,
  WorkspaceContributionMode,
} from "@nlc/shared";
import {
  embeddingFromBlob,
  embeddingToBlob,
  toGlobalPattern,
  toKGEdge,
  type GlobalPatternRow,
  type KGEdgeRow,
  type WorkspaceContributionRow,
} from "../rows/kg-rows.js";

export class KgStore {
  constructor(private readonly db: Database.Database) {}

  createGlobalPattern(input: GlobalPatternInput): GlobalPattern {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO global_patterns
         (id,title,description,example_snippet,source_projects,tags,confidence,embedding,created_at,last_applied_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.title,
        input.description,
        input.exampleSnippet,
        JSON.stringify(input.sourceProjects),
        JSON.stringify(input.tags),
        input.confidence,
        input.embedding.length ? embeddingToBlob(input.embedding) : null,
        now,
        now,
      );
    return this.getGlobalPattern(id)!;
  }

  getGlobalPattern(id: string): GlobalPattern | null {
    const row = this.db
      .prepare("SELECT * FROM global_patterns WHERE id = ?")
      .get(id) as GlobalPatternRow | undefined;
    return row ? toGlobalPattern(row) : null;
  }

  listGlobalPatterns(limit = 200): GlobalPattern[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM global_patterns ORDER BY confidence DESC, last_applied_at DESC LIMIT ?",
      )
      .all(limit) as GlobalPatternRow[];
    return rows.map(toGlobalPattern);
  }

  listGlobalPatternsWithEmbedding(): { pattern: GlobalPattern; embedding: number[] }[] {
    const rows = this.db.prepare("SELECT * FROM global_patterns").all() as GlobalPatternRow[];
    return rows.map((r) => ({
      pattern: toGlobalPattern(r),
      embedding: r.embedding ? embeddingFromBlob(r.embedding) : [],
    }));
  }

  updateGlobalPatternConfidence(id: string, confidence: number, appliedAt?: number): void {
    this.db
      .prepare(
        "UPDATE global_patterns SET confidence = ?, last_applied_at = COALESCE(?, last_applied_at) WHERE id = ?",
      )
      .run(confidence, appliedAt ?? null, id);
  }

  appendGlobalPatternSource(id: string, workspaceId: string): void {
    const existing = this.getGlobalPattern(id);
    if (!existing) return;
    if (existing.sourceProjects.includes(workspaceId)) return;
    const next = [...existing.sourceProjects, workspaceId];
    this.db
      .prepare("UPDATE global_patterns SET source_projects = ? WHERE id = ?")
      .run(JSON.stringify(next), id);
  }

  /** Remove a project's contribution from every pattern; delete patterns left with no sources. */
  retractWorkspaceContribution(workspaceId: string): { updated: number; deleted: number } {
    const rows = this.db
      .prepare("SELECT * FROM global_patterns")
      .all() as GlobalPatternRow[];
    let updated = 0;
    let deleted = 0;
    for (const row of rows) {
      const sources = JSON.parse(row.source_projects) as string[];
      if (!sources.includes(workspaceId)) continue;
      const remaining = sources.filter((s) => s !== workspaceId);
      if (remaining.length === 0) {
        this.db.prepare("DELETE FROM global_patterns WHERE id = ?").run(row.id);
        deleted++;
      } else {
        this.db
          .prepare("UPDATE global_patterns SET source_projects = ? WHERE id = ?")
          .run(JSON.stringify(remaining), row.id);
        updated++;
      }
    }
    return { updated, deleted };
  }

  deleteGlobalPattern(id: string): boolean {
    const r = this.db.prepare("DELETE FROM global_patterns WHERE id = ?").run(id);
    return r.changes > 0;
  }

  insertKGEdge(edge: Omit<KGEdge, "id" | "createdAt">): KGEdge {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO kg_edges (id,from_id,from_kind,to_id,to_kind,edge_kind,weight,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(id, edge.fromId, edge.fromKind, edge.toId, edge.toKind, edge.edgeKind, edge.weight, now);
    return { ...edge, id, createdAt: now };
  }

  listKGEdges(opts: { fromId?: string; toId?: string; edgeKind?: string } = {}): KGEdge[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.fromId) {
      where.push("from_id = ?");
      params.push(opts.fromId);
    }
    if (opts.toId) {
      where.push("to_id = ?");
      params.push(opts.toId);
    }
    if (opts.edgeKind) {
      where.push("edge_kind = ?");
      params.push(opts.edgeKind);
    }
    const sql = `SELECT * FROM kg_edges${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC`;
    return (this.db.prepare(sql).all(...params) as KGEdgeRow[]).map(toKGEdge);
  }

  getWorkspaceContribution(workspaceId: string): WorkspaceContributionMode {
    const row = this.db
      .prepare("SELECT * FROM workspace_contribution WHERE workspace_id = ?")
      .get(workspaceId) as WorkspaceContributionRow | undefined;
    return (row?.mode as WorkspaceContributionMode | undefined) ?? "isolated";
  }

  setWorkspaceContribution(workspaceId: string, mode: WorkspaceContributionMode): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO workspace_contribution (workspace_id, mode, updated_at)
         VALUES (?,?,?)
         ON CONFLICT(workspace_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`,
      )
      .run(workspaceId, mode, now);
  }
}
