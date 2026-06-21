/** Semantic index IPC handlers: rebuild, status, vector search. */

import fs from "node:fs";
import {
  IPC,
  type SemanticHit,
  type SemanticIndexStatus,
  type SemanticSearchArgs,
} from "@nlc/shared";
import { scanFiles } from "@nlc/project-indexer";
import { isIndexableFile, searchChunks } from "@nlc/semantic-index";
import { validateWorkspaceId } from "../validators.js";
import { handle } from "../ipc-handle.js";
import { IntelligenceServices } from "../intelligence-services.js";
import type { Services } from "../services.js";

type RequireRoot = (workspaceId: string) => string;

export function registerSemanticIpc(services: Services, requireRoot: RequireRoot): void {
  const { storage } = services;
  const intelligence = new IntelligenceServices(services);

  handle(IPC.rebuildSemanticIndex, async (raw): Promise<SemanticIndexStatus> => {
    const args = validateWorkspaceId(raw);
    const root = requireRoot(args.workspaceId);
    const files = await collectIndexFiles(root);
    const indexer = intelligence.indexer();
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
    return intelligence.indexer().status(args.workspaceId, total);
  });

  handle(IPC.semanticSearch, async (raw): Promise<SemanticHit[]> => {
    const args = raw as SemanticSearchArgs;
    // Shape-validate the required scalars even if we don't run a full schema.
    const ws = validateWorkspaceId({ workspaceId: args.workspaceId });
    if (typeof args.query !== "string" || args.query.length === 0) {
      throw new Error("IPC payload rejected: query must be a non-empty string");
    }
    return searchChunks(storage, intelligence.embedder(), ws.workspaceId, args.query, args.opts);
  });
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
