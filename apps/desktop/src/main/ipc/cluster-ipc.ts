/** Cluster (distributed) IPC handlers: worker-node list + registration. */

import { IPC } from "@nlc/shared";
import { validateRegisterWorkerNode } from "../validators.js";
import { handle } from "../ipc-handle.js";
import type { Services } from "../services.js";

export function registerClusterIpc(services: Services): void {
  const { storage, advancedSettings } = services;

  handle(IPC.listWorkerNodes, () => storage.cluster.listWorkerNodes());
  handle(IPC.registerWorkerNode, (raw) => {
    const { node } = validateRegisterWorkerNode(raw);
    if (!advancedSettings.get().distributedEnabled) {
      throw new Error("Distributed mode is disabled in advanced settings");
    }
    return storage.cluster.upsertWorkerNode(node);
  });
}
