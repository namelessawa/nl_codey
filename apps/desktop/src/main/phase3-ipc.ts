/** Phase 3 IPC handlers: memory, semantic index, task tree, roles, git, sandbox. */

import fs from "node:fs";
import { dialog } from "electron";
import {
  IPC,
  type CreateMemoryArgs,
  type DeleteMemoryArgs,
  type EditTaskNodeArgs,
  type ImportMemoryArgs,
  type ListMemoryArgs,
  type MemoryEntry,
  type MemoryExport,
  type PRDescription,
  type RoleMessage,
  type SemanticHit,
  type SemanticIndexStatus,
  type SemanticSearchArgs,
  type SetSandboxModeArgs,
  type TaskChangeSummary,
  type TaskNode,
  type UpdateMemoryArgs,
  type WorkspaceIdArgs,
  type RunIdArgs,
  type TaskNodeIdArgs,
} from "@coding-agent/shared";
import { scanFiles } from "@coding-agent/project-indexer";
import {
  createEntry,
  deleteEntry,
  exportMemory as buildMemoryExport,
  importMemory as importMemoryEnvelope,
  listEntries,
  updateEntry,
} from "@coding-agent/memory";
import { isIndexableFile, searchChunks } from "@coding-agent/semantic-index";
import {
  buildPRDescription,
  discardAgentBranch as gitDiscardBranch,
  getWorkingTreeStatus,
} from "@coding-agent/git-integration";
import { parseRow } from "@coding-agent/orchestrator";
import { handle } from "./ipc-handle.js";
import { Phase3Services } from "./phase3-services.js";
import type { Services } from "./services.js";

type RequireRoot = (workspaceId: string) => string;

export function registerPhase3Ipc(services: Services, requireRoot: RequireRoot): void {
  const { storage } = services;
  const phase3 = new Phase3Services(services);

  // --- memory ---
  handle(IPC.listMemoryEntries, (raw): MemoryEntry[] => {
    const args = raw as ListMemoryArgs;
    return listEntries(storage, args.workspaceId, args.filter);
  });

  handle(IPC.createMemoryEntry, async (raw): Promise<MemoryEntry> => {
    const args = raw as CreateMemoryArgs;
    const embedding = await embedEntryText(phase3, `${args.entry.title}\n${args.entry.body}`);
    return embedding
      ? createEntry(storage, args.workspaceId, args.entry, embedding)
      : createEntry(storage, args.workspaceId, args.entry);
  });

  handle(IPC.updateMemoryEntry, (raw): MemoryEntry => {
    const args = raw as UpdateMemoryArgs;
    const updated = updateEntry(storage, args.id, args.patch);
    if (!updated) throw new Error("Memory entry not found");
    return updated;
  });

  handle(IPC.deleteMemoryEntry, (raw): { deleted: boolean } => {
    const args = raw as DeleteMemoryArgs;
    return { deleted: deleteEntry(storage, args.id) };
  });

  handle(IPC.exportMemory, async (raw): Promise<{ filePath: string }> => {
    const args = raw as WorkspaceIdArgs;
    const envelope = buildMemoryExport(storage, args.workspaceId);
    const result = await dialog.showSaveDialog({
      title: "Export project memory",
      defaultPath: "project-memory.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) throw new Error("Export cancelled");
    fs.writeFileSync(result.filePath, JSON.stringify(envelope, null, 2), "utf8");
    return { filePath: result.filePath };
  });

  handle(IPC.importMemory, (raw): { imported: number } => {
    const args = raw as ImportMemoryArgs;
    const text = fs.readFileSync(args.filePath, "utf8");
    const data = JSON.parse(text) as MemoryExport;
    return { imported: importMemoryEnvelope(storage, args.workspaceId, data) };
  });

  // --- semantic index ---
  handle(IPC.rebuildSemanticIndex, async (raw): Promise<SemanticIndexStatus> => {
    const args = raw as WorkspaceIdArgs;
    const root = requireRoot(args.workspaceId);
    const files = await collectIndexFiles(root);
    const indexer = phase3.indexer();
    await indexer.indexFiles(args.workspaceId, files);
    return indexer.status(args.workspaceId, files.length);
  });

  handle(IPC.getSemanticIndexStatus, async (raw): Promise<SemanticIndexStatus> => {
    const args = raw as WorkspaceIdArgs;
    const root = requireRoot(args.workspaceId);
    const total = (await scanFiles(root)).filter(isIndexableFile).length;
    return phase3.indexer().status(args.workspaceId, total);
  });

  handle(IPC.semanticSearch, async (raw): Promise<SemanticHit[]> => {
    const args = raw as SemanticSearchArgs;
    return searchChunks(storage, phase3.embedder(), args.workspaceId, args.query, args.opts);
  });

  // --- task tree ---
  handle(IPC.getTaskTree, (raw): TaskNode[] => {
    const args = raw as RunIdArgs;
    return storage.listTaskNodes(args.runId);
  });

  handle(IPC.approveTaskTree, (): { approved: boolean } => {
    // Approval gating is consumed by the coordinator's injected approve() port;
    // here we simply acknowledge the user's GUI approval.
    return { approved: true };
  });

  handle(IPC.editTaskNode, (raw): TaskNode => {
    const args = raw as EditTaskNodeArgs;
    const updated = storage.updateTaskNode(args.taskNodeId, args.patch);
    if (!updated) throw new Error("Task node not found");
    return updated;
  });

  handle(IPC.cancelTaskNode, (raw): TaskNode => {
    const args = raw as TaskNodeIdArgs;
    storage.setTaskNodeStatus(args.taskNodeId, "cancelled");
    const node = storage.getTaskNode(args.taskNodeId);
    if (!node) throw new Error("Task node not found");
    return node;
  });

  // --- role messages ---
  handle(IPC.listRoleMessages, (raw): RoleMessage[] => {
    const args = raw as TaskNodeIdArgs;
    return storage.listRoleMessages(args.taskNodeId).map(parseRow);
  });

  // --- git ---
  handle(IPC.getGitStatus, async (raw) => {
    const args = raw as WorkspaceIdArgs;
    return getWorkingTreeStatus(requireRoot(args.workspaceId));
  });

  handle(IPC.generatePRDescription, async (raw): Promise<PRDescription> => {
    const args = raw as RunIdArgs;
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
    const args = raw as RunIdArgs;
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

  // --- sandbox ---
  handle(IPC.getSandboxMode, (raw) => {
    const args = raw as WorkspaceIdArgs;
    return phase3.getSandboxMode(args.workspaceId);
  });

  handle(IPC.setSandboxMode, (raw) => {
    const args = raw as SetSandboxModeArgs;
    return phase3.setSandboxMode(args.workspaceId, args.mode);
  });
}

async function embedEntryText(phase3: Phase3Services, text: string): Promise<number[] | null> {
  try {
    const [vec] = await phase3.embedder().embed([text]);
    return vec ?? null;
  } catch {
    return null;
  }
}

async function collectIndexFiles(
  root: string,
): Promise<{ path: string; content: string; mtime: number }[]> {
  const files = (await scanFiles(root)).filter(isIndexableFile);
  const out: { path: string; content: string; mtime: number }[] = [];
  for (const rel of files) {
    try {
      const abs = `${root}/${rel}`;
      const stat = fs.statSync(abs);
      out.push({ path: rel, content: fs.readFileSync(abs, "utf8"), mtime: stat.mtimeMs });
    } catch {
      // Skip unreadable files (deleted between scan and read, perms, etc.).
    }
  }
  return out;
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
