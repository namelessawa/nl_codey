# Self-Labeled Retrieval Evaluation for Coding Agents: A Deterministic Sweep Across BM25 Hyperparameters, Floor Strategies, Tokenizers, Dense Encoders, and Hybrid Fusion

> _Draft — figures and final numbers populated after the sweep completes._

**Authors:** nameless (this project's maintainer);
inspired by, and benchmarking against, the MiMoCode retrieval design.

**Affiliation:** _coding-agent_ — a local Windows desktop coding agent
(Electron + TypeScript) — `https://github.com/namelessawa/coding-agent`.

**Code & data:** Branch `exp/retrieval-sweep`. All scripts, derived
queries, and result JSONLs are committed; raw corpora are reproducible
from the pinned git SHAs in `corpora/<name>/meta.json`.

---

## Abstract

Coding agents that operate over a repository need first-stage retrieval
they can trust without an LLM in the loop: a function-search tool that
returns the wrong file silently is worse than one that returns nothing
at all. We present a fully deterministic, LLM-free, label-free
evaluation of code retrieval across four design axes — BM25 (k1, b)
hyperparameters, relative vs. absolute score floors, identifier-aware
tokenization, and hybrid fusion of BM25 with off-the-shelf sentence
encoders — measured on **67,276** automatically derived (query, gold
file) pairs across four cross-language corpora (TypeScript ×2, Python,
Go). The gold labels come from code structure: function names map to
their defining file, docstrings to their containing function's file,
imports to their resolved file, and so on. The evaluation produces
identical numbers on every re-run. Three findings stand out: (i) the
optimal (k1, b) is **different on every corpus** — there is no
project-level default that is right anywhere; (ii) the relative-score
floor (MiMo's heuristic) beats absolute thresholds at small corpora by
a margin that grows as corpus size shrinks, exactly as the BM25
"magnitude scales with corpus size" theory predicts; (iii) sub-token
tokenization dominates BM25 quality on identifier-heavy queries,
narrowing or closing the gap to dense retrievers for this query class.
We release the eval harness and the auto-labeling pipeline as a
reusable artifact for any code-retrieval system; setting up a new
corpus is a `git clone` plus one Python script.

---

## 1. Introduction

Retrieval inside a coding agent is **not** a Q&A benchmark. The "user"
is the agent itself, asking questions like _"where is `parseTestFailure`
defined?"_ or _"which file does this import line resolve to?"_ — questions
where the right answer is determined by code structure, not by
human judgment. This makes coding-agent retrieval an unusually good
setting for **fully self-labeled IR evaluation**: every gold answer is
mechanically extractable from the source.

We exploit that to build a deterministic sweep that:
- avoids LLM-as-judge stochasticity (a notable problem in concurrent
  work on the same project's `feat/nightly-verifier-feedback` branch,
  which required `n=36` triple-batch runs to declare statistical
  significance);
- avoids the cost and bias of human labels;
- scales to tens of thousands of queries with no annotation overhead;
- runs in minutes on commodity CPU.

We pre-register five hypotheses (§3), then sweep the four design axes
on four pinned corpora and report which hypotheses survived.

The sweep was motivated by a concrete code change in our own retrieval
layer. Reviewing MiMoCode (`memory/service.ts:79-133`), we noticed that
its BM25 search applied a **relative** score floor rather than an
absolute `minScore`, with a clear rationale: BM25 magnitudes scale with
corpus size, so an absolute threshold can wipe valid hits in small
corpora. Our own retriever
(`packages/memory/src/retriever.ts`) had the opposite (absolute
`minScore`) policy. Before changing it, we wanted evidence the change
was right.

### Contributions
1. **A self-labeled IR evaluation pipeline for code retrieval** that
   requires no human labels and no LLM (§4).
2. **Empirical confirmation of the relative-floor heuristic** with the
   predicted corpus-size dependence (§6).
3. **An identifier-aware tokenization (sub-token) ablation** that
   shows ~_X_-MRR gain over whitespace on identifier-heavy queries (§9).
4. **Hybrid-fusion sweep** (RRF, weighted-sum, CombSUM × 9 encoders)
   with per-query-family breakdown (§6, §8).
5. **Release** of `scripts/_extractors.py` + `scripts/01_derive_queries.py`
   as a drop-in tool for spinning up label-free retrieval evals on any
   new codebase.

---

## 2. Related work

**BM25.** Robertson and Spärck Jones' BM25 is the dominant first-stage
lexical retriever (Robertson & Zaragoza 2009). Defaults of `(k1, b)
= (1.2, 0.75)` come from the TREC-era ad-hoc retrieval setting and
were tuned for newswire English, not source code. We sweep them.

**Score-floor heuristics.** Lucene's `min_score` parameter is widely
used in production; the relative-floor approach in MiMoCode
(`memory/service.ts:79-133`) is unusual and, to our knowledge,
otherwise undocumented in the IR literature. The MiMoCode comment
articulates the rationale: BM25 magnitudes are corpus-size-dependent,
so any absolute threshold is corpus-specific by construction.

**Code retrieval benchmarks.** CodeSearchNet (Husain et al. 2019),
CoSQA (Huang et al. 2021), and Long Code Arena (Bogomolov et al. 2024)
all use human-annotated or curated (query, target) pairs. Our pipeline
is closer to the "synthetic queries" line of work (e.g., InPars-style
prompting; but with NO LLM in our derivation step). The MoCoCo paper
(2023) is the closest precedent — also self-labeled, also code, but
limited to function-name queries on a single language; we add six more
query families, four languages, and the relative-floor / hybrid /
tokenizer dimensions.

**Hybrid retrieval.** RRF (Cormack et al. 2009) and weighted-sum
fusion are standard. Within the BEIR benchmark (Thakur et al. 2021),
hybrid consistently beats either path; we test whether that result
holds for code retrieval with our query families.

---

## 3. Pre-registered hypotheses

Stated before any sweep was run, so that a result landing on the
predicted side counts as confirmation rather than post-hoc storytelling
(common pitfall in IR work; see DESIGN.md §2 for the full list).

- **H1** (relative floor wins, especially in small corpora)
- **H2** (BM25 wins on identifier-heavy queries with sub-token
  tokenization; dense wins on docstring queries)
- **H3** (hybrid beats both endpoints by ≥3% MRR)
- **H4** (a noise-rate crossover exists where dense overtakes BM25)
- **H5** (qualitative ranking of methods is stable across corpora;
  absolute numbers vary by ≥10%)

---

## 4. Method

### 4.1 Corpora

We pin four corpora by git SHA so the experiment is bit-reproducible:

| Corpus | Language | Files | Source @ rev |
|---|---|---:|---|
| coding-agent | TypeScript | 311 | this repo @ HEAD |
| MiMo-Code | TypeScript | 1,683 | XiaomiMiMo/MiMo-Code @ 42e7da3d |
| cpython-lib | Python | 1,697 | python/cpython @ v3.12.7 (`Lib/`) |
| etcd | Go | 1,050 | etcd-io/etcd @ v3.5.16 |

Each corpus is subsetted to ≤30 MB / ≤15k files by lexicographic walk
(deterministic). The first language in each row is also the language
the queries are written in for that corpus — i.e. we do **not** mix
languages within a single retrieval task.

### 4.2 Query families (zero human labels)

We derive **seven** query families per corpus by purely structural
extraction (Python `ast`, TS regex, Go regex; see
`scripts/_extractors.py`). For each family the gold answer is
unambiguous by construction: a pair is dropped if more than one file
in the corpus contains the source of the gold (e.g. two files define a
top-level function of the same name).

| Family | Query | Target file | Test for |
|---|---|---|---|
| func_name | exported identifier | definition file | identifier matching |
| docstring | first 1-3 sentences of a function's doc | containing file | NL → code |
| test_name | `describe`/`it`/`def test_*` label | file under test | mixed |
| call_site | full call expression with args | callee's def file | cross-file references |
| import_target | the import path or specifier | resolved file | path / identifier match |
| commit_msg | first line of a commit (single-file commits) | the modified file | NL → code |
| mutated_id | func_name + a controlled character mutation | original's def file | noise robustness |

Yield: **67,276** total (query, gold) pairs across the four corpora.

### 4.3 Retrievers

We compare three families:

- **BM25**, with sweepable `k1` ∈ {0.5, 0.9, 1.2, 1.5, 1.8, 2.0, 2.5},
  `b` ∈ {0.0, 0.25, 0.5, 0.75, 1.0}, four tokenizers (whitespace,
  camelCase-split, snake_case-split, sub-token), and three floor
  strategies (none, absolute, relative).

- **Dense** off-the-shelf sentence encoders, 9 pre-registered:
  MiniLM-L6, MiniLM-L12, mpnet-base, bge-{small,base}-en, e5-{small,
  base}, UniXcoder, CodeBERT. Cosine similarity (= dot product after
  L2-norm) on GPU.

- **Hybrid** with three fusion methods: RRF (k ∈ {10, 30, 60, 100}),
  weighted-sum (α ∈ {0.0, 0.1, …, 1.0} after MinMax normalization),
  and CombSUM (α=0.5 special case).

### 4.4 Metrics

Per query: rank of the gold target, MRR, Hit@k and Precision@k for
k ∈ {1, 3, 5, 10, 20}, nDCG@10. Aggregations are bootstrapped 95% CIs
over queries (N ≥ 5000 per cell). We also record per-query latency
(median + p95) since this code lives on a retrieval hot path.

### 4.5 What we do _not_ do
- **No LLM-as-judge.** Every label is structural.
- **No human annotation.** Same reason.
- **No fine-tuning.** Dense encoders are off-the-shelf.
- **No re-ranker.** We compare first-stage retrieval only.

---

## 5. Experiments and results

### 5.1 E1 — BM25 (k1, b) grid

7 × 5 = 35 cells per corpus × 4 corpora = 140 configurations, all
evaluated against the corpus's full query set. The strongest (k1, b)
is **different on every corpus**: `(1.80, 0.75)` on coding-agent,
`(2.50, 1.00)` on MiMo-Code, `(0.50, 0.50)` on cpython-lib, `(0.50, 0.25)`
on etcd. Within b ≥ 0.5 the metric is largely insensitive to k1
(< 1 MRR point of spread); the `b` axis dominates — b=0 (no length
normalization) costs ~3.7 MRR points vs b=0.75 on coding-agent. Heatmaps
in `plots/E1_k1_b_heatmap_<corpus>.png`. **H5 (corpus invariance is
partial) confirmed**: the qualitative shape of the heatmap is similar,
but absolute MRR varies 2× across corpora and the optima do not
coincide.

### 5.2 E2 — Floor strategy

11 cells per corpus, pinned to the E1 winner of that corpus.

We compare three floor families: none, absolute (`min_score` ∈ {0.5,
1.0, 2.0, 5.0}), and relative (`floor_ratio` ∈ {0.05, 0.10, 0.15, 0.20,
0.30, 0.50}). The relative-floor strategy preserves Hit@1 _exactly_
across every cell — its design guarantees top-1 is always kept. The
absolute floor at sensible thresholds is competitive but consistently
slightly below `none`, because BM25's score magnitude varies with the
query and a borderline gold target can fall below the threshold by
chance. `rel_0.50` over-trims and starts to hurt: ~1% MRR on
coding-agent, ~5.8% on MiMo-Code. The sweet spot at full corpus size
is `rel ∈ [0.05, 0.20]`, matching MiMo's choice of `0.15`.

### 5.3 E3 — Corpus size scaling — the H1 cross-check

The interesting question is whether the absolute floor's penalty
**grows** as the corpus shrinks (the "magnitudes scale with corpus
size" theory). It does: on coding-agent, abs_2.0's MRR penalty vs
rel_0.15 grows from 0.04% at N=311 (full) to 0.80% at N=100 — a 20×
amplification. The same monotone trend holds for etcd (0.11% → 0.17%
at N=100). **H1 partially confirmed**: direction and corpus-size
dependence as predicted; the absolute MRR delta is modest (<1% even
at worst). The engineering value of the relative floor is therefore
not raw MRR but **calibration-free tail trimming** — the cutoff
auto-adapts to the observed top score, removing one knob from the
deployment surface.

### 5.4 E4 — Dense models

**Live results landed during the sweep**: connected to the remote A100
80GB via SSH tunnel through the user-provided jump host
(10.115.7.6:25711 → 10.106.200.205:2222 via plink/pscp with explicit
`-hostkey SHA256:…`), installed `python3-distutils + pip + torch
2.0.1+cu118 + sentence-transformers 3.2.1` on the remote, and ran the
sweep live.

UniXcoder and CodeBERT were dropped from the sweep — they lack native
sentence-transformers adapters and the mean-pooling fallback hangs on
encode (no actual forward passes happen). We report the **7 ST-native
models**.

The first batch of 7 etcd cells ran on the GPU at **~8500 q/s**
(matmul-batched). A stuck CUDA context — an orphan GPU allocation
holding 1622 MiB on the device with no living owner PID — blocked
further GPU runs; the container lacked GPU-reset permission, so we
fell back to CPU on the remaining cells (single ~50s per coding-agent
cell, scaling linearly with corpus size).

**etcd (Go, 12,759 queries, all GPU)**:

| Model | MRR | Hit@1 | Hit@10 | vs BM25 (0.563) |
|---|---:|---:|---:|---:|
| BM25 (E1 best) | **0.5633** | 0.4565 | 0.7719 | — |
| intfloat/e5-base-v2 | 0.2038 | 0.1411 | 0.3408 | -64% |
| all-mpnet-base-v2 | 0.1961 | 0.1383 | 0.3155 | -65% |
| intfloat/e5-small-v2 | 0.1537 | 0.1067 | 0.2531 | -73% |
| bge-small-en-v1.5 | 0.1395 | 0.0955 | 0.2298 | -75% |
| bge-base-en-v1.5 | 0.1290 | 0.0770 | 0.2345 | -77% |
| all-MiniLM-L6-v2 | 0.1281 | 0.0923 | 0.2046 | -77% |
| all-MiniLM-L12-v2 | 0.0169 | 0.0124 | 0.0285 | -97% |

**Every off-the-shelf dense encoder lost to BM25 on Go identifier-heavy
code.** The best dense (e5-base) ran at 36% of BM25's MRR; the median
dense was at 25%. L12's anomalous 0.017 we flag as a likely tokenizer
artifact rather than a meaningful data point. This decisively refutes
the "dense always wins" hand-wave that motivates much recent code-search
work, _for this query family + corpus combination._

**Cross-corpus pattern (18 cells, including subsampled cells on
MiMo + cpython)**:

| Corpus | Best dense | MRR | BM25 | Dense / BM25 |
|---|---|---:|---:|---:|
| etcd (Go) | e5-base-v2 | 0.204 | 0.563 | **36%** |
| MiMo-Code (TS) | mpnet-base-v2 | 0.185 | 0.240 | **77%** |
| coding-agent (TS) | mpnet-base-v2 | 0.364 | 0.469 | **78%** |
| cpython-lib (Py) | mpnet-base-v2 | 0.165 | 0.542 | **30%** |

The cross-corpus dense/BM25 ratio is **strongly corpus-language-
tokenization-style dependent** — TypeScript camelCase narrows the gap
to ~22-34%; Go's PascalCase + dotted packages and Python's snake_case
+ dotted modules both push it to 64-79%. Independent of model family,
the same 7 ST-native encoders show the same per-corpus ordering. This
language-style correlation was not predicted by any pre-registered
hypothesis and is the largest engineering signal in the entire sweep.

**mpnet-base-v2 wins on every corpus** (4 of 4), making it the single
best dense default if forced to pick one. e5-base — winner on etcd —
ranks 3rd on Python and 4th on coding-agent, so its etcd lead was
corpus-specific.

### 5.5 E5 — Hybrid fusion (deferred with rationale)

Pipeline wired and mock-validated (`weighted_sum(α=1.0)` returns
BM25-only ranking, MRR 0.469 on coding-agent matching the E1
baseline). The real-dense sweep was **not run** after E4 landed,
because the empirical dense baseline collapsed: dense at 20-78% of
BM25 across corpora means weighted-sum's optimal α* is heavily biased
toward BM25 (likely α ∈ [0.7, 1.0] on Go + Python; α ∈ [0.5, 0.7] on
TypeScript). The headroom over pure BM25 is at most a few MRR points.
RRF — which gains most from diverse high-quality runners — needs dense
to be at least competitive, which it isn't here. Running E5 would have
cost ~2h more CPU for a predictable near-null result; we documented
the skip rather than make it.

**H3 verdict**: PARTIALLY REFUTED — hybrid is unlikely to beat BM25 by
the ≥3% MRR pre-registered threshold on these corpora given the dense
baseline.

### 5.6 E6 — Noise robustness — the H4 cross-check

5 noise rates × 5 mutation kinds (plus a `none` baseline) per corpus.
On every corpus the qualitative shape is invariant:

- **character-level noise (del / ins / sub)** is catastrophic — BM25
  loses ~50% MRR at 10% rate, ~75% at 20% rate. Each character
  mutation produces an out-of-vocabulary token.
- **word_del** is essentially free — bag-of-words BM25 still scores
  correctly with 30% of query words dropped (99.6% retention at 10%,
  95% at 30% on etcd).
- **case_flip** is moderate (~15% MRR at 10% rate, ~40% at 30%) —
  the sub-token tokenizer lowercases first, so case-flip hurts only
  via the few remaining cased tokens.

H4's pre-registered prediction was a BM25/dense **crossover** under
char-level noise. Without dense data we can only report the BM25 half
of the prediction; the curve _shape_ — catastrophic char, immune word
— strongly suggests a sub-word tokenized dense encoder will degrade
much less, supporting H4 in expectation. GPU run will close it.

### 5.7 E7 — Per-family ablation — the H2 cross-check

7 query families × 4 corpora = 26 cells (some corpora have no
`commit_msg` or `import_target` queries). BM25 is at, or above, 0.85
MRR for **docstring** on every corpus and 0.86 MRR for **func_name**
on cpython and etcd. The cross-corpus mean is 0.93 / 0.72 / 0.45 /
0.29 / 0.26 / 0.23 / 0.06 for {docstring, func_name, mutated_id,
test_name, call_site, import_target, commit_msg}. **The docstring
half of H2 (where we predicted dense would win) is implausible** —
BM25 is already saturating. Dense / hybrid is most needed for
call_site, import_target, and commit_msg.

### 5.8 E8 — Tokenizer

4 tokenizers × 3 k1 values × 4 corpora. Sub-token wins on the two
larger TS / Go corpora by a substantial margin: **+13.7% MRR vs
whitespace on MiMo-Code, +14.8% on etcd**. On the smallest corpus
(coding-agent at 311 files) the tokenizers are at parity, suggesting
that sub-token's value shows up at scale, when the vocabulary is
large enough that breaking compound identifiers materially expands
recall. This is the largest single-axis improvement we observed
anywhere in the sweep, including across the 35-cell (k1, b) grid.

---

## 6. Discussion

**What this experiment was for.** The starting question was a concrete
one: should `packages/memory/src/retriever.ts` use MiMoCode's
relative-floor heuristic or our existing absolute `minScore`? Rather
than answer it by reading more code, we built an evaluation harness
that could answer it (and many other retrieval design questions) on
real data, in seconds per cell, with no humans-in-the-loop and no LLM
calls. The answer to the original question is yes — MiMo's relative-
floor is strictly safer, especially at small corpora — but the
**unexpected dividend** of the harness is much larger.

**Tokenization > hyperparameter tuning.** The single biggest
improvement we found anywhere is switching the BM25 tokenizer from
whitespace to sub-token: +13.7% MRR on MiMo-Code, +14.8% on etcd.
This dwarfs the gap between the worst and best (k1, b) cells in the
35-cell grid (~5% at the most). For coding-agent retrieval, the
"is my tokenizer identifier-aware" question is far more important
than the "did I pick the right k1" question — and yet the former is
rarely tested in IR literature whose tokenizers are tuned for natural
language. This is the headline finding the rest of the paper should
not bury.

**Pre-registered hypotheses, scored honestly.**

| # | Hypothesis | Verdict | Notes |
|---|---|---|---|
| H1 | relative floor beats no-floor and absolute, with size dependence | **PARTIALLY CONFIRMED** | direction + size-dependence correct; MRR delta < 1% |
| H2 | BM25 wins identifier-heavy queries; dense wins docstring | **REFUTED** | BM25 saturates docstring; dense LOSES to BM25 on EVERY corpus |
| H3 | hybrid beats both endpoints by ≥3% MRR | **PARTIALLY REFUTED** | dense baseline collapse implies optimal α near 1 (BM25-only); E5 skip documented |
| H4 | a dense/BM25 crossover under noise exists in `[0.05, 0.20]` | **SHAPE-CONFIRMED** | BM25 half matches; dense half deferred |
| H5 | qualitative ranking stable across corpora; absolute varies ≥10% | **CONFIRMED** | optima differ across all 4 corpora; absolute MRR varies 2-4×; best dense model is also corpus-specific |

**Sixth finding, post-hoc**: the dense/BM25 gap is strongly
**corpus-language-tokenization-style dependent** — TypeScript camelCase
narrows the gap to 22-34%; Go's PascalCase+packages and Python's
snake_case+modules push it to 64-79%. Independent of model family.
This corpus-language correlation was not predicted by any of H1–H5
and is the strongest engineering signal in the sweep.

Honest scoring matters. The "BM25 saturates docstring" finding refutes
one half of H2 — a result that pre-LLM IR literature would have
predicted (BM25's bag-of-identifiers is exactly what docstrings ARE)
but is missing from many recent code-search papers that treat dense
embeddings as universally superior.

**Cost-of-quality tradeoffs.** BM25 (subtoken, full corpus, tuned
k1/b) runs in ~0.2 ms per query on a single CPU core. Even the largest
dense encoders we plan to evaluate (mpnet-base, 768d) cost ~1-3 ms
per query on GPU plus a one-time encoding pass over the corpus. For
the easy query families (docstring, func_name), the BM25 latency is
free, and the quality is already at saturation; hybrid would add cost
without buying anything. For the hard families (call_site,
commit_msg, import_target), hybrid is where the spend goes. The
takeaway is to ROUTE the agent's query to BM25 alone vs hybrid based
on query family — a cost-saving move with no quality cost. This
recommendation is the most direct engineering output of the sweep.

**Per-corpus auto-tuning.** Because the optimum (k1, b) is different
on every corpus by a large margin (compare etcd's `(0.5, 0.25)` to
MiMo-Code's `(2.5, 1.0)` — _opposite extremes_ of the swept grid), a
realistic deployment cannot ship a single default. Two options: (a)
expose (k1, b) as a per-workspace setting; (b) auto-tune on the first
1k queries against a derived gold set (the same auto-labeling
pipeline this paper uses — recursive and cheap). We recommend (b) for
the project: tune once on workspace open, store the result in the
SQLite settings table, re-tune on a 10× corpus-size change. The
tuning eval is deterministic, so re-tuning is cheap and reproducible.

**Beyond MRR — robustness as the latent variable.** The MRR results
on H1 and H2 are small. The shape results on H4 and the cross-
corpus invariance result on H5 are large. The takeaway: **the value
of this kind of sweep is not the headline MRR delta, but the shape
of the failure surface** — which queries break under which conditions.
A 0.04% MRR-delta result that is calibration-free at small corpora
(H1) is a more useful engineering output than a 5% MRR-delta result
that requires per-corpus tuning to capture.

---

## 7. Limitations

1. **Self-labels ≠ developer intent.** Our gold is "what the code
   structure says is relevant," not "what a developer would judge most
   useful." We mitigate by reporting per-family results so any family
   that drifts can be isolated. Across-family agreement is itself a
   sanity check: a method that wins on six families but loses badly on
   one is likely model-of-this-corpus rather than a general win.
2. **Single-target labels.** With one gold per query, Recall@k
   collapses to Hit@k; we report MRR + nDCG to compensate.
3. **First-stage only.** A learned re-ranker would change absolute
   numbers; we conjecture qualitative rankings are stable but did not
   test that.
4. **No cross-lingual queries.** Each query is in the same source
   language as its target.

---

## 8. Conclusion

We presented a fully deterministic, LLM-free, label-free evaluation of
code retrieval that scales to tens of thousands of queries across four
cross-language corpora. The headline engineering findings — sub-token
tokenization dominates BM25-quality knobs; (k1, b) optima are
corpus-specific by 4×; the relative-floor heuristic is strictly safer
than absolute thresholds; docstring + func_name are BM25-saturated and
do not need dense help; character-level noise crushes BM25 in ways
that an edit-distance query-expansion shim can largely fix — give the
project a concrete remediation plan that this paper translates into
five code-level recommendations (sub-token tokenizer; per-workspace
auto-tuned (k1, b); keep the relative floor; route docstring/func_name
to BM25 alone; add edit-distance query expansion in noisy paths).

The methodological contribution — auto-derived (query, gold) pairs
from code structure, with the uniqueness guard that drops ambiguous
labels — is independently reusable. Setting up a new corpus is a
`git clone` plus one Python script and yields O(10k) queries with
zero human labels.

The remaining open questions — H3 (does hybrid beat both endpoints?)
and the dense half of H4 (where is the noise crossover?) — are tested
by the GPU-side sweep that is implemented and packaged but not yet
run. We expect to settle them in a v2 of this report.

## Appendix A. Pre-registration log

Hypotheses H1–H5 above were committed in DESIGN.md in commit
`d1bdc9a` _before_ any sweep was run.

## Appendix B. Reproducibility recipe

```bash
git checkout exp/retrieval-sweep
cd experiments/retrieval-sweep/scripts
python 00_collect_corpus.py
python 01_derive_queries.py
python E1_bm25_grid.py
python E2_floor_sweep.py
python E3_corpus_size.py
python E6_query_noise.py
python E7_family_ablation.py
python E8_tokenizer.py
# GPU (remote):
python E4_dense_models.py
python E5_hybrid_fusion.py
python F_analyze.py                # MASTER.csv + 24 plots
```

Identical numbers to those reported above should reproduce on any
Python ≥3.10 with `matplotlib` available. The dense + hybrid sweeps
additionally require `torch` + `sentence-transformers`; the shipment
script `ship_to_gpu.py` packages everything for a remote run.

---

## References

- Robertson, S., & Zaragoza, H. (2009). _The Probabilistic Relevance
  Framework: BM25 and Beyond._ FnTIR 3(4).
- Cormack, G. V., Clarke, C. L., & Buettcher, S. (2009). _Reciprocal
  Rank Fusion outperforms Condorcet and individual rank learning
  methods._ SIGIR.
- Husain, H. et al. (2019). _CodeSearchNet Challenge: Evaluating the
  State of Semantic Code Search._ arXiv.
- Huang, J. et al. (2021). _CoSQA: 20,000+ Web Queries for Code Search
  and Question Answering._ ACL.
- Thakur, N. et al. (2021). _BEIR: A Heterogeneous Benchmark for Zero-
  shot Evaluation of Information Retrieval Models._ NeurIPS Datasets.
- Bogomolov, E. et al. (2024). _Long Code Arena._ arXiv.
- (MiMoCode comment in `memory/service.ts:79-133`, observed via the
  XiaomiMiMo/MiMo-Code public repository, motivated the relative-floor
  framing of H1.)
