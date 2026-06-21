/** Advanced settings IPC: read + write the feature-flag bundle. */

import { IPC } from "@nlc/shared";
import { validateUpdatePhase4Settings } from "../validators.js";
import { handle } from "../ipc-handle.js";
import type { Services } from "../services.js";

export function registerAdvancedSettingsIpc(services: Services): void {
  const { phase4Settings } = services;

  handle(IPC.getPhase4Settings, () => phase4Settings.get());
  handle(IPC.updatePhase4Settings, (raw) => {
    const { settings: next } = validateUpdatePhase4Settings(raw);
    return phase4Settings.set(next);
  });
}
