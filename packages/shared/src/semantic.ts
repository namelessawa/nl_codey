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

export type SemanticHit = {
  filePath: string;
  startLine: number;
  endLine: number;
  /** Short snippet (never the embedding). */
  snippet: string;
  kind: ChunkKind;
  symbolName?: string;
  score: number;
};

export type SemanticIndexStatus = {
  totalFiles: number;
  indexedFiles: number;
  lastUpdated: number | null;
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
