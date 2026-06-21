/**
 * Pattern extractor — an offline batch process (NOT a chat role) that scans
 * per-project memory and promotes patterns that appear in ≥2 projects, all
 * with verified outcomes, into the global pool.
 *
 * Health budget: ≤10 new GlobalPatterns/week is healthy. The extractor must
 * stay conservative; cross-project patterns are the gold standard, not the
 * default state.
 */
import type {
  GlobalPattern,
  GlobalPatternInput,
  MemoryEntry,
} from "@nlc/shared";
import type { KnowledgeGraph } from "./knowledge-graph.js";

export type ProjectMemorySource = {
  workspaceId: string;
  /** Entries should already be filtered to verified/successful ones. */
  entries: MemoryEntry[];
};

export type ExtractionConfig = {
  /** Number of distinct projects required to promote a pattern. */
  minProjects: number;
  /** Cap on weekly promotions to avoid pollution. */
  weeklyLimit: number;
  /** Title-similarity threshold for treating two memory entries as the same pattern. */
  similarityThreshold: number;
  /** Initial confidence assigned to a promoted pattern. */
  initialConfidence: number;
};

export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  minProjects: 2,
  weeklyLimit: 10,
  similarityThreshold: 0.6,
  initialConfidence: 0.5,
};

/** Group memory entries from multiple projects into candidate clusters. */
export function groupCandidates(
  sources: ProjectMemorySource[],
  config: ExtractionConfig = DEFAULT_EXTRACTION_CONFIG,
): Map<string, { entries: MemoryEntry[]; projects: Set<string> }> {
  const clusters = new Map<string, { entries: MemoryEntry[]; projects: Set<string> }>();

  for (const source of sources) {
    for (const entry of source.entries) {
      const key = canonicalKey(entry.title);
      let cluster = clusters.get(key);
      if (!cluster) {
        // Look for a similar-titled cluster.
        for (const [existingKey, existing] of clusters) {
          if (similarity(existingKey, key) >= config.similarityThreshold) {
            cluster = existing;
            break;
          }
        }
      }
      if (!cluster) {
        cluster = { entries: [], projects: new Set() };
        clusters.set(key, cluster);
      }
      cluster.entries.push(entry);
      cluster.projects.add(source.workspaceId);
    }
  }
  return clusters;
}

/** Promote eligible candidates to global patterns. Caller injects KG facade. */
export function extractAndPromote(
  sources: ProjectMemorySource[],
  kg: KnowledgeGraph,
  config: ExtractionConfig = DEFAULT_EXTRACTION_CONFIG,
): GlobalPattern[] {
  const clusters = groupCandidates(sources, config);
  const eligible: { input: GlobalPatternInput; score: number }[] = [];

  for (const [key, cluster] of clusters) {
    if (cluster.projects.size < config.minProjects) continue;
    const first = cluster.entries[0];
    if (!first) continue;
    const input: GlobalPatternInput = {
      title: first.title,
      description: summarize(cluster.entries),
      exampleSnippet: pickExample(cluster.entries),
      sourceProjects: Array.from(cluster.projects),
      tags: dedupeTags(cluster.entries),
      confidence: Math.min(1, config.initialConfidence + 0.1 * (cluster.projects.size - 2)),
      embedding: [],
    };
    eligible.push({ input, score: cluster.projects.size + cluster.entries.length * 0.1 });
    void key;
  }

  // Highest cross-project evidence wins; budget cap applied.
  eligible.sort((a, b) => b.score - a.score);
  const promoted: GlobalPattern[] = [];
  for (const candidate of eligible.slice(0, config.weeklyLimit)) {
    promoted.push(kg.contribute(candidate.input));
  }
  return promoted;
}

function canonicalKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  const tokensA = new Set(a.split(" ").filter(Boolean));
  const tokensB = new Set(b.split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const t of tokensA) if (tokensB.has(t)) overlap++;
  return overlap / Math.max(tokensA.size, tokensB.size);
}

function summarize(entries: MemoryEntry[]): string {
  // Take the longest body as the canonical description; cluster size is the
  // signal for how broadly this pattern applies.
  let best = "";
  for (const e of entries) if (e.body.length > best.length) best = e.body;
  return best;
}

function pickExample(entries: MemoryEntry[]): string {
  for (const e of entries) {
    const fenced = e.body.match(/```[a-z]*\n([\s\S]+?)```/);
    if (fenced?.[1]) return fenced[1].trim();
  }
  return entries[0]?.body.slice(0, 400) ?? "";
}

function dedupeTags(entries: MemoryEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) for (const t of e.tags) set.add(t);
  return Array.from(set).slice(0, 8);
}
