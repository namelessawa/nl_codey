# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

A local Windows desktop **coding agent**: open a project, type a task, and the agent drives an **autonomous tool-use loop** — reading code, searching, planning, and editing — proposing each change as a patch. Nothing is written to disk until the user **approves** in the GUI. Every step is logged to SQLite, every change is snapshotted, and any run can be **rolled back**. All file/command access is confined to the workspace root.

The codebase spans three phases, all on `main`:

- **Phase 1** — safe single-pass MVP: path isolation + command whitelist + timeout + output truncation + explicit approval.
- **Phase 2** — autonomous tool-use loop with a budget breaker, automatic verify→repair cycle, regression guard, context compression, retry-with-backoff, the V4A context patch format, a symbol index, and an eval harness.
- **Phase 3** — long-term project entrustment: cross-session memory, semantic index, task planning, multi-agent orchestration (Planner/Coder/Reviewer), git integration, web tools, and WSL/Docker sandbox runners.

## Commands

```powershell
pnpm install          # also runs electron-rebuild postinstall for better-sqlite3
pnpm dev              # launch Electron app with HMR (electron-vite dev)
pnpm build            # typecheck packages, then electron-vite production build
pnpm typecheck        # tsc --noEmit across all workspace projects
pnpm test             # vitest run (all packages)
pnpm test:watch       # vitest watch
pnpm rebuild:native   # rebuild better-sqlite3 against Electron's ABI
```

Run a single test file or test by name:

```powershell
pnpm exec vitest run packages/runtime/llm/src/test-connection.test.ts
pnpm exec vitest run -t "masks all but the last 4 characters"
```

### Native module ABI gotcha (important)

`better-sqlite3` is a native module. `postinstall` / `rebuild:native` compile it against **Electron's** ABI so `pnpm dev`/`build` work. But `pnpm test` runs under plain **Node**, which has a different `NODE_MODULE_VERSION`. As a result `packages/core/storage/src/storage.test.ts` (the only test that opens a real DB) **fails with an ABI mismatch unless the module is currently built for Node**. This is an environment/toolchain artifact, not a code regression — do not "fix" storage code in response to it. Every other test runs fine under Node because nothing else touches the native binding.

## Architecture

### Monorepo layout (pnpm workspace: `apps/*`, `packages/*`)

```
apps/desktop          Electron app: src/main, src/preload, src/renderer (React)
packages/shared       Types + IPC contract. The dependency hub — everything imports it.
packages/sandbox      Path isolation, command whitelist/router, WSL + Docker runners
packages/storage      SQLite (better-sqlite3): workspaces/runs/steps/snapshots + Phase 3 tables
packages/project-indexer  File scan + ignore rules + project-type detection
packages/llm          Provider abstraction + factory: streaming chat() + complete(), testLLMConnection
packages/tools        The agent's tools (list/read/search/patch/run/git/symbol/web/memory/task)
packages/agent-core   AgentService + runToolLoop, budget, verifier, regression guard, compressor, eval, rollback
packages/memory       Cross-session memory: decision/preference/failure/fact entries + retriever
packages/semantic-index   Embedders, chunker, cosine vector search, incremental mtime reindex
packages/planner      Dependency graph, DAG validation, scheduler waves, LLM decomposer
packages/orchestrator Planner/Coder/Reviewer roles, message bus, lock manager, worker pool, coordinator
packages/git-integration  Branch manager, conventional commit writer, PR generator, diff summarizer
packages/web-tools    Domain whitelist, readability fetch, search backends
```

Workspace packages ship **raw `.ts` source** (`main`/`module`/`types` all point at `src/index.ts`) — there is no per-package build output. `electron.vite.config.ts` therefore **bundles** them (via `externalizeDepsPlugin({ exclude: workspacePackages })`) instead of externalizing. Cross-package imports use the `@nlc/*` alias and **`.js` extension specifiers** even though the files are `.ts` (NodeNext/Bundler ESM convention — keep this when adding imports).

### The process boundary (read this before touching IPC)

`contextIsolation: true`, `nodeIntegration: false`. The renderer never touches Node. Data flows through one typed contract. Adding any renderer↔main call means editing **all five** of these in lockstep:

1. `packages/shared/src/ipc.ts` — add the channel to the `IPC` map, an arg type, and a method on the `AgentApi` interface.
2. `apps/desktop/src/main/ipc.ts` — register a handler via the `handle()` wrapper (it wraps every call in the `{ ok: true, data } | { ok: false, error }` envelope).
3. `apps/desktop/src/preload/index.ts` — bridge the method onto `window.agentApi`.
4. `apps/desktop/src/renderer/src/api.ts` — add a wrapper that `unwrap`s the envelope into a value-or-throw.
5. Consume `api.*` in renderer components.

Live updates flow the other way: main calls `broadcast(IPC_EVENT, event)` → renderer's `api.onAgentEvent` handler. `AgentEvent` is a discriminated union keyed on `kind`: `run_updated` | `step_added` | `patch_ready` | `delta` (token-by-token assistant text for the in-progress turn) | `task_updated` | `role_message` | `index_status` (the last three are Phase 3).

### Agent run lifecycle (`packages/agent-core/src/service.ts` + `loop.ts`)

`AgentService.runTask` no longer runs a fixed pipeline — it assembles the conversation, a `BudgetController`, and a tool executor, then hands control to **`runToolLoop`** (`loop.ts`). The model drives: it streams `chat()` turns, selects tools via the tool-calling API, and continues until it stops, the budget trips, the user cancels, or an error occurs. `AgentRunState` now includes `tool_use`, `verifying`, `repairing`, and `budget_exceeded` alongside the Phase 1 states.

- **Approval gate:** `apply_patch` still pauses for explicit user approval — the loop parks on a promise that the Apply/Reject IPC resolves, so nothing is written without consent. Snapshots are taken before each write; `rollback` restores them in reverse (cumulative, one per applied patch).
- **Verify→repair:** after an approved patch, `verifyAfterPatch` runs the detected validation command; on failure the run enters `repairing` and feeds a structured failure summary (`parse_test_failure`) back to the model. A `regression` guard classifies failures against a pristine baseline captured before the first edit.
- **Compression:** when estimated context exceeds ~60% of the model's window, `compressConversation` folds the middle of the history into an LLM summary (`SUMMARIZE_PROMPT`) before the next turn, preserving the system prompt, original task, and the most recent messages.
- The LLM provider is **resolved per run** via the injected `resolveLLM()` (not held as a field), so settings changes take effect without restart. A missing API key surfaces as a readable error and falls back to the env mock provider.
- Cancellation is an `AbortController` per run; `stop()` aborts it and `throwIfAborted` checkpoints between phases.
- "Explain" tasks (`isExplainTask`) short-circuit: they read files and return prose, never entering the patch flow.

### Settings & secrets (`apps/desktop/src/main/settings/`, `packages/shared/src/settings.ts`)

- `AppSettings` (llm/agent/ui) types, `DEFAULT_SETTINGS`, `PROVIDER_PRESETS`, and pure `validateSettings`/`maskApiKey`/`mergeSettings` live in **shared** so main, renderer, and llm agree.
- `SettingsStore` (main) persists non-secret settings as `<userData>/settings.json`. The **API key is split out** to `SecretStore`, which encrypts it via Electron `safeStorage` into `<userData>/apikey.bin` — never in the JSON, never logged, stripped from provider errors (`redactError`/`maskApiKey`). If `safeStorage` is unavailable, the key is not persisted (no plaintext fallback). Swapping in an OS keyring later means changing only `secret.ts`.
- The settings UI (`renderer/src/components/SettingsModal.tsx` + `settings/*`) uses the `useSettings` hook. Theme/font-size apply via `data-theme`/`data-fontsize` attributes on `<html>` (see `appearance.ts` + `styles.css` CSS custom properties). A minimal `i18n.ts` `t()` dictionary covers the settings surface only — the rest of the app is not yet translated.

### LLM providers (`packages/llm`)

`createLLMProvider(config: LLMConfig)` is the factory. OpenAI / DeepSeek / OpenRouter / Gemini / Custom all share `OpenAICompatibleProvider` (`/chat/completions`, Bearer auth; Gemini via Google's OpenAI-compat base URL). Anthropic uses `AnthropicProvider` (`/v1/messages`, `x-api-key`). Providers use plain `fetch` (no SDKs) with a shared `withTimeout` helper. Both expose a streaming `chat()` (emits `text_delta` / `tool_call` / `finish` / `error` chunks, reassembling fragmented SSE tool calls) and the Phase 1 `complete()`, and wrap every POST in `postWithRetries` (bounded exponential backoff on network errors + retryable statuses 408/409/425/429/5xx, never on a deliberate abort). `createLLMProviderFromEnv` is the dev fallback (default `LLM_PROVIDER=mock`, needs no key; its `chat()` runs keyword-driven tool sequences with a repair branch so the full loop is exercisable offline).

### Sandbox invariants (`packages/sandbox`)

- Every path is `resolve`d and checked to stay inside the workspace root, including `realpath` symlink-escape checks (`assertInsideWorkspace`).
- `run_command` routes through one of three `SandboxMode`s (Settings → Agent): **`whitelist`** (default, safest), **`wsl`** (WSL Ubuntu against a workspace copy), or **`docker`** (ephemeral container, workspace bind-mounted). WSL/Docker default to no network egress unless a command opts in, and sync changed files back to the host.
- In `whitelist` mode, commands are **exact-matched** (after whitespace normalization) against `ALLOWED_COMMANDS` and screened against `DANGEROUS_PATTERNS` (chaining, substitution, redirection, `rm -rf`, `powershell`, etc.) before spawning. To allow a new validation command, add it to the whitelist — do not loosen the matcher. The current whitelist: `npm test`, `npm run test`, `npm run build`, `pnpm test`, `pnpm build`, `yarn test`, `yarn build`, `pytest`, `pytest .`, `go test ./...`, `cargo test`, `tsc --noEmit`, `npx tsc --noEmit`.

### Tool limits (`packages/tools`)

Each tool enforces hard caps so a single step can't flood the model or escape the workspace. File/search/exec tools: `list_files` ≤500 files (ignores `node_modules/.git/dist/build/target/.venv/__pycache__/.next/out`); `read_file` ≤200KB, rejects binary; `read_file_range` ≤500-line slice; `search_text` ripgrep, ≤100 matches, ≤300 chars context; `find_symbol` ≤400 files / ≤50 results; `run_command` 60s timeout, 100KB output cap, cwd = workspace root; `apply_patch`/`write_file` snapshot before write and apply transactionally — `apply_patch` accepts both unified diff and the V4A context format, auto-detected by the envelope. Phase 2/3 tools (port-injected, registered in `agent-core/src/tools-registry.ts`): `git_status`/`git_diff`, `record_plan`, `semantic_search`, `web_fetch`/`web_search` (domain-whitelisted), `read_memory`/`write_memory`, `propose_task_breakdown`/`update_task_status`, and the Coder↔Reviewer messages `request_review`/`approve_change`/`request_changes`. `ripgrep` is bundled via `@vscode/ripgrep` — no system install needed.

### Dynamic tool trust boundary

- `DynamicToolBundle.mutatingNames` is mandatory. Read-only bundles must
  provide `[]`; missing or malformed classification is never interpreted as
  safe.
- Agent Core must validate every runtime bundle before exposing schemas or
  retaining its dispatcher. Reject duplicate schemas/classifications,
  classifications without schemas, and collisions with every built-in tool
  surface.
- Dispatch must reject undeclared dynamic calls even if a model fabricates a
  tool call it was never offered. Read-only mode must both hide and reject
  mutating tools; degraded mode must reject them before source dispatch.
- Bundle factory and validation failures must create a visible `[security]`
  Run Step. Production wiring, including `buildServices`, must not swallow
  factory exceptions before AgentService can audit them.
- These controls do not isolate a full Node plugin process. Do not describe
  manifest permissions as OS-enforced process isolation.

## Conventions

- TypeScript `strict` + `noUncheckedIndexedAccess`. Prefer `type`/`interface` exports from `shared`; pure functions for tools and validation.
- Tests are colocated `*.test.ts` under `packages/**/src` (vitest config only globs packages, not `apps/`). AAA structure, descriptive names.
- Persisted data and secrets live in Electron `userData` (`%APPDATA%/coding-agent` on Windows), never in the repo. The SQLite DB is at `<userData>/data/workspace-state.db`; `settings.json` and `apikey.bin` are gitignored defensively.
