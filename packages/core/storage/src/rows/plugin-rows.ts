/** Plugin installation row converter. */

import type { PluginInstallation, PluginPermission } from "@nlc/shared";

export type PluginInstallationRow = {
  id: string;
  manifest_json: string;
  install_path: string;
  enabled: number;
  approved_permissions: string;
  installed_at: number;
};

export function toPluginInstallation(r: PluginInstallationRow): PluginInstallation {
  return {
    id: r.id,
    manifest: JSON.parse(r.manifest_json) as PluginInstallation["manifest"],
    installPath: r.install_path,
    enabled: r.enabled === 1,
    approvedPermissions: JSON.parse(r.approved_permissions) as PluginPermission[],
    installedAt: r.installed_at,
  };
}
