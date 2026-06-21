/** Task tree IPC handlers: list / approve plan / edit / cancel task nodes. */

import { IPC, type TaskNode } from "@nlc/shared";
import {
  validateEditTaskNode,
  validateRunId,
  validateTaskNodeId,
} from "../validators.js";
import { handle } from "../ipc-handle.js";
import type { Services } from "../services.js";

export function registerTaskIpc(services: Services): void {
  const { storage } = services;

  handle(IPC.getTaskTree, (raw): TaskNode[] => {
    const args = validateRunId(raw);
    return storage.listTaskNodes(args.runId);
  });

  handle(IPC.approveTaskTree, (raw): { approved: boolean } => {
    const { runId } = validateRunId(raw);
    // Resolve the multi-agent run's plan-approval gate (or buffer the
    // decision if the coordinator hasn't reached approve() yet — see
    // AgentService.resolvePlanApproval). Idempotent: a second click after
    // the gate already cleared is a silent no-op.
    services.agent.resolvePlanApproval(runId, true);
    return { approved: true };
  });

  handle(IPC.editTaskNode, (raw): TaskNode => {
    const args = validateEditTaskNode(raw);
    const updated = storage.updateTaskNode(args.taskNodeId, args.patch);
    if (!updated) throw new Error("Task node not found");
    return updated;
  });

  handle(IPC.cancelTaskNode, (raw): TaskNode => {
    const args = validateTaskNodeId(raw);
    storage.setTaskNodeStatus(args.taskNodeId, "cancelled");
    const node = storage.getTaskNode(args.taskNodeId);
    if (!node) throw new Error("Task node not found");
    return node;
  });
}
