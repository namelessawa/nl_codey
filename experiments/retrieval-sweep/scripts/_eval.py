"""Top-level evaluation harness — config → JSONL row per query.

Usage from a sweep driver:

    from _eval import evaluate_bm25, EvalConfig

    cfg = EvalConfig(
        corpus="coding-agent",
        retriever="bm25",
        tokenizer="subtoken",
        k1=1.5, b=0.75,
        floor_ratio=0.0,
        min_score=None,
        top_k=20,
    )
    write_eval_jsonl(cfg, ...)

Each result row holds:
  - cfg_id              (sha1 of the config)
  - query_id            (sha1 of (corpus, family, query, target_id))
  - family
  - rank, mrr
  - hit@k, p@k, ndcg@k for k ∈ K_VALUES
  - latency_ms          per query (per-config aggregates emitted separately)
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

from _bm25 import BM25Index
from _common import CORPORA_DIR, QUERIES_DIR, RESULTS_DIR, log, read_jsonl, write_jsonl
from _metrics import K_VALUES, score_query


@dataclass(frozen=True)
class EvalConfig:
    """A single retriever configuration to evaluate."""
    corpus: str
    retriever: str            # "bm25" | "dense" | "hybrid_*"
    tokenizer: str = "subtoken"
    k1: float = 1.5
    b: float = 0.75
    floor_ratio: float = 0.0
    min_score: float | None = None
    top_k: int = 20
    # For corpus-size sweep (E3):
    corpus_subset_n: int | None = None
    # For dense / hybrid (filled later):
    dense_model: str | None = None
    fusion_alpha: float | None = None
    rrf_k: int | None = None
    # Provenance.
    seed: int = 0
    notes: str = ""

    @property
    def cfg_id(self) -> str:
        return hashlib.sha1(
            json.dumps(asdict(self), sort_keys=True).encode("utf-8")
        ).hexdigest()[:16]


def load_corpus(name: str, n: int | None = None) -> list[tuple[str, str]]:
    """Return `[(file_id, content), ...]` for the corpus.

    If `n` is set, take the FIRST n files (deterministic — same as the
    lexicographic walk that produced corpus.jsonl). Used by E3 to test the
    corpus-size dependence claim.
    """
    rows = list(read_jsonl(CORPORA_DIR / name / "corpus.jsonl"))
    if n is not None:
        rows = rows[:n]
    return [(r["file_id"], r["content"]) for r in rows]


def load_queries(name: str) -> list[dict]:
    return list(read_jsonl(QUERIES_DIR / f"{name}.queries.jsonl"))


def build_index(cfg: EvalConfig) -> BM25Index:
    docs = load_corpus(cfg.corpus, cfg.corpus_subset_n)
    idx = BM25Index(cfg.tokenizer)
    idx.fit(docs)
    return idx


def evaluate_bm25(
    cfg: EvalConfig,
    queries: Iterable[dict] | None = None,
    index: BM25Index | None = None,
) -> tuple[list[dict], dict]:
    """Run one BM25 config across all queries; return (per-query rows, summary).

    `index` may be passed in to amortize fit() across many configs that share
    the same (corpus, tokenizer). The caller is responsible for matching
    the cfg.corpus / cfg.tokenizer when reusing.
    """
    if index is None:
        index = build_index(cfg)
    if queries is None:
        queries = load_queries(cfg.corpus)

    rows: list[dict] = []
    latencies: list[float] = []
    for q in queries:
        t0 = time.perf_counter()
        hits = index.score(
            q["query"],
            k1=cfg.k1, b=cfg.b,
            top_k=cfg.top_k,
            floor_ratio=cfg.floor_ratio,
            min_score=cfg.min_score,
        )
        dt = (time.perf_counter() - t0) * 1000.0
        latencies.append(dt)

        ranked = [h[0] for h in hits]
        m = score_query(ranked, q["target_id"])
        rows.append({
            "cfg_id":    cfg.cfg_id,
            "query_id":  q["query_id"],
            "family":    q["family"],
            "latency_ms": round(dt, 4),
            **m,
        })

    n = max(1, len(rows))
    summary = {
        "cfg_id":     cfg.cfg_id,
        "config":     asdict(cfg),
        "n_queries":  len(rows),
        "mrr":        sum(r["mrr"] for r in rows) / n,
        "hit_at_1":   sum(r["hit@1"]  for r in rows) / n,
        "hit_at_3":   sum(r["hit@3"]  for r in rows) / n,
        "hit_at_5":   sum(r["hit@5"]  for r in rows) / n,
        "hit_at_10":  sum(r["hit@10"] for r in rows) / n,
        "hit_at_20":  sum(r["hit@20"] for r in rows) / n,
        "ndcg_at_10": sum(r["ndcg@10"] for r in rows) / n,
        "latency_ms_mean": sum(latencies) / n,
        "latency_ms_p95":  _p95(latencies),
    }
    return rows, summary


def _p95(values: list[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    idx = int(0.95 * (len(s) - 1))
    return s[idx]


def write_eval_jsonl(stage: str, rows: list[dict], summary: dict) -> Path:
    out_dir = RESULTS_DIR / stage
    out_dir.mkdir(parents=True, exist_ok=True)
    rows_path = out_dir / f"{summary['cfg_id']}.rows.jsonl"
    summary_path = out_dir / f"{summary['cfg_id']}.summary.json"
    write_jsonl(rows_path, rows)
    summary_path.write_text(
        json.dumps(summary, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return rows_path
