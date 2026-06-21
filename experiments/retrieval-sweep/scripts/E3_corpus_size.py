"""E3 — corpus-size sweep. Tests whether the relative-floor advantage
persists / grows / shrinks as the corpus shrinks.

For each corpus, evaluate at N ∈ {100, 500, 1000, 5000, 10000, full}
files (truncated by the deterministic lexicographic walk in 00_collect):
  - One BM25Index per N.
  - Three floor strategies per N: none, absolute (best from E2),
    relative (best from E2).

Only queries whose gold target_id is in the corpus-subset are evaluated
in that cell — otherwise the gold isn't reachable and the score would
be unfairly punished.

Output: results/E3/<cfg_id>.{summary.json, rows.jsonl} + INDEX.csv.
"""
from __future__ import annotations

import csv
import sys
import time
from pathlib import Path

from _bm25 import BM25Index
from _common import CORPORA_DIR, RESULTS_DIR, log
from _eval import EvalConfig, evaluate_bm25, load_corpus, load_queries, write_eval_jsonl


STAGE = "E3"
SUBSET_SIZES = (100, 500, 1000, 5000, 10000)   # plus "full"
PINNED_K1, PINNED_B = 1.5, 0.75                # E1 favorite; revisit after E1 lands
TOKENIZER = "subtoken"

FLOOR_STRATEGIES = [
    ("none",      dict(floor_ratio=0.0, min_score=None)),
    ("abs_2.0",   dict(floor_ratio=0.0, min_score=2.0)),
    ("rel_0.15",  dict(floor_ratio=0.15, min_score=None)),
]


def run_corpus(corpus: str) -> list[dict]:
    log(f"=== E3 sweep: {corpus} ===")
    full_docs = load_corpus(corpus)
    queries = load_queries(corpus)
    sizes = [s for s in SUBSET_SIZES if s < len(full_docs)] + [len(full_docs)]

    out: list[dict] = []
    for n in sizes:
        in_corpus = {d[0] for d in full_docs[:n]}
        reachable_q = [q for q in queries if q["target_id"] in in_corpus]
        log(f"  N={n:>6}  reachable_queries={len(reachable_q)}")
        idx = BM25Index(TOKENIZER)
        idx.fit(full_docs[:n])
        for label, kw in FLOOR_STRATEGIES:
            cfg = EvalConfig(
                corpus=corpus, retriever="bm25", tokenizer=TOKENIZER,
                k1=PINNED_K1, b=PINNED_B, top_k=20,
                corpus_subset_n=n,
                notes=f"E3 size={n} floor={label}",
                **kw,
            )
            t0 = time.perf_counter()
            rows, summary = evaluate_bm25(cfg, reachable_q, index=idx)
            dt = time.perf_counter() - t0
            write_eval_jsonl(STAGE, rows, summary)
            summary["floor_label"] = label
            summary["subset_n"] = n
            log(f"    {label:10s}  N={n:>6}  MRR={summary['mrr']:.4f} "
                f"H@1={summary['hit_at_1']:.4f} H@10={summary['hit_at_10']:.4f}  ({dt:.1f}s)")
            out.append(summary)
    return out


def write_index_csv(summaries: list[dict]) -> Path:
    out = RESULTS_DIR / STAGE / "INDEX.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    if not summaries:
        return out
    fieldnames = ["corpus", "subset_n", "floor_label", "k1", "b",
                  "floor_ratio", "min_score", "n_queries",
                  "mrr", "hit_at_1", "hit_at_3", "hit_at_5",
                  "hit_at_10", "hit_at_20", "ndcg_at_10",
                  "latency_ms_mean", "latency_ms_p95", "cfg_id"]
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        for s in summaries:
            cfg = s["config"]
            row = {k: cfg.get(k) for k in ("corpus", "k1", "b",
                                          "floor_ratio", "min_score")}
            row["subset_n"] = s.get("subset_n")
            row["floor_label"] = s.get("floor_label", "")
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
    log(f"E3 INDEX → {out}  ({len(summaries)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
