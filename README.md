# Coding Agent — Local Windows GUI Coding Agent (Phase 1 MVP)

A local desktop coding agent. Open a project, type a task, and the agent plans →
searches → reads code → proposes a **unified diff**. Nothing is written until you
**approve**. Every step is logged to SQLite, every change is snapshotted, and any
run can be **rolled back**. All file and command access is confined to the
workspace root.

> Phase 1 deliberately omits multi-agent, long-term memory, cloud execution,
> semantic indexing, and strong sandboxing. Safety here is path isolation +
> command whitelist + timeout + output truncation + explicit user approval.

## Architecture

A pnpm monorepo:

```
apps/desktop          Electron app (main / preload / React renderer)
packages/shared       Shared TypeScript types (agent, tools, llm, IPC)
packages/sandbox      Path isolation, command whitelist, output truncation
packages/storage      SQLite (better-sqlite3): workspaces/runs/steps/snapshots
packages/project-indexer  File scan + ignore rules + project-type detection
packages/llm          LLM abstraction: Mock + OpenAI-compatible + Anthropic providers, test-connection
packages/tools        list_files, read_file, search_text, apply_patch, run_command, write_file
packages/agent-core   State machine orchestrator + rollback
```

The renderer never touches Node directly — it talks to the main process through a
typed `window.agentApi` exposed by the preload bridge (`contextIsolation: true`).

## Requirements

- Node.js 20+ (developed on 24)
- pnpm 10+
- Windows 11 (primary target)
- A C/C++ build toolchain for the native `better-sqlite3` module
  (Visual Studio Build Tools "Desktop development with C++", or run
  `npm install --global windows-build-tools` once).

`ripgrep` is **bundled** via `@vscode/ripgrep` — no system install needed.

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
base URL). Anthropic uses the native `/v1/messages` API. A **Custom** provider only
needs a Base URL + API Key + Model.

### Dev fallback (no key configured)

When no API key is saved, LLM calls fall back to the env provider from
`.env` (copy `.env.example`). Default `LLM_PROVIDER=mock` needs no key and exercises
the full plan/patch/approve/rollback loop (creates `AGENT_NOTES.md`).

The SQLite database lives at `<userData>/data/workspace-state.db`.

### Security TODOs

- `safeStorage` covers Windows/macOS/Linux desktop; a dedicated OS keyring module
  could replace `SecretStore` without touching call sites (the interface is isolated).
- `agent.maxAutoSteps` and `agent.sandboxEnabled` are persisted and surfaced, but the
  Phase-1 single-pass pipeline (and always-on command whitelist) doesn't yet have a
  multi-step loop / toggleable sandbox surface to fully enforce them — wired for the
  next phase. `allowShellExecution` and `requireConfirmationBeforeCommand` **are**
  enforced today.

## Test

```powershell
pnpm test
```

Covered: path isolation (`assertInsideWorkspace`, incl. symlink escape), command
whitelist + injection rejection, `apply_patch` (new file / modify / no-corrupt on
failure / malformed), storage init idempotency + lifecycle, plan JSON parsing, and
the mock provider.

## The six tools

| Tool | Limits |
|---|---|
| `list_files` | workspace-only, ignores `node_modules/.git/dist/build/target/.venv/__pycache__/.next/out`, ≤500 files |
| `read_file` | workspace-only, ≤200KB, binary rejected |
| `search_text` | ripgrep, ≤100 matches, ≤300 chars context, ignored dirs skipped |
| `apply_patch` | snapshot before write, transactional (no partial corruption), records after-content |
| `run_command` | whitelist only, 60s timeout, 100KB output cap, cwd = workspace root |
| `write_file` | internal (post-approval), snapshot before write |

**Command whitelist:** `npm test`, `npm run test`, `npm run build`, `pnpm test`,
`pnpm build`, `yarn test`, `yarn build`, `pytest`, `pytest .`, `go test ./...`,
`cargo test`, `tsc --noEmit`, `npx tsc --noEmit`.

## Acceptance scenarios

1. **Fix TypeScript errors** — agent detects `package.json`/`tsconfig.json`,
   suggests `npx tsc --noEmit`, locates files, proposes a diff, you approve, it
   re-runs the command.
2. **Add a unit test** — searches the target function, reads the source, proposes
   a test-file diff, you approve, it runs the test command.
3. **Explain code** — reads the referenced file and returns a structured
   explanation; **does not** enter the patch/apply flow.
4. **Small refactor** — proposes a minimal behavior-preserving diff, you approve,
   it runs tests.

## Safety model

- Every path is `resolve`d and checked to remain inside the workspace root
  (symlink escapes via `realpath`, Windows separators handled).
- Commands are exact-matched against the whitelist and screened for dangerous
  patterns before spawning.
- Patches snapshot prior content before writing and apply transactionally.
- Patch application requires explicit user approval in the GUI.
- Any run is fully reversible via **Rollback**.
- A run can be cancelled via **Stop** (AbortSignal).
