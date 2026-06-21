"""Hybrid fusion of two ranked retrievers' outputs.

Three pre-registered fusion methods (DESIGN.md §5):

  - RRF (Reciprocal Rank Fusion):
        score_combined(d) = sum_i  1 / (rrf_k + rank_i(d))
    Rank-only; scale-free. `rrf_k` ∈ {10, 30, 60, 100} swept.

  - Weighted sum (post-MinMax normalization):
        score_combined(d) = alpha * norm_a(d) + (1-alpha) * norm_b(d)
    `alpha` ∈ {0.0, 0.1, …, 1.0} swept. Needs a `norm` step because
    BM25 and cosine live on different magnitude scales.

  - CombSUM (post-MinMax normalization, equal weight):
        score_combined(d) = norm_a(d) + norm_b(d)
    A degenerate weighted-sum with alpha=0.5 — kept separately because
    it's a classical IR baseline worth naming.

All three accept the two retrievers' (doc_id, raw_score) lists. Output
is `[(doc_id, fused_score), ...]` sorted descending, top_k truncated.
"""
from __future__ import annotations

from typing import Iterable, Sequence


def _minmax_normalize(scores: Iterable[tuple[str, float]]) -> dict[str, float]:
    items = list(scores)
    if not items:
        return {}
    vals = [s for _, s in items]
    lo, hi = min(vals), max(vals)
    rng = hi - lo
    if rng == 0.0:
        return {d: 1.0 for d, _ in items}
    return {d: (s - lo) / rng for d, s in items}


def rrf(
    a: Sequence[tuple[str, float]],
    b: Sequence[tuple[str, float]],
    rrf_k: int = 60,
    top_k: int = 20,
) -> list[tuple[str, float]]:
    """Reciprocal-rank fusion. `rrf_k` is the smoothing offset."""
    fused: dict[str, float] = {}
    for rank, (d, _) in enumerate(a, start=1):
        fused[d] = fused.get(d, 0.0) + 1.0 / (rrf_k + rank)
    for rank, (d, _) in enumerate(b, start=1):
        fused[d] = fused.get(d, 0.0) + 1.0 / (rrf_k + rank)
    return sorted(fused.items(), key=lambda kv: kv[1], reverse=True)[:top_k]


def weighted_sum(
    a: Sequence[tuple[str, float]],
    b: Sequence[tuple[str, float]],
    alpha: float = 0.5,
    top_k: int = 20,
) -> list[tuple[str, float]]:
    """alpha · norm(a) + (1-alpha) · norm(b)."""
    na = _minmax_normalize(a)
    nb = _minmax_normalize(b)
    keys = set(na) | set(nb)
    fused = [
        (d, alpha * na.get(d, 0.0) + (1.0 - alpha) * nb.get(d, 0.0))
        for d in keys
    ]
    fused.sort(key=lambda kv: kv[1], reverse=True)
    return fused[:top_k]


def comb_sum(
    a: Sequence[tuple[str, float]],
    b: Sequence[tuple[str, float]],
    top_k: int = 20,
) -> list[tuple[str, float]]:
    return weighted_sum(a, b, alpha=0.5, top_k=top_k)
