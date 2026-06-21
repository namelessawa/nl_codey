/** Phase 3 long-term memory contracts. Shared across memory pkg, main, renderer. */

/**
 * Kinds of persisted project memory:
 * - `decision`: a technical choice the project made, and why.
 * - `preference`: the user's style preferences.
 * - `failure`: a pitfall hit before ("a step on the rake").
 * - `fact`: project-relevant fact that is not a decision.
 */
export type MemoryKind = "decision" | "preference" | "failure" | "fact";

export type MemoryEntry = {
  id: string;
  workspaceId: string;
  kind: MemoryKind;
  /** One-line summary, shown in retrieval results. */
  title: string;
  /** Full content with context. */
  body: string;
  tags: string[];
  /** Which run produced it, if any. */
  sourceRunId?: string;
  createdAt: number;
  lastUsedAt?: number;
  /** 0-5; incremented when an entry is referenced and yields a good result. */
  usefulness: number;
};

/** Fields a caller may set when creating an entry (system fills the rest). */
export type MemoryEntryInput = {
  kind: MemoryKind;
  title: string;
  body: string;
  tags?: string[];
  sourceRunId?: string;
};

/** Partial update applied to an existing entry. */
export type MemoryEntryPatch = Partial<
  Pick<MemoryEntry, "kind" | "title" | "body" | "tags" | "usefulness" | "lastUsedAt">
>;

export type MemoryFilter = {
  kind?: MemoryKind;
  /** Substring match against title/body. */
  search?: string;
  tags?: string[];
  /** Include entries hidden by decay (usefulness <= hidden threshold). */
  includeHidden?: boolean;
};

export type MemoryRetrievalOptions = {
  workspaceId: string;
  maxEntries?: number;
  /** Kinds to always prefer (e.g. preference + failure). */
  preferKinds?: MemoryKind[];
  /** Minimum cosine similarity to include a candidate. */
  minScore?: number;
  /**
   * Relative-floor filter (MiMo memory/service.ts pattern). When > 0, the
   * retriever ALWAYS keeps the top-1 hit and drops any subsequent hit whose
   * score is below `topScore * floorRatio`.
   *
   * Why relative, not absolute: cosine/BM25 magnitudes are corpus-/embedder-
   * dependent. In a small corpus or with a low-dimensional embedder every
   * score collapses toward 0, so any absolute `minScore` floor would wrongly
   * wipe real hits. The relative floor scales with the actual top score,
   * keeping the gold result while trimming common-word noise.
   *
   * 0 (default) = disabled (keep all matches up to `maxEntries`). Composes
   * with `minScore`: an entry must pass BOTH filters to be returned.
   */
  floorRatio?: number;
};

export type MemoryHit = {
  entry: MemoryEntry;
  score: number;
};

/** Versioned envelope for project memory export/import (forward compatible). */
export type MemoryExport = {
  version: 1;
  workspaceId: string;
  exportedAt: number;
  entries: MemoryEntry[];
};

/** Usefulness at/below which an entry is hidden from default views (decay). */
export const MEMORY_HIDDEN_THRESHOLD = -3;
/** Days without use before a failure entry is decayed (usefulness -1). */
export const MEMORY_DECAY_DAYS = 90;
/** Max failure entries injected into a system prompt's pitfall section. */
export const MEMORY_MAX_FAILURE_INJECTION = 5;
