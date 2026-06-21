/** Phase 3 IPC handlers: memory, semantic index, task tree, roles, git, sandbox. */

import fs from "node:fs";
import { dialog } from "electron";
import {
  IPC,
  type MemoryEntry,
  type MemoryExport,
  type PRDescription,
  type RoleMessage,
  type SemanticHit,
  type SemanticIndexStatus,
  type SemanticSearchArgs,
  type TaskChangeSummary,
  type TaskNode,
} from "@nlc/shared";
import {
  validateCreateMemory,
  validateDeleteMemory,
  validateEditTaskNode,
  validateListMemory,
  validateRunId,
  validateSetSandboxMode,
  validateTaskNodeId,
  validateUpdateMemory,
  validateWorkspaceId,
} from "./validators.js";
import { scanFiles } from "@nlc/project-indexer";
import {
  createEntry,
  deleteEntry,
  exportMemory as buildMemoryExport,
  importMemory as importMemoryEnvelope,
  listEntries,
  updateEntry,
} from "@nlc/memory";
import { isIndexableFile, searchChunks } from "@nlc/semantic-index";
import {
  buildPRDescription,
  discardAgentBranch as gitDiscardBranch,
  getWorkingTreeStatus,
} from "@nlc/git-integration";
import { parseRow } from "@nlc/orchestrator";
import { handle } from "./ipc-handle.js";
import { Phase3Services } from "./phase3-services.js";
import type { Services } from "./services.js";

type RequireRoot = (workspaceId: string) => string;

export function registerPhase3Ipc(services: Services, requireRoot: RequireRoot): void {
  const { storage } = services;
  const phase3 = new Phase3Services(services);

  // --- memory ---
  handle(IPC.listMemoryEntries, (raw): MemoryEntry[] => {
    const args = validateListMemory(raw);
    return listEntries(storage, args.workspaceId, args.filter);
  });

  handle(IPC.createMemoryEntry, async (raw): Promise<MemoryEntry> => {
    const args = validateCreateMemory(raw);
    const embedding = await embedEntryText(phase3, `${args.entry.title}\n${args.entry.body}`);
    return embedding
      ? createEntry(storage, args.workspaceId, args.entry, embedding)
      : createEntry(storage, args.workspaceId, args.entry);
  });

  handle(IPC.updateMemoryEntry, (raw): MemoryEntry => {
    const args = validateUpdateMemory(raw);
    const updated = updateEntry(storage, args.id, args.patch);
    if (!updated) throw new Error("Memory entry not found");
    return updated;
  });

  handle(IPC.deleteMemoryEntry, (raw): { deleted: boolean } => {
    const args = validateDeleteMemory(raw);
    return { deleted: deleteEntry(storage, args.id) };
  });

  handle(IPC.exportMemory, async (raw): Promise<{ filePath: string }> => {
    const args = validateWorkspaceId(raw);
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

  // SECURITY: the file path is now picked main-side via the OS dialog, NOT
  // received from the renderer. Previously the renderer supplied any path it
  // wanted and the main process happily read it with main's privileges (a
  // compromised renderer could read arbitrary host files). Now the user has
  // to explicitly point at the JSON file every time.
  handle(IPC.importMemory, async (raw): Promise<{ imported: number; filePath: string | null }> => {
    const args = validateWorkspaceId(raw);
    const result = await dialog.showOpenDialog({
      title: "Import project memory",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { imported: 0, filePath: null };
    }
    const filePath = result.filePaths[0]!;
    const text = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(text) as MemoryExport;
    return { imported: importMemoryEnvelope(storage, args.workspaceId, data), filePath };
  });

  // --- semantic index ---
  handle(IPC.rebuildSemanticIndex, async (raw): Promise<SemanticIndexStatus> => {
    const args = validateWorkspaceId(raw);
    const root = requireRoot(args.workspaceId);
    const files = await collectIndexFiles(root);
    const indexer = phase3.indexer();
    // Broadcast the start so any open SemanticSearchView flips to the
    // "building" affordance without waiting for its 2 s poll.
    services.emit({
      kind: "index_status",
      workspaceId: args.workspaceId,
      status: { ...indexer.status(args.workspaceId, files.length), building: true },
    });
    try {
      await indexer.indexFiles(args.workspaceId, files);
    } finally {
      const final = indexer.status(args.workspaceId, files.length);
      services.emit({ kind: "index_status", workspaceId: args.workspaceId, status: final });
    }
    return indexer.status(args.workspaceId, files.length);
  });

  handle(IPC.getSemanticIndexStatus, async (raw): Promise<SemanticIndexStatus> => {
    const args = validateWorkspaceId(raw);
    const root = requireRoot(args.workspaceId);
    const total = (await scanFiles(root)).filter(isIndexableFile).length;
    return phase3.indexer().status(args.workspaceId, total);
  });

  handle(IPC.semanticSearch, async (raw): Promise<SemanticHit[]> => {
    const args = raw as SemanticSearchArgs;
    // Shape-validate the required scalars even if we don't run a full schema.
    const ws = validateWorkspaceId({ workspaceId: args.workspaceId });
    if (typeof args.query !== "string" || args.query.length === 0) {
      throw new Error("IPC payload rejected: query must be a non-empty string");
    }
    return searchChunks(storage, phase3.embedder(), ws.workspaceId, args.query, args.opts);
  });

  // --- task tree ---
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

  // --- role messages ---
  handle(IPC.listRoleMessages, (raw): RoleMessage[] => {
    const args = validateTaskNodeId(raw);
    return storage.listRoleMessages(args.taskNodeId).map(parseRow);
  });

  handle(IPC.listRoleMessagesForRun, (raw): RoleMessage[] => {
    const args = validateRunId(raw);
    return storage.listRoleMessagesForRun(args.runId).map(parseRow);
  });

  // --- git ---
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

  // --- sandbox ---
  handle(IPC.getSandboxMode, (raw) => {
    const args = validateWorkspaceId(raw);
    return phase3.getSandboxMode(args.workspaceId);
  });

  handle(IPC.setSandboxMode, (raw) => {
    const args = validateSetSandboxMode(raw);
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
