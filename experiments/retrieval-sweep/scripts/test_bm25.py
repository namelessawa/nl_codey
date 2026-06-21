"""Sanity tests for the BM25 + tokenizer modules.

Run with `python -m unittest test_bm25`. No third-party deps.
"""
from __future__ import annotations

import unittest

from _bm25 import BM25Index
from _tokenizers import (
    TOKENIZERS,
    tokenize_camel_split,
    tokenize_snake_split,
    tokenize_subtoken,
    tokenize_whitespace,
)


class TestTokenizers(unittest.TestCase):

    def test_whitespace_lowers_and_punct_splits(self):
        toks = tokenize_whitespace("Hello, World! Foo-Bar.")
        self.assertEqual(toks, ["hello", "world", "foo", "bar"])

    def test_camel_split_breaks_pascal(self):
        toks = tokenize_camel_split("parseTestFailure JSONParser ABCFoo")
        self.assertIn("parse", toks)
        self.assertIn("test", toks)
        self.assertIn("failure", toks)
        self.assertIn("json", toks)
        self.assertIn("parser", toks)
        # ABCFoo → "abc", "foo"
        self.assertIn("abc", toks)
        self.assertIn("foo", toks)

    def test_snake_split_breaks_underscore(self):
        self.assertEqual(
            tokenize_snake_split("get_user_id"),
            ["get", "user", "id"],
        )

    def test_subtoken_includes_full_and_parts(self):
        toks = tokenize_subtoken("parseTestFailure")
        # Whole-token form must be present.
        self.assertIn("parsetestfailure", toks)
        # And the camel parts.
        self.assertIn("parse", toks)
        self.assertIn("test", toks)
        self.assertIn("failure", toks)

    def test_registry_covers_all(self):
        self.assertEqual(
            sorted(TOKENIZERS),
            ["camel_split", "snake_split", "subtoken", "whitespace"],
        )


class TestBM25Index(unittest.TestCase):

    def _build(self) -> BM25Index:
        docs = [
            ("d_alpha", "database migration sqlite schema and rows"),
            ("d_beta",  "database query result rows from sqlite"),
            ("d_gamma", "css animation styling colour transitions"),
            ("d_delta", "rust ownership borrow checker error"),
            ("d_epsilon", "react component state hooks effect"),
        ]
        idx = BM25Index("whitespace")
        idx.fit(docs)
        return idx

    def test_avgdl_and_doc_count(self):
        idx = self._build()
        self.assertEqual(len(idx.doc_ids), 5)
        self.assertGreater(idx.avgdl, 1.0)

    def test_top_hit_is_strongest_match(self):
        idx = self._build()
        hits = idx.score("database migration sqlite", top_k=5)
        self.assertGreaterEqual(len(hits), 1)
        self.assertEqual(hits[0][0], "d_alpha")

    def test_empty_query_returns_nothing(self):
        idx = self._build()
        self.assertEqual(idx.score("", top_k=5), [])

    def test_unknown_terms_return_nothing(self):
        idx = self._build()
        self.assertEqual(idx.score("foobar quux zzz", top_k=5), [])

    def test_floor_ratio_keeps_top_drops_tail(self):
        idx = self._build()
        hits = idx.score("database rows", top_k=10)
        self.assertGreaterEqual(len(hits), 2)
        top = hits[0][1]
        gentle = idx.score("database rows", top_k=10, floor_ratio=0.05)
        # Ratio > 1.0 is physically unclearable by any non-top hit
        # (it requires score >= top × 10 with the impl's invariant of
        # ALWAYS keeping top-1).
        aggro  = idx.score("database rows", top_k=10, floor_ratio=10.0)
        self.assertEqual(aggro[0][0], hits[0][0])
        self.assertEqual(len(aggro), 1)
        # Gentle floor can never INVENT new hits.
        self.assertLessEqual(len(gentle), len(hits))
        for h in gentle:
            self.assertGreaterEqual(h[1], top * 0.05)

    def test_min_score_absolute_floor(self):
        idx = self._build()
        hits = idx.score("database rows", top_k=10)
        if not hits:
            self.skipTest("no hits to test absolute floor against")
        threshold = hits[-1][1] + 1e-6
        kept = idx.score("database rows", top_k=10, min_score=threshold)
        for h in kept:
            self.assertGreater(h[1], hits[-1][1])

    def test_k1_b_affect_ranking_monotonically(self):
        idx = self._build()
        # k1 huge ≈ relax tf saturation; not the same ranking as k1=0.5 in
        # all corpora but here we just confirm the score CHANGES.
        a = dict(idx.score("database rows", k1=0.5, b=0.0, top_k=5))
        b = dict(idx.score("database rows", k1=2.5, b=1.0, top_k=5))
        # At least one top doc should have a different score with the two
        # configs (otherwise the parameters are silently ignored).
        changed = any(abs(a.get(d, 0) - b.get(d, 0)) > 1e-6 for d in set(a) | set(b))
        self.assertTrue(changed)


if __name__ == "__main__":
    unittest.main()
