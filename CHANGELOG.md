# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); this project is pre-1.0 (`0.1.0`).

## [Unreleased]

### Added
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
