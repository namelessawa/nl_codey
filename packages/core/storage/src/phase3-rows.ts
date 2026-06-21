/** Row shapes + mappers for Phase 3 tables (memory/chunks/tasks/roles/git). */

import type {
  GitAction,
  GitActionKind,
  IndexedChunk,
  MemoryEntry,
  MemoryKind,
  RoleMessage,
  RoleMessageKind,
  RoleMessageRow,
  TaskNode,
  TaskNodeStatus,
  AgentRole,
  ChunkKind,
} from "@nlc/shared";

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

export type TaskNodeRow = {
  id: string;
  parent_run_id: string;
  title: string;
  description: string;
  status: string;
  depends_on: string;
  verify_command: string | null;
  files_scope: string | null;
  sub_run_id: string | null;
  created_at: number;
  updated_at: number;
};

export type RoleMessageDbRow = {
  id: string;
  task_node_id: string;
  from_role: string;
  to_role: string;
  kind: string;
  payload: string;
  created_at: number;
};

export type GitActionRow = {
  id: string;
  run_id: string;
  action: string;
  ref: string | null;
  payload: string | null;
  created_at: number;
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

export function chunkToBlob(embedding: number[]): Buffer {
  return embeddingToBlob(embedding);
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

export function toTaskNode(row: TaskNodeRow): TaskNode {
  return {
    id: row.id,
    parentRunId: row.parent_run_id,
    title: row.title,
    description: row.description,
    status: row.status as TaskNodeStatus,
    dependsOn: safeParseStringArray(row.depends_on),
    ...(row.verify_command !== null ? { verifyCommand: row.verify_command } : {}),
    ...(row.files_scope !== null ? { filesScope: safeParseStringArray(row.files_scope) } : {}),
    ...(row.sub_run_id !== null ? { subRunId: row.sub_run_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toRoleMessageRow(row: RoleMessageDbRow): RoleMessageRow {
  return {
    id: row.id,
    taskNodeId: row.task_node_id,
    fromRole: row.from_role as AgentRole,
    toRole: row.to_role as AgentRole,
    kind: row.kind as RoleMessageKind,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

export function toGitAction(row: GitActionRow): GitAction {
  return {
    id: row.id,
    runId: row.run_id,
    action: row.action as GitActionKind,
    ...(row.ref !== null ? { ref: row.ref } : {}),
    ...(row.payload !== null ? { payload: row.payload } : {}),
    createdAt: row.created_at,
  };
}

function safeParseStringArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
