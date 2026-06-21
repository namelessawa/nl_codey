/** Advanced settings IPC: read + write the feature-flag bundle. */

import { IPC } from "@nlc/shared";
import { validateUpdateAdvancedSettings } from "../validators.js";
import { handle } from "../ipc-handle.js";
import type { Services } from "../services.js";

export function registerAdvancedSettingsIpc(services: Services): void {
  const { advancedSettings } = services;

  handle(IPC.getAdvancedSettings, () => advancedSettings.get());
  handle(IPC.updateAdvancedSettings, (raw) => {
    const { settings: next } = validateUpdateAdvancedSettings(raw);
    return advancedSettings.set(next);
  });
}
