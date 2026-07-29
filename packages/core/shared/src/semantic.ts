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
  /** Hard budget for snippets returned as retrieval context. */
  maxContextTokens?: number;
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
  /** Conservative estimate for this returned snippet. */
  estimatedTokens: number;
  /** Normalized budget shared by the complete returned hit set. */
  contextTokenBudget: number;
  /** Estimated tokens consumed by the complete returned hit set. */
  contextTokensUsed: number;
  /** True when the budget shortened a snippet or omitted a ranked hit. */
  budgetLimited: boolean;
  budgetOmittedHits: number;
  tokenEstimator: "ascii_4_non_ascii_1";
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
/** Maximum top-K accepted at the retrieval boundary. */
export const SEMANTIC_MAX_TOP_K = 50;
/** Default and maximum snippet-context budgets. */
export const SEMANTIC_DEFAULT_CONTEXT_TOKENS = 512;
export const SEMANTIC_MAX_CONTEXT_TOKENS = 8_192;
export const SEMANTIC_TOKEN_ESTIMATOR = "ascii_4_non_ascii_1" as const;

export function normalizeSemanticContextTokenBudget(
  value: number | undefined,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return SEMANTIC_DEFAULT_CONTEXT_TOKENS;
  }
  return Math.max(
    1,
    Math.min(SEMANTIC_MAX_CONTEXT_TOKENS, Math.floor(value)),
  );
}

/** ASCII is estimated at four chars/token; non-ASCII at one char/token. */
export function estimateSemanticTokens(text: string): number {
  let quarterTokenUnits = 0;
  for (const character of text) {
    quarterTokenUnits += character.codePointAt(0)! <= 0x7f ? 1 : 4;
  }
  return Math.ceil(quarterTokenUnits / 4);
}
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
