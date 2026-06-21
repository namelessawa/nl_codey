/** Plugin IPC handlers: install / list / enable / uninstall. */

import { dialog } from "electron";
import { IPC, type PluginInstallation } from "@nlc/shared";
import {
  PluginLoader,
  type PermissionPrompter,
  type PluginRepository,
} from "@nlc/plugin-sdk";
import {
  validateInstallPlugin,
  validatePluginId,
  validateSetPluginEnabled,
} from "../validators.js";
import { handle } from "../ipc-handle.js";
import type { Services } from "../services.js";

export function registerPluginIpc(services: Services): void {
  const { storage, phase4Settings } = services;

  // The PluginLoader is the ONLY path that may install a plugin: it runs the
  // SDK manifest validator (rejects bad semver, non-snake_case tools, unknown
  // permissions), then asks the user to approve each requested permission via
  // an OS dialog before anything reaches the database. The previous
  // installPlugin handler skipped both steps and trusted whatever the
  // renderer sent — a compromised renderer could install a plugin claiming
  // any permission set. Fixed.
  const pluginRepo: PluginRepository = {
    installPlugin: (manifest, installPath, perms) =>
      storage.phase4.installPlugin(manifest, installPath, perms),
    listPlugins: () => storage.phase4.listPlugins(),
    setPluginEnabled: (id, enabled) => storage.phase4.setPluginEnabled(id, enabled),
    uninstallPlugin: (id) => storage.phase4.uninstallPlugin(id),
  };
  // Fallback prompter used only when the install IPC arrives without
  // pre-approval (e.g., a future programmatic install path). The renderer's
  // PluginManager form ships `approvedPermissions` per-checkbox and goes
  // through the pre-approval path in PluginLoader.install, bypassing this
  // dialog entirely.
  const pluginPrompter: PermissionPrompter = {
    async ask(manifest, requested) {
      if (requested.length === 0) return [];
      const lines = requested.map((p, i) => `${i + 1}. ${p}`).join("\n");
      const result = await dialog.showMessageBox({
        type: "warning",
        title: `Install plugin: ${manifest.name}`,
        message: `Approve permissions for "${manifest.name}" v${manifest.version}?`,
        detail:
          `This plugin requests the following permissions:\n\n${lines}\n\n` +
          `Click "Approve all" to grant every permission, or "Cancel" to abort the install. ` +
          `For per-permission approval, use the install dialog in the renderer UI instead.`,
        buttons: ["Cancel", "Approve all"],
        defaultId: 0,
        cancelId: 0,
      });
      return result.response === 1 ? requested : [];
    },
  };
  const pluginLoader = new PluginLoader(pluginRepo, pluginPrompter);

  handle(IPC.listPlugins, () => storage.phase4.listPlugins());
  handle(IPC.installPlugin, async (raw): Promise<PluginInstallation> => {
    if (!phase4Settings.get().pluginsEnabled) {
      throw new Error("Plugins feature is disabled in advanced settings");
    }
    const validated = validateInstallPlugin(raw);
    const result = await pluginLoader.install(
      validated.manifest,
      validated.installPath,
      validated.approvedPermissions,
    );
    if (!result.ok) throw new Error(result.reason);
    return result.installation;
  });
  handle(IPC.setPluginEnabled, (raw) => {
    const { id, enabled } = validateSetPluginEnabled(raw);
    return storage.phase4.setPluginEnabled(id, enabled);
  });
  handle(IPC.uninstallPlugin, (raw) => {
    const { id } = validatePluginId(raw);
    return { uninstalled: storage.phase4.uninstallPlugin(id) };
  });
}
