/** Style-spec store: per-scope (global/team/project) style specifications. */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { StyleSpec } from "@nlc/shared";
import { toStyleSpec, type StyleSpecRow } from "../rows/style-rows.js";

export class StyleStore {
  constructor(private readonly db: Database.Database) {}

  upsertStyleSpec(spec: StyleSpec): StyleSpec {
    const now = Date.now();
    const existing = this.db
      .prepare("SELECT * FROM style_specs WHERE scope = ? AND IFNULL(workspace_id,'') = IFNULL(?,'')")
      .get(spec.scope, spec.workspaceId ?? "") as StyleSpecRow | undefined;
    const nextVersion = existing ? existing.version + 1 : spec.version;
    const payload = JSON.stringify({
      scope: spec.scope,
      workspaceId: spec.workspaceId,
      rules: spec.rules,
      derivedFrom: spec.derivedFrom,
    });
    if (existing) {
      this.db
        .prepare("UPDATE style_specs SET spec_json = ?, version = ?, updated_at = ? WHERE id = ?")
        .run(payload, nextVersion, now, existing.id);
      return { ...spec, version: nextVersion, updatedAt: now };
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO style_specs (id, scope, workspace_id, spec_json, version, updated_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(id, spec.scope, spec.workspaceId, payload, nextVersion, now);
    return { ...spec, version: nextVersion, updatedAt: now };
  }

  getStyleSpec(scope: StyleSpec["scope"], workspaceId: string | null): StyleSpec | null {
    const row = this.db
      .prepare("SELECT * FROM style_specs WHERE scope = ? AND IFNULL(workspace_id,'') = IFNULL(?,'')")
      .get(scope, workspaceId ?? "") as StyleSpecRow | undefined;
    return row ? toStyleSpec(row) : null;
  }
}
