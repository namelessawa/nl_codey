"""Sanity tests for hybrid fusion + dense mock."""
from __future__ import annotations

import unittest

from _dense import HashedMockEmbedder, dense_score, encode_corpus
from _hybrid import comb_sum, rrf, weighted_sum


class TestRRF(unittest.TestCase):
    def test_rrf_promotes_a_doc_top_in_both(self):
        a = [("doc1", 9.0), ("doc2", 5.0), ("doc3", 1.0)]
        b = [("doc1", 0.99), ("doc4", 0.7), ("doc2", 0.3)]
        fused = rrf(a, b, rrf_k=60, top_k=5)
        # doc1 ranked top by both → must win.
        self.assertEqual(fused[0][0], "doc1")

    def test_rrf_handles_disjoint_sets(self):
        a = [("a1", 1.0), ("a2", 0.5)]
        b = [("b1", 1.0), ("b2", 0.5)]
        fused = rrf(a, b)
        ids = {d for d, _ in fused}
        self.assertEqual(ids, {"a1", "a2", "b1", "b2"})


class TestWeightedSum(unittest.TestCase):
    def test_alpha_endpoints_reduce_to_single_retriever(self):
        a = [("doc1", 10.0), ("doc2", 5.0)]
        b = [("doc3", 10.0), ("doc4", 5.0)]
        only_a = weighted_sum(a, b, alpha=1.0)
        only_b = weighted_sum(a, b, alpha=0.0)
        # With alpha=1, doc1 (top of `a`) must rank first.
        self.assertEqual(only_a[0][0], "doc1")
        # With alpha=0, doc3 (top of `b`) must rank first.
        self.assertEqual(only_b[0][0], "doc3")

    def test_minmax_normalization_robust_to_scale(self):
        a = [("doc1", 1.0), ("doc2", 0.5)]
        b = [("doc1", 10000.0), ("doc3", 5000.0)]
        # If we did NOT normalize, b would always dominate. With minmax both
        # contribute on [0, 1], so the fused top must be doc1 (top in both).
        fused = weighted_sum(a, b, alpha=0.5)
        self.assertEqual(fused[0][0], "doc1")


class TestCombSum(unittest.TestCase):
    def test_combsum_equals_alpha_half(self):
        a = [("doc1", 1.0), ("doc2", 0.5)]
        b = [("doc1", 1.0), ("doc3", 0.5)]
        self.assertEqual(comb_sum(a, b), weighted_sum(a, b, alpha=0.5))


class TestDenseMock(unittest.TestCase):
    def test_mock_embedding_dim_and_shape(self):
        e = HashedMockEmbedder()
        v = e.encode(["alpha beta gamma"])
        self.assertEqual(len(v), 1)
        self.assertEqual(len(v[0]), e.dim)

    def test_dense_score_finds_obvious_match(self):
        e = HashedMockEmbedder()
        doc_ids, vecs = encode_corpus(
            e, "_unit_test_inline_",
            [("d1", "database migration sqlite schema"),
             ("d2", "css animation styling"),
             ("d3", "react component state hooks")],
        )
        try:
            hits = dense_score("database migration sqlite", e, doc_ids, vecs)
            self.assertGreaterEqual(len(hits), 1)
            self.assertEqual(hits[0][0], "d1")
        finally:
            # encode_corpus caches by name; clean up.
            from _common import CORPORA_DIR
            (CORPORA_DIR / "_embed_cache" / e.name /
             "_unit_test_inline_.embeddings.json").unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
