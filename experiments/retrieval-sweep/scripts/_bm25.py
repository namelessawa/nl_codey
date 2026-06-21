"""Self-contained BM25 implementation with tunable (k1, b, tokenizer, floor).

No third-party deps. Sparse-dict postings, BM25 (Robertson-Sparck-Jones IDF):

    IDF(t) = log( (N - df_t + 0.5) / (df_t + 0.5) + 1 )

    score(d, q) = sum_{t in q} IDF(t) *
                   (tf_d(t) * (k1 + 1)) /
                   (tf_d(t) + k1 * (1 - b + b * |d|/avgdl))

The implementation aims for correctness and clarity, not raw speed. For
the sweep we re-index per (tokenizer, corpus) but score many configs
against the same index — `score_many` reuses the precomputed doc-length
normalization factor across (k1, b) so a 35-cell hyperparam grid runs in
seconds, not minutes.

Relative-floor (MiMo memory/service.ts:79-133):
    The top-1 hit is ALWAYS kept; subsequent hits below `top * ratio`
    are dropped before the @k truncation. `ratio=0` disables.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Callable, Sequence

from _tokenizers import TOKENIZERS


# -------------------------------------------------------------------- index

class BM25Index:
    """A sparse postings index for one (corpus, tokenizer) pair.

    Stores once; scored many times across the (k1, b) grid.
    """

    def __init__(self, tokenizer_name: str) -> None:
        self.tokenizer_name = tokenizer_name
        self._tokenize: Callable[[str], list[str]] = TOKENIZERS[tokenizer_name]
        # Doc index → doc_id (rel_path / file_id) lookup.
        self.doc_ids: list[str] = []
        # Per-doc length (number of tokens). Used in the b-scaling factor.
        self.doc_len: list[int] = []
        # Sum of lengths / N → avgdl. Precomputed once.
        self.avgdl: float = 0.0
        # term → sorted list of (doc_idx, tf) postings.
        self.postings: dict[str, list[tuple[int, int]]] = {}
        # term → document frequency.
        self.df: dict[str, int] = {}
        # term → BM25 idf.
        self.idf: dict[str, float] = {}

    # ---------------------------- build ----------------------------

    def fit(self, docs: Sequence[tuple[str, str]]) -> None:
        """`docs` is an iterable of `(doc_id, text)`. Tokenize, count, index.

        Indexes everything in one pass; postings are kept in insertion-
        order (which matches doc_idx) so binary-mergeable for later
        intersections if we needed them.
        """
        postings: dict[str, list[tuple[int, int]]] = defaultdict(list)
        doc_freq: dict[str, int] = defaultdict(int)
        total_len = 0
        for doc_id, text in docs:
            tokens = self._tokenize(text)
            self.doc_ids.append(doc_id)
            self.doc_len.append(len(tokens))
            total_len += len(tokens)
            tf = Counter(tokens)
            idx = len(self.doc_ids) - 1
            for term, count in tf.items():
                postings[term].append((idx, count))
                doc_freq[term] += 1
        self.postings = dict(postings)
        self.df = dict(doc_freq)
        n_docs = max(1, len(self.doc_ids))
        self.avgdl = total_len / n_docs
        # BM25 IDF (smoothed Robertson-Sparck-Jones, +1 inside log to stay
        # non-negative for very common terms).
        self.idf = {
            t: math.log((n_docs - df + 0.5) / (df + 0.5) + 1.0)
            for t, df in doc_freq.items()
        }

    # ---------------------------- score ----------------------------

    def score(
        self,
        query: str,
        k1: float = 1.5,
        b: float = 0.75,
        top_k: int = 20,
        floor_ratio: float = 0.0,
        min_score: float | None = None,
    ) -> list[tuple[str, float]]:
        """Return `[(doc_id, score), ...]` sorted descending.

        Args mirror DESIGN.md §5:
          - k1, b: classic BM25 hyperparams.
          - top_k: truncation after filtering.
          - floor_ratio: relative-floor filter (MiMo pattern); 0 = off.
          - min_score: absolute floor; None = off. Composes with floor_ratio.
        """
        q_terms = self._tokenize(query)
        if not q_terms:
            return []
        # Dedup the query terms but keep tf for repeats (BM25 standard).
        q_tf = Counter(q_terms)

        # accum maps doc_idx → score.
        accum: dict[int, float] = defaultdict(float)
        for term, q_count in q_tf.items():
            idf = self.idf.get(term)
            if idf is None:
                continue
            postings = self.postings.get(term)
            if not postings:
                continue
            # The classic BM25 doesn't multiply by q_tf, but the
            # Robertson-Walker formula does — we follow the rank_bm25
            # convention of treating each query term as a 1-occurrence
            # event, so `q_count` is unused. Documented here so a reader
            # spots the choice.
            _ = q_count  # noqa: F841 (intentional)
            for doc_idx, tf in postings:
                dl = self.doc_len[doc_idx]
                denom = tf + k1 * (1.0 - b + b * (dl / self.avgdl))
                # Guard against divide-by-zero on degenerate empty docs.
                if denom == 0.0:
                    continue
                accum[doc_idx] += idf * (tf * (k1 + 1.0)) / denom

        if not accum:
            return []

        hits = sorted(accum.items(), key=lambda kv: kv[1], reverse=True)

        # Absolute min_score floor (composes with relative). Applied
        # BEFORE the relative floor so top-1 isn't an artifact of a
        # below-threshold corner hit.
        if min_score is not None:
            hits = [h for h in hits if h[1] >= min_score]
            if not hits:
                return []

        # Relative floor: always keep top-1, drop subsequent < top × ratio.
        if floor_ratio > 0.0 and len(hits) > 1:
            top = hits[0][1]
            cutoff = top * floor_ratio
            hits = [hits[0]] + [h for h in hits[1:] if h[1] >= cutoff]

        return [(self.doc_ids[idx], score) for idx, score in hits[:top_k]]
