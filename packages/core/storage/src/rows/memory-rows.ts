/** Memory row converters: project-memory entries + embedding blob helpers. */

import type { MemoryEntry, MemoryKind } from "@nlc/shared";

export type MemoryRow = {
  id: string;
  workspace_id: string;
  kind: string;
  title: string;
  body: string;
  tags: string;
  source_run_id: string | null;
  embedding: Buffer | null;
  created_at: number;
  last_used_at: number | null;
  usefulness: number;
};

/** Serialize a float32 embedding to a compact Buffer for BLOB storage. */
export function embeddingToBlob(embedding: number[]): Buffer {
  const arr = new Float32Array(embedding);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

/** Deserialize a BLOB back into a number[] embedding. */
export function embeddingFromBlob(blob: Buffer): number[] {
  const arr = new Float32Array(
    blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength),
  );
  return Array.from(arr);
}

export function toMemoryEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind as MemoryKind,
    title: row.title,
    body: row.body,
    tags: safeParseStringArray(row.tags),
    ...(row.source_run_id !== null ? { sourceRunId: row.source_run_id } : {}),
    createdAt: row.created_at,
    ...(row.last_used_at !== null ? { lastUsedAt: row.last_used_at } : {}),
    usefulness: row.usefulness,
  };
}

/** Memory entry with its embedding vector (null when not yet embedded). */
export function memoryEmbedding(row: MemoryRow): number[] | null {
  return row.embedding ? embeddingFromBlob(row.embedding) : null;
}

export function safeParseStringArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
