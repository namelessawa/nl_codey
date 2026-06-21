/** Sandbox-mode IPC handlers: read + write the global sandbox-mode setting. */

import { IPC } from "@nlc/shared";
import { validateSetSandboxMode, validateWorkspaceId } from "../validators.js";
import { handle } from "../ipc-handle.js";
import { IntelligenceServices } from "../intelligence-services.js";
import type { Services } from "../services.js";

export function registerSandboxIpc(services: Services): void {
  const intelligence = new IntelligenceServices(services);

  handle(IPC.getSandboxMode, (raw) => {
    const args = validateWorkspaceId(raw);
    return intelligence.getSandboxMode(args.workspaceId);
  });

  handle(IPC.setSandboxMode, (raw) => {
    const args = validateSetSandboxMode(raw);
    return intelligence.setSandboxMode(args.workspaceId, args.mode);
  });
}
