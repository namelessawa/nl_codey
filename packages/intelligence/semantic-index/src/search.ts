/** Thin search entrypoint + indexable-file predicate. */

import type {
  EmbeddingProvider,
  SemanticHit,
  SemanticSearchOptions,
} from "@nlc/shared";
import { SEMANTIC_INDEXED_EXTENSIONS } from "@nlc/shared";
import { searchChunks, type ChunkStore } from "./vector-store.js";

/** Run a semantic search over a workspace's indexed chunks. */
export function semanticSearch(
  store: ChunkStore,
  embedder: EmbeddingProvider,
  workspaceId: string,
  query: string,
  opts: SemanticSearchOptions = {},
): Promise<SemanticHit[]> {
  return searchChunks(store, embedder, workspaceId, query, opts);
}

const INDEXABLE_EXTENSIONS = new Set<string>(SEMANTIC_INDEXED_EXTENSIONS);

/** True when a file path has an extension the semantic index covers. */
export function isIndexableFile(path: string): boolean {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return false;
  return INDEXABLE_EXTENSIONS.has(lower.slice(dot));
}
