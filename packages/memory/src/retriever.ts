/**
 * Memory retrieval: score persisted memory entries against a task query using
 * embedding similarity plus tag-overlap and recency bonuses, then return the
 * top hits. Entries in `preferKinds` get a flat boost so they nearly always
 * surface (e.g. user preferences + project pitfalls).
 */
import type {
  EmbeddingProvider,
  MemoryEntry,
  MemoryHit,
  MemoryKind,
  MemoryRetrievalOptions,
} from "@coding-agent/shared";
import type { MemoryStore } from "./project-memory.js";

const DEFAULT_MAX_ENTRIES = 8;
const WEIGHT_COSINE = 0.7;
const WEIGHT_TAG = 0.2;
const WEIGHT_RECENCY = 0.1;
/** Flat additive boost applied to entries whose kind is preferred. */
const PREFER_KIND_BOOST = 1;
/** Recency half-life: an entry used this many days ago scores ~0.5 recency. */
const RECENCY_HALFLIFE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Cosine similarity of two equal-length vectors. Returns 0 on degenerate input. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** Tokenize text into a lowercase set of word tokens for keyword overlap. */
function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/i)
    .filter((t) => t.length > 0);
  return new Set(tokens);
}

/** Jaccard-style overlap of an entry's tags against the query tokens (0..1). */
function tagOverlapBonus(tags: string[], queryTokens: Set<string>): number {
  if (tags.length === 0 || queryTokens.size === 0) return 0;
  let matched = 0;
  for (const tag of tags) {
    if (queryTokens.has(tag.toLowerCase())) matched += 1;
  }
  return matched / tags.length;
}

/** Exponential decay recency bonus in (0..1] from lastUsedAt/createdAt. */
function recencyBonus(entry: MemoryEntry, now: number): number {
  const last = entry.lastUsedAt ?? entry.createdAt;
  const ageDays = Math.max(0, (now - last) / MS_PER_DAY);
  return Math.pow(0.5, ageDays / RECENCY_HALFLIFE_DAYS);
}

/** Keyword overlap fallback when an entry has no embedding (0..1). */
function keywordOverlap(entry: MemoryEntry, queryTokens: Set<string>): number {
  if (queryTokens.size === 0) return 0;
  const entryTokens = tokenize(`${entry.title} ${entry.body}`);
  if (entryTokens.size === 0) return 0;
  let matched = 0;
  for (const token of queryTokens) {
    if (entryTokens.has(token)) matched += 1;
  }
  return matched / queryTokens.size;
}

export class MemoryRetriever {
  private readonly store: MemoryStore;
  private readonly embedder: EmbeddingProvider;

  constructor(store: MemoryStore, embedder: EmbeddingProvider) {
    this.store = store;
    this.embedder = embedder;
  }

  /**
   * Retrieve the most relevant memory entries for `query`. Does NOT mutate any
   * entry — the caller decides whether to `touchMemory` for usefulness.
   */
  async retrieve(
    query: string,
    opts: MemoryRetrievalOptions,
  ): Promise<MemoryHit[]> {
    const candidates = this.store.listMemoryWithEmbeddings(opts.workspaceId);
    if (candidates.length === 0) return [];

    const queryEmbedding = await this.embedQuery(query);
    const queryTokens = tokenize(query);
    const preferKinds = new Set<MemoryKind>(opts.preferKinds ?? []);
    const now = Date.now();

    const hits: MemoryHit[] = candidates.map(({ entry, embedding }) => {
      const score = this.scoreEntry({
        entry,
        embedding,
        queryEmbedding,
        queryTokens,
        preferKinds,
        now,
      });
      return { entry, score };
    });

    const minScore = opts.minScore;
    const filtered =
      typeof minScore === "number"
        ? hits.filter((hit) => hit.score >= minScore)
        : hits;

    filtered.sort((a, b) => b.score - a.score);
    const cap = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    return filtered.slice(0, cap);
  }

  private async embedQuery(query: string): Promise<number[] | null> {
    const text = query.trim();
    if (text.length === 0) return null;
    const vectors = await this.embedder.embed([text]);
    return vectors[0] ?? null;
  }

  private scoreEntry(args: {
    entry: MemoryEntry;
    embedding: number[] | null;
    queryEmbedding: number[] | null;
    queryTokens: Set<string>;
    preferKinds: Set<MemoryKind>;
    now: number;
  }): number {
    const { entry, embedding, queryEmbedding, queryTokens, preferKinds, now } =
      args;

    const tagBonus = tagOverlapBonus(entry.tags, queryTokens);
    const recency = recencyBonus(entry, now);

    let semantic: number;
    if (embedding && queryEmbedding) {
      semantic = cosineSimilarity(queryEmbedding, embedding);
    } else {
      // No embedding available: fall back to tag/keyword overlap only.
      semantic = keywordOverlap(entry, queryTokens);
    }

    let score =
      WEIGHT_COSINE * semantic +
      WEIGHT_TAG * tagBonus +
      WEIGHT_RECENCY * recency;

    if (preferKinds.has(entry.kind)) score += PREFER_KIND_BOOST;
    return score;
  }
}
