"""E5 — hybrid retriever fusion sweep.

For each corpus:
  - Pin best BM25 (k1, b, tokenizer) — read from E1 INDEX (fallback to literature
    defaults if missing).
  - Pin best dense model — read from E4 INDEX (fallback to mock).
  - For each (fusion_method, alpha or rrf_k), produce one ranked list per
    query and compute metrics.

Output: results/E5/<cfg_id>.{summary.json, rows.jsonl} + INDEX.csv.

Runs on the GPU server (because dense scoring is the bottleneck) or
locally with `--mock`.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

from _bm25 import BM25Index
from _common import CORPORA_DIR, RESULTS_DIR, log
from _dense import dense_score, encode_corpus, get_embedder
from _eval import EvalConfig, load_corpus, load_queries, write_eval_jsonl
from _hybrid import comb_sum, rrf, weighted_sum
from _metrics import score_query


STAGE = "E5"
TOKENIZER = "subtoken"

ALPHAS = (0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0)
RRF_KS = (10, 30, 60, 100)


def best_bm25(corpus: str) -> tuple[float, float]:
    p = RESULTS_DIR / "E1" / "INDEX.csv"
    fallback = (1.5, 0.75)
    if not p.exists():
        return fallback
    best_mrr = -1.0
    best = fallback
    with p.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r.get("corpus") != corpus:
                continue
            mrr = float(r["mrr"])
            if mrr > best_mrr:
                best_mrr = mrr
                best = (float(r["k1"]), float(r["b"]))
    return best


def best_dense(corpus: str) -> str:
    p = RESULTS_DIR / "E4" / "INDEX.csv"
    if not p.exists():
        return "mock"
    best_mrr = -1.0
    best = "mock"
    with p.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r.get("corpus") != corpus:
                continue
            mrr = float(r["mrr"])
            if mrr > best_mrr:
                best_mrr = mrr
                best = r["dense_model"]
    return best


def run_corpus(corpus: str, mock_dense: bool = False) -> list[dict]:
    log(f"=== E5 hybrid: {corpus} ===")
    k1, b = best_bm25(corpus)
    dense_model = "mock" if mock_dense else best_dense(corpus)
    log(f"  pinned BM25=(k1={k1}, b={b})  dense={dense_model}")

    docs = load_corpus(corpus)
    queries = load_queries(corpus)
    bm25 = BM25Index(TOKENIZER)
    bm25.fit(docs)
    embedder = get_embedder(dense_model, mock=mock_dense)
    doc_ids, doc_vecs = encode_corpus(embedder, corpus, docs)

    # Precompute BM25 + dense top-K for each query ONCE; fusion is then trivial.
    log(f"  precomputing per-query rank lists (n={len(queries)})…")
    bm25_lists: list[list[tuple[str, float]]] = []
    dense_lists: list[list[tuple[str, float]]] = []
    for q in queries:
        bm25_lists.append(bm25.score(q["query"], k1=k1, b=b, top_k=50))
        dense_lists.append(dense_score(q["query"], embedder, doc_ids, doc_vecs, top_k=50))

    def _run_fusion(name: str, fuse, extra: dict):
        cfg = EvalConfig(
            corpus=corpus, retriever=name,
            tokenizer=TOKENIZER, k1=k1, b=b,
            dense_model=dense_model,
            top_k=20, notes=f"E5 {name}",
            **extra,
        )
        rows, summary = _score(queries, bm25_lists, dense_lists, fuse, cfg)
        write_eval_jsonl(STAGE, rows, summary)
        log(f"  {name:14s} {extra}  MRR={summary['mrr']:.4f} "
            f"H@1={summary['hit_at_1']:.4f} H@10={summary['hit_at_10']:.4f}")
        return summary

    out = []
    for alpha in ALPHAS:
        out.append(_run_fusion(
            "hybrid_wsum",
            lambda a, b_, _alpha=alpha: weighted_sum(a, b_, alpha=_alpha, top_k=20),
            {"fusion_alpha": alpha},
        ))
    for k in RRF_KS:
        out.append(_run_fusion(
            "hybrid_rrf",
            lambda a, b_, _k=k: rrf(a, b_, rrf_k=_k, top_k=20),
            {"rrf_k": k},
        ))
    out.append(_run_fusion(
        "hybrid_combsum",
        lambda a, b_: comb_sum(a, b_, top_k=20),
        {},
    ))
    return out


def _score(queries, a_lists, b_lists, fuse, cfg) -> tuple[list[dict], dict]:
    rows: list[dict] = []
    latencies: list[float] = []
    for q, a, b in zip(queries, a_lists, b_lists):
        t0 = time.perf_counter()
        hits = fuse(a, b)
        dt = (time.perf_counter() - t0) * 1000.0
        latencies.append(dt)
        ranked = [h[0] for h in hits]
        m = score_query(ranked, q["target_id"])
        rows.append({
            "cfg_id":     cfg.cfg_id,
            "query_id":   q["query_id"],
            "family":     q["family"],
            "latency_ms": round(dt, 4),
            **m,
        })
    n = max(1, len(rows))
    summary = {
        "cfg_id":     cfg.cfg_id,
        "config":     {**cfg.__dict__},
        "n_queries":  len(rows),
        "mrr":        sum(r["mrr"] for r in rows) / n,
        "hit_at_1":   sum(r["hit@1"]  for r in rows) / n,
        "hit_at_3":   sum(r["hit@3"]  for r in rows) / n,
        "hit_at_5":   sum(r["hit@5"]  for r in rows) / n,
        "hit_at_10":  sum(r["hit@10"] for r in rows) / n,
        "hit_at_20":  sum(r["hit@20"] for r in rows) / n,
        "ndcg_at_10": sum(r["ndcg@10"] for r in rows) / n,
        "latency_ms_mean": sum(latencies) / n,
    }
    return rows, summary


def write_index_csv(summaries: list[dict]) -> Path:
    out = RESULTS_DIR / STAGE / "INDEX.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    if not summaries:
        return out
    fieldnames = ["corpus", "retriever", "k1", "b", "dense_model",
                  "fusion_alpha", "rrf_k", "n_queries",
                  "mrr", "hit_at_1", "hit_at_3", "hit_at_5",
                  "hit_at_10", "hit_at_20", "ndcg_at_10",
                  "latency_ms_mean", "cfg_id"]
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        for s in summaries:
            cfg = s["config"]
            row = {k: cfg.get(k) for k in
                   ("corpus", "retriever", "k1", "b", "dense_model",
                    "fusion_alpha", "rrf_k")}
            row["cfg_id"] = s["cfg_id"]
            for k in ("n_queries", "mrr", "hit_at_1", "hit_at_3", "hit_at_5",
                      "hit_at_10", "hit_at_20", "ndcg_at_10", "latency_ms_mean"):
                row[k] = s[k]
            w.writerow(row)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mock", action="store_true",
                    help="Use HashedMockEmbedder (no torch).")
    ap.add_argument("--corpora", nargs="*", default=None)
    args = ap.parse_args()
    sel = args.corpora or [p.parent.name for p in CORPORA_DIR.glob("*/corpus.jsonl")]
    summaries: list[dict] = []
    for corpus in sel:
        try:
            summaries.extend(run_corpus(corpus, mock_dense=args.mock))
        except Exception as e:
            log(f"!! {corpus} failed: {e}")
    out = write_index_csv(summaries)
    log(f"E5 INDEX → {out}  ({len(summaries)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
