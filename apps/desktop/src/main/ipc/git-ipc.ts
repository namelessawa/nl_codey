/** Git IPC handlers: working-tree status, PR description, branch discard. */

import {
  IPC,
  type PRDescription,
  type TaskChangeSummary,
} from "@nlc/shared";
import {
  buildPRDescription,
  discardAgentBranch as gitDiscardBranch,
  getWorkingTreeStatus,
} from "@nlc/git-integration";
import { validateRunId, validateWorkspaceId } from "../validators.js";
import { handle } from "../ipc-handle.js";
import type { Services } from "../services.js";

type RequireRoot = (workspaceId: string) => string;

export function registerGitIpc(services: Services, requireRoot: RequireRoot): void {
  const { storage } = services;

  handle(IPC.getGitStatus, async (raw) => {
    const args = validateWorkspaceId(raw);
    return getWorkingTreeStatus(requireRoot(args.workspaceId));
  });

  handle(IPC.generatePRDescription, async (raw): Promise<PRDescription> => {
    const args = validateRunId(raw);
    const run = storage.getRun(args.runId);
    if (!run) throw new Error("Run not found");
    const root = requireRoot(run.workspaceId);
    const nodes = storage.listTaskNodes(args.runId);
    const tasks: TaskChangeSummary[] = nodes.map((n) => ({
      taskNodeId: n.id,
      title: n.title,
      changedFiles: n.filesScope ?? [],
    }));
    const status = await getWorkingTreeStatus(root);
    return buildPRDescription({
      runId: args.runId,
      userRequest: run.userTask,
      branch: status.branch,
      tasks,
    });
  });

  handle(IPC.discardAgentBranch, async (raw): Promise<{ discarded: boolean }> => {
    const args = validateRunId(raw);
    const run = storage.getRun(args.runId);
    if (!run) throw new Error("Run not found");
    const root = requireRoot(run.workspaceId);
    const branchAction = storage
      .listGitActions(args.runId)
      .find((a) => a.action === "create_branch" && a.ref);
    if (!branchAction?.ref) throw new Error("No agent branch recorded for this run");
    const base = parseBranchBase(branchAction.payload) ?? "main";
    await gitDiscardBranch(root, branchAction.ref, base);
    return { discarded: true };
  });
}

function parseBranchBase(payload?: string): string | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { base?: unknown };
    return typeof parsed.base === "string" ? parsed.base : null;
  } catch {
    return null;
  }
}
