/**
 * Curator: filter the raw signal-derived dataset down to high-signal pairs.
 * Quality > quantity. Better to ship 100 clean pairs than 10k noisy ones.
 *
 * Filters applied:
 *   1. Drop pure-formatting / whitespace-only differences.
 *   2. Drop pairs where the human edit is too close to the agent version (likely noise).
 *   3. Dedupe near-identical (prompt, chosen) tuples.
 *   4. Optional: stratify by category so one bucket doesn't drown the rest.
 */
import type { PreferencePair } from "@nlc/shared";

export type CurationConfig = {
  /** 0..1; minimum normalized edit distance to keep a pair. */
  minEditDistance: number;
  /** Cap per category to prevent dominance. */
  perCategoryCap: number;
  /** Drop pairs whose quality_score sits below this floor. */
  minQuality: number;
};

export const DEFAULT_CURATION_CONFIG: CurationConfig = {
  minEditDistance: 0.05,
  perCategoryCap: 200,
  minQuality: 0.4,
};

export type CurationResult = {
  kept: PreferencePair[];
  droppedFormatting: number;
  droppedTooSimilar: number;
  droppedLowQuality: number;
  droppedDuplicates: number;
};

export function curatePairs(
  pairs: PreferencePair[],
  config: CurationConfig = DEFAULT_CURATION_CONFIG,
): CurationResult {
  let droppedFormatting = 0;
  let droppedTooSimilar = 0;
  let droppedLowQuality = 0;
  let droppedDuplicates = 0;

  const stage1 = pairs.filter((p) => {
    if (isWhitespaceOnly(p)) {
      droppedFormatting++;
      return false;
    }
    return true;
  });

  const stage2 = stage1.filter((p) => {
    const editDist = normalizedEditDistance(p.chosen, p.rejected);
    if (editDist < config.minEditDistance) {
      droppedTooSimilar++;
      return false;
    }
    return true;
  });

  const stage3 = stage2.filter((p) => {
    if (p.qualityScore < config.minQuality) {
      droppedLowQuality++;
      return false;
    }
    return true;
  });

  const seen = new Set<string>();
  const stage4: PreferencePair[] = [];
  for (const p of stage3) {
    const key = `${p.prompt}::${p.chosen.slice(0, 200)}`;
    if (seen.has(key)) {
      droppedDuplicates++;
      continue;
    }
    seen.add(key);
    stage4.push(p);
  }

  // Stratify per category.
  const byCategory = new Map<string, PreferencePair[]>();
  for (const p of stage4) {
    const cat = p.category ?? "_uncategorized";
    let bucket = byCategory.get(cat);
    if (!bucket) {
      bucket = [];
      byCategory.set(cat, bucket);
    }
    bucket.push(p);
  }
  const kept: PreferencePair[] = [];
  for (const bucket of byCategory.values()) {
    bucket.sort((a, b) => b.qualityScore - a.qualityScore);
    kept.push(...bucket.slice(0, config.perCategoryCap));
  }

  return {
    kept,
    droppedFormatting,
    droppedTooSimilar,
    droppedLowQuality,
    droppedDuplicates,
  };
}

function isWhitespaceOnly(p: PreferencePair): boolean {
  const a = p.chosen.replace(/\s+/g, "");
  const b = p.rejected.replace(/\s+/g, "");
  return a === b;
}

/** Quick approximation: token-Jaccard-distance, normalized to [0,1]. */
export function normalizedEditDistance(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 && tokensB.size === 0) return 0;
  let inter = 0;
  for (const t of tokensA) if (tokensB.has(t)) inter++;
  const union = tokensA.size + tokensB.size - inter;
  if (union === 0) return 0;
  return 1 - inter / union;
}

function tokenize(s: string): string[] {
  return s.split(/[\s\.,;:\(\)\[\]\{\}<>'"!?\-+=*/&|^%@~`]+/).filter(Boolean);
}
