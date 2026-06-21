"""E2 — relative vs absolute floor sweep (the central MiMo claim).

Pinned: BM25 with the strongest (k1, b) per corpus (read from E1 INDEX).
If E1 hasn't run yet, fall back to (1.5, 0.75) — the literature default.

Sweep cells:
  - none                      (baseline, floor=0)
  - absolute min_score ∈ {0.5, 1.0, 2.0, 5.0}  (BM25 raw scores ~ 0–10)
  - relative floor_ratio ∈ {0.05, 0.10, 0.15, 0.20, 0.30, 0.50}

= 1 + 4 + 6 = 11 cells per corpus.

Output: results/E2/<cfg_id>.{summary.json, rows.jsonl} + INDEX.csv.
"""
from __future__ import annotations

import csv
import json
import sys
import time
from pathlib import Path

from _bm25 import BM25Index
from _common import CORPORA_DIR, RESULTS_DIR, log
from _eval import EvalConfig, evaluate_bm25, load_corpus, load_queries, write_eval_jsonl


STAGE = "E2"
FALLBACK_K1, FALLBACK_B = 1.5, 0.75
TOKENIZER = "subtoken"


def best_k1_b_for(corpus: str) -> tuple[float, float]:
    """Pick the strongest (k1, b) for `corpus` from E1's emitted summaries.

    Reads `results/E1/*.summary.json` directly so it works even while E1
    is mid-run (the INDEX.csv is only written at stage exit).
    """
    summary_dir = RESULTS_DIR / "E1"
    if not summary_dir.exists():
        log(f"  (no E1 summaries; using fallback ({FALLBACK_K1}, {FALLBACK_B}))")
        return FALLBACK_K1, FALLBACK_B
    best_mrr = -1.0
    best = (FALLBACK_K1, FALLBACK_B)
    for jf in summary_dir.glob("*.summary.json"):
        try:
            s = json.loads(jf.read_text(encoding="utf-8"))
        except Exception:
            continue
        cfg = s.get("config", {})
        if cfg.get("corpus") != corpus:
            continue
        if cfg.get("retriever") != "bm25":
            continue
        mrr = float(s.get("mrr") or 0.0)
        if mrr > best_mrr:
            best_mrr = mrr
            best = (float(cfg["k1"]), float(cfg["b"]))
    if best_mrr < 0:
        log(f"  (no E1 summaries for {corpus}; using fallback)")
        return FALLBACK_K1, FALLBACK_B
    log(f"  best (k1, b) for {corpus} from E1 summaries: {best}  (MRR={best_mrr:.4f})")
    return best


def run_corpus(corpus: str) -> list[dict]:
    log(f"=== E2 sweep: {corpus} ===")
    k1, b = best_k1_b_for(corpus)

    docs = load_corpus(corpus)
    log(f"{corpus}: building BM25 index over {len(docs)} docs")
    idx = BM25Index(TOKENIZER)
    idx.fit(docs)

    queries = load_queries(corpus)
    log(f"{corpus}: {len(queries)} queries loaded; pinned k1={k1} b={b}")

    cells = [
        ("none",          dict(floor_ratio=0.0,  min_score=None)),
        ("abs_0.5",       dict(floor_ratio=0.0,  min_score=0.5)),
        ("abs_1.0",       dict(floor_ratio=0.0,  min_score=1.0)),
        ("abs_2.0",       dict(floor_ratio=0.0,  min_score=2.0)),
        ("abs_5.0",       dict(floor_ratio=0.0,  min_score=5.0)),
        ("rel_0.05",      dict(floor_ratio=0.05, min_score=None)),
        ("rel_0.10",      dict(floor_ratio=0.10, min_score=None)),
        ("rel_0.15",      dict(floor_ratio=0.15, min_score=None)),
        ("rel_0.20",      dict(floor_ratio=0.20, min_score=None)),
        ("rel_0.30",      dict(floor_ratio=0.30, min_score=None)),
        ("rel_0.50",      dict(floor_ratio=0.50, min_score=None)),
    ]
    summaries: list[dict] = []
    for label, kw in cells:
        cfg = EvalConfig(
            corpus=corpus, retriever="bm25", tokenizer=TOKENIZER,
            k1=k1, b=b, top_k=20,
            notes=f"E2 floor sweep — {label}",
            **kw,
        )
        t0 = time.perf_counter()
        rows, summary = evaluate_bm25(cfg, queries, index=idx)
        dt = time.perf_counter() - t0
        write_eval_jsonl(STAGE, rows, summary)
        log(f"  {label:10s} MRR={summary['mrr']:.4f} H@1={summary['hit_at_1']:.4f} "
            f"H@10={summary['hit_at_10']:.4f} nDCG@10={summary['ndcg_at_10']:.4f}  ({dt:.1f}s)")
        # Stash the label so the CSV can group cells.
        summary["floor_label"] = label
        summaries.append(summary)
    return summaries


def write_index_csv(summaries: list[dict]) -> Path:
    out = RESULTS_DIR / STAGE / "INDEX.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    if not summaries:
        return out
    fieldnames = ["corpus", "floor_label", "k1", "b",
                  "floor_ratio", "min_score", "n_queries",
                  "mrr", "hit_at_1", "hit_at_3", "hit_at_5",
                  "hit_at_10", "hit_at_20", "ndcg_at_10",
                  "latency_ms_mean", "latency_ms_p95", "cfg_id"]
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        for s in summaries:
            cfg = s["config"]
            row = {k: cfg.get(k) for k in
                   ("corpus", "k1", "b", "floor_ratio", "min_score")}
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
    log(f"E2 INDEX → {out}  ({len(summaries)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
