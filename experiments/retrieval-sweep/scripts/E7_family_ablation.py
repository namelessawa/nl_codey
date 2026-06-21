"""E7 — per-query-family ablation.

For each corpus, evaluate BM25 (pinned best k1/b/floor) on EACH of the
7 query families separately. Reports which families BM25 is strong on
vs. weak on — this is the input to RQ2 (which retriever family on which
query family).

Output: results/E7/<cfg_id>.{summary.json, rows.jsonl} + INDEX.csv.
"""
from __future__ import annotations

import csv
import sys
import time
from collections import defaultdict
from pathlib import Path

from _bm25 import BM25Index
from _common import CORPORA_DIR, RESULTS_DIR, log
from _eval import EvalConfig, evaluate_bm25, load_corpus, load_queries, write_eval_jsonl


STAGE = "E7"
TOKENIZER = "subtoken"
K1, B = 1.5, 0.75
FLOOR_RATIO = 0.15

FAMILIES = ("func_name", "docstring", "test_name", "call_site",
            "import_target", "commit_msg", "mutated_id")


def run_corpus(corpus: str) -> list[dict]:
    log(f"=== E7 family ablation: {corpus} ===")
    docs = load_corpus(corpus)
    queries = load_queries(corpus)
    by_family: dict[str, list[dict]] = defaultdict(list)
    for q in queries:
        by_family[q["family"]].append(q)

    idx = BM25Index(TOKENIZER)
    idx.fit(docs)

    out: list[dict] = []
    for fam in FAMILIES:
        qs = by_family.get(fam, [])
        if not qs:
            log(f"  {fam:14s} (no queries)")
            continue
        cfg = EvalConfig(
            corpus=corpus, retriever="bm25", tokenizer=TOKENIZER,
            k1=K1, b=B, floor_ratio=FLOOR_RATIO,
            top_k=20,
            notes=f"E7 family={fam}",
        )
        t0 = time.perf_counter()
        rows, summary = evaluate_bm25(cfg, qs, index=idx)
        dt = time.perf_counter() - t0
        write_eval_jsonl(STAGE, rows, summary)
        summary["family"] = fam
        log(f"  {fam:14s} n={len(qs):>5}  MRR={summary['mrr']:.4f} "
            f"H@1={summary['hit_at_1']:.4f} H@10={summary['hit_at_10']:.4f}  ({dt:.1f}s)")
        out.append(summary)
    return out


def write_index_csv(summaries: list[dict]) -> Path:
    out = RESULTS_DIR / STAGE / "INDEX.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    if not summaries:
        return out
    fieldnames = ["corpus", "family", "tokenizer", "k1", "b",
                  "floor_ratio", "n_queries",
                  "mrr", "hit_at_1", "hit_at_3", "hit_at_5",
                  "hit_at_10", "hit_at_20", "ndcg_at_10",
                  "latency_ms_mean", "cfg_id"]
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        for s in summaries:
            cfg = s["config"]
            row = {k: cfg.get(k) for k in
                   ("corpus", "tokenizer", "k1", "b", "floor_ratio")}
            row["family"] = s.get("family", "")
            row["cfg_id"] = s["cfg_id"]
            for k in ("n_queries", "mrr", "hit_at_1", "hit_at_3", "hit_at_5",
                      "hit_at_10", "hit_at_20", "ndcg_at_10",
                      "latency_ms_mean"):
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
    log(f"E7 INDEX → {out}  ({len(summaries)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
