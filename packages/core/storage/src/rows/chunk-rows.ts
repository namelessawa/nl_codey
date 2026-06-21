/** Semantic-index chunk row converter. */

import type { ChunkKind, IndexedChunk } from "@nlc/shared";
import { embeddingFromBlob, embeddingToBlob } from "./memory-rows.js";

export type ChunkRow = {
  id: string;
  workspace_id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  kind: string;
  content: string;
  symbol_name: string | null;
  embedding: Buffer;
  file_mtime: number;
  created_at: number;
};

export function chunkToBlob(embedding: number[]): Buffer {
  return embeddingToBlob(embedding);
}

export function chunkFromRow(row: ChunkRow): IndexedChunk {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    filePath: row.file_path,
    startLine: row.start_line,
    endLine: row.end_line,
    kind: row.kind as ChunkKind,
    content: row.content,
    ...(row.symbol_name !== null ? { symbolName: row.symbol_name } : {}),
    embedding: embeddingFromBlob(row.embedding),
  };
}
