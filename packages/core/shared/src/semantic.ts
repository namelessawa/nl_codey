/** Phase 3 semantic index (vector retrieval) contracts. */

export type ChunkKind = "code" | "doc" | "comment";

export type IndexedChunk = {
  id: string;
  workspaceId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  kind: ChunkKind;
  /** Original text, up to ~1500 chars. */
  content: string;
  /** Symbol name when the chunk is a function/class. */
  symbolName?: string;
  embedding: number[];
};

/** A chunk before embedding (chunker output). */
export type RawChunk = {
  filePath: string;
  startLine: number;
  endLine: number;
  kind: ChunkKind;
  content: string;
  symbolName?: string;
};

export type SemanticSearchOptions = {
  topK?: number;
  kinds?: ChunkKind[];
};

export type SemanticHitStaleness =
  | "fresh"
  | "modified"
  | "missing"
  | "unknown";

export type ContextProvenance = {
  source: "semantic_index";
  /** Stable audit id for the stored chunk; never contains source content. */
  chunkId: string;
  /** Source-file mtime captured when this chunk was indexed. */
  indexedMtime: number | null;
  /** Current source-file mtime at retrieval time, or null when unavailable. */
  currentMtime: number | null;
  staleness: SemanticHitStaleness;
  /** One-based position after kind filtering and similarity ranking. */
  rank: number;
  /** Human-readable, content-free explanation of why this hit was selected. */
  selectionReason: string;
  /** Whether the returned snippet omitted source characters. */
  truncated: boolean;
  originalChars: number;
};

export type SemanticHit = {
  filePath: string;
  startLine: number;
  endLine: number;
  /** Short snippet (never the embedding). */
  snippet: string;
  kind: ChunkKind;
  symbolName?: string;
  score: number;
  provenance: ContextProvenance;
};

export type SemanticIndexStatus = {
  totalFiles: number;
  indexedFiles: number;
  freshFiles: number;
  /** New or modified source files not represented by a current chunk set. */
  staleFiles: number;
  /** Indexed files that no longer exist in the current workspace scan. */
  missingFiles: number;
  isStale: boolean;
  lastUpdated: number | null;
  lastChecked: number;
  /** True while a background (re)build is running. */
  building: boolean;
};

/**
 * Embedding provider abstraction. Implemented by the semantic-index package
 * (OpenAI text-embedding-3-small by default) and by a mock for offline tests.
 * Memory retrieval consumes the same interface.
 */
export interface EmbeddingProvider {
  readonly model: string;
  /** Dimensionality of returned vectors. */
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** Default chunk size ceiling in characters. */
export const SEMANTIC_MAX_CHUNK_CHARS = 1500;
/** Code function split threshold in lines. */
export const SEMANTIC_MAX_CHUNK_LINES = 80;
/** Default top-K for semantic_search. */
export const SEMANTIC_DEFAULT_TOP_K = 8;
/** File extensions that get indexed. */
export const SEMANTIC_INDEXED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".md",
] as const;
