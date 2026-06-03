# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); this project is pre-1.0 (`0.1.0`).

## [Unreleased]

### Security (Sprint 1 — unified security model)
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

### Changed (Sprint 1 — unified configuration sources)
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
  ids (`@coding-agent/*`) stay unchanged.

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
  to the bundle list so every `@coding-agent/*` workspace package (13 total) is bundled. `pnpm build`
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
