/** In-memory ChunkStore used by tests (also a reference implementation). */

import type { IndexedChunk } from "@nlc/shared";
import type { ChunkStore } from "./vector-store.js";

export type ReplaceCall = {
  filePath: string;
  chunks: IndexedChunk[];
  mtime: number;
};

export class FakeChunkStore implements ChunkStore {
  /** workspaceId -> filePath -> chunks */
  private readonly chunks = new Map<string, Map<string, IndexedChunk[]>>();
  private readonly mtimes = new Map<string, Map<string, number>>();

  /** Recorded calls, for test assertions. */
  readonly replaceCalls: ReplaceCall[] = [];
  readonly deleteCalls: Array<{ workspaceId: string; filePath: string }> = [];

  replaceChunksForFile(
    workspaceId: string,
    filePath: string,
    chunks: IndexedChunk[],
    mtime: number,
  ): void {
    this.fileMap(workspaceId).set(filePath, chunks);
    this.mtimeMap(workspaceId).set(filePath, mtime);
    this.replaceCalls.push({ filePath, chunks, mtime });
  }

  deleteChunksForFile(workspaceId: string, filePath: string): void {
    this.fileMap(workspaceId).delete(filePath);
    this.mtimeMap(workspaceId).delete(filePath);
    this.deleteCalls.push({ workspaceId, filePath });
  }

  listChunks(workspaceId: string): IndexedChunk[] {
    const out: IndexedChunk[] = [];
    for (const list of this.fileMap(workspaceId).values()) {
      out.push(...list);
    }
    return out;
  }

  getIndexedFileMtimes(workspaceId: string): Map<string, number> {
    return new Map(this.mtimeMap(workspaceId));
  }

  countChunks(workspaceId: string): number {
    return this.listChunks(workspaceId).length;
  }

  private fileMap(workspaceId: string): Map<string, IndexedChunk[]> {
    let map = this.chunks.get(workspaceId);
    if (!map) {
      map = new Map();
      this.chunks.set(workspaceId, map);
    }
    return map;
  }

  private mtimeMap(workspaceId: string): Map<string, number> {
    let map = this.mtimes.get(workspaceId);
    if (!map) {
      map = new Map();
      this.mtimes.set(workspaceId, map);
    }
    return map;
  }
}
