# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); this project is pre-1.0 (`0.1.0`).

## [Unreleased]

### Fixed
- **Startup crash `SqliteError: no such column: iteration` on upgraded databases** —
  `Storage`'s constructor ran `exec(SCHEMA_SQL)` (which created `idx_snapshots_run_iter ON
  file_snapshots(run_id, iteration)`) *before* `migrate()` added the `iteration` column via
  `COLUMN_MIGRATIONS`. On a pre-Phase-2 DB the `file_snapshots` table already existed without that
  column, so the index creation threw. Split all `CREATE INDEX` statements out of `SCHEMA_SQL` into a
  new `INDEX_SQL` block and reordered init to tables → migrations → indexes, so indexes referencing
  migrated columns succeed on upgraded installs. Added a regression test that opens a legacy DB whose
  `file_snapshots` lacks `iteration`. (Storage tests still require the Node-ABI better-sqlite3 build
  to execute — see CLAUDE.md.)
- **App load crash from un-bundled Phase 3 packages** — `apps/desktop/electron.vite.config.ts`
  listed only the Phase 1/2 workspace packages in `workspacePackages`, so `externalizeDepsPlugin`
  externalized the six Phase 3 packages (`semantic-index`, `memory`, `planner`, `orchestrator`,
  `git-integration`, `web-tools`). At runtime Electron's Node tried to load their raw `.ts` source
  and threw `ERR_UNKNOWN_FILE_EXTENSION` for `packages/semantic-index/src/index.ts`. Added all six
  to the bundle list so every `@coding-agent/*` workspace package (13 total) is bundled. `pnpm build`
  green; `out/main/index.js` now transforms 118 modules.

### Added
- **Phase 3 — long-term project entrustment (full module build, typecheck-green)**. New packages:
  `@coding-agent/memory` (cross-session memory: decision/preference/failure/fact entries,
  embedding+tag+recency retriever, decay, JSON export/import), `@coding-agent/semantic-index`
  (OpenAI + mock embedders, heuristic chunker, cosine vector search, incremental mtime reindex),
  `@coding-agent/planner` (glob dependency graph, DAG validation, scheduler waves with
  scope-overlap serialization, LLM decomposer), `@coding-agent/orchestrator` (Planner/Coder/Reviewer
  roles + prompts, strict 4-kind message-bus with JSON validation, thread-safe BudgetController,
  LockManager with deadlock-timeout, bounded worker pool, Coordinator review loop),
  `@coding-agent/git-integration` (branch manager, conventional commit writer, PR generator,
  diff summarizer), `@coding-agent/web-tools` (domain whitelist, readability fetch, search backends).
  Extended packages: `sandbox` (WSL/Docker runners, escape guards, command router), `tools` (10 new
  port-injected LLM tools + role registry; git_create_branch/git_commit kept as orchestrator
  system-calls), `storage` (5 new tables: memory_entries, semantic_chunks, task_nodes, role_messages,
  git_actions + CRUD), `shared` (memory/semantic/task/roles/git/sandbox/web contracts + 25 IPC
  channels). Desktop: full IPC wiring (main handlers, preload bridge, renderer api) and 6 GUI
  components (MemoryPanel, TaskTreeView, RoleTimeline, GitDiffPreview, FailureLibraryView,
  SandboxIndicator) behind a new "Phase 3" tab. `pnpm typecheck` green across all 15 workspace
  projects; ~220 new unit tests pass (the only failing tests are the pre-existing storage
  better-sqlite3 native-ABI mismatch under Node, documented in CLAUDE.md).
- **Acceptance scenarios (Phase 2 Step 16)** — `docs/PHASE2_ACCEPTANCE.md` enumerates 14
  acceptance scenarios (autonomous loop, patch approval, verify, verify→repair, regression
  guard, snapshots/rollback, budget breaker, cancellation, compression, retries,
  observability, project card, symbol navigation, eval suite), each mapped to its steps,
  expected result, and verifying test. Backed by `acceptance.test.ts`, which drives the
  assembled tool-use pipeline through a deterministic scripted provider end-to-end:
  verify→repair→done (two gated patches, two verifications), patch rejection → cancelled, and
  the budget circuit breaker. This closes out the Phase 2 dev-order steps.
- **Iteration timeline (Phase 2 Step 8)** — a new **Timeline** tab in the center panel
  visualizes the agent's edit→verify→repair cycles: one card per iteration with a status
  marker (in-progress / verified / failed), a `patch` badge, a relative start offset, and the
  step count. Iterations are derived purely from the step stream by `deriveIterations` (a new
  patch opens a new iteration; verify pass/fail notes set its status), so it stays in sync
  live with no new IPC. Unit-tested (4 tests).
- **Project card (Phase 2 Step 9)** — the left panel now shows a compact card for the open
  workspace: detected project kind (Node/TS, Python, Go, Rust, or unknown), the validation
  commands the agent will prefer, total file count, and the top file extensions. Derived
  client-side from the workspace file list via `deriveProjectCard` (filename heuristics
  mirroring the main-process detector), so it needs no disk reads or IPC. Unit-tested
  (5 tests).
- **Eval framework + 10 tasks (Phase 2 Step 14)** — a deterministic evaluation harness for
  the agent. Each `EvalTask` seeds a tiny workspace, states a prompt, and asserts the result
  through reproducible, LLM-free checks (`file_exists` / `file_absent` / `file_contains` /
  `file_not_contains` / `command_succeeds`). `runEvalSuite` isolates each task in its own
  workspace, runs an **injected** agent runner (so the framework is unit-testable and
  decoupled from AgentService/storage; a crashed run scores as failed rather than throwing),
  and `summarize`/`formatReport` produce a pass-rate report. Ships `EVAL_TASKS`: 10 small
  add/fix/rename/refactor/multi-file tasks. Core is fully unit-tested (10 tests).
- **`find_symbol` tool + symbol index (Phase 2 Step 10)** — a new agent tool locates symbol
  declarations (functions, classes, interfaces, types, enums, structs, traits, consts) by
  name across the project, or lists all symbols in a single file — faster than `search_text`
  for jumping to a definition. Backed by a pure, dependency-free `extractSymbols` heuristic
  that pattern-matches top-level declarations per language (TS/JS, Python, Go, Rust) with
  line numbers, signatures, and an `exported` flag (JS `export` / Python non-underscore / Go
  capitalization / Rust `pub`). Capped at 400 files scanned and 50 results, never escaping the
  workspace. _(Deviation from spec: implemented as a regex heuristic rather than a tree-sitter
  parse, to avoid adding a second native-module/ABI dependency alongside better-sqlite3; the
  `symbols` table is reserved for a future persisted index.)_
- **Resilient LLM requests (Phase 2 Step 15)** — both providers now retry transient failures
  instead of failing the whole run on the first hiccup. A new `postWithRetries` helper wraps
  every `/chat/completions` and `/v1/messages` POST with bounded exponential backoff
  (3 attempts), retrying network errors and retryable HTTP statuses (408/409/425/429 and
  5xx) while never retrying a deliberate abort. The final attempt's response is returned
  intact so callers keep their status-specific, key-redacted error detail. This also wires up
  the previously-dead `withRetries` helper. `isRetryableStatus`/`withRetries`/`postWithRetries`
  are unit-tested (9 tests).
- **Regression guard (Phase 2 Step 7)** — before the agent makes any edit, the run now
  captures a pristine baseline by running the verification command once and recording which
  tests already failed. After each post-patch verification, current failures are classified
  against that baseline into regressions (newly broken — likely caused by this run), fixed,
  and pre-existing. Regressions are surfaced as a prominent guard note appended to the
  model's feedback so it must fix them before finishing, while pre-existing failures are
  explicitly called out as not-this-run so the agent doesn't chase unrelated breakage. When
  shell is disabled or no command is detected the baseline is `null` and classification is
  skipped. Pure `analyzeRegressions`/`regressionNote` helpers are unit-tested.
- **Verifier loop (Phase 2 Step 6)** — after an approved `apply_patch` writes to disk, the
  agent now automatically runs the project's verification command (the first detected
  test/build script) instead of relying on the model to remember. The run transitions the
  status to `verifying`; on success it returns to `tool_use` with a pass note, on failure it
  enters `repairing` and feeds a structured failure summary (parsed via `parse_test_failure`:
  framework + per-file/line failures) back to the model so it can make a minimal fix, which is
  then verified again — the verify→repair loop. Skipped (with an explanatory note) when shell
  execution is disabled or no command is detected. Pure `evaluateVerification` helper is
  unit-tested; the loop gains an optional injected `verifyAfterPatch` hook. Cumulative
  snapshots (one per applied patch, restored in reverse on rollback) make every iteration
  reversible.
- **Context compression (Phase 2 Step 13)** — long tool-use runs no longer blow the model's
  context window. When the estimated conversation size exceeds 60% of the model's context
  window (`contextWindowFor`), the loop folds the middle of the history into an LLM-generated
  summary before the next turn, preserving the system prompt, the original user task, and the
  most recent 10 messages verbatim. The summarizer runs through the same provider via a new
  `AgentService.summarizeContext` and a Chinese `SUMMARIZE_PROMPT` that keeps task goal,
  explored files, attempted patches, and test failures while dropping full file bodies and
  intermediate reasoning. A trace step reports how many messages were compressed. Compression
  is an optional, injected dependency of `runToolLoop`, so it stays out of the way in tests.
- **More agent tools (Phase 2 Step 11)** — `read_file_range` (inclusive 1-indexed slice,
  max 500 lines, reports total line count), `git_status` (branch + modified/added/deleted/
  untracked), `git_diff` (working-tree or staged unified diff, optional path), and
  `record_plan` (advisory structured plan for the trace). Wired into the tool registry and
  schemas. _(`ask_human` deferred — needs a free-text response IPC + GUI input.)_
- **V4A patch format (Phase 2 Step 12)** — `apply_patch` now accepts the context-based
  V4A format (`*** Begin Patch` / `*** Update File:` / `*** Add File:` / `*** Delete File:`
  / `*** End Patch`) in addition to unified diff. V4A locates edits by surrounding context
  (line-number-free, more tolerant of model mistakes), supports add/update/delete across
  multiple files in one patch, and applies transactionally — a context that can't be found
  aborts before any write, so files are never corrupted. The format is auto-detected by the
  envelope; unified diff remains the fallback.
- **Live trace + budget GUI (Phase 2 Step 4)** — the agent now streams assistant text
  to the renderer token-by-token via a new `delta` agent event; the step stream shows the
  in-progress turn live instead of waiting for the turn to finish. A top-bar
  **BudgetIndicator** shows cost / iterations / tool-calls / elapsed time against the
  limits, turning amber past 80% and red past 100%. A new **Trace** tab renders the full
  step trace with relative timestamps, type icons, per-step durations, type filtering,
  search, expand-to-detail, and JSON export. Run-control now treats `tool_use`/`verifying`/
  `repairing` as active states so Run/Stop gate correctly. _(Pause/Resume and
  Force-Approve-All buttons are deferred.)_
- **Agent tool-use loop (Phase 2 Step 2)** — the agent core no longer runs the fixed
  two-pass plan→diff pipeline. `runToolLoop` lets the model drive: it streams `chat()`
  turns, selects tools (`list_files`/`read_file`/`search_text`/`apply_patch`/`run_command`)
  via the tool-calling API, and continues until it stops, the budget trips, the user
  cancels, or an error occurs. New states (`tool_use`, `budget_exceeded`) flow to the GUI.
  `apply_patch` still pauses for explicit user approval (the loop parks on a promise that
  the Apply/Reject IPC resolves), so nothing is written without consent, and rollback is
  preserved. Per-turn token/cost/tool/iteration usage is persisted to the run. The explain
  task keeps its read-only short-circuit. `AGENT_TOOL_SCHEMAS` + `createToolExecutor`
  bridge the model's tool calls to the Phase 1 tools.
- **Phase 2 foundation — streaming, tool-calling LLM layer** _(backend only; agent
  loop migration pending)_. New `ChatLLMProvider` interface with a streaming
  `chat()` that emits `text_delta` / `tool_call` / `finish` / `error` chunks, alongside
  the retained Phase 1 `complete()`. OpenAI-compatible and Anthropic providers parse SSE
  and reassemble fragmented tool calls (OpenAI `tool_calls` deltas; Anthropic
  `input_json_delta` blocks and `tool_result` messages). New shared types
  (`ToolSchema`, `LLMToolCall`, `TokenUsage`, `LLMChunk`, `JSONSchema`) and a model
  metadata module (`MODEL_PRICING`, context windows, `computeCostUsd`, token estimates).
  The Mock provider gained a `chat()` with turn/keyword-driven tool sequences and a
  conditional repair branch so the loop is exercisable without an API key.
- **Budget controller** — `BudgetController` tracks iterations, cost, tool calls, and
  wall-clock time against per-run limits (`DEFAULT_BUDGET_LIMITS`, hard-capped at
  $5.00 via `clampBudgetLimits`) and reports a `BudgetStatus` snapshot for the GUI.
- **Cumulative-snapshot storage schema** — `agent_runs` gains token/cost/iteration/
  model/exit columns; `file_snapshots` gains `iteration` + `snapshot_type`; new
  `project_cards` and `symbols` tables. Additive `COLUMN_MIGRATIONS` upgrade existing
  databases in place. New `Storage` methods: `addRunUsage`, `setRunModel`,
  `setRunExitReason`, `listSnapshotsByType`, `listSnapshotsByIteration`.
- **`parse_test_failure`** — structured failure parser for vitest, jest, pytest, tsc,
  go test, and cargo test, with an `unknown` fallback that returns truncated raw output.
- **Workspace memory** — the left panel now shows a "Recent" list of previously opened
  workspaces (persisted in SQLite, most-recent-first) so a folder can be reopened in one
  click without the file dialog. Backed by new `listWorkspaces` / `openRecentWorkspace`
  IPC channels; reopening validates the folder still exists and refreshes its
  opened-at timestamp.
- **Auto-scroll on LLM output** — the step stream now follows new output to the bottom as
  the agent streams, with stick-to-bottom detection that stops following when the user
  scrolls up and re-engages when they return to the bottom.
- **Structured file tree** — the left panel renders the workspace as a collapsible
  folder/file tree (directories first, expandable) built from the flat path list via a
  pure `buildTree`, instead of a flat path list.
- **Formatted LLM output** — agent `message` steps render as markdown (headings, bullet/
  numbered lists, bold/italic, inline and fenced code) via a small dependency-free
  `Markdown` renderer, instead of raw monospace text.

### Fixed
- **Run button unresponsive** — Run is now clickable with no workspace open and the guard
  surfaces "Open a workspace first" instead of silently doing nothing.
- **No live feedback during real-LLM runs** — the renderer dropped live events while the
  run detail was still null; `reduceAgentDetail` now seeds the detail from the first
  event so steps stream live instead of appearing frozen.

### Changed
- `CLAUDE.md` documents the concrete command whitelist, per-tool limits, and the SQLite
  DB path.
