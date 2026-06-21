/** ChunkStore port + cosine similarity + in-memory semantic search. */

import type {
  ChunkKind,
  EmbeddingProvider,
  IndexedChunk,
  SemanticHit,
  SemanticSearchOptions,
} from "@nlc/shared";
import { SEMANTIC_DEFAULT_TOP_K } from "@nlc/shared";

const SNIPPET_CHARS = 200;

/**
 * Storage port for indexed chunks. The real implementation lives in
 * @nlc/storage; this package depends only on this interface so it
 * stays storage-agnostic and easy to fake in tests.
 */
export interface ChunkStore {
  replaceChunksForFile(
    workspaceId: string,
    filePath: string,
    chunks: IndexedChunk[],
    mtime: number,
  ): void;
  deleteChunksForFile(workspaceId: string, filePath: string): void;
  listChunks(workspaceId: string): IndexedChunk[];
  getIndexedFileMtimes(workspaceId: string): Map<string, number>;
  countChunks(workspaceId: string): number;
}

/**
 * Cosine similarity of two equal-length vectors. Returns 0 for mismatched
 * lengths or zero-magnitude vectors rather than NaN.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Embed the query, score it against every stored chunk via cosine similarity,
 * optionally filter by kind, then return the top-K hits (highest score first).
 * Hits carry a short snippet, never the embedding vector.
 */
export async function searchChunks(
  store: ChunkStore,
  embedder: EmbeddingProvider,
  workspaceId: string,
  query: string,
  opts: SemanticSearchOptions = {},
): Promise<SemanticHit[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const chunks = store.listChunks(workspaceId);
  if (chunks.length === 0) return [];

  const [queryVec] = await embedder.embed([trimmed]);
  if (!queryVec) return [];

  const kinds = opts.kinds && opts.kinds.length > 0 ? new Set<ChunkKind>(opts.kinds) : null;
  const topK = opts.topK ?? SEMANTIC_DEFAULT_TOP_K;

  const scored: SemanticHit[] = [];
  for (const chunk of chunks) {
    if (kinds && !kinds.has(chunk.kind)) continue;
    const score = cosineSimilarity(queryVec, chunk.embedding);
    scored.push(toHit(chunk, score));
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, topK));
}

function toHit(chunk: IndexedChunk, score: number): SemanticHit {
  const hit: SemanticHit = {
    filePath: chunk.filePath,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    kind: chunk.kind,
    snippet: chunk.content.slice(0, SNIPPET_CHARS),
    score,
  };
  if (chunk.symbolName) hit.symbolName = chunk.symbolName;
  return hit;
}
