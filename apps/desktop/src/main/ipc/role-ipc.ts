/** Role messages IPC handlers: Planner/Coder/Reviewer message history. */

import { IPC, type RoleMessage } from "@nlc/shared";
import { parseRow } from "@nlc/orchestrator";
import { validateRunId, validateTaskNodeId } from "../validators.js";
import { handle } from "../ipc-handle.js";
import type { Services } from "../services.js";

export function registerRoleIpc(services: Services): void {
  const { storage } = services;

  handle(IPC.listRoleMessages, (raw): RoleMessage[] => {
    const args = validateTaskNodeId(raw);
    return storage.listRoleMessages(args.taskNodeId).map(parseRow);
  });

  handle(IPC.listRoleMessagesForRun, (raw): RoleMessage[] => {
    const args = validateRunId(raw);
    return storage.listRoleMessagesForRun(args.runId).map(parseRow);
  });
}
