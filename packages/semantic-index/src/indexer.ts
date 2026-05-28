/** Builds and maintains the semantic index over a workspace's files. */

import { randomUUID } from "node:crypto";
import type {
  EmbeddingProvider,
  IndexedChunk,
  RawChunk,
  SemanticIndexStatus,
} from "@coding-agent/shared";
import { chunkFile } from "./chunker.js";
import type { ChunkStore } from "./vector-store.js";

export type IndexFile = {
  path: string;
  content: string;
  mtime: number;
};

export type IndexProgress = {
  processed: number;
  total: number;
  filePath: string;
};

type ProgressCallback = (progress: IndexProgress) => void;

export class SemanticIndexer {
  constructor(
    private readonly store: ChunkStore,
    private readonly embedder: EmbeddingProvider,
  ) {}

  /**
   * Chunk a file, embed all its chunks in one batch, and replace the file's
   * existing chunks atomically. A file with no indexable chunks still clears
   * any previously stored chunks (via an empty replace).
   */
  async indexFile(
    workspaceId: string,
    filePath: string,
    content: string,
    mtime: number,
  ): Promise<void> {
    const raw = chunkFile(filePath, content);
    const indexed = await this.embedChunks(workspaceId, raw);
    this.store.replaceChunksForFile(workspaceId, filePath, indexed, mtime);
  }

  /** Index a batch of files sequentially, reporting progress per file. */
  async indexFiles(
    workspaceId: string,
    files: IndexFile[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    let processed = 0;
    for (const file of files) {
      await this.indexFile(workspaceId, file.path, file.content, file.mtime);
      processed++;
      onProgress?.({ processed, total: files.length, filePath: file.path });
    }
  }

  /**
   * Incremental reindex: only (re)index files whose mtime changed or that are
   * new, and delete chunks for files that no longer exist in the workspace.
   */
  async reindexChanged(
    workspaceId: string,
    files: IndexFile[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const known = this.store.getIndexedFileMtimes(workspaceId);
    const present = new Set(files.map((f) => f.path));

    // Remove files that disappeared from the workspace.
    for (const knownPath of known.keys()) {
      if (!present.has(knownPath)) {
        this.store.deleteChunksForFile(workspaceId, knownPath);
      }
    }

    const changed = files.filter((file) => known.get(file.path) !== file.mtime);
    let processed = 0;
    for (const file of changed) {
      await this.indexFile(workspaceId, file.path, file.content, file.mtime);
      processed++;
      onProgress?.({ processed, total: changed.length, filePath: file.path });
    }
  }

  /** Snapshot of index coverage for the UI / status reporting. */
  status(workspaceId: string, totalFiles: number): SemanticIndexStatus {
    const mtimes = this.store.getIndexedFileMtimes(workspaceId);
    return {
      totalFiles,
      indexedFiles: mtimes.size,
      lastUpdated: lastUpdated(mtimes),
      building: false,
    };
  }

  private async embedChunks(workspaceId: string, raw: RawChunk[]): Promise<IndexedChunk[]> {
    if (raw.length === 0) return [];
    const embeddings = await this.embedder.embed(raw.map((c) => c.content));
    if (embeddings.length !== raw.length) {
      throw new Error(
        `Embedding count mismatch: expected ${raw.length}, got ${embeddings.length}`,
      );
    }
    return raw.map((chunk, i) => {
      const indexed: IndexedChunk = {
        id: randomUUID(),
        workspaceId,
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        kind: chunk.kind,
        content: chunk.content,
        embedding: embeddings[i] ?? [],
      };
      if (chunk.symbolName) indexed.symbolName = chunk.symbolName;
      return indexed;
    });
  }
}

function lastUpdated(mtimes: Map<string, number>): number | null {
  let max: number | null = null;
  for (const mtime of mtimes.values()) {
    if (max === null || mtime > max) max = mtime;
  }
  return max;
}
