"""E4 — subsampled to 1500 random queries per corpus (per-family
proportional).

Why: CPU dense encoding on the remote takes ~12 min per (model, corpus)
cell for cpython-scale corpora. The full sweep would take 15+ hours.
Subsampling to 1500 queries per corpus keeps statistical power
(±2.5% MRR at 95% CI for hit rates near 0.3) and cuts encoding to
~2 min per cell.

The subsampling is deterministic (seed=42) and stratified by family
so per-family ablation (E7-style) is still tractable per (corpus, model).
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from _common import CORPORA_DIR, RESULTS_DIR, log
from _eval import EvalConfig, load_corpus, load_queries, write_eval_jsonl
from _metrics import score_query


STAGE = "E4"
SUBSAMPLE_N = 1500


def stratified_subsample(queries: list[dict], n: int, seed: int = 42) -> list[dict]:
    """Sample `n` queries, proportionally across families, deterministically."""
    by_family: dict[str, list[dict]] = defaultdict(list)
    for q in queries:
        by_family[q["family"]].append(q)
    families = sorted(by_family.keys())
    total = sum(len(v) for v in by_family.values())
    if total <= n:
        return queries
    rng = random.Random(seed)
    picked: list[dict] = []
    quotas = {fam: max(1, round(len(by_family[fam]) * n / total)) for fam in families}
    # Adjust quotas to sum to n
    while sum(quotas.values()) > n:
        biggest = max(quotas, key=lambda f: quotas[f])
        quotas[biggest] -= 1
    while sum(quotas.values()) < n:
        smallest = min(quotas, key=lambda f: quotas[f])
        quotas[smallest] += 1
    for fam in families:
        sub = by_family[fam][:]
        rng.shuffle(sub)
        picked.extend(sub[:quotas[fam]])
    rng.shuffle(picked)
    return picked


def get_cpu_embedder(model_name: str):
    from sentence_transformers import SentenceTransformer
    log(f"[dense-cpu] loading {model_name}")
    model = SentenceTransformer(model_name, device='cpu')
    embedder_name = model_name.replace("/", "__")
    class _E:
        name = embedder_name
        dim = model.get_sentence_embedding_dimension() or 0
        def __init__(self, mdl): self.model = mdl
        def encode(self, texts, batch_size=128):
            return self.model.encode(
                list(texts), batch_size=batch_size,
                convert_to_numpy=True, normalize_embeddings=True,
                show_progress_bar=False).tolist()
        def cache_dir(self):
            d = CORPORA_DIR / "_embed_cache" / embedder_name
            d.mkdir(parents=True, exist_ok=True)
            return d
    return _E(model)


def run(corpus: str, model_name: str) -> dict:
    log(f"=== E4 subsample: corpus={corpus} model={model_name} ===")
    embedder = get_cpu_embedder(model_name)
    docs = load_corpus(corpus)
    queries = load_queries(corpus)
    queries = stratified_subsample(queries, SUBSAMPLE_N)
    log(f"  subsampled to {len(queries)} queries")

    # Encode docs (cached after first time per model+corpus).
    from _dense import encode_corpus
    doc_ids, doc_vecs_list = encode_corpus(embedder, corpus, docs)
    doc_vecs = np.asarray(doc_vecs_list, dtype=np.float32)
    norms = np.linalg.norm(doc_vecs, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    doc_vecs = doc_vecs / norms

    query_texts = [q["query"] for q in queries]
    t0 = time.perf_counter()
    query_vecs = np.asarray(embedder.encode(query_texts, batch_size=128),
                            dtype=np.float32)
    qnorms = np.linalg.norm(query_vecs, axis=1, keepdims=True)
    qnorms[qnorms == 0] = 1.0
    query_vecs = query_vecs / qnorms
    log(f"[E4] queries encoded: {query_vecs.shape}  ({time.perf_counter() - t0:.1f}s)")

    cfg = EvalConfig(
        corpus=corpus, retriever="dense",
        dense_model=embedder.name, top_k=20,
        notes=f"E4 cpu-subsample n={SUBSAMPLE_N}",
    )
    t0 = time.perf_counter()
    scores = query_vecs @ doc_vecs.T
    rows: list[dict] = []
    target_ids = [q["target_id"] for q in queries]
    families = [q["family"] for q in queries]
    query_ids = [q["query_id"] for q in queries]
    ranked_all = np.argsort(-scores, axis=1)[:, :cfg.top_k]
    for i in range(scores.shape[0]):
        ranked = [doc_ids[idx] for idx in ranked_all[i]]
        m = score_query(ranked, target_ids[i])
        rows.append({
            "cfg_id":    cfg.cfg_id,
            "query_id":  query_ids[i],
            "family":    families[i],
            "latency_ms": 0.0,
            **m,
        })
    elapsed = time.perf_counter() - t0
    log(f"[E4] scored {len(rows)} queries in {elapsed:.1f}s")
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
    ap.add_argument("--models", nargs="*", default=None)
    ap.add_argument("--corpora", nargs="*", default=None)
    args = ap.parse_args()
    corpora = args.corpora or ["coding-agent", "MiMo-Code", "cpython-lib"]
    # Strongest representative subset.
    models = args.models or [
        "sentence-transformers/all-MiniLM-L6-v2",
        "sentence-transformers/all-mpnet-base-v2",
        "BAAI/bge-base-en-v1.5",
        "intfloat/e5-base-v2",
    ]
    summaries: list[dict] = []
    for corpus in corpora:
        for model in models:
            try:
                summaries.append(run(corpus, model))
            except Exception as e:
                log(f"!! {corpus}/{model} failed: {e}")
                import traceback; traceback.print_exc()
    out = write_index_csv(summaries)
    log(f"E4 INDEX → {out}  ({len(summaries)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
