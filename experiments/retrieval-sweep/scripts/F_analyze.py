"""F — aggregate every stage's results into one flat CSV + per-stage
analysis tables + the headline plots referenced in REPORT.md.

Reads from results/E*/<cfg_id>.summary.json — NEVER from INDEX.csv,
because INDEX is only written at stage exit and can lag mid-run.

Outputs:
  results/MASTER.csv             — every (cfg, family-or-summary) row
  plots/E1_k1_b_heatmap_<corpus>.png  — BM25 (k1, b) MRR heatmap per corpus
  plots/E2_floor_<corpus>.png         — relative vs absolute floor MRR bars
  plots/E3_size_scaling_<corpus>.png  — MRR vs corpus_subset_n per floor strat
  plots/E6_noise_curves_<corpus>.png  — MRR vs noise_rate per kind
  plots/E7_family_<corpus>.png        — per-query-family MRR bars
  plots/E8_tokenizer_<corpus>.png     — per-tokenizer MRR bars

If matplotlib is unavailable, the script still emits the CSV — the
plots are skipped with a log message.
"""
from __future__ import annotations

import csv
import glob
import json
import sys
from collections import defaultdict
from pathlib import Path

from _common import RESULTS_DIR, PLOTS_DIR, log


# ----------------------------------------------------------------------
# Aggregation
# ----------------------------------------------------------------------

def load_all_summaries() -> list[dict]:
    rows: list[dict] = []
    for stage_dir in sorted(RESULTS_DIR.glob("E*")):
        stage = stage_dir.name
        for jf in stage_dir.glob("*.summary.json"):
            try:
                s = json.load(jf.open(encoding="utf-8"))
            except Exception as e:
                log(f"  skip {jf}: {e}")
                continue
            cfg = s.get("config", {})
            flat = {"stage": stage, "cfg_id": s.get("cfg_id")}
            for k in ("corpus", "retriever", "tokenizer", "k1", "b",
                      "floor_ratio", "min_score", "top_k",
                      "corpus_subset_n", "dense_model",
                      "fusion_alpha", "rrf_k"):
                flat[k] = cfg.get(k)
            # Bring stage-specific fields up to top-level for easy filtering.
            for k in ("family", "floor_label", "noise_kind", "noise_rate",
                      "subset_n"):
                if k in s:
                    flat[k] = s[k]
            for k in ("n_queries", "mrr", "hit_at_1", "hit_at_3", "hit_at_5",
                      "hit_at_10", "hit_at_20", "ndcg_at_10",
                      "latency_ms_mean", "latency_ms_p95"):
                flat[k] = s.get(k)
            rows.append(flat)
    return rows


def write_master_csv(rows: list[dict]) -> Path:
    out = RESULTS_DIR / "MASTER.csv"
    if not rows:
        out.write_text("", encoding="utf-8")
        return out
    keys: list[str] = []
    seen = set()
    for r in rows:
        for k in r.keys():
            if k not in seen:
                keys.append(k)
                seen.add(k)
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=keys)
        w.writeheader()
        for r in rows:
            w.writerow(r)
    return out


# ----------------------------------------------------------------------
# Per-stage analysis tables
# ----------------------------------------------------------------------

def per_stage_summary(rows: list[dict]) -> dict:
    by_stage_corpus: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in rows:
        by_stage_corpus[(r["stage"], r["corpus"])].append(r)
    out: dict = {}
    for (stage, corpus), rs in by_stage_corpus.items():
        rs_sorted = sorted(rs, key=lambda r: -(r.get("mrr") or 0))
        out[f"{stage}/{corpus}"] = {
            "n_configs": len(rs),
            "best_mrr": rs_sorted[0]["mrr"] if rs_sorted else None,
            "best_config": {k: rs_sorted[0].get(k) for k in
                            ("k1", "b", "tokenizer", "floor_ratio",
                             "floor_label", "noise_kind", "noise_rate",
                             "family", "subset_n", "dense_model",
                             "fusion_alpha", "rrf_k")
                            if rs_sorted[0].get(k) is not None},
            "worst_mrr": rs_sorted[-1]["mrr"] if rs_sorted else None,
        }
    return out


# ----------------------------------------------------------------------
# Plots (matplotlib optional)
# ----------------------------------------------------------------------

def _try_matplotlib():
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        return plt
    except Exception as e:
        log(f"  matplotlib unavailable, skipping plots: {e}")
        return None


def _save(plt, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    plt.tight_layout()
    plt.savefig(path, dpi=120)
    plt.close()


def plot_E1_heatmaps(rows: list[dict]) -> None:
    plt = _try_matplotlib()
    if plt is None:
        return
    by_corpus: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["stage"] == "E1":
            by_corpus[r["corpus"]].append(r)
    for corpus, rs in by_corpus.items():
        k1s = sorted({r["k1"] for r in rs})
        bs  = sorted({r["b"]  for r in rs})
        # NaN for missing cells so matplotlib draws a blank square instead of
        # raising — partial sweeps still plot what they have.
        import math
        grid = [[float("nan")] * len(bs) for _ in range(len(k1s))]
        for r in rs:
            i = k1s.index(r["k1"])
            j = bs.index(r["b"])
            grid[i][j] = float(r["mrr"]) if r["mrr"] is not None else float("nan")
        fig, ax = plt.subplots(figsize=(6.0, 4.5))
        im = ax.imshow(grid, aspect="auto", cmap="viridis", origin="lower")
        ax.set_xticks(range(len(bs)))
        ax.set_xticklabels([f"{b:.2f}" for b in bs])
        ax.set_yticks(range(len(k1s)))
        ax.set_yticklabels([f"{k:.2f}" for k in k1s])
        ax.set_xlabel("b")
        ax.set_ylabel("k1")
        ax.set_title(f"E1 BM25 MRR — {corpus}")
        for i in range(len(k1s)):
            for j in range(len(bs)):
                v = grid[i][j]
                if v is None:
                    continue
                ax.text(j, i, f"{v:.3f}", ha="center", va="center",
                        color="white" if v < 0.5 * max(map(max, grid)) else "black",
                        fontsize=8)
        plt.colorbar(im, ax=ax)
        _save(plt, PLOTS_DIR / f"E1_k1_b_heatmap_{corpus}.png")
        log(f"  wrote plot E1_k1_b_heatmap_{corpus}.png")


def plot_E2_floor_bars(rows: list[dict]) -> None:
    plt = _try_matplotlib()
    if plt is None:
        return
    by_corpus: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["stage"] == "E2":
            by_corpus[r["corpus"]].append(r)
    for corpus, rs in by_corpus.items():
        rs.sort(key=lambda r: r.get("floor_label") or "")
        labels = [r.get("floor_label", "") for r in rs]
        mrrs = [r["mrr"] for r in rs]
        fig, ax = plt.subplots(figsize=(7.0, 4.2))
        bars = ax.bar(labels, mrrs)
        ax.set_ylabel("MRR")
        ax.set_title(f"E2 floor strategy — {corpus}")
        ax.set_ylim(0, max(mrrs) * 1.15 if mrrs else 1.0)
        for b, m in zip(bars, mrrs):
            ax.text(b.get_x() + b.get_width()/2, m, f"{m:.3f}",
                    ha="center", va="bottom", fontsize=8)
        plt.xticks(rotation=30, ha="right")
        _save(plt, PLOTS_DIR / f"E2_floor_{corpus}.png")
        log(f"  wrote plot E2_floor_{corpus}.png")


def plot_E3_size_scaling(rows: list[dict]) -> None:
    plt = _try_matplotlib()
    if plt is None:
        return
    by_corpus: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["stage"] == "E3":
            by_corpus[r["corpus"]].append(r)
    for corpus, rs in by_corpus.items():
        by_floor: dict[str, list[tuple[int, float]]] = defaultdict(list)
        for r in rs:
            label = r.get("floor_label", "")
            n = r.get("subset_n")
            if n is None or label == "":
                continue
            by_floor[label].append((int(n), r["mrr"]))
        fig, ax = plt.subplots(figsize=(6.5, 4.5))
        for label, pts in sorted(by_floor.items()):
            pts.sort()
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            ax.plot(xs, ys, marker="o", label=label)
        ax.set_xscale("log")
        ax.set_xlabel("Corpus subset size (files)")
        ax.set_ylabel("MRR")
        ax.set_title(f"E3 size scaling — {corpus}")
        ax.legend(fontsize=9)
        _save(plt, PLOTS_DIR / f"E3_size_scaling_{corpus}.png")
        log(f"  wrote plot E3_size_scaling_{corpus}.png")


def plot_E6_noise(rows: list[dict]) -> None:
    plt = _try_matplotlib()
    if plt is None:
        return
    by_corpus: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["stage"] == "E6":
            by_corpus[r["corpus"]].append(r)
    for corpus, rs in by_corpus.items():
        by_kind: dict[str, list[tuple[float, float]]] = defaultdict(list)
        for r in rs:
            by_kind[r.get("noise_kind") or "?"].append(
                (r.get("noise_rate") or 0, r["mrr"]))
        fig, ax = plt.subplots(figsize=(6.5, 4.5))
        for kind in sorted(by_kind):
            pts = sorted(by_kind[kind])
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            ax.plot(xs, ys, marker="o", label=kind)
        ax.set_xlabel("Noise rate")
        ax.set_ylabel("MRR")
        ax.set_title(f"E6 query-noise robustness — {corpus}")
        ax.legend(fontsize=9)
        _save(plt, PLOTS_DIR / f"E6_noise_curves_{corpus}.png")
        log(f"  wrote plot E6_noise_curves_{corpus}.png")


def plot_E7_family(rows: list[dict]) -> None:
    plt = _try_matplotlib()
    if plt is None:
        return
    by_corpus: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["stage"] == "E7":
            by_corpus[r["corpus"]].append(r)
    for corpus, rs in by_corpus.items():
        rs.sort(key=lambda r: -(r["mrr"] or 0))
        labels = [r.get("family", "") for r in rs]
        mrrs = [r["mrr"] for r in rs]
        fig, ax = plt.subplots(figsize=(7.0, 4.2))
        bars = ax.bar(labels, mrrs)
        ax.set_ylabel("MRR")
        ax.set_title(f"E7 per-family — {corpus}")
        for b, m in zip(bars, mrrs):
            ax.text(b.get_x() + b.get_width()/2, m, f"{m:.3f}",
                    ha="center", va="bottom", fontsize=8)
        plt.xticks(rotation=30, ha="right")
        _save(plt, PLOTS_DIR / f"E7_family_{corpus}.png")
        log(f"  wrote plot E7_family_{corpus}.png")


def plot_E4_dense_models(rows: list[dict]) -> None:
    plt = _try_matplotlib()
    if plt is None:
        return
    by_corpus: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["stage"] == "E4":
            by_corpus[r["corpus"]].append(r)
    for corpus, rs in by_corpus.items():
        rs.sort(key=lambda r: -(r["mrr"] or 0))
        labels = [(r.get("dense_model") or "?").replace("sentence-transformers__", "ST/")
                                                .replace("BAAI__", "BAAI/")
                                                .replace("intfloat__", "if/")
                                                .replace("microsoft__", "MS/")
                  for r in rs]
        mrrs = [r["mrr"] for r in rs]
        fig, ax = plt.subplots(figsize=(7.5, 4.5))
        bars = ax.bar(labels, mrrs)
        ax.set_ylabel("MRR")
        ax.set_title(f"E4 dense models — {corpus}")
        for b, m in zip(bars, mrrs):
            ax.text(b.get_x() + b.get_width()/2, m, f"{m:.3f}",
                    ha="center", va="bottom", fontsize=8)
        plt.xticks(rotation=30, ha="right", fontsize=8)
        _save(plt, PLOTS_DIR / f"E4_dense_{corpus}.png")
        log(f"  wrote plot E4_dense_{corpus}.png")


def plot_E8_tokenizer(rows: list[dict]) -> None:
    plt = _try_matplotlib()
    if plt is None:
        return
    by_corpus: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["stage"] == "E8":
            by_corpus[r["corpus"]].append(r)
    for corpus, rs in by_corpus.items():
        rs.sort(key=lambda r: (r.get("tokenizer") or "", r.get("k1") or 0))
        labels = [f"{r.get('tokenizer','')}\nk1={r.get('k1','')}" for r in rs]
        mrrs = [r["mrr"] for r in rs]
        fig, ax = plt.subplots(figsize=(7.0, 4.2))
        bars = ax.bar(labels, mrrs)
        ax.set_ylabel("MRR")
        ax.set_title(f"E8 tokenizer × k1 — {corpus}")
        for b, m in zip(bars, mrrs):
            ax.text(b.get_x() + b.get_width()/2, m, f"{m:.3f}",
                    ha="center", va="bottom", fontsize=8)
        plt.xticks(rotation=45, ha="right", fontsize=8)
        _save(plt, PLOTS_DIR / f"E8_tokenizer_{corpus}.png")
        log(f"  wrote plot E8_tokenizer_{corpus}.png")


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

def main() -> int:
    rows = load_all_summaries()
    log(f"loaded {len(rows)} summaries across stages")
    csv_out = write_master_csv(rows)
    log(f"MASTER.csv → {csv_out}")
    summary = per_stage_summary(rows)
    summary_path = RESULTS_DIR / "stage_summary.json"
    summary_path.write_text(
        json.dumps(summary, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    log(f"stage_summary.json → {summary_path}")
    plot_E1_heatmaps(rows)
    plot_E2_floor_bars(rows)
    plot_E3_size_scaling(rows)
    plot_E4_dense_models(rows)
    plot_E6_noise(rows)
    plot_E7_family(rows)
    plot_E8_tokenizer(rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
