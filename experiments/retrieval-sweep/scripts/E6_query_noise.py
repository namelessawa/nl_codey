"""E6 — query-noise robustness sweep (BM25 baseline, all-corpus).

For each corpus:
  - Pin (k1, b, tokenizer, floor) = literature default.
  - For each noise kind × rate, corrupt each query (deterministically),
    re-score, log per-noise summary.

The actual MRR drop CURVE per noise level is the primary output —
plotted in F.

Output: results/E6/<cfg_id>.{summary.json, rows.jsonl} + INDEX.csv.
"""
from __future__ import annotations

import csv
import sys
import time
from pathlib import Path

from _bm25 import BM25Index
from _common import CORPORA_DIR, RESULTS_DIR, log
from _eval import EvalConfig, load_corpus, load_queries, write_eval_jsonl
from _metrics import score_query
from _noise import NOISES


STAGE = "E6"
TOKENIZER = "subtoken"
K1, B = 1.5, 0.75
FLOOR_RATIO = 0.15
TOP_K = 20

NOISE_RATES = (0.0, 0.05, 0.10, 0.20, 0.30)
NOISE_KINDS = ("none", "char_del", "char_ins", "char_sub", "word_del", "case_flip")


def evaluate_noisy(
    cfg: EvalConfig,
    queries: list[dict],
    index: BM25Index,
    noise_kind: str,
    noise_rate: float,
) -> tuple[list[dict], dict]:
    """Like evaluate_bm25 but each query is mutated before scoring."""
    noise_fn = NOISES[noise_kind]
    rows: list[dict] = []
    latencies: list[float] = []
    for q in queries:
        noisy = noise_fn(q["query"], noise_rate, q["query_id"])
        t0 = time.perf_counter()
        hits = index.score(
            noisy,
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
            "cfg_id":     cfg.cfg_id,
            "query_id":   q["query_id"],
            "family":     q["family"],
            "noise_kind": noise_kind,
            "noise_rate": noise_rate,
            "latency_ms": round(dt, 4),
            **m,
        })
    n = max(1, len(rows))
    summary = {
        "cfg_id":     cfg.cfg_id,
        "config":     {**cfg.__dict__},
        "noise_kind": noise_kind,
        "noise_rate": noise_rate,
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


def run_corpus(corpus: str) -> list[dict]:
    log(f"=== E6 noise sweep: {corpus} ===")
    docs = load_corpus(corpus)
    queries = load_queries(corpus)
    idx = BM25Index(TOKENIZER)
    idx.fit(docs)
    out: list[dict] = []
    cfg = EvalConfig(
        corpus=corpus, retriever="bm25", tokenizer=TOKENIZER,
        k1=K1, b=B, floor_ratio=FLOOR_RATIO,
        top_k=TOP_K, notes="E6 query-noise sweep",
    )
    for kind in NOISE_KINDS:
        for rate in NOISE_RATES:
            if kind == "none" and rate != 0.0:
                continue
            t0 = time.perf_counter()
            rows, summary = evaluate_noisy(cfg, queries, idx, kind, rate)
            dt = time.perf_counter() - t0
            # Compute a NEW cfg_id per (kind, rate) so the JSONLs don't
            # overwrite. Mix kind+rate into a derived id.
            import hashlib
            tag = f"{cfg.cfg_id}_{kind}_{rate}"
            summary["cfg_id"] = hashlib.sha1(tag.encode()).hexdigest()[:16]
            write_eval_jsonl(STAGE, rows, summary)
            log(f"  {kind:10s} rate={rate:.2f}  MRR={summary['mrr']:.4f} "
                f"H@1={summary['hit_at_1']:.4f} H@10={summary['hit_at_10']:.4f}  ({dt:.1f}s)")
            out.append(summary)
    return out


def write_index_csv(summaries: list[dict]) -> Path:
    out = RESULTS_DIR / STAGE / "INDEX.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    if not summaries:
        return out
    fieldnames = ["corpus", "noise_kind", "noise_rate",
                  "k1", "b", "floor_ratio", "n_queries",
                  "mrr", "hit_at_1", "hit_at_3", "hit_at_5",
                  "hit_at_10", "hit_at_20", "ndcg_at_10",
                  "latency_ms_mean", "cfg_id"]
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        for s in summaries:
            cfg = s["config"]
            row = {k: cfg.get(k) for k in
                   ("corpus", "k1", "b", "floor_ratio")}
            row["noise_kind"] = s["noise_kind"]
            row["noise_rate"] = s["noise_rate"]
            row["cfg_id"] = s["cfg_id"]
            for k in ("n_queries", "mrr", "hit_at_1", "hit_at_3", "hit_at_5",
                      "hit_at_10", "hit_at_20", "ndcg_at_10", "latency_ms_mean"):
                row[k] = s[k]
            w.writerow(row)
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
    log(f"E6 INDEX → {out}  ({len(summaries)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
