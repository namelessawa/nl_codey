"""E1 — BM25 (k1, b) hyperparameter grid sweep across all corpora.

For each corpus:
  - Build ONE BM25Index per tokenizer (default: subtoken).
  - Score each of 35 (k1, b) configs against ALL queries.
  - Write per-config summary + per-query rows.

The index is reused across the 35 configs because k1 / b are scoring-
time parameters, not index-time. This is what makes the sweep tractable
on a single CPU core (~minutes for the whole grid on coding-agent).

Output:
    results/E1/<cfg_id>.summary.json
    results/E1/<cfg_id>.rows.jsonl
    results/E1/INDEX.csv  (all summaries flattened)

Usage:
    python scripts/E1_bm25_grid.py                       # all corpora
    python scripts/E1_bm25_grid.py coding-agent MiMo-Code
"""
from __future__ import annotations

import csv
import sys
import time
from pathlib import Path

from _bm25 import BM25Index
from _common import CORPORA_DIR, RESULTS_DIR, log
from _eval import EvalConfig, build_index, evaluate_bm25, load_corpus, load_queries, write_eval_jsonl


# Pre-registered grid (DESIGN.md §5).
K1_VALUES = (0.5, 0.9, 1.2, 1.5, 1.8, 2.0, 2.5)
B_VALUES  = (0.0, 0.25, 0.5, 0.75, 1.0)
TOKENIZER = "subtoken"   # E1 pins tokenizer; E8 sweeps it.

STAGE = "E1"


def run_corpus(corpus: str) -> list[dict]:
    log(f"=== E1 sweep: {corpus} ===")
    # Build the index ONCE (the most expensive step).
    docs = load_corpus(corpus)
    log(f"{corpus}: building BM25 index over {len(docs)} docs ({TOKENIZER})")
    t0 = time.perf_counter()
    idx = BM25Index(TOKENIZER)
    idx.fit(docs)
    log(f"{corpus}: fit done in {time.perf_counter() - t0:.2f}s, avgdl={idx.avgdl:.1f}, vocab={len(idx.idf)}")

    queries = load_queries(corpus)
    log(f"{corpus}: {len(queries)} queries loaded")

    all_summaries: list[dict] = []
    n_cfgs = len(K1_VALUES) * len(B_VALUES)
    cfg_idx = 0
    for k1 in K1_VALUES:
        for b in B_VALUES:
            cfg_idx += 1
            cfg = EvalConfig(
                corpus=corpus,
                retriever="bm25",
                tokenizer=TOKENIZER,
                k1=k1, b=b,
                floor_ratio=0.0,
                min_score=None,
                top_k=20,
                notes="E1 grid sweep",
            )
            t1 = time.perf_counter()
            rows, summary = evaluate_bm25(cfg, queries, index=idx)
            dt = time.perf_counter() - t1
            write_eval_jsonl(STAGE, rows, summary)
            log(f"  [{cfg_idx:2d}/{n_cfgs}] k1={k1:.2f} b={b:.2f}  "
                f"MRR={summary['mrr']:.4f} H@1={summary['hit_at_1']:.4f} "
                f"H@10={summary['hit_at_10']:.4f}  ({dt:.1f}s)")
            all_summaries.append(summary)
    return all_summaries


def flatten_summary(s: dict) -> dict:
    cfg = s["config"]
    flat = dict(cfg)
    flat["cfg_id"] = s["cfg_id"]
    flat["n_queries"] = s["n_queries"]
    for k in ("mrr", "hit_at_1", "hit_at_3", "hit_at_5", "hit_at_10",
             "hit_at_20", "ndcg_at_10", "latency_ms_mean", "latency_ms_p95"):
        flat[k] = s[k]
    return flat


def write_index_csv(summaries: list[dict]) -> Path:
    out = RESULTS_DIR / STAGE / "INDEX.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    rows = [flatten_summary(s) for s in summaries]
    if not rows:
        return out
    keys = sorted(rows[0].keys())
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=keys)
        w.writeheader()
        for r in rows:
            w.writerow(r)
    return out


def main() -> int:
    sel = sys.argv[1:]
    if not sel:
        sel = [p.parent.name for p in CORPORA_DIR.glob("*/corpus.jsonl")]
    summaries: list[dict] = []
    for corpus in sel:
        try:
            summaries.extend(run_corpus(corpus))
        except Exception as e:
            log(f"!! {corpus} failed: {e}")
    out = write_index_csv(summaries)
    log(f"E1 INDEX → {out}  ({len(summaries)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
