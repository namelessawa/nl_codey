# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); this project is pre-1.0 (`0.1.0`).

## [Unreleased]

### Added
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

### Fixed
- **Run button unresponsive** — Run is now clickable with no workspace open and the guard
  surfaces "Open a workspace first" instead of silently doing nothing.
- **No live feedback during real-LLM runs** — the renderer dropped live events while the
  run detail was still null; `reduceAgentDetail` now seeds the detail from the first
  event so steps stream live instead of appearing frozen.

### Changed
- `CLAUDE.md` documents the concrete command whitelist, per-tool limits, and the SQLite
  DB path.
