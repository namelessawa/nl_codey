# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local Windows desktop **coding agent**: open a project, type a task, and the agent plans → searches → reads code → proposes a **unified diff**. Nothing is written to disk until the user **approves** in the GUI. Every step is logged to SQLite, every change is snapshotted, and any run can be **rolled back**. All file/command access is confined to the workspace root.

Phase 1 scope intentionally excludes multi-agent, long-term memory, cloud execution, and semantic indexing. Safety = path isolation + command whitelist + timeout + output truncation + explicit user approval.

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
pnpm exec vitest run packages/llm/src/test-connection.test.ts
pnpm exec vitest run -t "masks all but the last 4 characters"
```

### Native module ABI gotcha (important)

`better-sqlite3` is a native module. `postinstall` / `rebuild:native` compile it against **Electron's** ABI so `pnpm dev`/`build` work. But `pnpm test` runs under plain **Node**, which has a different `NODE_MODULE_VERSION`. As a result `packages/storage/src/storage.test.ts` (the only test that opens a real DB) **fails with an ABI mismatch unless the module is currently built for Node**. This is an environment/toolchain artifact, not a code regression — do not "fix" storage code in response to it. Every other test runs fine under Node because nothing else touches the native binding.

## Architecture

### Monorepo layout (pnpm workspace: `apps/*`, `packages/*`)

```
apps/desktop          Electron app: src/main, src/preload, src/renderer (React)
packages/shared       Types + IPC contract. The dependency hub — everything imports it.
packages/sandbox      Path isolation, command whitelist, output truncation
packages/storage      SQLite (better-sqlite3): workspaces/runs/steps/snapshots
packages/project-indexer  File scan + ignore rules + project-type detection
packages/llm          Provider abstraction + factory + testLLMConnection
packages/tools        list_files, read_file, search_text, apply_patch, run_command, write_file
packages/agent-core   AgentService orchestrator (state machine) + rollback
```

Workspace packages ship **raw `.ts` source** (`main`/`module`/`types` all point at `src/index.ts`) — there is no per-package build output. `electron.vite.config.ts` therefore **bundles** them (via `externalizeDepsPlugin({ exclude: workspacePackages })`) instead of externalizing. Cross-package imports use the `@coding-agent/*` alias and **`.js` extension specifiers** even though the files are `.ts` (NodeNext/Bundler ESM convention — keep this when adding imports).

### The process boundary (read this before touching IPC)

`contextIsolation: true`, `nodeIntegration: false`. The renderer never touches Node. Data flows through one typed contract. Adding any renderer↔main call means editing **all five** of these in lockstep:

1. `packages/shared/src/ipc.ts` — add the channel to the `IPC` map, an arg type, and a method on the `AgentApi` interface.
2. `apps/desktop/src/main/ipc.ts` — register a handler via the `handle()` wrapper (it wraps every call in the `{ ok: true, data } | { ok: false, error }` envelope).
3. `apps/desktop/src/preload/index.ts` — bridge the method onto `window.agentApi`.
4. `apps/desktop/src/renderer/src/api.ts` — add a wrapper that `unwrap`s the envelope into a value-or-throw.
5. Consume `api.*` in renderer components.

Live updates flow the other way: main calls `broadcast(IPC_EVENT, event)` → renderer's `api.onAgentEvent` handler. `AgentEvent` is a discriminated union (`run_updated` | `step_added` | `patch_ready`).

### Agent run lifecycle (`packages/agent-core/src/service.ts`)

`AgentService.runTask` is a single-pass pipeline driven by `AgentRunState`:

```
planning → searching → reading → editing → waiting_for_user_approval
   → (user approves) → applying_patch → running_command → done | failed | cancelled
```

- It builds a patch but **stops at `waiting_for_user_approval`** and stores it in an in-memory `pending` map (also recoverable from the last `diff` step). `applyPatch` runs only after the user approves; it snapshots before writing and optionally runs a validation command. `rollback` restores snapshots.
- The LLM provider is **resolved per run** via the injected `resolveLLM()` (not held as a field), so settings changes take effect without restart. A missing API key surfaces as a readable error and falls back to the env mock provider.
- Cancellation is an `AbortController` per run; `stop()` aborts it and `throwIfAborted` checkpoints between phases.
- "Explain" tasks (`isExplainTask`) short-circuit: they read files and return prose, never entering the patch flow.

### Settings & secrets (`apps/desktop/src/main/settings/`, `packages/shared/src/settings.ts`)

- `AppSettings` (llm/agent/ui) types, `DEFAULT_SETTINGS`, `PROVIDER_PRESETS`, and pure `validateSettings`/`maskApiKey`/`mergeSettings` live in **shared** so main, renderer, and llm agree.
- `SettingsStore` (main) persists non-secret settings as `<userData>/settings.json`. The **API key is split out** to `SecretStore`, which encrypts it via Electron `safeStorage` into `<userData>/apikey.bin` — never in the JSON, never logged, stripped from provider errors (`redactError`/`maskApiKey`). If `safeStorage` is unavailable, the key is not persisted (no plaintext fallback). Swapping in an OS keyring later means changing only `secret.ts`.
- The settings UI (`renderer/src/components/SettingsModal.tsx` + `settings/*`) uses the `useSettings` hook. Theme/font-size apply via `data-theme`/`data-fontsize` attributes on `<html>` (see `appearance.ts` + `styles.css` CSS custom properties). A minimal `i18n.ts` `t()` dictionary covers the settings surface only — the rest of the app is not yet translated.

### LLM providers (`packages/llm`)

`createLLMProvider(config: LLMConfig)` is the factory. OpenAI / DeepSeek / OpenRouter / Gemini / Custom all share `OpenAICompatibleProvider` (`/chat/completions`, Bearer auth; Gemini via Google's OpenAI-compat base URL). Anthropic uses `AnthropicProvider` (`/v1/messages`, `x-api-key`). Providers use plain `fetch` (no SDKs) with a shared `withTimeout` helper. `createLLMProviderFromEnv` is the dev fallback (default `LLM_PROVIDER=mock`, needs no key, exercises the full approve/rollback loop).

### Sandbox invariants (`packages/sandbox`)

- Every path is `resolve`d and checked to stay inside the workspace root, including `realpath` symlink-escape checks (`assertInsideWorkspace`).
- Commands are **exact-matched** (after whitespace normalization) against `ALLOWED_COMMANDS` and screened against `DANGEROUS_PATTERNS` (chaining, substitution, redirection, `rm -rf`, `powershell`, etc.) before spawning. To allow a new validation command, add it to the whitelist — do not loosen the matcher. The current whitelist: `npm test`, `npm run test`, `npm run build`, `pnpm test`, `pnpm build`, `yarn test`, `yarn build`, `pytest`, `pytest .`, `go test ./...`, `cargo test`, `tsc --noEmit`, `npx tsc --noEmit`.

### Tool limits (`packages/tools`)

Each tool enforces hard caps so a single step can't flood the model or escape the workspace: `list_files` ≤500 files (ignores `node_modules/.git/dist/build/target/.venv/__pycache__/.next/out`); `read_file` ≤200KB, rejects binary; `search_text` ripgrep, ≤100 matches, ≤300 chars context; `run_command` 60s timeout, 100KB output cap, cwd = workspace root; `apply_patch`/`write_file` snapshot before write and apply transactionally (no partial corruption). `ripgrep` is bundled via `@vscode/ripgrep` — no system install needed.

## Conventions

- TypeScript `strict` + `noUncheckedIndexedAccess`. Prefer `type`/`interface` exports from `shared`; pure functions for tools and validation.
- Tests are colocated `*.test.ts` under `packages/**/src` (vitest config only globs packages, not `apps/`). AAA structure, descriptive names.
- Persisted data and secrets live in Electron `userData` (`%APPDATA%/coding-agent` on Windows), never in the repo. The SQLite DB is at `<userData>/data/workspace-state.db`; `settings.json` and `apikey.bin` are gitignored defensively.
