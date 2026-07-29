/** Semantic index IPC handlers: rebuild, status, vector search. */

import fs from "node:fs";
import path from "node:path";
import {
  IPC,
  type SemanticHit,
  type SemanticIndexStatus,
  type SemanticSearchArgs,
} from "@nlc/shared";
import { scanFiles } from "@nlc/project-indexer";
import {
  annotateSemanticHitStaleness,
  isIndexableFile,
  searchChunks,
} from "@nlc/semantic-index";
import { validateWorkspaceId } from "../validators.js";
import { handle } from "../ipc-handle.js";
import { IntelligenceServices } from "../intelligence-services.js";
import { currentMtimesForSemanticHits } from "../extended-ports.js";
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
      status: { ...indexer.status(args.workspaceId, files), building: true },
    });
    try {
      await indexer.reindexChanged(args.workspaceId, files);
    } finally {
      const final = indexer.status(args.workspaceId, files);
      services.emit({ kind: "index_status", workspaceId: args.workspaceId, status: final });
    }
    return indexer.status(args.workspaceId, files);
  });

  handle(IPC.getSemanticIndexStatus, async (raw): Promise<SemanticIndexStatus> => {
    const args = validateWorkspaceId(raw);
    const root = requireRoot(args.workspaceId);
    const files = await collectIndexFileStates(root);
    return intelligence.indexer().status(args.workspaceId, files);
  });

  handle(IPC.semanticSearch, async (raw): Promise<SemanticHit[]> => {
    const args = raw as SemanticSearchArgs;
    // Shape-validate the required scalars even if we don't run a full schema.
    const ws = validateWorkspaceId({ workspaceId: args.workspaceId });
    if (typeof args.query !== "string" || args.query.length === 0) {
      throw new Error("IPC payload rejected: query must be a non-empty string");
    }
    const root = requireRoot(ws.workspaceId);
    const hits = await searchChunks(
      storage,
      intelligence.embedder(),
      ws.workspaceId,
      args.query,
      args.opts,
    );
    return annotateSemanticHitStaleness(
      hits,
      currentMtimesForSemanticHits(root, hits),
    );
  });
}

async function collectIndexFiles(
  root: string,
): Promise<{ path: string; content: string; mtime: number }[]> {
  const files = (await scanFiles(root)).filter(isIndexableFile);
  const out: { path: string; content: string; mtime: number }[] = [];
  for (const rel of files) {
    try {
      const abs = path.join(root, rel);
      const stat = fs.statSync(abs);
      const content = fs.readFileSync(abs, "utf8");
      if (content.trim().length === 0) continue;
      out.push({ path: rel, content, mtime: stat.mtimeMs });
    } catch {
      // Skip unreadable files (deleted between scan and read, perms, etc.).
    }
  }
  return out;
}

async function collectIndexFileStates(
  root: string,
): Promise<{ path: string; mtime: number }[]> {
  const files = (await scanFiles(root)).filter(isIndexableFile);
  const out: { path: string; mtime: number }[] = [];
  for (const rel of files) {
    try {
      const abs = path.join(root, rel);
      if (fs.readFileSync(abs, "utf8").trim().length === 0) continue;
      out.push({ path: rel, mtime: fs.statSync(abs).mtimeMs });
    } catch {
      // A concurrent delete becomes a stale/missing file on the next poll.
    }
  }
  return out;
}
