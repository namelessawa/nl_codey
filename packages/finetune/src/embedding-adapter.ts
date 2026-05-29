/**
 * Domain embedding adapter. Same pattern as LoRA: train an embedding on the
 * project's code, then A/B-test against the base embedder on recall@8.
 * Promote only when statistically significantly better.
 */

export type ABComparison = {
  baselineHits: number;
  candidateHits: number;
  totalQueries: number;
  baselineRecall: number;
  candidateRecall: number;
  liftPercentagePoints: number;
  /** Approx p-value from a normal-approximation z-test. */
  pValue: number;
  /** True iff p < 0.05 AND candidate hits ≥ baseline hits. */
  significant: boolean;
};

export type Hits = { hitAtK: boolean }[];

/** Compare two recall@k results; returns a stat-significance verdict. */
export function compareRecall(baseline: Hits, candidate: Hits): ABComparison {
  if (baseline.length !== candidate.length || baseline.length === 0) {
    return {
      baselineHits: 0,
      candidateHits: 0,
      totalQueries: 0,
      baselineRecall: 0,
      candidateRecall: 0,
      liftPercentagePoints: 0,
      pValue: 1,
      significant: false,
    };
  }
  const n = baseline.length;
  const baselineHits = baseline.filter((h) => h.hitAtK).length;
  const candidateHits = candidate.filter((h) => h.hitAtK).length;
  const pBaseline = baselineHits / n;
  const pCandidate = candidateHits / n;
  const pPool = (baselineHits + candidateHits) / (2 * n);
  const se = Math.sqrt(2 * pPool * (1 - pPool) / n);
  const z = se === 0 ? 0 : (pCandidate - pBaseline) / se;
  const pValue = twoSidedPFromZ(z);
  return {
    baselineHits,
    candidateHits,
    totalQueries: n,
    baselineRecall: pBaseline,
    candidateRecall: pCandidate,
    liftPercentagePoints: (pCandidate - pBaseline) * 100,
    pValue,
    significant: pValue < 0.05 && candidateHits >= baselineHits,
  };
}

/** Two-sided p-value from standard-normal Z. Cheap, no library deps. */
function twoSidedPFromZ(z: number): number {
  const absZ = Math.abs(z);
  // Abramowitz & Stegun 26.2.17 approximation.
  const t = 1 / (1 + 0.2316419 * absZ);
  const d = 0.3989422804014327 * Math.exp(-(absZ * absZ) / 2);
  const p =
    d *
    t *
    (0.319381530 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return Math.min(1, 2 * p);
}

export type PromoteDecision = {
  promote: boolean;
  rationale: string;
};

export function decidePromote(comparison: ABComparison): PromoteDecision {
  if (!comparison.significant) {
    return {
      promote: false,
      rationale: `Not significant (p=${comparison.pValue.toFixed(3)}); keep base`,
    };
  }
  if (comparison.liftPercentagePoints < 2) {
    return {
      promote: false,
      rationale: `Lift < 2pp; not worth deploy risk`,
    };
  }
  return {
    promote: true,
    rationale: `Lift +${comparison.liftPercentagePoints.toFixed(1)}pp at p=${comparison.pValue.toFixed(3)}`,
  };
}
