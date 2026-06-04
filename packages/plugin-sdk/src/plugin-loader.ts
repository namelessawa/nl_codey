/**
 * Plugin loader. Reads a manifest, validates it, requests user approval for
 * each declared permission, and registers the resulting tools into the
 * Phase 3 tool-registry. The loader NEVER auto-approves permissions: it
 * surfaces them through the {@link PermissionPrompter} so the user must
 * explicitly tick each one.
 */
import type {
  PluginInstallation,
  PluginManifest,
  PluginPermission,
} from "@coding-agent/shared";
import { validateManifest } from "./manifest-schema.js";

export interface PluginRepository {
  installPlugin(
    manifest: PluginManifest,
    installPath: string,
    approvedPermissions: PluginPermission[],
  ): PluginInstallation;
  listPlugins(): PluginInstallation[];
  setPluginEnabled(id: string, enabled: boolean): PluginInstallation | null;
  uninstallPlugin(id: string): boolean;
}

export interface PermissionPrompter {
  /** Ask the user which of the requested permissions to approve. */
  ask(
    manifest: PluginManifest,
    requested: PluginPermission[],
  ): Promise<PluginPermission[]>;
}

export type InstallResult =
  | { ok: true; installation: PluginInstallation }
  | { ok: false; reason: string };

export class PluginLoader {
  constructor(
    private readonly repository: PluginRepository,
    private readonly prompter: PermissionPrompter,
  ) {}

  async install(
    rawManifest: unknown,
    installPath: string,
  ): Promise<InstallResult> {
    const validation = validateManifest(rawManifest);
    if (!validation.ok) {
      return {
        ok: false,
        reason: `Manifest invalid: ${validation.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
      };
    }
    const manifest = validation.manifest;
    const requested = uniquePermissions(manifest);
    // Reject zero-permission manifests outright. A plugin that declares
    // no permissions still spawns a full Node process — the permission
    // list is the only signal we have about what the script intends to
    // do. Letting that through skipped the permission-confirmation
    // dialog entirely on the host side, so a malicious manifest with
    // an empty permissions array installed silently.
    if (requested.length === 0) {
      return {
        ok: false,
        reason:
          "Plugin manifest declares no permissions. A plugin that needs nothing " +
          "from the host is either a mistake or hiding its intent — add at " +
          "least one permission (run_command / read_workspace / write_workspace / " +
          "read_memory / network:<host>) to make the install reviewable.",
      };
    }
    const approved = await this.prompter.ask(manifest, requested);
    if (approved.length === 0) {
      return { ok: false, reason: "User declined all permissions; plugin not installed" };
    }
    const installation = this.repository.installPlugin(manifest, installPath, approved);
    return { ok: true, installation };
  }

  list(): PluginInstallation[] {
    return this.repository.listPlugins();
  }

  setEnabled(id: string, enabled: boolean): PluginInstallation | null {
    return this.repository.setPluginEnabled(id, enabled);
  }

  uninstall(id: string): boolean {
    return this.repository.uninstallPlugin(id);
  }
}

function uniquePermissions(manifest: PluginManifest): PluginPermission[] {
  const set = new Set<PluginPermission>();
  for (const tool of manifest.tools) {
    for (const perm of tool.permissions) set.add(perm);
  }
  return Array.from(set);
}
