/** Knowledge-graph row converters: global patterns + edges + contribution mode. */

import type { GlobalPattern, KGEdge, WorkspaceContributionMode } from "@nlc/shared";

export type GlobalPatternRow = {
  id: string;
  title: string;
  description: string;
  example_snippet: string;
  source_projects: string;
  tags: string;
  confidence: number;
  embedding: Buffer | null;
  created_at: number;
  last_applied_at: number;
};

export function toGlobalPattern(r: GlobalPatternRow): GlobalPattern {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    exampleSnippet: r.example_snippet,
    sourceProjects: JSON.parse(r.source_projects) as string[],
    tags: JSON.parse(r.tags) as string[],
    confidence: r.confidence,
    embedding: r.embedding ? embeddingFromBlob(r.embedding) : [],
    createdAt: r.created_at,
    lastAppliedAt: r.last_applied_at,
  };
}

export function embeddingToBlob(vec: number[]): Buffer {
  const arr = new Float32Array(vec);
  return Buffer.from(arr.buffer);
}

export function embeddingFromBlob(buf: Buffer): number[] {
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(f);
}

export type KGEdgeRow = {
  id: string;
  from_id: string;
  from_kind: string;
  to_id: string;
  to_kind: string;
  edge_kind: string;
  weight: number;
  created_at: number;
};

export function toKGEdge(r: KGEdgeRow): KGEdge {
  return {
    id: r.id,
    fromId: r.from_id,
    fromKind: r.from_kind as KGEdge["fromKind"],
    toId: r.to_id,
    toKind: r.to_kind as KGEdge["toKind"],
    edgeKind: r.edge_kind as KGEdge["edgeKind"],
    weight: r.weight,
    createdAt: r.created_at,
  };
}

export type WorkspaceContributionRow = {
  workspace_id: string;
  mode: string;
  updated_at: number;
};

export type WorkspaceContributionPair = {
  workspaceId: string;
  mode: WorkspaceContributionMode;
  updatedAt: number;
};
