/** Plugin store: install / list / enable / uninstall plugin manifests. */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { PluginInstallation, PluginManifest } from "@nlc/shared";
import { toPluginInstallation, type PluginInstallationRow } from "../rows/plugin-rows.js";

export class PluginStore {
  constructor(private readonly db: Database.Database) {}

  installPlugin(
    manifest: PluginManifest,
    installPath: string,
    approvedPermissions: PluginInstallation["approvedPermissions"],
  ): PluginInstallation {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO plugin_installations
         (id, manifest_json, install_path, enabled, approved_permissions, installed_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(id, JSON.stringify(manifest), installPath, 1, JSON.stringify(approvedPermissions), now);
    return {
      id,
      manifest,
      installPath,
      enabled: true,
      approvedPermissions,
      installedAt: now,
    };
  }

  listPlugins(): PluginInstallation[] {
    const rows = this.db
      .prepare("SELECT * FROM plugin_installations ORDER BY installed_at DESC")
      .all() as PluginInstallationRow[];
    return rows.map(toPluginInstallation);
  }

  setPluginEnabled(id: string, enabled: boolean): PluginInstallation | null {
    this.db
      .prepare("UPDATE plugin_installations SET enabled = ? WHERE id = ?")
      .run(enabled ? 1 : 0, id);
    const row = this.db
      .prepare("SELECT * FROM plugin_installations WHERE id = ?")
      .get(id) as PluginInstallationRow | undefined;
    return row ? toPluginInstallation(row) : null;
  }

  uninstallPlugin(id: string): boolean {
    return (
      this.db.prepare("DELETE FROM plugin_installations WHERE id = ?").run(id).changes > 0
    );
  }
}
