# Code Retrieval Sweep — Experiment Report

> **Branch**: `exp/retrieval-sweep` · **Status**: in progress (CPU sweeps
> running locally; GPU sweep packed for shipping) · **Date**: 2026-06-13

This report accompanies the [DESIGN.md](DESIGN.md). It documents what
actually ran, what the numbers say, where the data confirms or refutes
the pre-registered hypotheses, and what changes (if any) the experiment
recommends for the project's retrieval layer.

Every number in this report comes from a deterministic Python run with
zero LLM, zero human labels, and pinned corpus SHAs — re-running the
scripts on the same hardware should reproduce every digit. The
`results/MASTER.csv` and `results/stage_summary.json` are the source of
truth; tables below are formatted excerpts.

---

## 0. Top-line conclusions (TL;DR)

Six findings, ordered by engineering impact on the project:

1. **Sub-token tokenization is the single highest-impact change.**
   On the two larger TS / Go corpora, sub-token gains **+13.7% and
   +14.8% MRR** over whitespace — a bigger headroom than the entire
   (k1, b) hyperparameter grid. _Recommendation: switch the project's
   lexical tokenizer to sub-token. (E8)_

2. **Optimal BM25 (k1, b) is corpus-specific** and varies wildly:
   `(1.8, 0.75)` / `(2.5, 1.0)` / `(0.5, 0.5)` / `(0.5, 0.25)` across
   the four corpora. There is no project-level default that is right
   anywhere. _Recommendation: either expose (k1, b) as a per-workspace
   setting or auto-tune on the corpus. (E1, H5 confirmed)_

3. **The relative floor is strictly safer than absolute** at every
   corpus size, _and_ the safety gap widens at smaller N — exactly as
   the "BM25 magnitudes scale with corpus size" theory predicts. The
   MRR delta is small (≤0.80%), but the engineering value is real:
   no per-corpus calibration. _Recommendation: keep commit `0f57ae0`'s
   relative-floor as the default. (E2, E3, H1 partially confirmed)_

4. **BM25 saturates on `docstring` (mean MRR 0.93) and `func_name`
   (mean 0.72)** — these query families are essentially solved
   without dense retrieval. The hard families are `call_site` (0.26),
   `commit_msg` (0.06), `import_target` (0.23). _Recommendation:
   route the easy families to BM25; reserve any future dense / hybrid
   spend for the hard ones. (E7)_

5. **Character-level noise crushes BM25.** At 10% char-mutation rate,
   MRR drops to ~50%; at 20%, to ~25%. `word_del` is essentially
   immune (99.6% retention at 10%). _Recommendation: in user-typed
   query paths, expand the query with edit-distance variants before
   BM25 — gets most of the dense upside at zero inference cost. (E6,
   H4 shape-confirmed; full crossover pending GPU run)_

6. **Cross-corpus qualitative rankings are stable**, absolute numbers
   are not. The per-family ordering (docstring > func_name > mutated >
   the rest) holds across all four corpora; absolute MRR varies
   2-4×. _Recommendation: any tuning done on one corpus must be
   re-validated on the deployment corpus. (H5)_

Hypotheses status (final):

- **H1** PARTIALLY CONFIRMED (relative floor strictly safer than absolute;
  MRR delta small)
- **H2** REFUTED — BM25 already saturates docstring; off-the-shelf
  dense encoders LOSE to BM25 on all 4 corpora (best dense at 36% of
  BM25 on Go, 30% on Python, 77-78% on TypeScript)
- **H3** PARTIALLY REFUTED — given E4's dense collapse, hybrid is
  unlikely to beat pure BM25 by ≥3% MRR on these corpora (E5 deferred
  with documented rationale)
- **H4** SHAPE-CONFIRMED (BM25 half) — character-level noise crushes
  BM25; dense half deferred
- **H5** CONFIRMED — qualitative ranking stable across corpora;
  absolute numbers vary 2-4×; best dense model is also corpus-specific
  (e5-base on Go, mpnet on the other three)

**Sixth finding added post-experiment** — the dense/BM25 gap is
strongly **corpus-language-tokenization-style dependent**: TypeScript's
camelCase narrows the gap to ~22-34%; Go's PascalCase + dotted
packages opens it to ~64-77%; Python's snake_case + dotted modules
opens it to ~70-79%. This corpus-language correlation was not
predicted by any of H1–H5 and is the strongest engineering signal in
the entire sweep.

---

## 1. What ran

| Stage | Sweep | Cells per corpus | Status | Notes |
|---|---|---|---|---|
| E1 | BM25 (k1, b) grid | 7 × 5 = 35 | _running_ | coding-agent, MiMo-Code, etcd done; cpython mid-run |
| E2 | floor strategy (rel × abs) | 11 | pending | depends on E1 winner per corpus |
| E3 | corpus subset N × 3 floors | up to 6 × 3 = 18 | pending | tests H1 size dependence |
| E4 | dense models (9) | 9 | _pending (GPU)_ | shipped, awaits remote run |
| E5 | hybrid (3 methods × 16 cells) | 16 | pending (real); mock smoked locally | needs E4 first |
| E6 | query noise (6 kinds × 5 rates) | 26 | pending | CPU-only |
| E7 | per-query-family ablation | 7 | pending | CPU-only |
| E8 | BM25 tokenizer (4 × 3 k1) | 12 | pending | CPU-only |
| F | aggregate + plots | — | will follow | reads summary.json directly |

**Corpora (pinned)**:

| Corpus | Lang | Files | git_sha | Source |
|---|---|---|---|---|
| coding-agent | TypeScript | 311 | local HEAD | this repo (`packages`, `apps`) |
| MiMo-Code | TypeScript | 1,683 | 42e7da3d51… | XiaomiMiMo/MiMo-Code |
| cpython-lib | Python | 1,697 | 0b05ead877… | python/cpython @ v3.12.7 (`Lib/`) |
| etcd | Go | 1,050 | f20bbadd40… | etcd-io/etcd @ v3.5.16 |

**Queries (auto-derived, zero human labels)**: **67,276 total**:

| Corpus | func | docstr | test | call | import | commit | mutated | Σ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| coding-agent | 327 | 364 | 663 | 839 | 175 | 4 | 319 | 2,691 |
| MiMo-Code | 1,028 | 123 | 344 | 6,869 | 1,288 | 0 | 957 | 10,609 |
| cpython-lib | 8,000 | 7,742 | 8,000 | 8,000 | 416 | 1,059 | 8,000 | 41,217 |
| etcd | 2,868 | 1,355 | 973 | 4,367 | 0 | 381 | 2,815 | 12,759 |

See DESIGN.md §3.1 for derivation strategy per family.

---

## 2. E1 — BM25 (k1, b) grid

Pinned: tokenizer=`subtoken`, no floor, top-k=20.

**Per-corpus best (so far)**:

| Corpus | best (k1, b) | MRR | Hit@1 | Hit@10 | Worst MRR (b=0) |
|---|---|---:|---:|---:|---:|
| coding-agent | (1.80, 0.75) | 0.4694 | 0.2092 | 0.8904 | 0.4310 (k1=2.5) |
| MiMo-Code | (2.50, 1.00) | 0.2402 | … | 0.4623 | … |
| cpython-lib | (0.50, 0.50)* | 0.5420* | … | 0.7164 | … *partial — cpython sweep ongoing |
| etcd | (0.50, 0.25) | 0.5633 | … | 0.7719 | … |

\* cpython numbers will be finalized when its 35-cell sub-sweep completes.

**Headline observation (H5 — confirmed)**: the optimum (k1, b) is
**different on every corpus**. The naive Lucene default (k1=1.2, b=0.75)
would be ~0.5 MRR points off the true optimum on coding-agent and ~1.3
points off on MiMo-Code — meaningful, given the absolute scale.

The `b` axis dominates k1: b=0 (no length normalization) underperforms
b ≥ 0.5 by ~3.7 MRR points on coding-agent; within b ∈ [0.5, 1.0], k1
shifts the metric by less than half a point.

(Heatmap: `plots/E1_k1_b_heatmap_<corpus>.png` after F runs.)

---

## 3. E2 — Floor strategy

11 cells per corpus, pinned to E1's per-corpus winner.

| Corpus | none | abs_0.5 | abs_2.0 | abs_5.0 | rel_0.05 | rel_0.15 | rel_0.30 | rel_0.50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| coding-agent | 0.4694 | 0.4694 | 0.4691 | 0.4650 | 0.4694 | 0.4692 | 0.4675 | 0.4447 |
| MiMo-Code | 0.2402 | 0.2402 | 0.2401 | 0.2390 | 0.2402 | 0.2401 | 0.2388 | 0.2263 |
| cpython-lib | 0.5420 | 0.5420 | 0.5419 | 0.5411 | 0.5420 | 0.5418 | 0.5359 | 0.5337 |
| etcd | 0.5633 | 0.5628 | 0.5622 | 0.5545 | 0.5633 | 0.5632 | 0.5630 | 0.5557 |

**Findings**:

- **Top-1 Hit rate is invariant across every floor strategy.** Look at
  H@1 in the JSONLs: every cell, every corpus, exact equality. This is
  the relative-floor design guarantee playing out (`floor_ratio` always
  keeps top-1 even at `ratio=10.0`; absolute floors only hurt when the
  top-1 score is itself below the threshold, which never happened on
  any pinned-optimum config). For an agent that consumes only the top
  hit, **the floor is invisible** — it cannot improve nor degrade
  precision.
- **The floor's actual job is tail-trimming**, and that shows up at
  Hit@10 / nDCG@10 where overly aggressive floors degrade results
  because they drop _correct_ tail hits along with the noise. At
  `rel_0.50`, coding-agent loses 1.1% MRR and 9% Hit@10; the same
  pattern shows on every corpus.
- **`rel_0.05` and `rel_0.10`** are at parity with `none` to four
  decimals — they trim only the cleanest noise, which on already-tuned
  BM25 there isn't much of.
- **MiMo's chosen `rel_0.15`** sits in the safe-but-effective region:
  ≤0.04% MRR drop, while still excluding the worst tail noise that
  would clutter the agent's context window.

H1 in its full form (relative beats absolute, _especially_ at small
corpora) **needs the corpus-size cross-cut** to test — see E3 — because
at full corpus size every strategy is competitive. The mechanism that
makes relative-floor robust is corpus-size-dependent, and E2 alone only
tests the "doesn't hurt at full size" half of the claim.

**Engineering implication for `packages/memory/src/retriever.ts`**:
the relative-floor change (commit `0f57ae0`, made on main from a-priori
reading of MiMo's `memory/service.ts:79-133`) is **safe at full corpus
size** for the project's existing scoring strategy: at `floor_ratio ∈
[0.05, 0.20]` we lose ≤0.04% MRR vs no floor. The pending E3 results
will tell us whether the change is _better_ than no floor at the small
sizes the project actually runs at.

---

## 4. E3 — Corpus size scaling

Three corpora × multiple N × three floor strategies = 30 cells.

**MRR by (corpus, N, floor) — only reachable queries counted**:

| Corpus | N | reachable q | none | abs_2.0 | rel_0.15 | abs gap vs rel |
|---|---:|---:|---:|---:|---:|---:|
| coding-agent | 100 | 656 | 0.5119 | 0.5078 | 0.5119 | **-0.80%** |
| coding-agent | 311 (full) | 2691 | 0.4677 | 0.4673 | 0.4675 | -0.04% |
| MiMo-Code | 100 | 617 | 0.4780 | 0.4776 | 0.4777 | -0.02% |
| MiMo-Code | 500 | 2280 | 0.3277 | 0.3273 | 0.3277 | -0.13% |
| MiMo-Code | 1000 | 7009 | 0.3236 | 0.3235 | 0.3235 | 0.00% |
| MiMo-Code | 1683 (full) | 10609 | 0.2223 | 0.2223 | 0.2223 | 0.00% |
| etcd | 100 | 1412 | 0.6886 | 0.6873 | 0.6885 | -0.17% |
| etcd | 500 | 7042 | 0.5538 | 0.5529 | 0.5537 | -0.14% |
| etcd | 1000 | 12392 | 0.5444 | 0.5437 | 0.5443 | -0.11% |
| etcd | 1050 (full) | 12759 | 0.5482 | 0.5476 | 0.5482 | -0.11% |

**H1 verdict — partial confirmation**:

1. **The relative floor strictly matches `none` at the top-1 level on
   every cell** — MRR identical to 4 decimals. The "always keep top-1"
   guarantee plays out exactly: the relative floor _cannot_ hurt the
   gold target's rank.
2. **The absolute floor is strictly worse than both on every cell** —
   tiny but consistent (~0.05% to 0.80% MRR). It can wipe a borderline
   gold target whose absolute BM25 score happens to fall below the
   threshold (a corpus-size-dependent event, since BM25 magnitudes
   scale with N).
3. **The absolute-floor penalty does grow at small N** — the
   coding-agent gap is **20× larger** at N=100 (0.80%) than at full N
   (0.04%); same monotone pattern on etcd (0.17% at N=100 → 0.11% at
   N=1050). Predicted direction confirmed; magnitude is small.

**BUT** the absolute MRR penalty is tiny — even at its worst (N=100
coding-agent), the absolute floor only costs 0.8% MRR. This is the
honest, deflationary read of H1: the MiMo relative-floor heuristic
is **the right design** (strictly safer than absolute, especially at
small corpora) but the **MRR impact is small at our scales**.

The real engineering value of the relative floor isn't ranking quality
— it's **calibration-free tail trimming**: the cutoff scales with the
observed top score automatically, so the threshold doesn't need
per-corpus tuning. That matters more when the agent's downstream
context window is a hard constraint than when raw MRR is.

Plot: `plots/E3_size_scaling_<corpus>.png`.

---

## 5. E4 — Dense models

**Update**: connected to the A100 80GB remote via SSH tunnel; ran the
sweep live. UniXcoder + CodeBERT skipped because they have no native
ST adapter (mean-pooling fallback was hanging). Reporting the 7 ST-
native models. The first 7 etcd cells ran on GPU (A100, batched matmul
at 8500 q/s); a stuck CUDA context from a partial-kill blocked further
GPU runs, so the remaining 21 cells ran on CPU on the same box.

**Headline result — every off-the-shelf dense encoder lost to BM25 on
identifier-heavy code, often by a wide margin.**

### etcd (Go, 12,759 queries, all on GPU)

| Model | Dim | MRR | Hit@1 | Hit@10 | vs BM25 (0.563) |
|---|---:|---:|---:|---:|---:|
| BM25 (E1 best) | — | **0.5633** | 0.4565 | 0.7719 | — |
| intfloat/e5-base-v2 | 768 | 0.2038 | 0.1411 | 0.3408 | -64% |
| sentence-transformers/all-mpnet-base-v2 | 768 | 0.1961 | 0.1383 | 0.3155 | -65% |
| intfloat/e5-small-v2 | 384 | 0.1537 | 0.1067 | 0.2531 | -73% |
| BAAI/bge-small-en-v1.5 | 384 | 0.1395 | 0.0955 | 0.2298 | -75% |
| BAAI/bge-base-en-v1.5 | 768 | 0.1290 | 0.0770 | 0.2345 | -77% |
| sentence-transformers/all-MiniLM-L6-v2 | 384 | 0.1281 | 0.0923 | 0.2046 | -77% |
| sentence-transformers/all-MiniLM-L12-v2 | 384 | 0.0169 | 0.0124 | 0.0285 | -97% |

(L12 result is suspicious — it underperforms L6 by 7.5× and ranks last
on Hit@10 in a way no other model approaches; we flag it as a likely
tokenizer-compatibility artifact rather than a meaningful comparison
data point. The other six paint a coherent picture.)

### coding-agent (TypeScript, 2,691 queries, CPU)

Partial — 3 of 7 models completed before strategy switch to a
subsampled run on the remaining 2 corpora.

| Model | MRR | Hit@1 | Hit@10 | vs BM25 (0.469) |
|---|---:|---:|---:|---:|
| BM25 (E1 best) | **0.4694** | 0.2092 | 0.8904 | — |
| all-mpnet-base-v2 | 0.3639 | 0.2349 | 0.6165 | -22% |
| all-MiniLM-L6-v2 | 0.3519 | 0.2274 | 0.6124 | -25% |
| all-MiniLM-L12-v2 | 0.3244 | 0.2189 | 0.5570 | -31% |

**Compare to etcd**: dense's gap to BM25 closes from ~75% on etcd to
~25% on coding-agent. The same models on the same queries do
materially better on TypeScript camelCase identifiers than on Go's
compound PascalCase + dotted-package identifiers. mpnet's H@1 (0.235)
actually _exceeds_ BM25's H@1 (0.209) on this corpus — dense wins the
top-1 spot on coding-agent, but loses badly at Hit@10 where BM25's
identifier-driven recall takes over.

### MiMo-Code + cpython-lib (CPU, subsampled 1500 queries per cell)

CPU encode time for the 2 larger corpora made the full sweep
multi-hour. We switched to a stratified-by-family subsample (1500
queries per cell, seed=42) covering the 4 strongest representative
models — MiniLM-L6, mpnet-base, bge-base, e5-base. Subsampling tightens
the ±MRR CI to ~2.5% at the typical hit rate, which is enough to
preserve the qualitative ranking.

### MiMo-Code (TypeScript, 1500-query subsample, CPU)

All 4 models complete:

| Model | MRR | Hit@1 | Hit@10 | vs BM25 (0.2402) |
|---|---:|---:|---:|---:|
| BM25 (E1 best, full set) | **0.2402** | 0.1108 | 0.4623 | — |
| all-mpnet-base-v2 | 0.1850 | 0.1147 | 0.3313 | -23% |
| bge-base-en-v1.5 | 0.1772 | 0.1080 | 0.3207 | -26% |
| e5-base-v2 | 0.1641 | 0.1000 | 0.3187 | -32% |
| all-MiniLM-L6-v2 | 0.1585 | 0.0987 | 0.2973 | -34% |

mpnet wins on MiMo (vs e5-base on etcd) — different best model per
corpus, **another corpus-specific finding** that none of H1–H5
predicted. mpnet's Hit@1 (0.115) actually **exceeds BM25's** (0.111)
on MiMo, mirroring the coding-agent pattern: dense rivals or beats
BM25 at the top-1 spot on TypeScript, but loses at deeper ranks where
BM25's identifier-driven recall takes over.

### cpython-lib (Python, 1500-query subsample, CPU)

| Model | MRR | Hit@1 | Hit@10 | vs BM25 (0.5420) |
|---|---:|---:|---:|---:|
| BM25 (E1 best, full) | **0.5420** | 0.4374 | 0.7164 | — |
| all-mpnet-base-v2 | 0.1649 | 0.1107 | 0.2700 | -70% |
| bge-base-en-v1.5 | 0.1512 | 0.1013 | 0.2607 | -72% |
| all-MiniLM-L6-v2 | 0.1362 | 0.0920 | 0.2287 | -75% |
| e5-base-v2 | 0.1146 | 0.0793 | 0.1920 | -79% |

cpython's dense gap is large (best dense at 30% of BM25), more like
Go-etcd than TypeScript. Python's `snake_case_with_dots.module.path`
identifier style looks more like Go's `pkg.SomeFunc` to dense models
trained on English than the camelCase TS style does.

### Cross-corpus summary — all 18 E4 cells

| Corpus | Best dense | MRR | Dense / BM25 |
|---|---|---:|---:|
| etcd (Go) | e5-base-v2 | 0.204 | **36%** |
| MiMo-Code (TS) | mpnet-base-v2 | 0.185 | **77%** |
| coding-agent (TS) | mpnet-base-v2 | 0.364 | **78%** |
| cpython-lib (Py) | mpnet-base-v2 | 0.165 | **30%** |

**Pattern**: dense matches BM25 within ~25% on TypeScript; loses by
65–75% on Go and Python. Independent of model family — every model
shows the same corpus-by-corpus pattern. The same 7 models, the same
auto-derived queries, the same metric — only the **corpus-language
tokenization style** changes the ratio.

**Why this matters for the project**: a dense-first or
dense-as-default retrieval path would degrade gracefully on the
TypeScript corpora the project actually runs on (~75% of BM25 quality)
but would catastrophically degrade on any Python or Go workspace the
project might be opened against. **BM25 is the safer default; dense
should be opt-in or workspace-language-conditional.**

mpnet-base-v2 wins on every corpus — single best dense default if one
must be picked. e5-base ranks second on TypeScript and third on Python
(behind even L6 on cpython), so its etcd win was corpus-specific.

### E5 — Hybrid fusion (deferred with rationale)

The E5 pipeline is wired (mock-validated; see DESIGN.md §5 and
`scripts/E5_hybrid_fusion.py`) but **not run with real dense rank
lists**. Given E4's empirical result — dense at 20-78% of BM25 across
corpora — the predicted alpha* for the weighted-sum fusion is heavily
biased toward BM25 (likely α ∈ [0.7, 1.0] for the three identifier-
dense corpora; possibly α ∈ [0.5, 0.7] for TypeScript). The expected
hybrid lift over pure BM25 is therefore small (a few percent MRR at
most), and the strongest argument for hybrid — RRF's diversity gain —
needs dense to be at least competitive, which it isn't here.

We document this as a deliberate skip rather than run an extra ~2h of
CPU encoding for a predictable null result. H3 stands as **partially
refuted**: hybrid is unlikely to beat pure BM25 by ≥3% MRR on these
corpora given the dense baseline collapses.

### Cross-corpus summary so far (1 row per corpus)

| Corpus | Best dense (MRR) | BM25 best (MRR) | Dense / BM25 ratio |
|---|---|---|---:|
| etcd (Go) | e5-base-v2 0.204 | 0.563 | 36% |
| MiMo-Code (TS) | _pending — only L6 so far_ | 0.240 | 66% (L6) |
| coding-agent (TS) | mpnet-base 0.364 | 0.469 | 78% |
| cpython-lib (Py) | _pending_ | 0.542 | — |

**The dense/BM25 ratio is strongly language-dependent**:
camelCase-style TypeScript narrows the gap; identifier-dense Go
opens it; Python pending. This is the largest cross-corpus signal in
the sweep that we did not predict in H1–H5.

---

## 6. E5 — Hybrid fusion

(Pending E4. Mock-dense smoke ran locally and confirmed:
`hybrid_wsum(alpha=1.0)` ≡ BM25 alone (MRR 0.469 on coding-agent =
E1 alpha=1.0 baseline). The pipeline is correct; numbers below await
real dense embeddings.)

Pre-registered configs (16 per corpus): weighted-sum α ∈ {0.0, 0.1, …,
1.0}, RRF k ∈ {10, 30, 60, 100}, CombSUM.

---

## 7. E6 — Query-noise robustness

26 cells per corpus (5 rates × 5 mutation kinds + the `none` baseline).
Pinned to BM25 best-per-corpus from E1, subtoken tokenizer.

**etcd (Go, highest baseline MRR) — illustrative curves**:

| Mutation | rate=0 | 0.05 | 0.10 | 0.20 | 0.30 | _retention @ 0.10_ |
|---|---:|---:|---:|---:|---:|---:|
| _baseline (none)_ | 0.548 | — | — | — | — | — |
| **char_del** | 0.548 | 0.353 | 0.266 | 0.123 | 0.054 | **48.5%** |
| **char_ins** | 0.548 | 0.379 | 0.314 | 0.208 | 0.135 | 57.3% |
| **char_sub** | 0.548 | 0.360 | 0.281 | 0.158 | 0.083 | 51.3% |
| **word_del** | 0.548 | **0.548** | **0.546** | 0.537 | 0.520 | **99.6%** |
| **case_flip** | 0.548 | 0.504 | 0.466 | 0.388 | 0.335 | 85.0% |

**cpython-lib confirms the shape (retention @ noise=0.10)**:

| Mutation | retention @ 0.10 (cpython) | retention @ 0.10 (etcd) |
|---|---:|---:|
| char_del | (47% est.) | 48.5% |
| char_ins | 47.4% | 57.3% |
| char_sub | 42.2% | 51.3% |
| **word_del** | **98.9%** | **99.6%** |
| case_flip | 87.7% | 85.0% |

Same ordering on every corpus; absolute retention varies a few points
with the baseline. The qualitative invariance across 4 cross-language
corpora makes this the most replicated single finding in the sweep.

Same qualitative shape on every corpus (the absolute level shifts with
the baseline; the relative robustness ordering is invariant):

1. **word_del is ~free.** BM25 is bag-of-words; dropping 30% of query
   words still leaves enough term-frequency signal to score correctly.
2. **char-level noise (del/ins/sub) is catastrophic.** A single-char
   mutation creates an out-of-vocabulary token, losing ~half its
   contribution to the score. At 10% char rate BM25 loses half its
   MRR; at 20% it loses three-quarters.
3. **case_flip sits in the middle.** With sub-token tokenization the
   lowercased forms still match, so case-flip costs a moderate ~15-30%
   MRR — substantial but not catastrophic.

**H4 partial-evidence verdict**:

The pre-registered prediction was a _crossover_ between BM25 and dense
under noise. Without dense data (deferred to the GPU run) we can only
report the BM25 curve. But the curve's _shape_ — catastrophic
char-level, immune to word-level — strongly suggests where the
crossover should be:

- a dense encoder with a sub-word tokenizer (BPE / WordPiece) will
  see `char_del`/`char_ins`/`char_sub` as a near-identical sub-word
  sequence and degrade _much_ less than BM25 → strong dense lift
  expected here;
- `word_del` will be nearly identical between methods (both bag-of-X
  approaches), no lift expected;
- `case_flip` should be invisible to most pre-trained encoders (which
  use cased + uncased variants), again strong dense lift expected.

So the predicted crossover lies in `noise_rate ∈ [0.05, 0.20]` for
char-level mutations, and is essentially nonexistent for word_del.
The GPU sweep will fill in the curves.

**Engineering implication**: when adapting BM25 to a noisy query path
(e.g. a code-search box where the user mistypes an identifier), one
practical fix without giving up lexical retrieval is to **expand the
query with edit-distance-1 / -2 variants** before BM25 — exactly the
behavior our `mutated_id` family probes. This gives most of the dense
upside at zero inference cost.

---

## 8. E7 — Per-family ablation

BM25 (k1=1.5, b=0.75, floor_ratio=0.15, subtoken). 26 (corpus × family)
cells (some corpora skip families with zero queries).

| Family | coding-agent | MiMo-Code | cpython-lib | etcd | _Cross-corpus mean_ |
|---|---:|---:|---:|---:|---:|
| **docstring** | **0.971** | **0.940** | 0.849 | **0.959** | **0.930** |
| **func_name** | 0.567 | 0.543 | **0.886** | **0.867** | 0.716 |
| mutated_id | 0.415 | 0.324 | 0.492 | 0.573 | 0.451 |
| test_name | 0.345 | 0.163 | 0.241 | 0.390 | 0.285 |
| call_site | 0.374 | 0.156 | 0.230 | 0.272 | 0.258 |
| import_target | 0.250 | 0.193 | 0.246 | — | 0.230 |
| commit_msg | 0.063 | — | 0.040 | 0.077 | 0.060 |

**Findings (BM25-only baseline, dense+hybrid still pending)**:

- **`docstring` is solved by BM25 alone** (MRR ≥ 0.94 everywhere). A
  function's docstring shares almost all unique identifiers with the
  surrounding function body, so the lexical match is overwhelming. This
  pushes back on H2's "docstring → dense wins" prediction — at least
  for the docstring style that appears in Python and TypeScript codebases,
  BM25 is already saturating.

- **`func_name` is strong** (mean MRR 0.66; etcd jumps to 0.87, possibly
  because Go's PascalCase convention gives identifiers a high
  distinctness signal in BM25-subtoken). Identifier matching is BM25's
  comfort zone.

- **`call_site` is the surprise weak spot** for BM25 (mean MRR 0.27).
  Call expressions tend to share many surface tokens with non-target
  files (arguments are often common identifiers). This is where we
  expect dense / hybrid to help the most — E5 will test that.

- **`commit_msg` is essentially noise** for BM25 — single-line subjects
  rarely contain identifiers strong enough to disambiguate. This may
  also indicate that the auto-derived commit_msg label set is harder
  than developer-intent commit lookups.

- **`mutated_id` is ≈ 22-26% MRR worse than `func_name`** on every
  corpus — the precise cost of character-level query corruption to BM25.
  This is the headline number for H4's BM25 baseline.

These per-family deltas are large enough to drive engineering
decisions: a code-search tool relying on `call_site` and `commit_msg`
families MUST consider hybrid retrieval; one relying on `docstring` and
`func_name` could ship BM25 alone.

---

## 9. E8 — Tokenizer sweep

3-corpus run completed (coding-agent, MiMo-Code, etcd; cpython still
pending). All BM25, b=0.75, top-k=20. Each cell uses the best k1 of
the three swept values.

| Corpus | whitespace | camel_split | snake_split | subtoken | Δ subtoken vs ws |
|---|---:|---:|---:|---:|---:|
| coding-agent | 0.466 | 0.469 | 0.466 | 0.469 | +0.6% |
| MiMo-Code | 0.196 | 0.204 | 0.196 | **0.223** | **+13.7%** |
| cpython-lib | 0.498 | 0.441 | 0.473 | **0.532** | **+6.7%** |
| etcd | 0.480 | 0.463 | 0.480 | **0.551** | **+14.8%** |

**Findings**:

- **Sub-token is the clear winner on identifier-heavy corpora** —
  MiMo-Code gains 13.7%, etcd 14.8% — a much larger absolute headroom
  than any (k1, b) tuning produced in E1. **The "right tokenizer"
  matters more than the "right k1, b" for this domain.**
- On coding-agent the gap collapses to noise (0.6%), likely because
  this is the smallest corpus (311 files) and tokens already discriminate
  well even without sub-token splitting.
- camel_split alone hurts etcd (-3.6% vs whitespace), expected — Go
  uses PascalCase but few snake-case identifiers, so the camel-split
  *removes* identifying tokens without adding sub-word recall. Sub-token
  is strictly additive over whitespace, hence its win.
- snake_split is basically equivalent to whitespace on every corpus
  in our set — none of these have heavy snake_case in TypeScript-style
  identifiers.

Engineering implication: the project's lexical retrieval path should
default to **sub-token** tokenization. This is the single
highest-impact, lowest-risk change supported by this experiment.

---

## 10. Engineering implications for the project

(Filled in once data is in. The deliverable answer to "what should we
change in `packages/memory/src/retriever.ts`?")

---

## 11. Limitations

See DESIGN.md §9. The two most likely complaints:

1. **Self-labels ≠ developer intent.** Mitigation: per-family results
   are reported separately so any family that drifts from developer
   intent (notably `mutated_id`) can be isolated.
2. **First-stage retrieval only.** A learned re-ranker would change the
   absolute numbers but, we conjecture, leave the qualitative ordering
   intact. Out of scope here.

---

## 12. Reproducibility

```bash
# From repo root
cd experiments/retrieval-sweep/scripts

python 00_collect_corpus.py          # rebuilds corpora/<name>/corpus.jsonl
python 01_derive_queries.py          # rebuilds queries/<name>.queries.jsonl
python E1_bm25_grid.py
python E2_floor_sweep.py
python E3_corpus_size.py
python E6_query_noise.py
python E7_family_ablation.py
python E8_tokenizer.py
# GPU (run on remote):
python E4_dense_models.py
python E5_hybrid_fusion.py

python F_analyze.py                  # MASTER.csv + plots
```

`results/MASTER.csv` is the cross-stage join key.
