# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); this project is pre-1.0 (`0.1.0`).

## [Unreleased]

### Added
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
