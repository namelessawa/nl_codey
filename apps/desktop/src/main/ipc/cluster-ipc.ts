/** Cluster (distributed) IPC handlers: worker-node list + registration. */

import { IPC } from "@nlc/shared";
import { handle } from "../ipc-handle.js";
import type { Services } from "../services.js";

export const DISTRIBUTED_UNAVAILABLE_MESSAGE =
  "Distributed execution is unavailable: authenticated transport is not implemented";

export function registerClusterIpc(_services: Services): void {
  handle(IPC.listWorkerNodes, () => {
    throw new Error(DISTRIBUTED_UNAVAILABLE_MESSAGE);
  });
  handle(IPC.registerWorkerNode, () => {
    throw new Error(DISTRIBUTED_UNAVAILABLE_MESSAGE);
  });
}
