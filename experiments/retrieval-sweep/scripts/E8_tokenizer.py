"""E8 — BM25 tokenizer sweep.

Compares the 4 tokenizers (DESIGN.md §5 row 4):
  - whitespace, camel_split, snake_split, subtoken
× 3 representative k1 values × b = 0.75.

Per (corpus, tokenizer) one index, then 3 (k1, b) configs scored.

Output: results/E8/<cfg_id>.{summary.json, rows.jsonl} + INDEX.csv.
"""
from __future__ import annotations

import csv
import sys
import time
from pathlib import Path

from _bm25 import BM25Index
from _common import CORPORA_DIR, RESULTS_DIR, log
from _eval import EvalConfig, evaluate_bm25, load_corpus, load_queries, write_eval_jsonl


STAGE = "E8"
TOKENIZERS = ("whitespace", "camel_split", "snake_split", "subtoken")
K1_VALUES = (0.9, 1.5, 2.0)
B = 0.75


def run_corpus(corpus: str) -> list[dict]:
    log(f"=== E8 sweep: {corpus} ===")
    docs = load_corpus(corpus)
    queries = load_queries(corpus)
    out: list[dict] = []
    for tok in TOKENIZERS:
        log(f"  building BM25 [{tok}] over {len(docs)} docs")
        t_fit = time.perf_counter()
        idx = BM25Index(tok)
        idx.fit(docs)
        log(f"    vocab={len(idx.idf)} avgdl={idx.avgdl:.1f} fit={time.perf_counter()-t_fit:.2f}s")
        for k1 in K1_VALUES:
            cfg = EvalConfig(
                corpus=corpus, retriever="bm25", tokenizer=tok,
                k1=k1, b=B, top_k=20,
                notes=f"E8 tokenizer sweep",
            )
            t0 = time.perf_counter()
            rows, summary = evaluate_bm25(cfg, queries, index=idx)
            dt = time.perf_counter() - t0
            write_eval_jsonl(STAGE, rows, summary)
            log(f"    {tok:12s} k1={k1:.2f}  MRR={summary['mrr']:.4f} "
                f"H@1={summary['hit_at_1']:.4f} H@10={summary['hit_at_10']:.4f}  ({dt:.1f}s)")
            out.append(summary)
    return out


def write_index_csv(summaries: list[dict]) -> Path:
    out = RESULTS_DIR / STAGE / "INDEX.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    if not summaries:
        return out
    fieldnames = ["corpus", "tokenizer", "k1", "b", "n_queries",
                  "mrr", "hit_at_1", "hit_at_3", "hit_at_5",
                  "hit_at_10", "hit_at_20", "ndcg_at_10",
                  "latency_ms_mean", "latency_ms_p95", "cfg_id"]
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        for s in summaries:
            cfg = s["config"]
            row = {k: cfg.get(k) for k in
                   ("corpus", "tokenizer", "k1", "b")}
            row["cfg_id"] = s["cfg_id"]
            for k in ("n_queries", "mrr", "hit_at_1", "hit_at_3", "hit_at_5",
                      "hit_at_10", "hit_at_20", "ndcg_at_10",
                      "latency_ms_mean", "latency_ms_p95"):
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
    log(f"E8 INDEX → {out}  ({len(summaries)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
