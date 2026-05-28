# Coding Agent — Local Windows GUI Coding Agent

A local desktop coding agent. Open a project, type a task, and the agent drives an
**autonomous tool-use loop**: it reads code, searches, plans, and edits — proposing
each change as a patch. Nothing is written until you **approve**. Every step is logged
to SQLite, every change is snapshotted, and any run can be **rolled back**. All file
and command access is confined to the workspace root.

The project grew across three phases, all now on `main`:

- **Phase 1 — safe single-pass MVP.** Path isolation, command whitelist, timeout,
  output truncation, and explicit approval before any write.
- **Phase 2 — autonomous tool-use loop.** The model drives a streaming tool-calling
  loop with a budget breaker, an automatic verify→repair cycle, a regression guard
  against a pristine test baseline, context compression for long runs, retry-with-backoff
  on transient LLM failures, the V4A context patch format, a symbol index, and an eval
  harness. Live trace, iteration timeline, budget indicator, and project card in the GUI.
- **Phase 3 — long-term project entrustment.** Cross-session memory, a semantic index,
  task planning (dependency graph + scheduler), multi-agent orchestration
  (Planner / Coder / Reviewer), git integration (branch / commit / PR), web tools, and
  WSL/Docker sandbox runners — surfaced behind a "Phase 3" tab.

## Architecture

A pnpm monorepo (`apps/*`, `packages/*`). Workspace packages ship raw TypeScript source
and are **bundled** by `electron-vite`; cross-package imports use the `@coding-agent/*`
alias with `.js` specifiers (NodeNext/Bundler ESM convention).

```
apps/desktop          Electron app (main / preload / React renderer)
packages/shared       Types + IPC contract — the dependency hub everything imports
packages/sandbox      Path isolation, command whitelist/router, WSL + Docker runners
packages/storage      SQLite (better-sqlite3): workspaces/runs/steps/snapshots + Phase 3 tables
packages/project-indexer  File scan + ignore rules + project-type detection
packages/llm          Provider abstraction: streaming chat() + complete(), OpenAI-compat + Anthropic
packages/tools        The agent's tools (list/read/search/patch/run/git/symbol/web/memory/task)
packages/agent-core   Tool-use loop, budget, verifier, regression guard, compressor, eval, rollback
packages/memory       Cross-session memory: decision/preference/failure/fact entries + retriever
packages/semantic-index   Embedders, chunker, cosine vector search, incremental reindex
packages/planner      Dependency graph, DAG validation, scheduler waves, LLM decomposer
packages/orchestrator Planner/Coder/Reviewer roles, message bus, lock manager, worker pool
packages/git-integration  Branch manager, conventional commit writer, PR generator, diff summarizer
packages/web-tools    Domain whitelist, readability fetch, search backends
```

The renderer never touches Node directly — it talks to the main process through a typed
`window.agentApi` exposed by the preload bridge (`contextIsolation: true`,
`nodeIntegration: false`). Live updates flow back via a `broadcast` → `onAgentEvent`
channel carrying a discriminated `AgentEvent` union.

## Requirements

- Node.js 20+ (developed on 24)
- pnpm 10+
- Windows 11 (primary target)
- A C/C++ build toolchain for the native `better-sqlite3` module
  (Visual Studio Build Tools "Desktop development with C++", or run
  `npm install --global windows-build-tools` once).

`ripgrep` is **bundled** via `@vscode/ripgrep` — no system install needed. WSL and
Docker are optional; only the corresponding sandbox modes require them.

## Install

```powershell
pnpm install
```

`pnpm install` runs an `electron-rebuild` postinstall step that rebuilds
`better-sqlite3` against Electron's ABI. If it fails (toolchain missing), install
the C++ build tools and re-run:

```powershell
pnpm rebuild:native
```

## Run

```powershell
pnpm dev
```

This launches the Electron app with HMR. Use **Open** (top-left) to pick a project
folder, type a task, and click **Run**.

Build a production bundle:

```powershell
pnpm build
```

## Workspace UI

The left panel keeps recent projects and the current folder structure close at hand; the
center panel streams the agent's work across several tabs.

- **Recent workspaces** — previously opened folders are listed most-recent-first
  (persisted in SQLite) so a project can be reopened in one click. Reopening validates
  the folder still exists before switching to it.
- **Structured file tree** — the workspace renders as a collapsible folder/file tree
  (directories first, expandable), not a flat path list.
- **Project card** — detected project kind (Node/TS, Python, Go, Rust, or unknown), the
  validation commands the agent prefers, file count, and top extensions.
- **Formatted output** — agent messages render as markdown (headings, lists, bold/italic,
  inline and fenced code) via a small dependency-free renderer.
- **Auto-scroll** — the step stream follows new output as the agent streams, and stops
  following when you scroll up (re-engaging when you return to the bottom).
- **Trace / Timeline / Budget** — a Trace tab with per-step timestamps, durations,
  filtering, search, and JSON export; a Timeline tab visualizing edit→verify→repair
  iterations; and a top-bar budget indicator (cost / iterations / tool-calls / elapsed)
  that turns amber past 80% and red past 100%.
- **Phase 3 tab** — memory panel, task tree, role timeline, git diff preview, failure
  library, and sandbox indicator.

## Configure the LLM (Settings panel)

Click the **gear icon** (⚙, top-right of the center toolbar) to open **Settings**.
It has three groups:

- **LLM** — Provider (OpenAI / Anthropic / Google Gemini / DeepSeek / OpenRouter /
  Custom), API Key (masked, with show/hide), Base URL (auto-filled per provider),
  Model, Temperature (0–2), Max Tokens, Timeout (s), and a **Test connection**
  button that sends one minimal request and reports 连接成功 / a redacted error.
- **Agent** — workspace path, allow shell execution, confirm-before-command,
  max auto steps, sandbox mode.
- **Interface** — theme (System / Light / Dark), language (zh-CN / en-US), font size.

Save / Cancel / Reset-to-defaults (with a confirmation) sit in the footer; a toast
confirms each save.

### Where the API key is stored

The API key is **encrypted at rest** via Electron `safeStorage` (OS-backed:
Windows DPAPI / macOS Keychain / Linux Secret Service) in
`<userData>/apikey.bin`. It is **never** written to `settings.json`, logged, or
included in error messages (provider errors are redacted). All other settings are
JSON at `<userData>/settings.json`. On Windows `<userData>` is
`%APPDATA%/coding-agent`.

> If the OS reports secure storage unavailable, the panel shows a warning and the
> key is **not** persisted that session (no plaintext fallback on disk).

### Provider coverage

OpenAI, DeepSeek, OpenRouter, Google Gemini, and Custom all use the shared
OpenAI-compatible `/chat/completions` provider (Gemini via Google's OpenAI-compat
base URL). Anthropic uses the native `/v1/messages` API. Both expose a streaming
`chat()` (token deltas + tool calls, SSE reassembly) and a non-streaming `complete()`,
and retry transient failures with bounded exponential backoff. A **Custom** provider
only needs a Base URL + API Key + Model.

### Dev fallback (no key configured)

When no API key is saved, LLM calls fall back to the env provider from
`.env` (copy `.env.example`). Default `LLM_PROVIDER=mock` needs no key and exercises
the full tool-use / approve / verify / rollback loop without an API key.

The SQLite database lives at `<userData>/data/workspace-state.db`.

## The agent's tools

Each tool enforces hard caps so a single step can't flood the model or escape the
workspace.

| Tool | Limits / notes |
|---|---|
| `list_files` | workspace-only, ignores `node_modules/.git/dist/build/target/.venv/__pycache__/.next/out`, ≤500 files |
| `read_file` | workspace-only, ≤200KB, binary rejected |
| `read_file_range` | inclusive 1-indexed slice, ≤500 lines, reports total line count |
| `search_text` | ripgrep, ≤100 matches, ≤300 chars context, ignored dirs skipped |
| `find_symbol` | locate declarations or list a file's symbols (TS/JS, Python, Go, Rust), ≤400 files / ≤50 results |
| `apply_patch` | unified diff **or** V4A context format; snapshots before write; transactional (no partial corruption); pauses for approval |
| `run_command` | whitelist (or WSL/Docker per sandbox mode), 60s timeout, 100KB output cap, cwd = workspace root |
| `git_status` / `git_diff` | branch + change summary; working-tree or staged unified diff |
| `record_plan` | advisory structured plan recorded into the trace |
| `semantic_search` | cosine search over the embedded project index |
| `web_fetch` / `web_search` | readability fetch + search, restricted to a domain whitelist |
| `read_memory` / `write_memory` | cross-session decision / preference / failure / fact entries |
| `propose_task_breakdown` / `update_task_status` | task tree for planning and orchestration |
| `request_review` / `approve_change` / `request_changes` | Coder↔Reviewer orchestration messages |
| `write_file` | internal (post-approval), snapshot before write |

**Command whitelist** (sandbox mode `whitelist`, the default): `npm test`, `npm run test`,
`npm run build`, `pnpm test`, `pnpm build`, `yarn test`, `yarn build`, `pytest`,
`pytest .`, `go test ./...`, `cargo test`, `tsc --noEmit`, `npx tsc --noEmit`. To allow a
new validation command, add it to the whitelist — do not loosen the matcher.

## Sandbox modes

`run_command` routes through one of three modes (selectable in Settings → Agent):

- **`whitelist`** (default, safest) — exact-match allowlist, screened for dangerous
  patterns (chaining, substitution, redirection, `rm -rf`, `powershell`, …), spawned on
  the host with cwd pinned to the workspace root.
- **`wsl`** — runs inside a WSL Ubuntu instance against a workspace copy.
- **`docker`** — runs inside an ephemeral container with the workspace bind-mounted.

WSL/Docker runs default to **no network egress** unless a command opts in, and sync
changed files back to the host.

## Test

```powershell
pnpm test          # vitest run (all packages)
pnpm typecheck     # tsc --noEmit across all workspace projects
```

Coverage spans path isolation (incl. symlink escape), the command whitelist + injection
rejection + sandbox policy/router, `apply_patch` (unified + V4A, new/modify/delete,
no-corrupt on failure), the tool-use loop / budget / verifier / regression guard /
compressor / eval harness, the memory retriever, semantic index, planner graph/scheduler,
orchestrator message bus / locks / roles, git integration, web tools, the LLM providers
(streaming chat, retries), and the storage lifecycle.

> **Native-module note:** `pnpm test` runs under plain Node, while `better-sqlite3` is
> rebuilt against Electron's ABI for `pnpm dev`/`build`. The single test that opens a real
> DB (`packages/storage/src/storage.test.ts`) therefore fails with an ABI mismatch under
> Node — a toolchain artifact, not a code regression. See `CLAUDE.md`.

## Safety model

- Every path is `resolve`d and checked to remain inside the workspace root
  (symlink escapes via `realpath`, Windows separators handled).
- Commands are exact-matched against the whitelist (or routed through the WSL/Docker
  sandbox) and screened for dangerous patterns before spawning.
- Patches snapshot prior content before writing and apply transactionally; cumulative
  per-iteration snapshots are restored in reverse on rollback.
- Patch application requires explicit user approval in the GUI — the loop parks until the
  Apply/Reject IPC resolves.
- A per-run budget breaker caps cost / iterations / tool-calls / time (hard-capped at
  $5.00) and stops the run when tripped.
- Any run is fully reversible via **Rollback**; a run can be cancelled via **Stop**
  (AbortSignal, checkpointed between phases).
