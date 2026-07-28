# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); the project is
pre-1.0 — version numbers are illustrative, not yet semver-stable.

Section conventions (Keep a Changelog):
`Added` · `Changed` · `Deprecated` · `Removed` · `Fixed` · `Security`.

## [Unreleased]

### Security

- Dynamic tool bundles now fail closed. `mutatingNames` is mandatory and
  runtime validation rejects missing/non-array classification, unknown or
  duplicate mutating names, duplicate schemas, and collisions with built-in
  Agent/extended/orchestrator tool names. A single host-reserved set now also
  includes file-mutating and degraded-mode dangerous names, including
  `write_file`.
- Validated dispatchers refuse undeclared dynamic calls. Read-only mode both
  hides and rejects classified mutating tools, while degraded mode rejects
  them before the plugin dispatcher can execute.
- Planner, Coder, and Reviewer now enforce at execution time the exact schema
  set exposed to that role. Dynamic tools are role-unassigned by default, and
  fabricated role calls return a structured `role_tool_denied` result before
  the shared executor.
- AgentService records rejected bundles and bundle factory failures as
  `[security]` Run Steps in both single-agent and multi-agent paths. Desktop
  production wiring no longer converts `buildPluginBundle` exceptions into
  silent `null` results. Untrusted factory errors are normalized, bounded, and
  redacted for credentials, sensitive URLs, and local user directories before
  they reach SQLite or renderer events.
- Pull requests targeting `main` now run a dedicated Windows GitHub Actions
  workflow for install, typecheck, Agent Core security tests, Desktop
  production wiring, the non-Storage test suite, and the production build.
  The Storage real-DB test remains explicitly excluded under the documented
  Node/Electron native ABI backlog.
- This hardening does not provide OS-level isolation for a full Node plugin
  process; a dedicated restricted plugin runner remains separate work.

### Fixed

**IPC code-review remediation — 18 findings from full frontend↔backend review.**
Full review pass identified 18 confirmed issues across the IPC contract layer
(46 candidates, 28 rejected after adversarial verification). All fixes are
test-covered.

#### Plan-approval gate now actually gates (M10)
- `AgentService.awaitPlanApproval(runId)` and `resolvePlanApproval(runId, approved)`
  park the multi-agent coordinator until the user clicks Approve in
  TaskTreeView. Pre-click buffer handles the race where a fast user clicks
  before `persistNode` finishes broadcasting nodes. `stop()`/`clearRuns()`
  resolve any outstanding gate with false. Previously the `approve()` port
  hardcoded `return true` — the GUI button was decorative.

#### Phase 4 IPC runtime validation (M11/L7)
- Every Phase 4 IPC handler now goes through hand-rolled validators in
  `validators.ts` instead of `as` casts: enum checks for `WorkspaceContributionMode`/
  `StyleScope`/`StyleCategory`/`FeedbackSignalKind`/`FinetuneMethod`/`NodeStatus`,
  numeric range clamps (confidence ∈ [0,1], proactiveScanIntervalMin ∈ [1,1440]),
  string-length caps (title 200, description 8000, before/after 200KB,
  embedding ≤ 4096 dims), and an http(s)-only URL allowlist on `WorkerNode.endpoint`
  to prevent file:// SSRF redirects.
- 28 new validator tests covering rejection paths.

#### Sandbox + verify cancellation (M1, M2)
- `WslRunner` / `DockerRunner` / `runChild` accept an `AbortSignal`; on abort
  they kill the child + close the Windows Job Object instead of dragging out
  to the 60s timeout. `runChild` rejects with `AbortError`.
  `SandboxRunRequest.signal` plumbs through `runCommandWithPolicy` from the
  per-run `ctx.signal`.
- `verifyPatch` / `captureBaseline` early-return on `ctx.signal.aborted` both
  before spawn and after the await; abort errors are recognized via a new
  `isAbortError()` helper so a cancelled run doesn't emit a noisy
  "自动验证无法运行" error step.

#### LLM stream abort classified as cancelled, not failed (M3)
- `phase3ReactLoop` now checks `signal?.aborted` BEFORE the
  `finishReason === 'error'` branch. The OpenAI-compat / Anthropic providers
  catch their underlying `AbortError` and yield an in-band
  `{ type: 'error', message: 'Request aborted' }` chunk; without the
  ordering fix a user-clicked Stop during streaming surfaced as a "failed"
  run with red banner instead of "cancelled".

#### Apply/reject patch race-safety (L1)
- `applyPatch` is idempotent under double-click: when the run already moved
  to `applying_patch`/`verifying`/`repairing`/`tool_use`, the second call
  returns the current detail instead of throwing "No pending patch to apply".
- `rejectPatch` no longer overwrites a live `applying_patch` status with
  `cancelled` when it loses the race to `applyPatch`.

#### Per-run live-text buffers (M5/M6/L2)
- `App.tsx` `liveText: string` → `liveBuffers: Record<runId, string>`.
  Deltas accumulate per-run regardless of which run is active, fixing the
  M6 race where the first model tokens after `submitComposer` were dropped
  because `setActiveRunId` hadn't committed yet. Display reads
  `liveBuffers[activeRunId] ?? ""`.
- `setActiveRunId` is now a write-through wrapper: ref + state update at the
  same synchronous call site, eliminating the render-frame lag (M5) that
  let deltas for a stale run slip past the runId filter.
- Per-run buffers cap at 1 MiB with a head-truncation marker; cleared on
  terminal status or when `step_added(message)` commits the assistant text.

#### Renderer error-handling cleanups (M7/M8/M9/L4/L5)
- `FinetuneManager.refresh()` routes all four initial-load failures through
  the existing `setError` banner (was `.catch(() => {})`).
- `KnowledgeGraphView.delPattern` wrapped in try/catch — backend rejection
  no longer drops as unhandled rejection while the UI pretends success.
- `KnowledgeGraphView.getWorkspaceContribution` surfaces failures so the
  contribution dropdown can't silently display a wrong mode.
- `Phase4Panel` adds `settingsError` state; failed `getPhase4Settings` now
  shows the error instead of an indefinite "Loading…" spinner.
  `updatePhase4Settings` failures also surface.
- `LearningDashboard.listFrozenSnapshots` routes through `setError`.

#### Minor (L6, M4, L8)
- `openRecentWorkspace` no longer echoes the full filesystem path into the
  renderer error banner (Windows paths leak the OS username); a neutral
  message goes to the UI, the full path stays in `console.warn` main-side.
- `reduceAgentDetail` uses strict `>` (not `>=`) for `createdAt` comparison
  so two runs created in the same millisecond can't overwrite each other's
  live detail.
- `Phase4SettingsStore.set` writes the JSON file with `mode: 0o600` matching
  the main settings store; was world-readable under default POSIX umask.

---

## [0.1.0]

Everything below this line represents the foundational build-up of the project
(Phase 1 → Phase 4 → CLI + session split-out). Entry bodies are preserved
verbatim from their original sprint/PR notes; section headers are
lightly normalised from `### Section (subtitle)` to `### Section — subtitle`
for grep/scan consistency, but the wording within is untouched.

### Added — `/provider` picker with one-api-style preset catalogue + 5 custom slots
- **New `@nlc/shared/providers` module.** Curated catalogue of 22 preset
  providers grouped by region (International / China / Aggregator /
  Self-hosted), inspired by the provider list in
  github.com/songquanpeng/one-api: OpenAI, Anthropic, Google Gemini,
  Groq, Mistral, xAI, Cohere; DeepSeek, 智谱 AI, 月之暗面 Kimi,
  通义千问, 字节豆包, 零一万物, 百川, MiniMax, 阶跃星辰,
  腾讯混元, 百度文心, 讯飞星火; OpenRouter, One API self-hosted,
  Ollama, LM Studio. Each row carries `baseUrl` / `defaultModel` /
  `protocol` / `envKey` so the picker pre-fills sane defaults.
- **CLI provider store.** `apps/cli/src/lib/provider-store.ts` writes
  `<dataRoot>/cli-providers.json` (mode `0o600` on POSIX) — kept
  parallel to the GUI's `settings.json` + encrypted `apikey.bin` so the
  GUI's secret store stays untouched. The file holds one entry per
  configured preset id or `custom:N` slot plus an `active` pointer.
- **`loadCliSettings` merges the active provider as an override.**
  `settings.json` remains GUI-owned; if the CLI store has an active
  provider, its `baseUrl` / `model` / `apiKey` override the GUI defaults
  for the agent loop. Env-var fallback kicks in only when neither
  surface produced a key.
- **Opencode-style multi-step picker** (`provider-picker.tsx`). Mounts
  in the same modal slot as `Approval` / `SkillInstallPicker`:
  - **pick** — region-grouped row list with `>` cursor (no key chords);
    each row shows `★` for the active provider, `●` for configured,
    `○` for empty slots; ↑↓ to move, ↵ to pick, esc to cancel.
  - **url** — text input pre-filled with the preset URL (or saved one).
  - **key** — text input masked to `••••<last4>`.
  - **name** — text input (skipped for presets, whose names are locked
    to the catalogue).
  - **confirm** — summary, ↵ saves, esc cancels.
  Backspace, ctrl+w (word erase), ctrl+u (clear line) all work.
- **New `/provider` slash command** in the prompt palette (aliases
  `/providers`, `/p`). Opens the picker and, on save, writes a
  `model_change` event into the active session so the timeline reflects
  which provider was used for each turn.

### Added — session — branchable JSONL conversation tree under `~/.nlc/agent.session/`
- **New workspace package `@nlc/session`.** Replaces nothing — runs in
  parallel to the existing SQLite run history and captures the
  conversation at a level above runs. Lives entirely on plain `fs`, no
  SDK or DB. Provides:
  - `SessionStore` — file-backed CRUD + branch under
    `<root>/<encoded-cwd>/ses_<utc>_<rand>.json` (extension is `.json`
    by spec, content is JSONL so writes are append-only and crash-safe).
  - `SessionWriter` — append-only handle returned by `createSession` /
    `resumeSession` / `branchSession`; `appendMessage` auto-pins
    `parentId` to the chain head; `appendStateEvent` records
    `model_change` / `thinking_level_change` / `theme_change` /
    `workspace_change`.
  - `buildProjectTree` / `renderProjectTree` — git-style lane allocator
    that stitches every session in one project together via
    intra-file `parentId` chains and inter-file `header.parent.messageId`
    branch anchors. Output uses `*` for nodes, `|` for active lanes,
    and `|/` for branch-collapse rows.
  - `encodeProjectFolder` — Windows `E:\\proj\\foo` → `E--proj-foo`,
    POSIX `/home/x/y` → `-home-x-y`. Slash-then-colon collapse so the
    drive prefix stays a clean `--`.
  - 24 unit tests across path-encoder, store, and tree (all green).
- **Ink TUI is wired through `SessionBridge`.** `useLoop` now lazily
  opens a session on first user submit, mirrors every emit-channel event
  into the file (user message before the run starts so the prompt
  survives a crash; assistant deltas accumulate and flush on tool calls
  / run end; tool results land as `role:"tool"` messages with the
  triggering step id as `toolCallId`), and closes cleanly on unmount.
  The bridge fails open — a session-store error never blocks an agent
  run.
- **New slash commands** in the prompt palette:
  - `/sessions` — list every session file in this project with title,
    message count, and branch lineage.
  - `/tree` — render the git-style conversation tree inline.
  - `/branch <msg> [<session>]` — fork a new session from any prior
    message id; defaults the source to the active session when only the
    message id is passed.
  - `/resume <session|path>` — switch the active writer to an existing
    session file so further messages append there.
  - `/model [<provider/model>]` — log a model change as a state event
    (settings.json itself is still owned by the GUI).
  - `/think [<level>]` — log a thinking-level change as a state event.
  - `/theme <name>` now also logs a `theme_change` event so the timeline
    is preserved across sessions.
- **New `nlc sessions` shell subcommand** for inspecting the on-disk
  tree without launching the TUI:
  - `nlc sessions` / `nlc sessions list` — one row per session.
  - `nlc sessions tree` — git-style ASCII tree of the project.
  - `nlc sessions show <id|path>` — dump a session file as raw JSONL.
  - All three accept `--workspace`, `--data-root`, and `--json`.

### Fixed — TUI — opencode-style scrollback, fixed-height trace, bulletproof backspace
- **The `nlc` TUI now flows finished messages into the OS terminal's
  native scrollback.** Previously every state change repainted the entire
  Ink output tree, which meant the chat history scrolled off forever once
  the live frame redrew — the user's mouse wheel could no longer reach
  earlier messages. The rewrite splits the renderer into two regions:
  - **Scrollback** (above the live frame): `MessageStream` is now wrapped
    in Ink's `<Static>` component, so each finalised row is printed once
    and never repainted. The terminal owns the history; the user's wheel
    works as expected, even across hundreds of messages.
  - **Live frame** (the part Ink repaints): header + in-progress agent
    bubble + fixed-height trace panel + prompt + footer. The trace now
    has a hard `height={LIVE_BODY_HEIGHT}` (14 rows) instead of sharing
    `flexGrow` with the message column, so the prompt row no longer
    drifts up and down as new trace items arrive — it stays anchored
    on the same line as the trace's bottom rail.
- **In-progress agent deltas are now tracked separately from finalised
  rows.** `useLoop` keeps a `liveAgent` slot that mutates on every
  `delta` event and a `stream` array that is strictly append-only.
  When any non-delta event arrives (tool call, run-end, error), the
  reducer "flushes" the live message into `stream` so the row falls
  into Static scrollback and the live frame goes idle. This is required
  because `<Static>` deliberately ignores mutations on already-rendered
  rows — without the split, streamed text would appear once and then
  freeze.
- **Backspace is now bulletproof on Windows terminals.** The prompt's
  `useInput` handler used to rely on Ink's parsed `key.backspace` /
  `key.delete` flags, which is correct in theory but flaky in practice:
  Windows Terminal can send the DEL byte (``), classic cmd.exe
  sends BS (``), and conhost sometimes leaks the raw byte into
  `input` even when Ink also sets `key.delete`. After re-entering `/`
  to summon the command popup, the popup was eating the keystroke and
  the `/` could not be deleted. The new handler:
  - evaluates the erase branch **before** the popup's arrow/tab/escape
    handling, so the popup can no longer swallow a backspace;
  - accepts `key.backspace`, `key.delete`, raw ``, raw ``,
    and `Ctrl+H` as erase triggers;
  - also wires `Ctrl+W` (delete previous word) and `Ctrl+U` (clear
    line) for parity with familiar shell editing;
  - rejects stray control bytes (DEL/BS) from the printable-input
    branch so they can never accumulate into the value.
- **New component** `live-agent.tsx` renders the in-progress streaming
  bubble in the live frame. It mounts only while `liveAgent` is
  non-null and unmounts the instant the reducer flushes the row into
  Static.
- **Bumped buffers** so scrollback feels generous: `MAX_STREAM` 200 → 500,
  `MAX_TRACE` 80 → 200.

  Touched: `apps/cli/src/tui/{prompt,trace,message-stream,ink-tui,
  use-loop}.{ts,tsx}` and new `apps/cli/src/tui/live-agent.tsx`.
  `pnpm typecheck` green across the whole workspace.

### Added — first-run Docker bootstrap — "Start Docker & continue"
- **DockerInstallModal can now launch Docker Desktop for the user.** Before
  this change, when Docker was installed but the daemon wasn't running, the
  first-run modal told the user to start it manually and click *Re-check*.
  Now the modal renders a **"Start Docker & continue"** primary button in
  that state. Clicking it:
  1. Spawns Docker Desktop detached (Windows: `C:\Program Files\Docker\
     Docker\Docker Desktop.exe` then `%LOCALAPPDATA%\Docker\…`; macOS:
     `open -a Docker`; Linux: `systemctl --user start docker-desktop`).
  2. Polls `docker info` every 3 s for up to 150 s, broadcasting
     `installation_status` events so the modal renders the "starting…"
     spinner without renderer-side polling.
  3. Once the daemon answers, marks the installation gate as
     first-run-completed and the modal auto-closes — the user lands in the
     app without an extra click.

  On failure (`not_found`, `timeout`, spawn error) the modal stays open
  with a contextual error and the user can fall back to *Install* or
  *Skip*. The first-run rule is unchanged when Docker is already running —
  the modal never opens.

  Touched: `packages/shared/src/{installation,ipc}.ts` (added
  `DockerStartResult` + `IPC.startDocker`), `apps/desktop/src/main/
  installation-gate.ts` (new `startDocker()` + platform-specific launcher
  with injectable `launchDocker`/`sleep` for tests), `apps/desktop/src/
  main/ipc.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/
  renderer/src/{api.ts, hooks/useInstallationGate.ts, components/
  DockerInstallModal.tsx, App.tsx, i18n.ts, installation-styles.css}`. New
  tests in `installation-gate.test.ts` cover the success-with-first-run
  flip, launcher-fail, timeout, not-installed refusal, and the
  already-running short-circuit (no wasted spawn). `pnpm typecheck` green;
  18/18 InstallationGate tests pass.

### Fixed — CI — windows-latest docker e2e skip probe
- **build-windows job failed on main** because
  `packages/tools/src/e2e-docker.test.ts` only checked `docker version`
  before deciding whether to skip the docker-bound suite. GitHub's
  `windows-latest` runner ships a Docker CLI configured for Windows
  containers, so `docker version` exits 0 and `dockerAvailable` was
  `true`, but every `docker run python:3.12-slim …` returned exit code
  125 (`no matching manifest for windows/amd64`), failing 6 cases. The
  probe now also calls `docker info --format "{{.OSType}}"` and only
  enables the docker suite when OSType is `linux`. Hosts running Windows
  containers or a broken daemon skip cleanly; hosts with a real Linux
  engine (Docker Desktop / Linux CI) still run the full suite. Verified
  locally: 13 pass + 7 skip on a host with no daemon; `pnpm typecheck`
  green.
### Fixed — bug audit follow-up — multi-agent + plugin install + Phase 4 plumbing
- **P1.1 (security): multi-agent reviewer no longer bypasses command
  approval.** `runPlanner` and `runReviewer` in
  `packages/agent-core/src/multi-agent.ts` hard-wired
  `requiresApproval: () => false` / `waitForApproval: async () => true`,
  while `runCoder` already honored `deps.requiresApproval` /
  `deps.waitForApproval` plumbed through by `service.ts:815`. Because
  `ROLE_TOOLS.reviewer` (in `packages/orchestrator/src/roles.ts:48-54`)
  includes `run_command`, every reviewer-driven `run_command` slipped
  past the host's command-confirmation gate that the single-agent and
  coder paths still honored. Both wrappers now forward the host gates
  with a permissive `() => false` / `async () => true` fallback for
  tests that don't wire them.
- **P1.3 (security): plugin install honors the renderer's per-permission
  checkboxes instead of dropping them.** `PluginManager.tsx` collects
  per-permission `approvedPermissions`, `validators.ts` accepts them,
  but `phase4-ipc.ts` previously only forwarded
  `(manifest, installPath)` to `pluginLoader.install`, silently
  discarding the user's selection in favor of a coarse
  "Approve all / Cancel" OS dialog. `PluginLoader.install` now accepts
  an optional `preApprovedPermissions` argument; when provided it is
  intersected with the manifest's requested set (defense-in-depth
  against a compromised renderer) and used directly, skipping the
  prompter. The OS dialog remains the fallback when no pre-approval
  is supplied. Nine new vitest cases lock the behavior in.
- **P1.2 (UX/honesty): plugin install dialog now warns when "whitelist"
  sandbox is selected.** `PluginManager.tsx`'s sandbox selector now
  surfaces an inline warning that the `whitelist` mode runs the plugin
  script as a full Node process with declared permissions only
  constraining host-side SDK helpers, and notes that the `docker` /
  `wsl` sandboxes are not yet implemented for plugin invocation
  (matching the runtime's actual fail-closed behavior in
  `plugin-runtime.ts`).
- **P2.1: planner / coder / reviewer now honor `runToolLoop` terminal
  outcomes.** All three role wrappers in `multi-agent.ts` previously
  `await runToolLoop(...)` without inspecting `outcome.state`. A
  cancelled or budget-exhausted planner fell into the misleading
  "Planner did not produce a task breakdown" throw; a cancelled coder
  returned `{ diff: lastDiff, testOutput: lastTestOutput }` (usually
  empty) and the reviewer then "changes_requested"'d an empty diff;
  a cancelled reviewer fell into `parseReviewResult("")`'s JSON-failure
  fallback. The review loop would then burn another iteration on a run
  that should already be terminating. Each wrapper now throws a clear
  `Planner/Coder/Reviewer cancelled by user` /
  `... budget exceeded ...` / `... failed ...` error, which the
  Coordinator's existing escalation path converts to immediate
  cancellation via the `askHuman` port.
- **P2.2: packaged Electron no longer re-launches the app instead of
  running plugin scripts.** `plugin-runtime.ts:execNode` spawns
  `process.execPath` (the Node binary in dev, the Electron exe in a
  packaged build). Without `ELECTRON_RUN_AS_NODE=1` the packaged
  Electron exe re-launches the whole app instead of executing the
  script. Env merge now appends `ELECTRON_RUN_AS_NODE: "1"` LAST so a
  plugin can never override it.
- **P2.3: preference dataset curation now persists its filtered set.**
  `phase4-ipc.ts:buildPreferenceDataset` ran `curatePairs(...)` but
  only returned a `rejected` count; the dataset itself still held
  every raw pair, so subsequent training silently consumed
  pre-curation data even though the UI reported the filter as
  applied. New `Phase4Storage.replacePreferenceDatasetPairs(datasetId,
  pairs)` rewrites the table atomically; the IPC handler now calls
  it after curation.
- **P2.4: Finetune dataset dropdown now displays real pair counts.**
  `Phase4Storage.listPreferenceDatasets` previously returned
  `pairs: []` for every row, so `FinetuneManager.tsx`'s
  `{d.pairs.length} 对` rendered "0 对" universally. Added optional
  `PreferenceDataset.pairCount` (shared type), populated from a
  `LEFT JOIN + COUNT(*)` in the list endpoint; renderer now reads
  `pairCount ?? pairs.length` so the single-dataset endpoint still
  works unchanged.
- **P2.5: clearRuns now cascades into Phase 3 tables.**
  `Storage.deleteRunsForWorkspace` only deleted `agent_steps`,
  `agent_run_messages`, `file_snapshots`, `agent_runs`. The Phase 3
  tables `task_nodes`, `role_messages`, `git_actions` lack FK cascade
  and were not touched, so wipes left orphan rows surfacing in the
  task tree / role timeline / git log panels after the user thought
  they had cleared the workspace. The transaction now explicitly
  removes role messages (joined through `task_nodes.parent_run_id`),
  task nodes, and git actions for each removed run id.
- **P3.1 (security): plugin manifest permission validation no longer
  accepts `<known_token>_<garbage>` strings.**
  `manifest-schema.ts:isKnownPermission` previously used
  `startsWith(prefix)` for every entry in
  `KNOWN_PERMISSION_PREFIXES`, so `"run_command_extra"`,
  `"read_workspace_anything"`, `"write_workspace_evil"`, and
  `"read_memory_dump"` all passed validation. The host-side `authorize`
  is exact-match, so the loose strings would never authorize anything
  at runtime, but they polluted the install prompt and persisted as
  if legitimate. Now exact-matches the four fixed permissions and
  prefix-matches only `network:` (with a required non-empty host
  suffix; bare `network:` is meaningless and now rejected). Same
  tightening applied to `validators.ts:isKnownPluginPermission` for
  IPC payloads. Five new vitest cases cover the regression points.
- **P3.2: `proactiveScanIntervalMin` is now wired to a real scheduler.**
  The setting existed in `phase4.ts:399` and the Phase 4 settings UI
  but nothing consumed it — only the manual `scanDebtNow` IPC ran
  the debt scan. `phase4-ipc.ts` now starts a `setTimeout`-chained
  scheduler that re-reads the interval each tick (so settings changes
  apply on the next iteration), iterates the 10 most-recently-opened
  workspaces, skips silently when `proactiveEnabled` is off, and
  isolates per-workspace failures from one another. The timer is
  `unref()`'d and an `app.on("before-quit", stop)` hook cancels it
  cleanly on shutdown.
- **Verification.** `pnpm typecheck` passes across all 21 workspace
  projects; the test suite passes 73 files / 565 tests (8 skipped per
  the documented exclusions: `storage.test.ts` ABI mismatch,
  `*.debug.test.ts` real-LLM gates, `real-llm.integration.test.ts`
  preflight, `e2e-docker.test.ts` partials).

### Added — Phase 3 / Phase 4 surface reachable from main UI
- **`AgentSettings` panel now exposes `multiAgentEnabled` and a standalone
  `sandboxEnabled` toggle.** `service.ts:355` has been reading
  `multiAgentEnabled` since Phase 3 landed, but the renderer had no toggle
  for it; sandbox-enabled could only be flipped on indirectly by clicking
  a sandbox-mode card. Two new `ToggleRow`s in
  `apps/desktop/src/renderer/src/components/settings/AgentSettings.tsx`
  plus i18n keys (`agent.multiAgent` / `agent.multiAgentHint` /
  `agent.sandboxEnabled` / `agent.sandboxEnabledHint`) close the gap.
- **Phase 4 settings panel now wires the two non-boolean fields.**
  `contributionMode` (select: `isolated` / `contribute` / `team_shared`)
  and `proactiveScanIntervalMin` (number input, 1..1440) were defined in
  `packages/shared/src/phase4.ts:388` but had no UI surface — meaning the
  workspace contribution mode and proactive scan cadence could only be
  changed by hand-editing `phase4-settings.json`. Phase4Panel.tsx now
  renders both alongside the existing 7 feature flags.
- **New `WorkbenchModal` plus a Topbar entry point.** Phase 3 and Phase 4
  panels existed (`Phase3Panel.tsx`, `Phase4Panel.tsx`) but `App.tsx`
  never imported them — every memory / task-tree / role-timeline / git
  / failure-library / KG / style / learning / finetune / proposals /
  cluster / plugins view was therefore unreachable. New
  `apps/desktop/src/renderer/src/components/WorkbenchModal.tsx` mounts
  both panels behind a single Topbar button (`history` icon, next to
  Settings) and a full-screen modal that reuses the `settings-modal`
  shell. New i18n keys `topbar.workbench` / `topbar.workbenchTitle`.
- **Full plugin-install form in `PluginManager`.** Adds a collapsible
  installer that exposes every field of `PluginManifest` (name, version,
  description, author, sandbox kind) plus the `installPath` and the
  separate `approvedPermissions` checklist. Tools array supports
  add/remove with per-tool name, description, JSON-edited
  `Record<string, PluginToolParameter>`, and the four fixed permissions
  (`run_command` / `read_workspace` / `write_workspace` / `read_memory`).
  An "add network:host" widget appends `network:` template-literal
  permissions. `api.installPlugin(...)` was the lone wrapper without a
  caller — it now drives this form.
- **Full worker-register form in `ClusterMonitor`.** Adds a collapsible
  form with every `WorkerNode` field except the backend-stamped
  `registeredAt`: id, hostname, endpoint, status (4-value enum),
  capabilities (CSV), activeAssignments (CSV). `lastHeartbeat` is
  stamped at submit time. The node table now also surfaces the endpoint
  column and the `registeredAt` timestamp.
- **Full finetune-job form in `FinetuneManager`.** New collapsible form
  emits a `FinetuneJobInput` (name / baseModel / datasetId / method),
  with `datasetId` driven by a live `listPreferenceDatasets()` dropdown
  and `baseModel` autocompleted from the model registry. A new "Eval
  Runs" section consumes `listEvalRuns(taskId?, modelId?)` with two
  filter inputs — the eval-runs wrapper had no caller before.
- **Manual feedback-signal form in `LearningDashboard`.** Adds a
  collapsible form that exposes the full `FeedbackSignalInput`
  (workspaceId injected, runId, taskNodeId, kind, before, after,
  reason, filePath). Lets the user back-fill historical signals when
  the auto-record path missed them.
- **New `SemanticSearchView` (Phase 3 tab).** Surfaces the previously
  uncalled `rebuildSemanticIndex`, `getSemanticIndexStatus`, and
  `semanticSearch` wrappers. Shows index status (`indexedFiles/total`,
  last-updated, building flag with 2 s polling while a rebuild runs),
  a rebuild button, and a query box with `topK` (1..50) + `kinds`
  checkboxes (`code` / `doc` / `comment`). Results render with file
  path, line range, symbol name (when present), score, and snippet.
- **Wiring follow-ups.** `Topbar` gains an `onOpenWorkbench` prop;
  `App.tsx` owns the modal-open state and forwards the active
  workspace id + run id into the modal so Phase 3 tabs that need a run
  (Tasks / Roles / Git) still get one. Phase3Panel grows a sixth tab
  pointing at the semantic search view. `pnpm typecheck` passes
  across all 21 workspace projects.
- **New `DebugView` (Phase 3 tab #7).** Covers the three remaining
  direct-action wrappers that no other panel exposes: `runCommand`,
  `listWorkspaceFiles`, `readFile`. Three sub-sections —
  *Command runner* sends a sandbox-routed command and renders
  exitCode / timedOut / stdout / stderr from `RunCommandOutput`;
  *File browser* lists up to 500 workspace files with a live substring
  filter; *File viewer* reads any in-workspace path (≤ 200KB, binaries
  rejected) and renders the content in a scrollable `pre`. All three
  bypass agent reasoning by design and are clearly labelled as a debug
  channel that writes no snapshot and produces no run history.

### Security — audit follow-up — plugin gates + debug-test hygiene + live events + renderer sandbox
- **P1 fix: plugin tools now respect read-only AND degraded gates.**
  `DynamicToolBundle` now carries `mutatingNames: readonly string[]`
  listing the qualified plugin-tool names whose declared permissions
  (`run_command` / `write_workspace`) can change workspace state.
  `service.ts` filters those names out of the advertised schema when
  read-only mode is on, refuses them at dispatch as defense-in-depth
  (even if the model emits a call we didn't advertise), and wraps the
  installation gate so degraded mode also blocks them — the gate
  previously only matched the three built-in `run_command` /
  `apply_patch` / `write_file` names, so `plugin__*` calls slipped
  through. `plugin-runtime.ts` populates `mutatingNames` by scanning
  each tool's declared permissions; non-mutating bundles pass through
  unchanged.
- **P1 fix: plugin runtime no longer leaks `process.env` and no longer
  installs zero-permission manifests.** Plugin child processes spawned
  by `plugin-runtime.ts:execNode` now run with a scrubbed
  `NodeJS.ProcessEnv` — the new `scrubPluginEnv` drops a hard-coded
  list of credential variables (`LLM_API_KEY`, every supported
  provider's typical key, `GITHUB_TOKEN`, `NPM_TOKEN`, `AWS_*`,
  `DATABASE_URL`, …), every `npm_config_*` (pnpm/yarn project the full
  registry credential set into that namespace), and anything whose
  name matches `/(?:^|_)(api[_-]?key|token|secret|password|credential)s?(?:$|_)/i`.
  `plugin-loader.ts` now rejects manifests that declare zero
  permissions — the previous code skipped the permission-confirmation
  dialog entirely for those, so a malicious manifest could install
  silently and still run as a full Node process. `validators.ts`
  `installPath` validation tightened: `requireAbsolutePath` rejects
  relative paths and any `..` segment that survives normalisation,
  closing the path-traversal vector where the install path is
  concatenated into the rendered `node "<path>/tools/<name>.js"`
  command.
- **P2 fix: `*.debug.test.ts` no longer runs under default `pnpm test`.**
  `full-trace.debug.test.ts` and `complex-multiagent.debug.test.ts` now
  gate `describeReal` on `RUN_AGENT_DEBUG_TESTS=1` in addition to the
  existing `LLM_API_KEY` / `LLM_BASE_URL` check. Without the flag both
  files cleanly skip every real-LLM scenario — the
  `Storage(":memory:")` calls that previously fired during default
  `pnpm test` (and hit the native-binding ABI mismatch under Node) no
  longer execute. Preflight blocks now print a clear "set
  RUN_AGENT_DEBUG_TESTS=1" hint so the next operator knows how to
  re-enable.
- **P2 fix: Roles tab now actually shows role messages.**
  `Phase3Panel` was passing a `runId` to `RoleTimeline`'s `taskNodeId`
  prop; the IPC then queried `role_messages WHERE task_node_id = <runId>`
  and always returned an empty list. Added
  `Storage.listRoleMessagesForRun(runId)` which joins through
  `task_nodes.parent_run_id`, a new `IPC.listRoleMessagesForRun`
  channel + handler + preload bridge + renderer wrapper, and switched
  `RoleTimeline` to take a `runId` prop end-to-end. Multi-agent runs
  now populate the Planner/Coder/Reviewer swimlanes as soon as the
  IPC returns.
- **P3 fix: Phase 3 live events (`task_updated` / `role_message` /
  `index_status`) now emit at production points.** `service.ts`
  wraps `MultiAgentStore` so every `createTaskNode` /
  `setTaskNodeStatus` / `addRoleMessage` write also broadcasts a typed
  event (task-node and role-message paths are stable; role payload is
  parsed via `parseRow` from `@nlc/orchestrator` and
  swallowed-on-error so an emit failure never unwinds a successful
  write). `phase3-ipc.ts:rebuildSemanticIndex` emits `index_status`
  with `building: true` before the indexer runs and a final status
  after, even on error. `TaskTreeView`, `RoleTimeline`, and the new
  `SemanticSearchView` subscribe to `api.onAgentEvent` and refresh on
  matching events; the 2 s poll in `SemanticSearchView` stays as a
  belt-and-braces fallback.
- **P3 fix: Electron renderer sandbox enabled.** `apps/desktop/src/main/index.ts`
  flips `webPreferences.sandbox` from `false` to `true`. The preload
  only touches `electron.contextBridge` and `electron.ipcRenderer`
  (both sandbox-safe), so all IPC continues to work; the renderer
  process now drops Node integration entirely, shrinking the attack
  surface for foreign HTML the agent might fetch
  (`web_fetch` / readability, LLM-rendered markdown).
- **Verification.** `pnpm typecheck` passes across all 21 workspace
  projects; `pnpm exec vitest run --exclude "**/storage.test.ts"`
  passes 73/73 test files / 563 tests (1 skipped). Native-ABI
  `storage.test.ts` remains excluded by the known environment
  caveat documented in `CLAUDE.md`.

### Fixed — follow-up after PR #16 merge to `main`
- **`build-windows` CI typecheck unblocked.** Two debug trace harnesses
  (`packages/agent-core/src/complex-multiagent.debug.test.ts:382`,
  `packages/agent-core/src/full-trace.debug.test.ts:263`) called
  `run.costUsd.toFixed(4)` on a value typed as `number | null | undefined`,
  failing `noUncheckedIndexedAccess` + strict null checks under
  `tsc --noEmit`. Now `(run.costUsd ?? 0).toFixed(4)` so trace printers
  cope with rows that never accumulated cost.
- **NUL byte in `full-trace.debug.test.ts` removed.** A literal `0x00` byte
  had been written into the `wsl -l -q` UTF-16LE strip regex
  (`r.stdout.replace(/<NUL>/g, "")`), which made `file` classify the source
  as binary `data` and made `git diff` report a binary delta. Replaced with
  the proper `\0` regex escape; the file now reads as plain UTF-8 again.
- **`AgentService` race with `clearRuns` no longer crashes the loop.** When
  the user cleared a run while its background tool-loop was still tearing
  down, the storage writes that followed (`addStep`, `updateRunStatus`,
  `addRunUsage`, `setRunExitReason`, `saveRunMessages`) crashed the main
  process with `SQLITE_CONSTRAINT_FOREIGNKEY` or `Run not found: <id>`.
  New `safeRunWrite` helper plus `isStaleRunStorageError` classifier
  silently no-op those two error shapes (and only those two); every other
  storage failure still propagates. Errors thrown out of `runToolLoop`
  itself now convert to a structured outcome via `loopErrorToOutcome` so
  `exit_reason` is always stamped — aborted controllers map to `cancelled`
  rather than `failed` to keep failure metrics honest.
- **Multi-agent runs are now resumable via `continueTask`.** Previously a
  multi-agent run finished with `setRunExitReason` only; no conversation
  was persisted, so `loadRunMessages` returned empty and the follow-up
  endpoint replied "this run predates multi-turn — start a new task".
  New `buildMultiAgentSummary` produces a bounded (`≤ 20` bullets,
  `≤ 140`-char descriptions) status header + node-by-node recap, and
  `buildMultiAgentRunMessages` packages it as a `[system, user, assistant]`
  conversation so a follow-up resumes on the single-agent loop with the
  original task as anchor. Failures still persist the user task + the
  failure reason so the next turn has something to react to.
- **`apply_patch` partial-write rollback now restores the failing file.**
  `fs.writeFile` is not atomic — ENOSPC, AV-after-truncate, or a transient
  EIO can leave the in-flight target file half-written on disk. The
  rollback loop previously only iterated `applied[]`, which excluded the
  current (failing) change, so the partial bytes survived the
  `ToolError`. Rollback now restores `change.before` for the failing file
  as well; brand-new "Add File" ops that fail mid-write have any partial
  bytes removed. Two regression tests in `apply-patch.test.ts` simulate
  ENOSPC for the Update and Add cases.

Tests covering the above: 15 new in `service-race.test.ts`, 2 new in
`apply-patch.test.ts`. Full `pnpm typecheck` green; `vitest run
packages/agent-core packages/tools` reports 158 passed + 1 skipped
(real-LLM preflight, no API key).

### Security — CodeQL clearance on PR #16
- **Cleared all 16 open code-scanning alerts** on `feat/phase4-multiagent-bugfixes`
  so the CodeQL ruleset gate can pass:
  - `js/second-order-command-line-injection` in
    `packages/git-integration/src/git-exec.ts`: argv passed to `git` is now
    rejected if it contains options that instruct git itself to run a
    subordinate command (`--upload-pack`, `--receive-pack`, `--exec`,
    `--exec-path`, `--config-env`, `ext::` URLs, and `-c <key>=` overrides
    of `core.{sshCommand,pager,editor,fsmonitor,askPass}`, `http.proxy`,
    `url.*.insteadOf`). `branch-manager` additionally validates ref names
    (no `-` prefix, no shell-meta chars, no `..` / `@{`).
  - `js/polynomial-redos` × 15 across `parse-test-failure.ts` (TSC/Vitest/
    Jest/Pytest/Go/Cargo line parsers), `diff-summarizer.ts`, `anthropic.ts`,
    `openai-compatible.ts`, `semantic-index/embedder.ts`, `llm/prompts.ts`,
    and `web-tools/web-fetch.ts`: replaced lazy-`.+?` + greedy-`\s+`,
    unbounded `[\s\S]*?`-to-literal-terminator, and `\/+$` patterns with
    non-backtracking character classes, literal single spaces, and
    hand-rolled scans. All 107 affected-package tests still pass.

### Changed — Sprint 4 — Phase 3/4 wired into the live agent loop
- **Phase 4 prompt augmentation is now actually injected into the system
  prompt.** Previously `buildPhase4PromptAugmentation` was defined and
  unit-tested but no production code called it; `getSystemPrompt` / the read-
  only variant ran straight through with no GlobalPattern / StyleSpec / fine-
  tune identity reminder context. `AgentService` now takes a
  `getPhase4Augmentation: (workspaceId) => string` hook (`Phase4AugmentationFn`)
  and prepends its output after the base prompt; `apps/desktop` wires it from
  `storage.phase4.listGlobalPatterns()` + `getStyleSpec()` +
  `getActiveModel()`, gated by the respective Phase 4 feature flags. Failures
  fall through to an empty string so a sick Phase 4 surface never blocks a
  normal run. New shared `Phase4SettingsStore` (lifted out of `phase4-ipc.ts`)
  keeps the augmentation gate and the IPC handlers reading from one cache.
- **Phase 3 tools (`semantic_search` / `read_memory` / `write_memory` /
  `web_search` / `web_fetch`) now appear in the autonomous-loop tool surface.**
  They were defined in `@nlc/tools` and tested in isolation, but
  `agentToolSchemas` only advertised the Phase 1/2 catalogue, so the model
  never saw them. New `PHASE3_AGENT_TOOL_SCHEMAS` + `createPhase3Dispatcher`
  in `agent-core`, an optional `Phase3AgentPorts` bundle on
  `ToolExecutorOptions`, and a `getPhase3Ports` hook on AgentService route
  semantic-search hits / memory hits / web fetches through the existing
  approval + sandbox + budget machinery. `agentToolSchemas` now takes
  `phase3Available` (off by default) and a new `extraSchemas` slot for plugin
  / dynamic tools. `write_memory` joins `apply_patch` / `write_file` in the
  read-only filter so query-only mode stays query-only. `apps/desktop` wires
  the ports from `Phase3Services` + `searchChunks` + `MemoryRetriever` +
  `webSearch` (DuckDuckGo backend) + `webFetch`. 14 new unit tests in
  `phase3-schemas.test.ts` cover schema visibility, read-only filtering, and
  dispatcher routing.
- **`convertProposal` actually creates a run instead of throwing.** The
  Phase 4 IPC handler used to fail with "not yet wired to the Planner
  pipeline" — clicking *Convert* did nothing. It now composes a self-
  contained user task from `proposal.title` + `rationale` + affected files
  and calls `services.agent.runTask(workspaceId, task)`, then stamps the
  proposal `converted_to_task` with the real `convertedRunId` so the UI can
  navigate from inbox to run. Reuses every existing safety gate
  (approval / sandbox / budget / installation gate). Double-convert is
  refused with a readable error.
- **Plugin tools are now visible to the agent loop and routed through
  `PluginHost`.** `PluginHost` existed but had no caller outside its own
  tests; installed plugins were dead state. New `apps/desktop/src/main/
  plugin-runtime.ts` builds a dynamic `{schemas, dispatch}` bundle per
  driveLoop entry from the enabled `PluginInstallation` set, advertises
  `plugin__<plugin>__<tool>` schemas to the model, and routes invocations
  through `PluginHost.invoke` (which re-validates enablement + permissions
  per call). Whitelist-sandbox plugins spawn Node with cwd locked to the
  plugin install dir; `wsl` / `docker` sandbox modes return a clear
  "not yet supported for plugin invocations" error rather than silently
  failing. AgentService gains a `getDynamicTools` hook for the broader
  pattern (future MCP servers etc. plug in the same shape).
- **`createFinetuneJob` now drives a background training process.** It used
  to be a single `storage.phase4.createFinetuneJob(input)` insert with no
  consumer — jobs queued forever, `LoRATrainer` had zero call sites. New
  `apps/desktop/src/main/finetune-runner.ts` looks for a user-supplied
  Python script at `<userData>/finetune/train.py`, spawns it with
  `--base-model / --dataset-id / --method / --output-dir`, captures
  `ARTIFACT:` as the success marker, and transitions job status
  `queued → training → evaluating` on success or `→ failed` with an
  explicit `evalResult.gateReasons` on missing script / spawn error /
  timeout / bad output. `resumeQueued()` runs at startup so an
  interrupted job continues across restarts. Promotion to active model
  still flows through the eval gate + `ModelRegistry` per the Phase 4
  design.
- **Opt-in multi-agent mode.** New `agent.multiAgentEnabled` setting routes
  runs through the Phase 3 Coordinator (Planner → Coder → Reviewer) instead
  of the single-agent loop. New `multi-agent.ts` in `agent-core` provides
  the role-specific tool loops (filtered by `ROLE_TOOLS` from
  `@nlc/orchestrator`) and the strict-JSON `parseReviewResult` for
  the reviewer's verdict, plus orchestrator-only schemas
  (`propose_task_breakdown` / `update_task_status` / `request_review` /
  `approve_change` / `request_changes`). `AgentService.driveMultiAgentLoop`
  builds the same executor + Phase 3 ports + plugin bundle the single-agent
  path uses, so safety guarantees (approval / sandbox / verify-after-patch
  / snapshots) are identical. Default off so the long-standing single-agent
  behaviour is preserved.
- **Real-LLM smoke test.** New `real-llm.integration.test.ts` drives the
  autonomous loop against a real DeepSeek provider (extensible to others)
  with stubbed Phase 3 ports and asserts that `read_memory` was invoked end-
  to-end. Skips cleanly when `DEEPSEEK_API_KEY` is unset so `pnpm test`
  passes without API credentials. To run: set `DEEPSEEK_API_KEY` and execute
  `pnpm exec vitest run packages/agent-core/src/real-llm.integration.test.ts`.

### Changed — Sprint 3 — storage integrity + apply_patch hardening + Phase 4 cleanup
- **Storage gains foreign keys, unique constraints, cascade deletes, and a
  proper version-tracked migration path.** The Phase 1 tables (`agent_runs`,
  `agent_steps`, `agent_run_messages`, `file_snapshots`) used to declare
  `workspace_id` / `run_id` as bare `TEXT NOT NULL` with no `REFERENCES`
  even though `PRAGMA foreign_keys = ON` was set, so consistency relied on
  application code calling `DELETE` in the right order. New schema adds
  `workspaces.root_path UNIQUE`, foreign keys with `ON DELETE CASCADE` on
  every `workspace_id` / `run_id` column, and a `UNIQUE (run_id, seq)` index
  on `agent_run_messages` so a buggy double-save fails loudly instead of
  silently creating duplicate conversation rows. A new `schema_meta` table
  tracks the structural version; `STRUCTURAL_MIGRATIONS` rebuild the
  affected tables in a transaction (copy → drop → rename) when upgrading a
  legacy v1 database, dropping orphan rows first so the new FK rules apply
  cleanly. Fresh installs jump straight to the latest version. The native
  test (`storage.test.ts`) still hits the pre-existing better-sqlite3 ABI
  issue documented in CLAUDE.md.
- **`apply_patch` now refuses to overwrite an existing file from V4A
  "Add File"** instead of silently clobbering it. The model must use
  `*** Update File:` for any intentional rewrite — accidental Adds are
  almost always the model misreading the workspace, and refusing surfaces
  the mistake immediately instead of corrupting the file. Error message
  points the model at the correct operation.
- **`apply_patch` rolls back partial writes on a mid-batch failure.** The
  doc-string already promised "transactional", but Phase B (the write
  loop) just iterated without unwind logic — a write failing on file N
  left files 1..N-1 mutated and the workspace in an inconsistent half-
  patched state. The loop now tracks every file it touches in this call
  and, on a write error, reverses each change (deletes any file it added,
  restores the bytes of any file it modified or deleted) before re-throwing
  the originating error. Rollback errors are appended to the thrown message
  so the user knows when manual recovery is needed. 2 new tests in
  `apply-patch.test.ts` lock the contract.
- **`convertProposal` (Phase 4) marked experimental and refuses to run.**
  The handler used to record a synthetic `pending-<id>` run id that was
  never wired to the Planner pipeline — clicking "Convert" looked like it
  did something but produced no actual run. It now throws a clear
  "not yet wired to the Planner pipeline" error; the proposal row is left
  intact. The "Convert" button in `ProposalInbox` is disabled with a
  tooltip explaining the status. Snooze and dismiss still work and the
  proposal scan is unchanged.

### Security — Sprint 2 — IPC validation + privileged-entry lockdown
- **P1: every IPC handler now runtime-validates its payload before touching
  the storage / filesystem / agent.** Previously each handler did
  `args as XYZArgs` and trusted that the renderer sent the right shape. A
  compromised renderer (XSS in a future plugin, malicious fetched HTML
  rendered with `dangerouslySetInnerHTML`, etc.) could send garbage and rely
  on `undefined.runId` exceptions surfacing later. New hand-rolled validators
  (`apps/desktop/src/main/validators.ts`) reject bad shapes at the IPC
  boundary with a readable error fed through the existing
  `{ok:false,error}` envelope. Covered: `runAgentTask`, `continueAgentTask`,
  `runCommand`, `readFile`, `applyAgentPatch`/`rejectAgentPatch`/
  `rollbackRun`/`stopAgentRun`/`getAgentRun`, `clearAgentRuns`,
  `openRecentWorkspace`, `testLLMConnection`, every memory CRUD,
  semantic-search, task-tree, role-message, git, sandbox-mode, and the
  plugin-install path. 21 new `validators.test.ts` cases lock the contract
  (rejects non-objects, empty strings, unknown enums, missing required
  fields; accepts the network-scoped permission template literal).
- **P1: `importMemory` no longer reads renderer-supplied file paths.**
  Previously the renderer passed `{workspaceId, filePath}` and the main
  process happily `fs.readFileSync(filePath)` with main's privileges — a
  compromised renderer could read any host file. Now the IPC contract is
  `{workspaceId}` only; the main process opens an Electron
  `dialog.showOpenDialog` so the **user** picks the JSON file every time. The
  IPC return type carries the chosen `filePath` back to the renderer for
  display. `MemoryPanel.tsx` updated: the "paste path" text input is gone,
  the Import button now opens the dialog directly. Shared `AgentApi` and
  `ImportMemoryArgs` types updated in lockstep.
- **P1: `installPlugin` now routes through `PluginLoader`.** The handler
  used to skip both the SDK manifest validator and the user-permission
  prompt — `storage.phase4.installPlugin(a.manifest, a.installPath,
  a.approvedPermissions)` ran with whatever shape the renderer sent. A
  compromised renderer could install a plugin claiming any permission set
  with no user interaction. New wiring instantiates a `PluginLoader` with a
  `PluginRepository` adapter over `Phase4Storage` and a `PermissionPrompter`
  backed by `dialog.showMessageBox` (all-or-nothing approval for now;
  per-permission UI is a follow-up). The handler validates the manifest
  shape via the new validator, then calls `pluginLoader.install()` which
  internally runs `validateManifest` (rejects bad semver, non-snake_case
  tool names, unknown permissions) and `prompter.ask` (user must click
  "Approve all" in an OS dialog) before anything reaches the database.
  `setPluginEnabled` / `uninstallPlugin` gained inline shape checks too.

### Security — Sprint 1 — unified security model
- **P0: docker/wsl `run_command` bypassed the approval/snapshot/rollback gate
  and wrote straight through the bind-mounted host workspace.** Previously,
  `runCommandWithPolicy` only enforced the host whitelist on the
  `whitelist` branch; the `docker` and `wsl` branches handed the request to
  `routeCommand` → `DockerRunner` / `WslRunner`, both of which bind-mounted
  the **real** workspace (`-v <workspace>:/work` for docker, `--cd <workspace>`
  for wsl) and ran `sh -lc <command>` with no diff capture, no approval, no
  snapshot. The model could `rm -rf .` or `echo 'pwned' > index.ts` and the
  writes hit the user's source tree directly. Now every sandboxed command goes
  through a per-command copy-on-write staging directory under `os.tmpdir()`
  (new `WorkspaceSandbox` class in `packages/sandbox`): the workspace is
  copied into staging (hard-ignoring `node_modules` / `.git` / `dist` / etc.,
  capped at 8000 files / 200 MB), the runner is repointed at the staging dir
  instead of the host workspace, and after the command finishes a diff
  (`WorkspaceSandbox.diff`) reports which files were added/modified/deleted.
  Those changes are then handled per the caller's declared `writeback` mode:
  `auto` syncs + snapshots immediately (used by user-typed Run Command panel
  + baseline/verify), `approve` parks for explicit user approval via the
  existing patch-approval UI (used by every LLM-initiated `run_command` in
  docker/wsl mode), `discard` drops them (the safe default). Binary writes are
  surfaced as `binaryConflicts` and never auto-synced — opaque blobs must be
  reviewed by a human. New `requestSandboxWriteApproval` callback on the tool
  executor + new `awaitWritebackApproval` on `AgentService` synthesise a
  unified diff from the change set so the renderer's existing diff renderer
  shows the preview. Verified end-to-end against a real Docker container:
  `echo pwned > sandbox-only.txt` produces a change in staging but **does
  not** touch the host workspace until the user clicks Apply. 8 new
  `workspace-sandbox.test.ts` cases lock the CoW + diff contract; 3 new
  `e2e-docker.test.ts` cases lock the three writeback policies.
- **P0: read-only ("instruction") agent mode was hard-coded OFF by a
  DEBUG/TEST OVERRIDE in `apps/desktop/src/main/services.ts` (`readOnly:
  false`).** Removed the override and made the policy driven by a new
  `AgentSettings.readOnly` boolean (default `false`, exposed as a toggle in
  Settings → Agent). `AgentService` reads it per-run via a new
  `effectiveReadOnly()` helper; a hard override can still be set via
  `AgentDeps.readOnly` for headless harnesses, but the production wiring
  now respects the user's choice. Default remains `false` to preserve the
  current effective behaviour — users who want the safer instruction-only
  mode opt in via the toggle.

### Changed — Sprint 1 — unified configuration sources
- **Budget limits now come from `AppSettings.agent`.** `service.ts`
  previously called `clampBudgetLimits(DEFAULT_BUDGET_LIMITS)` with no
  reference to the GUI's "Max auto steps" or "Budget cap (USD)" sliders —
  the user could move them all they wanted, the loop ignored them. Fixed:
  `budgetLimits()` now reads `s.maxAutoSteps` → `maxIterations` and
  `s.budgetUsd` → `maxCostUsd` from the live settings, with
  `clampBudgetLimits` still enforcing the absolute hard caps (100 / $5 / 200 /
  30 min) so a misconfigured `settings.json` can never blow past them.
- **`requireConfirmationBeforeCommand` now actually pauses for confirmation.**
  The setting was wired into the UI for months but never consulted by the
  loop's `requiresApproval` predicate — only `apply_patch` was ever gated. Now
  `requiresApproval(call)` also returns true for `run_command` when the
  setting is on; the new `awaitCommandConfirmation` helper parks the loop on
  a `command_confirm` `Pending` entry whose payload is the `$ <command>`
  preview, so the existing Apply/Reject buttons act as run/skip for the
  pending command.
- **Single source of truth for sandbox mode.** `Phase3Services` previously
  kept its own per-workspace in-memory `Map<workspaceId, SandboxMode>` that
  the `getSandboxMode` / `setSandboxMode` IPC handlers read/wrote; meanwhile
  `AgentService.sandboxPolicy()` was reading from `settings.agent.sandboxMode`.
  The GUI selector and the dispatching loop saw different worlds. Both IPC
  handlers now read/write `AppSettings.agent.sandboxMode` directly (workspaceId
  parameter retained for API compatibility but ignored — sandbox mode is a
  global runtime choice, not a per-project one). The legacy `sandboxModes`
  field is gone from `Phase3Services`.

### Fixed
- **`run_command` ignored `sandboxMode` and always routed to the whitelist
  runner.** Even with `sandboxMode: "docker"` configured, every command
  dispatched by the agent (and by the baseline / verify-after-patch passes) was
  exact-matched against the host whitelist — so `pip install`, `ls -la`,
  `python --version`, and anything else outside the 13-entry allowlist returned
  `"Command not in whitelist"` instead of running in a container. The Phase-3
  `routeCommand` / `DockerRunner` / `WslRunner` plumbing was already wired but
  no caller actually used it. Fix: new
  `packages/tools/src/run-command-routed.ts` exposes `runCommandWithPolicy`,
  which dispatches through `routeCommand` when the policy is `docker` / `wsl`
  and falls back to the legacy whitelist runner otherwise. Wired into
  `agent-core/tools-registry.ts` (new `sandboxPolicy` option) and the three
  service.ts callers (loop dispatch, baseline, verify) via a new
  `sandboxPolicy()` helper that reads from current settings each call. Also
  auto-picks a Docker image based on detected project kind
  (`python:3.12-slim`, `node:22-slim`, etc.) when the policy doesn't pin one,
  with extended detection that recognises freshly-generated `*.py` /
  `requirements.txt` even before `pyproject.toml` exists. Verified end-to-end:
  agent generated a Python project in `test/`, ran 6 unittest cases in
  `python:3.12-slim`, all passed. Followed up with a headless harness at
  `packages/tools/src/e2e-docker.test.ts` that exercises every tool against
  the real workspace (17 cases — list_files / read_file / read_file_range /
  search_text / find_symbol / apply_patch V4A / write_file / git_status /
  git_diff / parse_test_failure / defaultDockerImage / four docker
  `run_command` paths covering happy path, non-zero exit, network
  block, and bind-mount readback / two whitelist fallback paths). All 17
  pass; full `pnpm exec vitest run packages/tools` stays green at 55/55,
  plus packages/agent-core and packages/sandbox at 94/94.
- **DeepSeek 400 "tool must be a response to a preceding message with
  tool_calls" after mid-run compression.** When the conversation crossed
  `COMPRESS_TRIGGER_RATIO`, `compressConversation` could land `tailStart` on a
  `tool` message — the parent `assistant(tool_calls=...)` was folded into the
  summary, leaving the tool message orphaned at the head of `recent`, and the
  next request was rejected by DeepSeek / OpenAI. `compressConversation` now
  advances `tailStart` past every leading `tool` message so `recent` always
  begins with a self-contained system/user/assistant entry. A regression test
  in `compressor.test.ts` asserts `recent` never starts with a `tool` role and
  that every surviving `tool` references a preceding assistant's `tool_calls`.

### Added
- **Collapsible left and right side panels.** Two new icon buttons in the
  Topbar (`panel-left` / `panel-right`) toggle the threads sidebar and the
  inspector right panel independently. State persists across launches via
  `localStorage` (`ui.leftCollapsed` / `ui.rightCollapsed`). The grid reflows
  smoothly (180 ms cubic-bezier on `grid-template-columns`) into 2-column or
  full-width layouts; with both collapsed, the chat takes the entire width.
  Existing responsive breakpoints (1280 / 1080) honour the collapse state.
- **Read-only ("instruction") agent mode — query, never modify.** The shipped
  agent now runs as a query-only assistant: it can read, search, list, find
  symbols, and inspect `git status`/`git diff`, but it is completely forbidden
  from modifying or deleting files. The file-mutating tools (`apply_patch`,
  `write_file`) are enforced in two layers (defense in depth):
  - **Schema:** `agentToolSchemas({ readOnly: true })` strips every
    `FILE_MUTATING_TOOLS` entry from the tool list advertised to the model, so
    the LLM is never even offered a way to edit.
  - **Dispatch:** `createToolExecutor({ readOnly: true })` hard-refuses any
    file-mutating call before it touches the workspace — a model can still emit
    a call for a name it was never offered, so the executor fails closed with a
    readable error fed back to the model rather than writing.
  A dedicated read-only system prompt (`getReadonlySystemPrompt`, ZH + EN)
  tells the model it has no write capability and must propose changes in prose
  for the user to apply. The pre-edit regression baseline is skipped in this
  mode (no edits to guard). Wired on via `AgentService`'s `readOnly` dep, set
  to `true` in the desktop app — a fixed policy, not a user-toggleable setting,
  so it holds regardless of Agent settings. 5 new `tools-registry.test.ts`
  cases lock the schema-filter and fail-closed-dispatch contract.
- **Smooth view transitions across the main shell.** The main slot
  (`EmptyView` → `NewRunCompose` → `ChatRunView`) now cross-fades on swap
  via a 200–240 ms GPU-only opacity + `translate3d` keyframe (`view-enter`)
  scoped to a new `.view-slot` wrapper. The slot re-mounts on a stable
  `viewKey` derived from `(workspace, isComposingNew, detail?.run.id)`,
  so each view animates in from scratch instead of receiving a half-stale
  layout. Sidebar threads, top-bar buttons, and footer icon buttons gained
  matching 120–160 ms background/color transitions for cohesion.
- **`smoothTransitions` toggle in `UISettings`.** New boolean (`default true`)
  controls the cross-view fade. Applied as `data-transitions="on|off"` on
  `<html>` via `applyAppearance`; gated under `reduceMotion` so accessibility
  always wins. A toggle row was added to the Settings → Interface pane with
  bilingual labels (`ui.smoothTransitions` / `ui.smoothTransitionsHint`).

### Fixed
- **Settings modal scroll lag.** The scroll panes (`.sm-content`, `.sm-tabs`)
  gained `contain: content` + `overscroll-behavior: contain` so wheel events
  no longer invalidate ancestor layout, and the modal itself now lives on
  its own composite layer (`transform: translateZ(0)` + `contain: layout
  paint`) so the heavy box-shadow caches once instead of re-rasterising
  every scroll frame. The scrim's `backdrop-filter` is hinted with
  `will-change: backdrop-filter` for the same reason. On a Windows laptop
  this turns a juddery scroll into a smooth one — the dominant cost was
  re-painting the modal drop-shadow and the scrim blur on every wheel tick.

### Added
- **Installation gate — first-run Docker guidance + degraded-mode lockout.**
  On first launch the main process probes for Docker (`docker --version`
  followed by `docker info`). If neither succeeds, a non-dismissible modal
  explains the security risk of running tool calls on the host without a
  container sandbox and offers three exits: **Install Docker Desktop**
  (opens the download page via `shell.openExternal`), **Re-check** (re-runs
  the probe), or **Skip and accept the risk** (red ghost button). The skip
  choice persists to `<userData>/installation-gate.json`. While "skipped +
  Docker missing" the app runs in `degraded` mode:
  - A red **Docker not installed** / **Docker not running** badge appears in
    the top bar; clicking it re-opens the install modal.
  - The Settings → Agent panel renders a red warning banner (click to
    re-open the install modal) and disables the entire fieldset via
    `<fieldset disabled>` + opacity/greyscale so users cannot accidentally
    re-enable unsafe options.
  - The agent loop's tool dispatcher (`createToolExecutor`) consults
    `assertToolAllowed(toolName)` before every dispatch — LLM-initiated
    `run_command` / `apply_patch` / `write_file` calls fail closed with a
    readable error fed back to the model, not a crash. The IPC `runCommand`
    handler enforces the same check for the user-typed Run Command panel.
  - Status changes are pushed live to every renderer window via a new
    `installation_status` `AgentEvent`; clicking **Re-check** after
    installing Docker silently lifts the lockout without a restart.
  Persistence survives corrupt JSON (falls back to defaults rather than
  crashing the boot path). 13 vitest cases lock the state-machine contract;
  3 additional `tools-registry.test.ts` cases lock the gate's "fail before
  side effects" guarantee.

### Changed
- **Sandbox child-process hardening — Job Object + correct env scrubbing.**
  Every WSL/Docker/Windows child spawned by `runChild` is now assigned to a
  Windows Job Object created via inline PowerShell P/Invoke. The job sets
  `KILL_ON_JOB_CLOSE` + per-process memory cap (1 GB default) + total CPU
  time cap (10 min default) + active process limit (16 default), so a
  hung/runaway tool can no longer outlive the Electron parent and Electron
  quit / run cancel drops the entire process tree atomically. On
  non-Windows the job is a no-op so callers don't branch on platform.
  Also fixes a long-standing bug where `filteredEnv` was imported into
  `wsl-runner.ts` but never passed to `child_process.spawn` — process
  env (including `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`)
  was leaking to every tool's stdout/stderr. The whitelisted env is now
  threaded through correctly.

### Documentation
- **AppContainer feasibility spike — `docs/sandbox/appcontainer-spike.md`.**
  Design-only writeup for the long-term route to a true Windows-native OS
  sandbox: Win32 AppContainer SIDs + capability gates + ACL-restricted
  workspace, equivalent to `bwrap` on Linux. Includes Rust+TS code
  skeletons, dependency choice (windows-rs + napi-rs + prebuildify), ~1075
  LOC budget, and a ~10-day phased rollout plan. Framed so the team can
  decide whether to invest after telemetry from the installation gate
  shows whether users actually adopt Docker.
- **README — Docker installation guidance is now front and center.**
  New section explains why Docker is the recommended sandbox on Windows,
  how to install Docker Desktop, what happens when it's missing, and how
  the degraded-mode lockout protects users who explicitly skip it.

### Changed
- **Product renamed to NL_Codey.** `productName`, `appId`, `shortcutName`, window
  title, README heading, and the system / patch / plan / summarize prompts now
  use `NL_Codey` instead of `Coding Agent`. The repository name and npm package
  ids (`@nlc/*`) stay unchanged.

### Fixed
- **Packaged app crashed on launch with `Cannot find module 'bindings'`.**
  `better-sqlite3` does `require('bindings')` at module load. The `bindings`
  and its sibling `file-uri-to-path` are transitive deps that pnpm with
  hoisted linker installs to root `node_modules`, but electron-builder did
  not bundle them into the asar — the same failure mode previously seen with
  `@vscode/ripgrep-win32-x64`. Declared `bindings@^1.5.0` and
  `file-uri-to-path@^1.0.0` as direct deps of `apps/desktop` so
  electron-builder must track and ship them.

### Added
- **Multi-turn runs — continue a finished run with follow-up tasks.** Each
  `AgentRun` no longer closes after one task; submitting from the chat
  composer on a finished run calls the new `continueAgentTask` IPC and
  appends to the same `runId`. The model receives the full prior
  conversation (assistant turns, tool calls, tool results, applied patches)
  so follow-ups like "now also rename the helper" or "the test still fails,
  fix the regex" have full context. New SQLite table
  `agent_run_messages` (one JSON row per `LLMMessage`, ordered by `seq`)
  persists the conversation at the end of each loop turn; `runToolLoop`
  now returns `finalMessages` in its outcome for that purpose. The
  regression-guard baseline is re-captured at the start of each follow-up
  turn so regressions are measured against the (already-edited) workspace,
  not the original pristine state. `AgentService.continueTask(runId,
  followUp)` rejects in-flight runs and runs predating multi-turn (no
  persisted conversation). Composer placeholder already said "Describe a
  follow-up task…" on finished runs — behaviour now matches.
- **Release pipeline — Windows installer via GitHub Actions.** New `.github/workflows/release.yml`
  builds an NSIS installer on `windows-latest` runner. Triggered by `v*` tags (auto-creates
  GitHub Release with attached `.exe` + `.zip`) or `workflow_dispatch` (artifact only).
  `apps/desktop/package.json` gains an `electron-builder` config block: `nsis` target with
  `oneClick: false` + `allowToChangeInstallationDirectory: true` (user-picked install dir,
  per-user install, no admin), plus a `zip` portable target. `asarUnpack` rules cover
  `better-sqlite3` (`.node` binding) and all `@vscode/ripgrep-*` platform binaries, so the
  packaged app can `spawn(rg)` and open the SQLite DB. `packages/tools/src/search-text.ts`
  now rewrites the `app.asar` path returned by `@vscode/ripgrep` to `app.asar.unpacked`
  before spawning. CI uses a separate `.npmrc.ci` to force `node-linker=hoisted` so
  electron-builder can resolve transitive deps without chasing pnpm symlinks; local dev keeps
  the default isolated layout. Local verification: `pnpm typecheck` + 456 tests pass,
  `pnpm build` clean. Tag a release with `git tag v0.1.0 && git push --tags` to publish.
- **Phase 4 — cross-project self-evolution + team scale.** Seven new workspace packages plus
  agent-core / IPC / GUI wiring that bring the coding agent from "single-project entrustment"
  to "provably improving across projects":
  - `packages/global-memory/` — cross-project knowledge graph with provenance; `KnowledgeGraph`
    facade ties pattern contribution to source-project edges; the offline `pattern-extractor`
    promotes a pattern only when it appears in ≥2 projects (default cap ≤10 promotions/week);
    `cross-project-retriever` ranks ≤3 patterns per task with semantic + tag matching and
    renders a provenance-tagged Markdown block; `privacy-scope` enforces opt-in contribution
    (default `isolated`) and full retraction cascade.
  - `packages/style-profile/` — `StyleSpec` data model (`naming` / `error-handling` / `imports`
    / `testing` / `comments` / `structure` × `must` / `should` / `prefer`); `style-extractor`
    derives initial rules from codebase statistics (quote preference, indent, semicolons,
    function style); `diff-feedback` classifies signals and auto-promotes after 3 consistent
    signals, auto-strengthens to `must` after 6. All rules carry source ("extracted" /
    "feedback" / "manual") for full human auditability.
  - `packages/learning/` — passive `SignalCollector` records `diff_accepted` / `diff_rejected`
    / `diff_edited` / `review_overturned` / `manual_correction` with zero user friction;
    `preference-dataset` builds `(prompt, chosen, rejected)` tuples from edited signals;
    `dataset-curator` filters whitespace-only churn, low-quality pairs, near-duplicates and
    caps per category — quality > quantity.
  - `packages/finetune/` — optional LoRA/QLoRA pipeline (default OFF); `LoRATrainer` shells out
    to an external backend; `eval-gate` enforces the three-rule gate (candidate score ≥
    baseline, zero per-task regression, no holdout collapse) with one-line verdict text;
    `ModelRegistry` enforces "exactly one active model" with one-click rollback to base;
    `embedding-adapter` runs A/B with normal-approximation z-test and only promotes on
    significant lift (≥2pp at p<0.05); `frozen-suite.ts` seeds 5 immutable initial tasks
    (L1 typo → L4 mini ESM migration) and computes monotonic/visible-improvement flags.
  - `packages/distributed/` — `Coordinator` holds the registered worker set with
    least-loaded scheduling; `RemoteWorkerClient` port for mTLS-pluggable transport; graceful
    fallback to local execution when no workers are available (NEVER blocks single-node);
    `task-distributor` computes ready sets + round-robin plans with per-task capability
    filtering; `node-recovery` reassigns running tasks from offline nodes.
  - `packages/proactive/` — read-only `scanForDebt` (oversized files, TODO concentration,
    missing tests, deprecated deps, doc gaps) with a HARD INVARIANT: never modifies a file,
    never schedules a task, never runs non-read-only commands; output is `ProposalInput[]`
    only; `ProposalInbox` provides snooze/dismiss/convert lifecycle with rewake on snooze
    expiry; conversion hands off to the Phase 3 Planner pipeline (which is the ONLY place a
    real task is created).
  - `packages/plugin-sdk/` — `validateManifest` rejects malformed manifests (bad semver,
    unknown sandbox, unknown permission, non-snake_case tool names) at install time;
    `PluginLoader` requires explicit per-permission user approval (never auto-approves);
    `PluginHost` re-checks permissions on every invocation (enable check + permission check +
    sandbox routing); `renderCommand` shell-escapes all argument values.
  - `packages/storage` — 16 new tables (`global_patterns`, `kg_edges`, `workspace_contribution`,
    `style_specs`, `feedback_signals`, `preference_pairs`, `preference_datasets`, `finetune_jobs`,
    `model_registry`, `proposals`, `worker_nodes`, `distributed_assignments`,
    `plugin_installations`, `checkpoints`, `eval_tasks`, `eval_runs`, `frozen_suite_snapshots`)
    + 16 indexes; new `Phase4Storage` sub-facade exposed via `storage.phase4`; all packages
    consume this through narrow port interfaces (same pattern as Phase 3 `MemoryStore`).
  - `packages/shared` — new `phase4.ts` module with all Phase 4 data contracts + `Phase4Settings`
    (per-feature flags, defaulting to disabled for `globalMemory` / `finetune` / `distributed` /
    `proactive` / `plugins`; `styleProfile` and `learning` default ON since they're zero-risk).
  - `packages/agent-core` — new `buildPhase4PromptAugmentation` injects GlobalPattern hints
    (capped at 3, with provenance) + StyleSpec rules (sorted must > should > prefer) +
    `MODEL_IDENTITY_REMINDER` ("you may be running on a fine-tuned model — still verify, style
    yields to correctness").
  - `apps/desktop` — new `phase4-ipc.ts` registers ~30 IPC handlers; `phase4-settings.json`
    persists feature flags separately from the main settings so they can be toggled freely.
    Preload bridge and renderer `api.ts` mirror the full surface. New components:
    `Phase4Panel` (tabbed shell), `KnowledgeGraphView` (provenance + delete), `StyleProfilePanel`
    (per-rule strength editor + extract-from-codebase), `LearningDashboard` (signal tally +
    frozen-suite weekly trend table + build-dataset action), `FinetuneManager` (model registry +
    one-click rollback + per-job eval Δ / holdout / regressions), `ProposalInbox` (scan +
    convert/snooze/dismiss), `ClusterMonitor` (auto-refresh every 10s), `PluginManager`
    (enable/disable/uninstall with permission display). Phase 4 stylesheet at
    `phase4-styles.css` registered through `main.tsx`.
  - **Tests**: ~70 new vitest cases across the seven packages (KG contribution + retraction
    cascade, pattern-extractor weekly cap, style-extractor codebase stats, diff-feedback
    threshold promotion + strengthening, dataset curator filters, eval-gate three-rule
    enforcement + catastrophic-forgetting detection, A/B z-test, coordinator least-loaded
    + fallback + reaper, task-distributor capability matching, node-recovery reassignment,
    debt-scanner read-only verification + dedupe, ProposalInbox lifecycle, manifest validator
    + authorize, PluginHost permission re-check + disabled-plugin rejection,
    phase4-prompt strength ordering + provenance rendering). Full `pnpm typecheck` green
    across all 21 packages + the desktop app. 456/460 vitest pass — the 4 failures are the
    pre-existing better-sqlite3 Node-ABI mismatch in `storage.test.ts` documented in CLAUDE.md.
- **Notebook UI polish (right panel · shortcuts · expanded settings · i18n)** — `RightPanel`
  slide-out detail surface + `ModelSwitcher` topbar pill + `QuickPrefsPopover` for fast
  theme/density swaps. `useShortcuts` + Settings → Shortcuts pane wires the named-action
  keyboard rebinding to the `ShortcutBindings` shape in `packages/shared/src/settings.ts`.
  Settings panes (`AgentSettings` / `LLMSettings` / `UISettings` / `fields`) fleshed out;
  `i18n.ts` dictionary extended to cover the new settings and quick-pref surfaces
  (zh-CN + en-US). Dropped the dead `packages/agent-core/src/intent.ts` — the tool-calling
  loop has driven intent end-to-end since Phase 2, and keeping the file encouraged
  accidental re-imports.
- **Notebook/runbook UI redesign (`ui/notebook-redesign` branch)** — replaces the 3-column dark
  IDE renderer with a chat-centric notebook aesthetic from the
  `claude.ai/design` handoff (`coding-agent/project/Coding Agent.html`). New shell: 48 px topbar
  (brand · workspace chip · LLM-status pill · settings) + 268 px threads sidebar wired to
  `listAgentRuns` (grouped today/yesterday/this-week, with status dots + awaiting/live pills) +
  main viewport that switches between an A3 notebook-cover empty state, a `NewRunCompose`
  serif prompt for workspaces with no active run, and a `ChatRunView` rendering `AgentStep[]`
  as paired user/agent messages + collapsible tool cards + a derived 4-stage pipeline strip
  (plan · explore · patch · verify). Approval is now a notebook-style sheet (`ApprovalSheet`)
  with summary pills, file list, syntax-highlighted V4A/unified-diff excerpts, and a
  signature-required Sign &amp; apply button — gated on initials. Warm-paper palette + Geist /
  Geist Mono / Newsreader fonts (loaded via Google Fonts with CSP `style-src` and `font-src`
  scoped to `fonts.googleapis.com` / `fonts.gstatic.com`). Legacy `FileTree`, `CommandOutput`,
  `TracePanel`, `IterationTimeline`, and `Phase3Panel` are no longer wired into the main shell
  (sources retained for re-surfacing later); `SettingsModal`, `Toast`, `BudgetIndicator`, and
  `DiffView` carry over and inherit the new palette via compatibility CSS aliases. Typecheck
  green across all 13 packages + the desktop app; `pnpm build` produces 314 kB renderer JS /
  36 kB CSS. 389/393 vitest pass (the 4 failures are the pre-existing better-sqlite3 Node-ABI
  mismatch in `storage.test.ts` documented in CLAUDE.md, not a regression).

### Fixed
- **Topbar settings / sidebar quick-prefs gear icons rendered as a dot** —
  `Topbar.tsx` and `ThreadsSidebar.tsx` rendered `<Icon name="gear" />` at `size={15}`
  with the default `stroke={1.6}`. Against the gear's 24×24 viewBox that maps every
  tooth to ~1 px and an effective stroke of ~1 px, so on standard-DPI displays the
  teeth anti-aliased into a fuzzy ring and only the inner `<circle r="3" />` (a
  ~3.75 px ring) read clearly — visually a "dot". Bumped both gear buttons (and the
  history button beside the quick-prefs gear) to `size={16} stroke={2}`, matching
  lucide's recommended minimum readable settings-icon size. Also reverted a stray
  uncommitted swap in `Icons.tsx` that replaced lucide's `Settings` path with the
  `Settings2` variant — both render the same at 15 px, so the swap did nothing for
  the symptom and only churned the source.
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
  to the bundle list so every `@nlc/*` workspace package (13 total) is bundled. `pnpm build`
  green; `out/main/index.js` now transforms 118 modules.
- **ReDoS on diff classifier (`packages/style-profile/src/diff-feedback.ts`)** — CodeQL flagged
  three polynomial-time regular expressions evaluated against unbounded LLM/user-controlled diff
  text. `/try\s*\{[\s\S]*?\}\s*catch/` (line 37) catastrophically backtracks on inputs like
  `try{try{try{...` because the lazy `[\s\S]*?` can split at every nested `{`. `/[a-z]+_[a-z]+/`
  (line 70, used twice — once on `before`, once on `after`) is polynomial on long `a`-runs without
  `_`. Fixed with two changes: (1) cap `before`/`after` at `MAX_SIGNAL_LEN = 4000` before any regex
  test so worst-case work is bounded regardless of future heuristics; (2) replace the lazy try/catch
  matcher with two anchored sub-tests (`/try\s*\{/` + `/\}\s*catch\b/`) and the snake_case matcher
  with the single-char-on-each-side form `/[a-z]_[a-z]/` (existence-detection is semantically
  equivalent — no need for the `+` quantifier). All 8 `style-profile` vitest cases still pass;
  closes the three GitHub Code Scanning alerts on PR #4.

### Added
- **Phase 3 — long-term project entrustment (full module build, typecheck-green)**. New packages:
  `@nlc/memory` (cross-session memory: decision/preference/failure/fact entries,
  embedding+tag+recency retriever, decay, JSON export/import), `@nlc/semantic-index`
  (OpenAI + mock embedders, heuristic chunker, cosine vector search, incremental mtime reindex),
  `@nlc/planner` (glob dependency graph, DAG validation, scheduler waves with
  scope-overlap serialization, LLM decomposer), `@nlc/orchestrator` (Planner/Coder/Reviewer
  roles + prompts, strict 4-kind message-bus with JSON validation, thread-safe BudgetController,
  LockManager with deadlock-timeout, bounded worker pool, Coordinator review loop),
  `@nlc/git-integration` (branch manager, conventional commit writer, PR generator,
  diff summarizer), `@nlc/web-tools` (domain whitelist, readability fetch, search backends).
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
