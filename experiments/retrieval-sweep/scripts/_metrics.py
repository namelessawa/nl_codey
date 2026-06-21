"""IR evaluation metrics — pure, no third-party deps.

All metrics here assume **single-target** gold (our self-labels are
unambiguous-target by construction). Multi-target generalizations are
straightforward but unused.

  - rank_of(ranked_ids, target)  → 1-based rank, or None if missed.
  - hit_at_k(rank, k)            → 1 if rank ≤ k else 0.
  - precision_at_k(rank, k)      → 1/k if hit, 0 otherwise (since |gold|=1).
  - reciprocal_rank(rank)        → 1/rank if hit, 0 if missed.
  - ndcg_at_k(rank, k)           → DCG/IDCG with single-target gold.
"""
from __future__ import annotations

import math
from typing import Sequence


def rank_of(ranked: Sequence[str], target: str) -> int | None:
    """Return the 1-based rank of `target` in `ranked`, or None if absent."""
    for i, doc_id in enumerate(ranked, start=1):
        if doc_id == target:
            return i
    return None


def hit_at_k(rank: int | None, k: int) -> int:
    return 1 if rank is not None and rank <= k else 0


def precision_at_k(rank: int | None, k: int) -> float:
    # With a single-target gold, P@k is 1/k if the target is in top-k else 0.
    return (1.0 / k) if hit_at_k(rank, k) else 0.0


def reciprocal_rank(rank: int | None) -> float:
    return (1.0 / rank) if rank is not None else 0.0


def ndcg_at_k(rank: int | None, k: int) -> float:
    """Single-target nDCG. IDCG is always 1 (best case: rank 1)."""
    if not hit_at_k(rank, k):
        return 0.0
    # DCG with binary relevance and log_2(rank+1) discount.
    return 1.0 / math.log2(rank + 1)  # type: ignore[arg-type]


# A pre-registered set of k values used by every sweep so columns line up.
K_VALUES: tuple[int, ...] = (1, 3, 5, 10, 20)


def score_query(ranked: Sequence[str], target: str) -> dict[str, float | int | None]:
    """Compute all per-query metrics in one shot. Used by the sweep harness."""
    r = rank_of(ranked, target)
    out: dict[str, float | int | None] = {"rank": r, "mrr": reciprocal_rank(r)}
    for k in K_VALUES:
        out[f"hit@{k}"]  = hit_at_k(r, k)
        out[f"p@{k}"]    = precision_at_k(r, k)
        out[f"ndcg@{k}"] = ndcg_at_k(r, k)
    return out
