"""E4 — dense-retriever model comparison (GPU sweep).

For each (corpus, dense_model):
  - Encode all docs once (cached as JSON in corpora/_embed_cache).
  - For each query, encode + dot product over the doc matrix.
  - Score, log per-config summary.

Designed to run on the remote GPU server (see ship_to_gpu.py / run_remote.sh).
Works locally on CPU too (slow); use `--mock` for pipeline validation.

Output: results/E4/<cfg_id>.{summary.json, rows.jsonl} + INDEX.csv.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

from _common import CORPORA_DIR, RESULTS_DIR, log
from _dense import REGISTERED_MODELS, dense_score, encode_corpus, get_embedder
from _eval import EvalConfig, load_corpus, load_queries, write_eval_jsonl
from _metrics import score_query


STAGE = "E4"


def run(corpus: str, model_name: str, mock: bool = False) -> dict:
    log(f"=== E4 dense: corpus={corpus} model={model_name} mock={mock} ===")
    embedder = get_embedder(model_name, mock=mock)
    docs = load_corpus(corpus)
    queries = load_queries(corpus)

    doc_ids, doc_vecs = encode_corpus(embedder, corpus, docs)
    log(f"[E4] encoded {len(doc_ids)} docs at dim={embedder.dim}")

    cfg = EvalConfig(
        corpus=corpus, retriever="dense",
        dense_model=embedder.name, top_k=20,
        notes="E4 dense sweep",
    )

    rows: list[dict] = []
    latencies: list[float] = []
    for q in queries:
        t0 = time.perf_counter()
        hits = dense_score(q["query"], embedder, doc_ids, doc_vecs, top_k=20)
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
    write_eval_jsonl(STAGE, rows, summary)
    log(f"  MRR={summary['mrr']:.4f} H@1={summary['hit_at_1']:.4f} "
        f"H@10={summary['hit_at_10']:.4f}  ({len(rows)} q)")
    return summary


def write_index_csv(summaries: list[dict]) -> Path:
    out = RESULTS_DIR / STAGE / "INDEX.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    if not summaries:
        return out
    fieldnames = ["corpus", "dense_model", "n_queries",
                  "mrr", "hit_at_1", "hit_at_3", "hit_at_5",
                  "hit_at_10", "hit_at_20", "ndcg_at_10",
                  "latency_ms_mean", "cfg_id"]
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        for s in summaries:
            cfg = s["config"]
            row = {"corpus": cfg.get("corpus"),
                   "dense_model": cfg.get("dense_model")}
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
    ap.add_argument("--models", nargs="*", default=None,
                    help="ST model names. Default = all registered.")
    ap.add_argument("--corpora", nargs="*", default=None,
                    help="Corpus names. Default = all discovered.")
    args = ap.parse_args()

    corpora = args.corpora or [
        p.parent.name for p in CORPORA_DIR.glob("*/corpus.jsonl")
    ]
    models = args.models or (["mock"] if args.mock else list(REGISTERED_MODELS))

    summaries: list[dict] = []
    for corpus in corpora:
        for model in models:
            try:
                summaries.append(run(corpus, model, mock=args.mock))
            except Exception as e:
                log(f"!! {corpus}/{model} failed: {e}")
    out = write_index_csv(summaries)
    log(f"E4 INDEX → {out}  ({len(summaries)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
