/** Proposals store: proactive debt-scan suggestions per workspace. */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Proposal, ProposalInput, ProposalStatus } from "@nlc/shared";
import { toProposal, type ProposalRow } from "../rows/proposals-rows.js";

export class ProposalsStore {
  constructor(private readonly db: Database.Database) {}

  createProposal(input: ProposalInput): Proposal {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO proposals
         (id, workspace_id, kind, title, rationale, estimated_effort, affected_files, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.kind,
        input.title,
        input.rationale,
        input.estimatedEffort,
        JSON.stringify(input.affectedFiles),
        "new",
        now,
        now,
      );
    return this.getProposal(id)!;
  }

  getProposal(id: string): Proposal | null {
    const row = this.db.prepare("SELECT * FROM proposals WHERE id = ?").get(id) as
      | ProposalRow
      | undefined;
    return row ? toProposal(row) : null;
  }

  listProposals(workspaceId: string, status?: ProposalStatus): Proposal[] {
    const sql = status
      ? "SELECT * FROM proposals WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC"
      : "SELECT * FROM proposals WHERE workspace_id = ? ORDER BY created_at DESC";
    const params = status ? [workspaceId, status] : [workspaceId];
    const rows = this.db.prepare(sql).all(...params) as ProposalRow[];
    return rows.map(toProposal);
  }

  updateProposalStatus(
    id: string,
    status: ProposalStatus,
    extras: { snoozedUntil?: number | null; convertedRunId?: string | null } = {},
  ): Proposal | null {
    const existing = this.getProposal(id);
    if (!existing) return null;
    const now = Date.now();
    this.db
      .prepare(
        "UPDATE proposals SET status = ?, snoozed_until = ?, converted_run_id = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        status,
        extras.snoozedUntil ?? existing.snoozedUntil,
        extras.convertedRunId ?? existing.convertedRunId,
        now,
        id,
      );
    return this.getProposal(id);
  }
}
