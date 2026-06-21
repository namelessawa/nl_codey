# Code Retrieval Sweep — Experiment Design

> **Branch**: `exp/retrieval-sweep` · **Started**: 2026-06-12 · **Owner**: nameless
> **Class**: deterministic IR experiment · **LLM**: none · **GPU**: required for dense models · **Human labels**: zero

---

## 0. Provenance & Motivation

This experiment is the deterministic-IR counterpart of the LLM-judge work on
`feat/nightly-verifier-feedback`. While that branch tunes how the agent's
verifier feeds failures back to the LLM under stochastic noise, this branch
takes the **opposite stance**: pick a layer of the agent that is fully
deterministic and explore it exhaustively. The chosen layer is **memory /
code retrieval**, motivated by three concrete pieces of evidence:

1. **Code reading**: `packages/memory/src/retriever.ts` ranks entries by
   `0.7·cosine + 0.2·tag-overlap + 0.1·recency` and (until commit `0f57ae0`)
   used an absolute `minScore` floor — the exact failure mode MiMo's
   `memory/service.ts:79-133` argues against.
2. **Architectural gap**: the project has structured-row retrieval
   (`packages/memory`) and dense-vector retrieval (`packages/semantic-index`),
   but **no lexical/BM25 path**. Hybrid retrieval is widely reported to beat
   either path alone; the project never tested whether that holds here.
3. **No-LLM constraint** (user-imposed): an LLM-judged eval would re-introduce
   the stochasticity the user is trying to escape; every result here must
   reproduce bit-for-bit given the same inputs.

## 1. Research Questions

**RQ1.** Under MiMo's "relative-floor" trimming strategy, how much does the
correctly-chosen `floorRatio` improve top-k retrieval quality vs. (a) no
floor and (b) any absolute `minScore` floor — and does the optimum shift
with corpus size? (Tests the BM25/cosine "score magnitudes are
corpus-dependent" claim.)

**RQ2.** For **identifier-heavy code queries** (function names,
docstrings, test names, call sites, imports, commit messages, mutated
identifiers — 7 auto-derived query families), does a lexical (BM25)
retriever or a dense (sentence-transformer) retriever win, and on which
families? Where does each fail?

**RQ3.** Does a **hybrid** retriever (RRF / weighted-sum / CombSUM) beat
the better of the two base retrievers, and how does the gain scale with
the **noise level** injected into the query?

**RQ4.** Which **tokenization** for the BM25 path — whitespace,
camelCase-split, snake_case-split, sub-token — yields the best
identifier-retrieval performance?

**RQ5.** Across **multiple repositories and languages**, are the answers
to RQ1–RQ4 stable, or are they corpus-specific artifacts?

## 2. Pre-Registered Hypotheses

(Stated before running any sweep, so a result that lands on the predicted
side counts as confirmation rather than post-hoc storytelling.)

- **H1 (relative floor)**: The optimal `floorRatio` is in `[0.1, 0.3]` and
  beats both `floorRatio=0` (no floor) and any absolute `minScore` floor at
  the same Recall@10. The gap widens as corpus size shrinks. MiMo defaults
  to 0.15 — we expect to confirm that default to within ±0.1.
- **H2 (BM25 wins on identifier queries)**: For function-name and
  import-target queries, BM25 with sub-token tokenization beats every
  general-purpose dense model on MRR. For docstring queries, dense wins.
- **H3 (hybrid beats both)**: RRF and weighted-sum hybrid beat the better
  individual retriever by ≥3% MRR on the union of query families.
- **H4 (noise crossover)**: Dense degrades less than BM25 as character-level
  query noise grows; a crossover exists somewhere in `noise ∈ [0.05, 0.3]`.
- **H5 (corpus invariance is partial)**: The qualitative ranking of methods
  is stable across repositories, but absolute numbers vary by ≥10% between
  repos.

## 3. Method: Self-Labeled IR Evaluation

The hardest design choice with no LLM and no humans is the gold label. We
adopt **self-labeling** — pairs derived deterministically from code
structure where the "correct" target file is unambiguous by construction.

For every (query, target file) pair we record:
- `query_family`: which derivation strategy produced it
- `query`: the raw query text
- `target_file`: the relative path that ground-truth IS the answer
- `query_provenance`: enough metadata to re-derive the pair from source

### 3.1 Query Families (zero-label, auto-derived)

For each language we have a parser for (Python via `ast`, TS/JS via
`@babel/parser` or `ts-morph`, Go via `go/ast`), we derive seven query
families:

| Family | Query text | Target | Rationale |
|---|---|---|---|
| `func_name` | bare identifier of an exported function | file containing its definition | Pure identifier match — BM25 favorite |
| `docstring` | first 1-3 sentences of a function's docstring (stripped) | file containing the function | NL → code — dense favorite |
| `test_name` | name of a test function or `it("...")` description | the file under test (resolved by import or naming convention) | Mixed identifier + NL |
| `call_site` | full call expression with arguments, e.g. `parseTestFailure(out)` | file where the called function is defined | Cross-file references |
| `import_target` | the import path or specifier | the file the import resolves to | Path/identifier match |
| `commit_msg` | first line of a commit message | the file(s) changed in that commit | NL → code, from git log |
| `mutated_id` | function name with controlled char-level mutation (typo, case flip, transposition) | file containing the original identifier | Noise robustness probe |

The query→target pair is rejected as ambiguous if more than one file in the
corpus contains a top-level definition of the same identifier (i.e. the
gold answer is not unique). This keeps every retained pair unambiguously
labelable without humans.

### 3.2 Why Self-Labels are Defensible

- **Construct validity**: every label is logically entailed by the source
  code, not produced by a model that might agree with the retriever for
  the wrong reason.
- **Reproducibility**: identical corpora produce identical labels; the
  experiment is therefore bit-deterministic.
- **Scale**: a 50k-line TypeScript repo yields O(1k) usable pairs per
  family, total O(10k) pairs per corpus. Across N=4 repos this is **tens
  of thousands of evaluated queries** — far beyond any hand-labeled set.
- **Known limitation**: self-labels test "can the retriever find what the
  *code structure says is relevant*" — not "what a human developer would
  judge most useful." We document this explicitly (§9 Limitations) and
  mitigate by reporting per-family results so any family that drifts from
  developer intent (e.g. `mutated_id`) can be isolated.

## 4. Corpora

Cross-language, cross-style, pinned by commit SHA so a re-run is
bit-reproducible.

| Corpus | Language(s) | Style | Why |
|---|---|---|---|
| `coding-agent` (this repo) | TypeScript (mono) | strict ESM monorepo, agent-style | Self-relevant: results directly inform our `retriever.ts`. |
| `MiMo-Code` (already cloned) | TypeScript | CLI agent fork of OpenCode | The exact pattern we're porting from — closes the loop on our own diff. |
| `cpython` `Lib/` subset | Python | mature stdlib, docstring-heavy | Strong docstrings test the dense path; `ast` parser is built-in. |
| `etcd` (Go) | Go | distributed-systems prod code | Identifier-dense, multi-package; tests cross-package call_site queries. |

Each corpus is **subsetted to ≤30 MB / ≤15k source files** (configured per
corpus) so dense indexing fits in one GPU run. Subset selection is
deterministic: lexicographic file order, truncate.

## 5. Independent Variables (the sweep dimensions)

| Var | Values | Levels | Notes |
|---|---|---|---|
| **Retriever** | `bm25`, `dense`, `hybrid_rrf`, `hybrid_wsum`, `hybrid_combsum` | 5 | one per family |
| **BM25 k1** | 0.5, 0.9, 1.2, 1.5, 1.8, 2.0, 2.5 | 7 | grid w/ b |
| **BM25 b** | 0.0, 0.25, 0.5, 0.75, 1.0 | 5 | grid w/ k1 |
| **BM25 tokenizer** | whitespace, camel-split, snake-split, sub-token | 4 | E8 |
| **Floor strategy** | none, abs(min=0/0.1/0.3/0.5), rel(ratio∈{0.05,0.1,0.15,0.2,0.3,0.5}) | 1+4+6=11 | E2 |
| **Corpus subset size** | 100, 500, 1k, 5k, 10k, full | 6 | E3 |
| **Dense model** | MiniLM-L6, MiniLM-L12, mpnet-base, bge-small-en, bge-base-en, e5-small, e5-base, UniXcoder, CodeBERT | 9 | E4 |
| **Hybrid alpha** (weighted sum) | 0.0, 0.1, …, 1.0 | 11 | E5 |
| **Hybrid RRF k** | 10, 30, 60, 100 | 4 | E5 |
| **Query noise rate** | 0.0, 0.05, 0.10, 0.20, 0.30 | 5 | E6 |
| **Query noise kind** | none, char-del, char-ins, char-sub, word-del, case-flip | 6 | E6 |
| **Query family** | 7 (§3.1) | 7 | E7 ablation |
| **k for @k metrics** | 1, 3, 5, 10, 20 | 5 | reported per row |
| **Random seed** | 5 (for any random subsampling) | 5 | reproducibility |

Total sweep cardinality is huge; we run **stratified rather than full
cartesian**: each experiment Eₙ pins all but the dimensions of interest
(see §7). Expected runs ≈ 20k–80k per corpus, ~100k–300k across all four.

## 6. Dependent Variables (metrics)

For each `(retriever_config, query)` pair we record:
- **Precision@k** for k ∈ {1, 3, 5, 10, 20}
- **Recall@k** for same k (since self-labels have a single gold target,
  Recall@k collapses to Hit@k)
- **MRR** (mean reciprocal rank), the headline metric
- **nDCG@10**
- **rank** of the gold target (or `∞` if missed)
- **latency_ms** per query (median + p95 across the run)

Aggregations: per-family, per-corpus, per-config; with bootstrap 95% CI
over queries (N≥5000 per cell).

## 7. Experiment Stages

| # | Sweep | Pinned | Reports |
|---|---|---|---|
| **E1** | BM25 (k1, b) grid (35 cells) | tokenizer=sub-token, floor=none, family=all | best (k1, b) per corpus |
| **E2** | floor strategy × ratio (11) | BM25 best from E1 | best floor per corpus + size |
| **E3** | corpus subset size (6) × floor (3 representative) | tokenizer=sub-token | tests H1 size dependence |
| **E4** | dense model (9) × family (7) | k=10 | which model on which family |
| **E5** | hybrid (3) × alpha/k (15) | BM25 best, dense best | tests H3 |
| **E6** | noise rate (5) × kind (6) × retriever (3) | BM25 best, dense best, best hybrid | tests H4 crossover |
| **E7** | family (7) × retriever (3) | full config | per-family ablation |
| **E8** | BM25 tokenizer (4) × k1 (3 representative) | b=0.75 | sub-token vs naive |

Total reported configurations after de-dup: ~600 unique configs × ~4 corpora
× ~8000 average queries/cell = **~20M query evaluations**.

## 8. Reproducibility Contract

- **Pin everything**: commit SHA per corpus, python `requirements.txt`,
  torch + transformers + sentence-transformers versions, CUDA version.
- **Deterministic seeds** for: subset selection, noise injection,
  bootstrap resampling.
- **No Date.now/Random in eval scripts** — only in deliberately seeded
  noise injection.
- **One JSONL per run** under `results/`; one Parquet summary per stage
  under `results/summaries/`.
- **Hashed config IDs**: `cfg_id = sha1(json.dumps(config, sort_keys=True))`
  for cross-stage joins.
- **`scripts/run.sh <stage>`** is the only entry point; it reads `stage.yaml`
  and runs the sweep, writes results, and verifies row counts.
- **`scripts/verify.py`** re-derives the gold pairs from corpus SHAs and
  checks that the JSONL row counts match expectations (catches a partial
  run quietly producing wrong stats).

## 9. Limitations (acknowledged up front)

- **Self-labels ≠ developer intent**: see §3.2.
- **Single-target labels**: `Recall@k` collapses to `Hit@k`. We compensate
  with MRR + nDCG.
- **Tokenizer for dense models is fixed by the model**; cross-tokenizer
  comparisons are BM25-only.
- **No re-ranking layer**: this experiment compares first-stage retrieval
  only. A learned re-ranker would change the picture but reintroduces
  training (and likely an LLM in the loss).
- **No cross-lingual queries**: query and target are in the same source
  language as the corpus.

## 10. Out of Scope

- LLM-as-judge (deliberately excluded — would re-introduce stochasticity).
- Fine-tuning embedders (deliberately excluded — turns it into a model
  training paper, not an IR sweep).
- Online learning / feedback adaptation.
- Code generation or repair quality.

