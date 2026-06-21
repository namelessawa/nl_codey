/** Knowledge-graph IPC handlers: cross-project pattern contribution + retraction. */

import { IPC } from "@nlc/shared";
import { KnowledgeGraph } from "@nlc/global-memory";
import {
  validateContributeGlobalPattern,
  validateDeleteGlobalPattern,
  validateSetWorkspaceContribution,
  validateWorkspaceId,
} from "../validators.js";
import { handle } from "../ipc-handle.js";
import type { Services } from "../services.js";

export function registerKgIpc(services: Services): void {
  const { storage } = services;
  const kg = new KnowledgeGraph(storage.phase4);

  handle(IPC.listGlobalPatterns, () => storage.phase4.listGlobalPatterns());
  handle(IPC.contributeGlobalPattern, (raw) => {
    const { input } = validateContributeGlobalPattern(raw);
    return kg.contribute(input);
  });
  handle(IPC.retractWorkspaceContribution, (raw) => {
    const { workspaceId } = validateWorkspaceId(raw);
    return kg.retractProject(workspaceId);
  });
  handle(IPC.deleteGlobalPattern, (raw) => {
    const { id } = validateDeleteGlobalPattern(raw);
    return { deleted: storage.phase4.deleteGlobalPattern(id) };
  });
  handle(IPC.getWorkspaceContribution, (raw) => {
    const { workspaceId } = validateWorkspaceId(raw);
    return storage.phase4.getWorkspaceContribution(workspaceId);
  });
  handle(IPC.setWorkspaceContribution, (raw) => {
    const { workspaceId, mode } = validateSetWorkspaceContribution(raw);
    storage.phase4.setWorkspaceContribution(workspaceId, mode);
    if (mode === "isolated") {
      // Retracting opt-in cascades: drop this workspace's contributions.
      kg.retractProject(workspaceId);
    }
    return mode;
  });
}
