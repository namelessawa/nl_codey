"""E4 batched — encodes ALL queries in one big batch (vectorized).

Drop-in replacement for E4_dense_models.py that batches queries
properly. The original encoded one query at a time which left the
A100 at 3% utilization. This version:

  1. Pre-encodes all docs once (already in cache or via embedder).
  2. Pre-encodes ALL queries in one big batched call.
  3. Computes `Q @ D.T` as a single numpy / torch matmul.
  4. Per query, picks top-k via argpartition + sorts.

Expected speedup: ~50-100x for query loops.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from _common import CORPORA_DIR, RESULTS_DIR, log
from _dense import REGISTERED_MODELS, encode_corpus, get_embedder
from _eval import EvalConfig, load_corpus, load_queries, write_eval_jsonl
from _metrics import score_query


STAGE = "E4"


def run(corpus: str, model_name: str, mock: bool = False) -> dict:
    log(f"=== E4 dense (batched): corpus={corpus} model={model_name} mock={mock} ===")
    embedder = get_embedder(model_name, mock=mock)
    docs = load_corpus(corpus)
    queries = load_queries(corpus)

    doc_ids, doc_vecs_list = encode_corpus(embedder, corpus, docs)
    doc_vecs = np.asarray(doc_vecs_list, dtype=np.float32)
    # Already L2-normalized on encode; double-norm is a no-op but safe.
    norms = np.linalg.norm(doc_vecs, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    doc_vecs = doc_vecs / norms
    log(f"[E4] docs encoded: {doc_vecs.shape}")

    # BIG batched query encoding.
    query_texts = [q["query"] for q in queries]
    t0 = time.perf_counter()
    query_vecs_list = embedder.encode(query_texts, batch_size=512)
    query_vecs = np.asarray(query_vecs_list, dtype=np.float32)
    qnorms = np.linalg.norm(query_vecs, axis=1, keepdims=True)
    qnorms[qnorms == 0] = 1.0
    query_vecs = query_vecs / qnorms
    log(f"[E4] queries encoded: {query_vecs.shape}  ({time.perf_counter() - t0:.1f}s)")

    cfg = EvalConfig(
        corpus=corpus, retriever="dense",
        dense_model=embedder.name, top_k=20,
        notes="E4 batched dense sweep",
    )

    # One big matmul: Q (n_q, d) @ D.T (d, n_doc) → (n_q, n_doc)
    t0 = time.perf_counter()
    # Process in slices so we never allocate (n_q × n_doc) for huge cases.
    n_q = query_vecs.shape[0]
    SLICE = 8192
    rows: list[dict] = []
    latencies: list[float] = []
    target_ids = [q["target_id"] for q in queries]
    families = [q["family"] for q in queries]
    query_ids = [q["query_id"] for q in queries]
    top_k = cfg.top_k

    for start in range(0, n_q, SLICE):
        end = min(start + SLICE, n_q)
        q_slice = query_vecs[start:end]
        scores = q_slice @ doc_vecs.T          # (slice, n_doc)
        # argpartition for top_k indices per row.
        if top_k < scores.shape[1]:
            idx_part = np.argpartition(-scores, top_k, axis=1)[:, :top_k]
            # Then sort within the top_k.
            sliced = np.take_along_axis(scores, idx_part, axis=1)
            order = np.argsort(-sliced, axis=1)
            ranked_idx = np.take_along_axis(idx_part, order, axis=1)
        else:
            ranked_idx = np.argsort(-scores, axis=1)[:, :top_k]
        for offset in range(end - start):
            qi = start + offset
            ranked = [doc_ids[i] for i in ranked_idx[offset]]
            m = score_query(ranked, target_ids[qi])
            rows.append({
                "cfg_id":    cfg.cfg_id,
                "query_id":  query_ids[qi],
                "family":    families[qi],
                "latency_ms": 0.0,   # batched — per-query latency meaningless
                **m,
            })
    elapsed = time.perf_counter() - t0
    log(f"[E4] scored {n_q} queries via matmul in {elapsed:.1f}s  ({n_q / elapsed:.0f} q/s)")

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
        "latency_ms_mean": elapsed * 1000.0 / n,
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
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--models", nargs="*", default=None)
    ap.add_argument("--corpora", nargs="*", default=None)
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
                import traceback; traceback.print_exc()
    out = write_index_csv(summaries)
    log(f"E4 INDEX → {out}  ({len(summaries)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
