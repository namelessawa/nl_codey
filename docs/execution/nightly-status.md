# Nightly execution status

Goal: `NLC-PRODUCTION-COMPLETE`

Overall state: **ACTIVE - LOCAL RELEASE GATES GREEN; HOSTED CI/TUI/PRODUCT WORK REMAINS**

## Batch board

| Batch | Branch | Scope | State | Evidence |
| --- | --- | --- | --- | --- |
| 1 | `codex/audit-production-complete` | Reality audit, control files, generated TUI inventory, current-doc path corrections | Ready for draft review; gate red on SBOX-ABORT-001 | Baseline captured; 18 commands, 18 key actions and 3 modal routes discovered |
| 2 | `codex/p1-test-cli-foundation` | Formal test configs, live/debug opt-in gate, CLI build/smoke | Ready for draft review; initial red integration evidence retained | Default offline gate: 685 passed; CLI bundle/help/version passed |
| 3 | `codex/p1-tui-render-foundation` | TUI unit/render/ANSI frame tests | Ready for draft review | 8 Ink render/interaction assertions passed with ANSI normalization |
| 4 | `codex/p1-tui-pty-harness` | Windows ConPTY + resize/key/cleanup primitives | Ready for draft review | 2 real ConPTY lifecycle assertions passed |
| 5 | `codex/p1-tui-core-workflows` | Core approval/reject/stop/session/recovery scenarios | Ready for draft review | 4 real ConPTY workflows; approval, rollback, reject, cancel, restart, resume and branch passed |
| 6 | `codex/p0-storage-abi-gate` | Node/Electron ABI + migration gates | Ready for draft review | Node migration/lifecycle 4/4; Electron load before/after restore passed |
| 7 | `codex/p0-sandbox-abort-stability` | Windows abort/process-tree stability | Ready for draft review | 12 serial + 8 concurrent abort soak passed below 1500 ms; descendant PID cleanup proved |
| 8 | `codex/p0-run-session-recovery` | Startup reconciliation and Run/Session linkage | Ready for draft review | Dead-owner recovery, Desktop wiring and approval-crash ConPTY restart passed |
| 9 | `codex/p0-unified-approval` | Mutation inventory and common approval enforcement | Ready for draft review | 31 paths inventoried; single-use mutation grants and denial/approval contract passed |
| 10 | `codex/p0-plugin-runner-spike` | Restricted plugin runner RFC/spike | Ready for draft review; default gate red on existing loaded ConPTY cleanup flake | Real Docker adversarial gate denied host/workspace secrets, network, process, rootfs and oversized-file access |
| 11 | `codex/p0-secret-redaction` | Shared secret-redaction contract and primary persistence/display boundaries | Ready for draft review; SEC-SECRET-001 remains open for secondary tails | Provider/tool/verifier/SQLite/JSONL/TUI fixtures and integration gate pass |
| 12 | `codex/p0-secret-redaction-tails` | Semantic/eval/fine-tune/Desktop/CLI redaction tails | Ready for draft review; SEC-SECRET-001 closed | Full default gate, 7 Storage and 19 integration assertions pass |
| 13 | `codex/p0-storage-migration-backup` | Historical SQLite migration backup and recovery | Ready for draft review; DATA-MIG-001 closed | Full default gate, 10 Storage and 19 integration assertions pass |
| 14 | `codex/p0-rollback-recovery` | Durable single/many/partial/restart rollback | Ready for draft review; REC-ROLLBACK-001 closed; default red on known ConPTY cleanup flake | 13 restorative recovery assertions and 19 integration assertions pass; exact bytes/existence/Run state proved |
| 15 | `codex/p1-tui-crash-cleanup` | Deterministic loaded ConPTY crash cleanup | Ready for draft review; default gate restored green | Awaited Windows tree termination; clean 5/5 targeted and loaded TUI E2E passes with immediate temp cleanup |
| 16 | `codex/p1-live-smoke-gate` | Explicit custom.txt live-model gate | Ready for draft review; CI-LIVE-001 closed | Custom provider streamed a real read_memory tool round-trip in 4.7s; default 629-unit slice remained offline |
| 17 | `codex/p1-release-ci-gates` | Required CI, CLI package and Windows install gates | Ready for draft review; hosted Release green; main-target required checks remain | Run 30405876544 passed clean install, tests, integration, builds, CLI/NSIS smoke and artifact upload |
| 18 | `codex/p1-tui-command-approval` | Native TUI command confirmation and rejection | Ready for draft review; command scenarios closed | 630 unit, 10 render, 2 lifecycle, 7 E2E and 13 recovery assertions passed |
| 19 | `codex/p1-tui-budget-exhaustion` | Native TUI budget circuit-breaker evidence | Ready for draft review; budget scenario closed | 630 unit, 10 render, 2 lifecycle, 8 E2E and 13 recovery assertions passed |
| 20 | `codex/p1-tui-provider-configuration` | Native provider setup and restart persistence | Ready for draft review; provider scenario closed | 630 unit, 2 lifecycle, 9 E2E and 13 recovery assertions passed |
| 21 | `codex/p1-tui-redacted-error` | Native provider-error redaction through TUI/SQLite/JSONL | Ready for draft review; redaction scenario closed | 631 unit, 2 lifecycle, 10 E2E and 13 recovery assertions passed |
| 22 | `codex/p1-tui-large-scrollback` | Native large-output retention and scrollback navigation | Ready for draft review; document behavior matrix closed | 632 unit, 2 lifecycle, 11 E2E and 13 recovery assertions passed |
| 23 | `codex/p1-tui-crash-soak` | Five-cycle bounded ConPTY crash cleanup | Ready for draft review; TUI crash-tail blocker closed | 5/5 soak, 11 E2E and 13 recovery assertions passed; ABI restored |
| 24 | `codex/p1-eval-recorded-foundation` | Frozen Headless deterministic/recorded benchmark and scorecard | In progress; offline thresholds pass, approved live threshold remains open | 13/13 deterministic, 13/13 recorded, unsafe refusal 1/1, regression 0%; 17 eval assertions and ABI restore passed |
| 25 | `codex/p1-eval-live-benchmark` | Approved custom-provider live benchmark | Ready for draft review; EVAL-001 closed | 12/13 (92.31%) in 155 seconds; controlled cross-file terminal failure retained; ABI restored |
| 26 | `codex/p1-tui-prompt-editor` | Unicode prompt state machine and native input contract | Ready for draft review; TUI-PROMPT-001 closed | 13 TUI unit, 15 render and 3 real ConPTY lifecycle/prompt assertions pass |
| 27 | `codex/p1-tui-input-inventory` | Complete generated modal/input evidence | Ready for draft review; TUI-INV-001 closed | 17 Ink render assertions; 23/23 generated input rows have test identifiers |
| 28 | `codex/p1-tui-minimum-layout` | Full terminal-size matrix and height-aware fallback | Ready for draft review; TUI-RENDER-001 and TUI-MIN-001 closed | Full offline gate green; 19 Ink render and 3 real ConPTY lifecycle/prompt assertions pass |
| 29 | `codex/p1-tui-read-only-analysis` | Exact Goal Scenario 2 read-only analysis and forged-write refusal | Ready for draft review; exact Scenario 2 closed | Full offline gate green; 4 Mock scenario, 19 Ink render and 12 native TUI E2E assertions pass |
| 30 | `codex/p1-tui-large-tool-output` | Exact Goal Scenario 14 output limits and native scrollback | Ready for draft review; exact Scenario 14 closed | Full offline gate green; 634 unit, 15 TUI unit, 19 render, 3 lifecycle, 12 E2E and 13 recovery assertions pass |
| 31 | `codex/p1-tui-dynamic-tool-redaction` | Exact Goal Scenario 13 dynamic-tool construction failure | Ready for draft review; exact Scenario 13 closed | Full offline gate green; 634 unit, 15 TUI unit, 19 render, 3 lifecycle, 12 E2E and 13 recovery assertions pass |
| 32 | `codex/p1-tui-provider-run-use` | Exact Goal Scenario 9 invalid configuration, correction and new-Run use | Ready for draft review; TUI-E2E-001 closed | Full offline gate green; 634 unit, 15 TUI unit, 19 render, 3 lifecycle, 12 E2E and 13 recovery assertions pass |
| 33 | `codex/p1-tui-mouse-contract` | Explicit Experimental mouse boundary and required TUI acceptance ledgers | Ready for draft review; TUI-MOUSE-001 closed | Full offline gate green; 15 TUI unit, 19 render, 3 lifecycle, 12 E2E and 13 recovery assertions pass |
| 34 | `codex/p1-tui-session-diagnostics` | Corrupt/partial Session diagnostics and safe resumed appends | Ready for draft review; corrupt/partial acceptance closed | Full offline gate green; 635 unit, 15 TUI unit, 19 render, 3 lifecycle, 12 E2E and 13 recovery assertions pass |
| 35 | `codex/p1-tui-page-navigation-contract` | Required PageUp/PageDown safe-no-op input contract | Ready for draft review; all 15 required key groups now have automated evidence | Full offline gate green; 635 unit, 16 TUI unit, 20 render, 4 lifecycle, 12 E2E and 13 recovery assertions pass |
| 36 | `codex/p1-tui-session-fault-isolation` | Visible Session write faults and resume/show path containment | Ready for draft review; write-failure/path-isolation acceptance closed | Full offline gate green; 638 unit, 16 TUI unit, 20 render, 4 lifecycle, 12 E2E and 13 recovery assertions pass |
| 37 | `codex/p1-tui-session-lineage-breadth` | Multilevel/cross-parent Session lineage and invalid-target continuity | Ready for draft review; `TUI-SESSION-001` closed | Full offline gate green; 638 unit, 16 TUI unit, 20 render, 4 lifecycle, 13 E2E and 13 recovery assertions pass |
| 38 | `codex/p1-shared-run-fsm-errors` | Shared Run transition table, atomic enforcement and stable failure codes | Ready for draft review; core `FSM-001` implementation complete | Full offline gate green; 643 unit, 17 recorded-eval, 80 Desktop-main, 4 lifecycle, 13 E2E and 14 recovery assertions pass |
| 39 | `codex/p1-context-provenance` | Semantic context provenance, snippet truncation and stale-index visibility | Ready for draft review; `CTX-001` remains in progress for impact graphs and TUI presentation | Full offline gate green; 645 unit, 17 recorded-eval, 81 Desktop-main, 4 lifecycle, 13 E2E and 14 recovery assertions pass |
| 40 | `codex/p1-context-impact-graph` | Bounded TS/JS impact graph and expandable TUI context detail | Ready for draft review; `CTX-001` remains in progress for stale eviction/refresh and token budgets | Full offline gate green; 648 unit, 17 recorded-eval, 81 Desktop-main, 21 render, 4 lifecycle, 13 E2E and 14 recovery assertions pass |
| 41 | `codex/p1-semantic-index-refresh-budget` | Production incremental semantic refresh and explicit retrieval token budgets | Ready for draft review; `CTX-001` closed | Full offline gate green; 650 unit, 17 recorded-eval, 82 Desktop-main, 21 render, 4 lifecycle, 13 E2E and 14 recovery assertions pass |
| 42 | `codex/p1-renderer-browser-split` | Browser-safe shared exports, sandboxed preload and packaged renderer startup | Ready for draft review; `RENDERER-001` closed | Full offline gate green; 652 unit, 17 recorded-eval, 82 Desktop-main, renderer/preload, 21 render, 4 lifecycle, 13 E2E and 14 recovery assertions pass |

## Work log

### 2026-07-29 - baseline and discovery

- Fetched `origin/main` and preserved the divergent previous branch.
- Created the audit branch at
  `11aa6486c904c393d3948b4b4f8d75a9b094591f`.
- Preserved and excluded the untracked `study-mode-e2e-test/` directory.
- Installed from the frozen lockfile with the repository-declared pnpm.
- Passed root typecheck and Desktop production build.
- Recorded Storage ABI, sandbox abort, ambient live-debug, missing CLI build
  script, renderer externalization and zero-TUI-test gaps.
- Added a generator that reads the real TUI command/parser/host routes and
  input components.
- Confirmed `custom.txt` exists and masked its secret during inspection. No
  explicit live smoke has been run in this batch.
- Batch verification: `pnpm typecheck`, `pnpm build`, generator syntax and
  generator idempotency passed. With Storage and debug suites explicitly
  excluded, 79 files/693 tests passed and only the pre-existing Windows abort
  timing assertion failed (1936 ms measured, 1500 ms bound).

### 2026-07-29 - formal test and CLI foundation

- Split the default offline gate into explicit unit, Desktop main, renderer,
  preload, CLI and TUI Vitest projects. The combined `pnpm test` gate passed
  685 assertions without consulting ambient LLM credentials.
- Moved Storage ABI, sandbox abort and Docker tool coverage into the explicit
  integration project. Its baseline is intentionally red: 16 passed, 7
  skipped and 5 failed (four ABI failures plus the Windows abort bound,
  measured at 3147 ms).
- Added an explicit `RUN_AGENT_DEBUG_TESTS=1` requirement to the Docker LLM
  debug suite. Its no-opt-in preflight passed and the live case skipped; no
  network request was made.
- Added the missing CLI bundle script and verified both the bundled entry and
  package shim with `--help`, plus bundled `--version`.
- Added command-catalogue/parser, argv, renderer-appearance and typed preload
  bridge smoke coverage. The generated action inventory now records the
  command tests while retaining honest gaps for key, modal, render and PTY
  behavior.
- `custom.txt` remained ignored and unread by test processes. No explicit live
  model smoke was required for this batch.

### 2026-07-29 - TUI render foundation

- Added the Ink 5-compatible testing library and pinned ANSI normalization as
  CLI development dependencies.
- Added a dedicated `test:tui:render` project and included it in the default
  offline gate.
- Passed eight render/interaction assertions covering themed header/footer
  frames, ANSI stripping, live trace retention, streaming state, Prompt
  completion and Windows DEL input, bounded patch previews, approve/reject,
  and two-way provider/skill picker navigation.
- Updated the generated inventory so the covered command, key and modal rows
  point to their committed test evidence; uncovered rows remain `None`.
- No agent service or model provider was constructed, so `custom.txt` was not
  read and no network/model call occurred.

### 2026-07-29 - Windows ConPTY harness

- Added the Microsoft `node-pty` prebuilt and a headless xterm screen model so
  PTY assertions inspect the current terminal buffer rather than concatenated
  ANSI output.
- Added a serial Windows PTY test project to the default offline gate.
- Passed a real ConPTY lifecycle covering wide startup, resize below the
  80-column breakpoint, trace-panel removal, `/help` completion, normal
  `/exit`, idle Ctrl+C and bounded child cleanup.
- Test fixtures use isolated temporary workspace/data roots and wait for child
  exit before retry-safe cleanup, preventing open ConPTY handles from leaking.
- The exercised paths do not submit an agent task; no provider was constructed
  and no model/network call occurred.

### 2026-07-29 - Storage ABI and migration matrix

- Added named Node, Electron and combined Storage gates. The Node gate backs up
  the installed Electron native binary, selects or compiles the exact host
  Node ABI, runs real migration/lifecycle tests, restores the backup in a
  `finally` path and verifies Electron can still open SQLite.
- Pinned `node-gyp` for Node releases without a published prebuild. Successful
  Node binaries are cached by package version, module ABI, platform and
  architecture under ignored `node_modules/.cache`.
- Passed all four Node Storage assertions, including the pre-Phase-2 migration
  fixture, and passed Electron ABI 130 smoke checks both before and after the
  swap. A forced intermediate failure also restored Electron successfully.
- The combined integration gate then passed: Storage 4/4 plus Sandbox/Docker
  17/17, with 7 Docker-environment cases skipped.
- Sandbox abort remains open for a repeated loaded soak because historical
  runs measured 1936-3147 ms despite the latest isolated 1171 ms result.

### 2026-07-29 - Windows sandbox abort stability

- Removed the synchronous PowerShell Job Object shim after proving its Win32
  handle was created in a process that exited before assignment. Handles are
  process-local, so the later assign/close helpers could not enforce the
  advertised limits and added seconds of startup latency.
- Added one shared process-tree terminator: Windows uses `taskkill /T /F`;
  POSIX uses a dedicated process group with TERM and a bounded KILL fallback.
  Both the default whitelist runner and WSL/Docker runner use the same path for
  cancellation and timeout.
- Added a race-safe already-aborted check, preserved `AbortError`, and proved a
  spawned descendant PID is promptly gone after the aborted command settles.
- The named `pnpm test:sandbox:abort:soak` gate passed 12 serial cancellations
  plus 8 concurrent cancellations, with every duration below the unchanged
  1500 ms bound. No LLM provider or network path was constructed.

### 2026-07-29 - Core TUI workflows and session replay

- Extended the restorative Storage ABI matrix so real Node/ConPTY agent tests
  can run against the Node native binary and always finish by verifying the
  Electron ABI. The default offline gate now includes this named TUI E2E
  project.
- Passed four isolated real-ConPTY workflows: approve then `/rollback`, reject
  without mutation, Ctrl+C during delayed streaming, and append-only session
  persistence across two restarts plus `/resume`, `/tree`, and `/branch`.
- Fixed the deterministic Mock provider to preserve the actual task from the
  agent context envelope and to honor `AbortSignal` while streaming. All tests
  explicitly select the mock provider and clear ambient provider keys.
- Startup session recovery replays the newest valid JSONL history without
  constructing a run or re-executing tools. Resume accepts exact ids or unique
  prefixes, while branch evidence asserts both header ancestry and the first
  child message's `parentId` on disk.
- Added `/rollback [<run>]`, backed by persisted snapshots and an exact/unique
  prefix resolver. Ink Static is remounted only for non-append replay so the
  selected history is actually visible in terminal scrollback.
- `custom.txt` remained ignored and unread by test processes; no network/model
  call occurred. See `docs/tui/pty-e2e-report.md` for the scenario evidence.

### 2026-07-29 - Run/Session startup reconciliation

- Added stable nullable Run linkage fields for JSONL session id/path plus the
  owning runtime instance and process id. AgentService writes them atomically
  with Run creation; TUI branch/resume tests query Runs back from the session
  id and assert the exact produced JSONL path.
- Added an idempotent Storage startup reconciler. It marks only non-terminal
  Runs owned by dead processes (or sufficiently old legacy rows) as
  `failed/interrupted_restart`, appends one bounded audit step, and never
  invokes a tool, reapplies a patch, changes snapshots or writes workspace
  files. A live peer PID is left untouched.
- Both Desktop and CLI service factories reconcile before accepting work.
  Desktop wiring exposes the recovery result; TUI displays it after replaying
  the latest valid session. Fresh TUI launches stay lazy and do not open
  SQLite until a database actually exists or a task is submitted.
- Added the named `pnpm test:recovery` ABI-restorative gate. Its real SQLite
  fixture proves dead/legacy recovery, live-peer preservation, stable session
  lookup, snapshot preservation and second-pass idempotency.
- Added a real ConPTY crash test that kills the process while the patch
  approval card is open. Restart restores JSONL, marks the linked Run once,
  leaves the patch absent, reports that no write was replayed, and a second
  restart adds no duplicate recovery step.
- All recovery tests use the deterministic mock provider and isolated roots.
  `custom.txt` was not read and no network/model call occurred.

### 2026-07-29 - Unified mutation authorization

- Added one executable mutation contract for workspace writes, process
  execution, memory writes and dynamic mutators. The executor now requires an
  authorization decision for every classified mutation; per-call grants bind
  tool-call id and name and are consumed exactly once.
- Closed the concrete dynamic-tool and `write_memory` bypass: both single-agent
  and multi-agent service paths now request approval before dispatch. Read-only,
  degraded-mode and role-denied calls fail before an approval prompt.
- Kept configurable command confirmation as an explicit capability grant, while
  Docker/WSL host writeback retains its separate staged-diff approval.
- Generated a 31-entry machine-readable inventory covering built-in tools,
  sandbox writeback, plugin/MCP, multi-agent roles, CLI/TUI/Desktop, Git,
  proactive, fine-tune, plugin lifecycle and startup recovery. The default test
  gate checks generator freshness, source/evidence existence and denial/allow
  proofs for every entry.
- Non-patch approval previews omit raw arguments. `write_file` is now explicitly
  reserved-only; MCP remains default-off. Full plugin process isolation remains
  the next P0 batch.
- The first full default run hit one existing ConPTY cleanup timing failure:
  the deliberately killed approval fixture did not report exit within 10
  seconds and held its temp directory. The restorative ABI `finally` passed.
  An immediate isolated rerun passed all 5 workflows (including crash recovery
  in 14.5 seconds), and the following Storage/integration matrix passed 5 + 19
  assertions with Electron ABI restored. A second complete `pnpm test` then
  passed end-to-end in 135 seconds, including both restorative ABI matrices.
- All verification remains deterministic and offline. `custom.txt` was not read
  and no network/model call occurred.

### 2026-07-29 - Restricted plugin runner

- Removed Desktop's host-user `process.execPath` plugin path. Only Docker
  manifests execute; whitelist and WSL manifests fail closed, and the advanced
  plugin feature remains default-off.
- Added a Docker runner that mounts only a bounded staging copy plus the
  read-only plugin directory. The container uses a pinned Node image with
  implicit pulls disabled, no network, private IPC, read-only rootfs, no
  capabilities, no-new-privileges, a non-root user, and CPU/memory/PID/file/
  descriptor/temp/time limits.
- Prevented repository-root `custom.txt` and common workspace credential files
  from entering the mounted staging tree. They are moved to an unmounted
  temporary backup and restored before diffing, so neither content nor a false
  deletion reaches plugin output.
- Staged text edits return as `proposedPatch` with `applied: false`; binary
  conflicts are surfaced by path. Real workspace writeback remains a separate
  `apply_patch` call and single-use approval.
- Added unit coverage for exact confinement arguments, fail-closed Desktop
  routing, secret restoration and proposed-patch propagation. Added an explicit
  `pnpm test:plugin:restricted` gate for the real Docker boundary.
- The first named gate failed before Docker execution because Node 24 rejected
  the Windows `pnpm.cmd` spawn wrapper; the wrapper now invokes pnpm's JS entry
  with `process.execPath`. The next attempt exhausted its 30-second budget while
  first pulling the image, so image acquisition is now explicit and separate
  from `--pull=never` production execution.
- After those harness fixes, the real adversarial container passed. It could not
  read an external host file, the host secret environment, workspace
  `custom.txt`, use the external network, see the host PID, write rootfs, or
  create an oversized file. It returned a staged patch while host bytes remained
  unchanged.
- Docker Desktop was stopped before the test, started only for the explicit
  gate, and restored to its stopped state afterward. The final stop client
  exceeded its 60-second wait, but an immediate `docker desktop status`
  confirmed `stopped`. No LLM was called and `custom.txt` was neither read nor
  printed.
- `pnpm typecheck`, `pnpm build`, the 617-test unit slice, 78 Desktop-main
  assertions, renderer/preload/CLI/TUI surface slices, and the real restricted
  plugin gate passed. The loaded default sequence failed twice only in the
  existing ConPTY approval-crash cleanup: the killed PTY did not report exit
  within 10 seconds and held its temp directory. An isolated rerun passed all
  5/5 TUI E2E workflows, including that scenario in 13.2 seconds.
- `pnpm test:integration` then passed 5 Storage plus 19 integration assertions
  with environment-gated skips, and verified the Electron ABI restoration.
  The default gate remains explicitly red until the loaded ConPTY cleanup is
  fixed; isolated success is not counted as a replacement.

### 2026-07-29 - Shared secret-redaction foundation

- Replaced separate provider and dynamic-plugin regular expressions with one
  browser-safe `redactSensitiveText` contract in `@nlc/shared`. It removes
  terminal controls, exact caller-supplied secrets, authorization/API-key
  headers, bearer and common token forms, URL credentials and sensitive query
  values, private-key blocks, and Windows/macOS/Linux user-home paths, then
  applies a caller-selected hard length bound.
- Applied the contract before LLM provider errors leave the provider, before
  failed tool results or verifier feedback return to the model, and before
  error/command audit steps enter SQLite.
- Applied the same boundary to JSONL system messages and final TUI error-row
  rendering. User/assistant prose, successful tool data, source files and
  patches remain byte-for-byte untouched.
- Added synthetic regression fixtures for exact keys, bearer/header values,
  sensitive URLs, common token forms, hostile string conversion, terminal
  controls, home paths and bounds. Added boundary fixtures proving model
  feedback, SQLite rows, JSONL lines and TUI frames contain placeholders but
  not the synthetic secrets.
- Primary targeted evidence passed: 51 shared/provider/agent/verifier/session
  assertions, 9 TUI render assertions, and 6 real SQLite assertions through the
  restorative Node/Electron ABI wrapper.
- `pnpm typecheck` and the production `pnpm build` passed. After fixing a
  dynamic-audit compatibility edge at its own boundary, the unit gate passed
  all 624 assertions.
- The full default gate passed all earlier slices and 4/5 real ConPTY workflows,
  then hit the same loaded approval-crash cleanup failure: the killed PTY did
  not report exit within 10 seconds and held its temporary directory. The
  restorative ABI `finally` passed; no retry is counted as replacement
  evidence, so the default gate remains red.
- `pnpm test:integration` passed 6 Storage assertions and 19 integration
  assertions with environment-gated skips, then verified the Electron ABI was
  restored.
- This batch does not close `SEC-SECRET-001`: semantic embedding errors,
  evaluation/fine-tune persistence, Desktop IPC errors and top-level CLI stderr
  still have local/raw paths and require a second bounded tail audit. No LLM
  was called and `custom.txt` was not read.

### 2026-07-29 - Secret-redaction tail closure

- Replaced the semantic embedding provider's local key substitution with the
  shared bounded contract. Non-2xx bodies now remove active keys, bearer/query
  credentials and local user-home paths before an exception leaves the
  provider.
- Redacted evaluation `errorMessage` and fine-tune `gateReasons` at their
  SQLite store boundaries. This covers both Desktop training stderr and the
  optional LoRA trainer without changing successful artifacts or task data.
- Applied the same contract to Docker probe/launcher errors, thrown Desktop IPC
  errors, and failed direct-command stdout/stderr before renderer display.
  Successful direct-command data remains byte-for-byte untouched.
- Routed the top-level CLI catch and existing run/workspace/task error paths
  through one bounded stderr writer. Final Ink error rows continue to use the
  display boundary added in Batch 11.
- Synthetic fixtures cover semantic errors, advanced SQLite rows, Docker
  status/start results, thrown IPC envelopes, failed direct-command results and
  the shared CLI stderr path. They assert placeholders, hard bounds and absence
  of keys, bearer/query values and user names.
- `pnpm typecheck`, `pnpm build`, 624 unit assertions, 80 Desktop-main
  assertions, 4 CLI assertions and 7 restorative Storage assertions passed.
- The full default gate passed end to end, including mutation inventory,
  renderer/preload surfaces, 9 TUI render assertions, 2 real ConPTY lifecycle
  checks, all 5 real TUI workflows and final recovery. Both ABI-restorative
  stages verified Electron 33.4.11 / modules 130 after Node tests.
- `pnpm test:integration` passed 7 Storage plus 19 integration assertions with
  environment-gated skips and restored the Electron ABI. No live LLM call
  occurred and `custom.txt` was not read.

### 2026-07-29 - Historical migration backup and recovery

- Replaced the old `workspaces`-only fresh-database test with a read-only
  preflight over all user tables. Early databases containing only Run or
  snapshot tables can no longer skip the structural migration.
- Existing files that have an older schema version or a missing additive column
  now receive a unique, same-directory `VACUUM INTO` snapshot before any WAL,
  schema, column, table-rebuild or index write. Fresh/current databases create
  no backup.
- A failed post-backup initialization closes its SQLite handle and throws a
  `StorageMigrationError` carrying the retained backup path. The source file is
  left in place for diagnosis; automatic destructive restore is not attempted.
- The real v1 fixture proves original rows, new columns, schema version and
  cascade FK constraints after upgrade, while its backup retains the original
  row/column shape and passes `quick_check`. A malformed historical fixture
  proves the failed source is unlocked and the backup remains readable.
- Added `docs/storage/migration-recovery.md` with stop, preserve, verify and
  restore guidance plus the backup's sensitive-data warning.
- The restorative Storage gate passed all 10 assertions and verified Electron
  33.4.11 / modules 130 after the Node run. No LLM was called and `custom.txt`
  was not read.
- `pnpm typecheck`, `pnpm build` and the full default gate passed, including
  624 unit assertions, 80 Desktop-main assertions, renderer/preload/CLI/TUI
  surfaces, 2 real ConPTY lifecycle checks, all 5 TUI E2E workflows and the
  final 10-assertion recovery run.
- `pnpm test:integration` passed the same 10 Storage assertions plus 19
  integration assertions with environment-gated skips. Every Node-native stage
  restored and verified the Electron ABI.

### 2026-07-29 - Durable rollback recovery

- Added explicit `before_existed` and `after_existed` snapshot state. New
  apply-patch, write-file and sandbox-writeback snapshots now distinguish a
  created file from a pre-existing empty file; historical ambiguous rows
  migrate conservatively as pre-existing so rollback cannot delete them.
- Rollback now preflights every canonical workspace path and current byte
  sequence before its first mutation, collapses repeated edits to the earliest
  state, and restores through same-directory temporary files. A mid-rollback
  failure compensates already-touched paths to the bytes observed at rollback
  start instead of reporting unconditional success.
- Successful filesystem restore atomically persists Run status `cancelled` and
  exit reason `rolled_back`. Preflight failure leaves both fields unchanged and
  records an error step.
- Added a dedicated restorative recovery config. Real workspace + file-backed
  SQLite fixtures prove a pre-existing empty file remains present, repeated
  edits restore BOM/CRLF/UTF-8 bytes, deleted files return, created files
  disappear, an interrupted snapshot without `after` state restores, and the
  same behavior survives Storage/service restart.
- `pnpm typecheck`, `pnpm build`, 624 unit assertions, the 13-assertion
  restorative recovery gate, 10 Storage assertions and 19 integration
  assertions passed. Every Node-native stage restored and verified Electron
  33.4.11 / modules 130.
- The full default gate passed mutation inventory, unit, Desktop,
  renderer/preload, CLI/TUI render and both ConPTY lifecycle checks. Four of
  five TUI E2E workflows passed; the known approval-crash cleanup case again
  failed because its killed PTY did not report exit within 10 seconds and held
  its temporary directory. The test runner later released the process and the
  ABI restoration passed, but the default gate remains red and no retry is
  counted as replacement evidence.
- No live LLM call occurred and `custom.txt` was not read or printed.

### 2026-07-29 - Deterministic loaded ConPTY crash cleanup

- Replaced the harness's fire-and-forget `taskkill /T /F` with a bounded,
  awaited child lifecycle. The harness now spends up to 75% of its public
  termination budget on the Windows tree traversal, then waits the remainder
  for node-pty's exit event.
- Kept node-pty's `kill()` out of the Windows fallback. Version 1.1 starts a
  console-list helper that races an already-terminated ConPTY and emits
  `AttachConsole failed`; the awaited `taskkill` path releases the process tree
  without that orphan/noise tail.
- The real approval-crash/restart fixture passed cleanly in two targeted 5/5
  TUI E2E runs after the final ordering, and the loaded full default sequence
  then passed all slices: 624 unit, 80 Desktop-main, renderer/preload/CLI/TUI,
  both ConPTY lifecycle checks, all 5 TUI E2E workflows, and all 13 recovery
  assertions. Both native stages restored and verified Electron 33.4.11 /
  modules 130.
- `pnpm test:integration` passed 10 Storage and 19 integration assertions with
  environment-gated skips, then restored the Electron ABI. No live LLM call
  occurred and `custom.txt` was not read.

### 2026-07-29 - Explicit custom.txt live-model gate

- Replaced the ambient DeepSeek-key real-model test with one dedicated
  `pnpm test:llm:live` gate. Its Vitest config is the only place that sets the
  opt-in flag; default unit/integration discovery continues to exclude
  `*.integration.test.ts`.
- Added a bounded parser for the ignored repository-root `custom.txt`. It
  accepts exactly `CUSTOM_API_KEY`, `CUSTOM_BASE_URL` and `CUSTOM_MODEL`,
  rejects malformed/duplicate/unknown fields and unsafe URLs, and emits only
  field names/line numbers in diagnostics. Five synthetic parser assertions
  prove configured secret values are absent from failure messages.
- The live smoke uses the generic OpenAI-compatible `custom` provider in
  read-only mode with no Storage/JSONL/workspace writes. The model emitted a
  streamed `read_memory` tool call, the deterministic port returned its fixture,
  and both live assertions passed in 4.7 seconds. Configuration came only from
  `custom.txt`; no value or key was printed, committed or persisted.
- The subsequent default gate passed all slices, including 629 unit assertions,
  80 Desktop-main assertions, both ConPTY lifecycle checks, all 5 TUI E2E
  workflows and 13 recovery assertions. The real-model file was not selected,
  so this run made no live call and did not read `custom.txt`.
- `pnpm typecheck`, `pnpm build`, 10 Storage and 19 integration assertions
  passed; every Node-native stage restored the Electron ABI. Added
  `docs/testing/live-llm-smoke.md` as the operator contract.

### 2026-07-29 - Release CI and installed-artifact gates

- Replaced the blanket Storage exclusion in both workflows with named
  `pnpm test` and `pnpm test:integration` gates. PR checks now exercise
  `windows-latest` on the supported Node 22 and current Node 24 lines, then
  require a separate Windows build/package/install job.
- Added CodeQL JavaScript/TypeScript analysis, dependency-review and a
  high-severity production `pnpm audit` gate. Updated hosted actions to their
  supported 2026 major lines: checkout/setup-node/pnpm-setup v6, CodeQL v4,
  dependency review v5, artifact v7 and release v3.
- Made the CLI tarball independently installable: its compiled `dist` entry is
  now the package main, bundled private `@nlc/*` inputs are development-only,
  and `pnpm smoke:cli:artifact` packs, installs and invokes `nlc --help` from a
  temporary npm installation. The tarball contained only bin/dist/metadata/
  README and the smoke installed 93 public packages before passing.
- Added `pnpm smoke:windows:installer`. It selects the generated NSIS artifact,
  silently installs it into an isolated system-temporary directory, verifies
  the main executable and uninstaller, silently uninstalls, and proves the
  directory was removed. No application/user-data process is started.
- The first package attempt found electron-builder 26.8.1 unable to unpack
  `winCodeSign` as a standard Windows user because its archive contained
  privileged symlinks. Upgrading to stable 26.15.7 fixed that path and also
  brought its pnpm-workspace production-dependency packaging fixes. Both
  `win-unpacked/NL_Codey.exe` and fresh NSIS/ZIP artifacts then built.
- The first loaded default run also exposed two test-handshake races: the help
  catalogue was mistaken for the typed `/exit` prompt and the idle header could
  render before Ink's raw-input effect mounted. Prompt-specific/input-ready
  handshakes replaced both timing assumptions. Five consecutive ConPTY runs
  passed, followed by a green loaded default run with 629 unit, 80 Desktop,
  2 ConPTY, 5 TUI E2E and 13 recovery assertions.
- Hosted Release run
  [30400540034](https://github.com/namelessawa/nl_codey/actions/runs/30400540034)
  reached a clean `windows-latest` runner but failed during dependency install:
  Node 24 had no `better-sqlite3` 11 prebuild, and its source fallback used
  node-gyp 11, which does not recognize the runner's Visual Studio 2026
  toolchain. No build, test or publish step ran.
- Moved the supported runtime floor to Node `>=22.22.2` because Node 20 is
  end-of-life, changed the matrix to Node 22/24, targeted the CLI bundle at
  Node 22, upgraded `better-sqlite3` to 12.11.1 (published Node 24 prebuild)
  and upgraded node-gyp to 12.2.0 (Visual Studio 2026 support). A frozen local
  install rebuilt the Electron native binding successfully.
- The loaded default test initially reproduced the known approval-crash cleanup
  tail after `taskkill` itself stalled. The ConPTY harness now keeps tree kill
  as the primary path but directly terminates the PTY root when that bounded
  traversal stalls, then retries the tree cleanup. Four consecutive targeted
  5/5 runs and the subsequent full loaded gate passed with immediate temporary
  directory cleanup and Electron ABI restoration.
- Hosted Release run `30403752798` passed clean Node 24 installation,
  typecheck and the cross-platform inventory gate, then exposed that ConPTY's
  output pipe stays silent in the GitHub Windows service session. Hosted test
  run `30404457013` proved the legacy winpty backend is also silent there.
  Run `30404803761` proved the bundled ConPTY DLL plus source launcher is
  likewise silent. The repository's existing default CodeQL setup remains the
  sole scanner because GitHub rejects advanced-configuration uploads while
  default setup is enabled.
- Hosted Release run `30404803761` proved the bundled ConPTY DLL is also
  silent when the PTY child launches through the source `tsx` path. Hosted
  Release run `30405370370` therefore built the CLI first and pointed the PTY
  harness at the production `dist/index.js` entry while retaining the system
  ConPTY backend. Local production-entry verification passed 2/2 lifecycle
  and 5/5 agent/session workflows without skips or unhandled pipe errors.
- Hosted Release run `30405370370` proved the production `dist/index.js`
  launcher is also silent in the GitHub Windows service session: both
  lifecycle scenarios received zero bytes while the child stayed alive.
  Because all three node-pty backends and both launchers fail identically,
  hosted workflows now set the explicit `NLC_SKIP_NATIVE_PTY=1` capability
  flag. Native PTY assertions remain enabled by default and mandatory on
  interactive or self-hosted Windows; hosted CI retains all deterministic
  TUI render, default, integration, package and installer gates.
- Hosted Release run `30405876544` passed the complete clean Windows release
  path: frozen install, typecheck, deterministic defaults, Storage ABI and
  integration, all production builds, packed CLI install/help, NSIS/ZIP
  packaging, artifact verification, silent install/uninstall and artifact
  upload. The seven native PTY scenarios were explicitly reported as skipped
  in the non-interactive hosted session; the same commit passed 2/2 lifecycle
  and 5/5 agent/session scenarios locally with the flag unset.
- `pnpm typecheck`, `pnpm build`, workflow YAML parsing, production audit
  (zero high/critical; one low), CLI pack/install/help, unpacked Windows
  packaging, NSIS/ZIP packaging, silent install/uninstall, 10 Storage and
  19 integration assertions all passed after the native/runtime upgrades.
  The final default gate passed 629 unit, 80 Desktop, 2 ConPTY, 5 TUI E2E and
  13 recovery assertions. Native gates restored Electron ABI. No live LLM call
  occurred and `custom.txt` was not read.
- Rollback is a branch revert: the temporary CLI and Windows installations were
  removed by their smoke scripts, and the installer uninstall completed, so no
  application or user-data state remains from this batch.

### 2026-07-29 - Native TUI command confirmation

- Added an explicit offline Mock scenario that requests one whitelist-approved
  `tsc --noEmit` command and then stops; default Mock behavior is unchanged.
- The TUI approval card now labels `$ ...` previews as pending commands and
  says `y` will run them instead of presenting command execution as a patch.
- Added real ConPTY workflows for both decisions. Approval must persist a
  command step with exit output; rejection must reach `cancelled` without any
  command step. The fixture enables shell execution only in its isolated
  settings root and uses no provider key or network.
- The first probe used `pnpm test`, which stayed alive in an empty temporary
  workspace; the bounded scenario now uses the equally whitelisted
  `tsc --noEmit`. The first modal keystroke can also race the card's input
  effect, so the PTY driver retries only while the card remains unconsumed.
- `pnpm typecheck` and the complete offline `pnpm test` gate passed: 630 unit,
  80 Desktop, 10 TUI render, 2 PTY lifecycle, 7 TUI E2E and 13 recovery
  assertions. Both restorative ABI runs returned to Electron successfully.
  No live LLM call occurred and `custom.txt` was not read.
- Rollback removes the explicit Mock scenario, command-specific approval copy
  and the two PTY cases; all settings, command output and files were confined
  to disposable test roots.

### 2026-07-29 - Native TUI budget exhaustion

- Added an isolated English-locale fixture with `maxAutoSteps: 1`. The ordinary
  offline Mock reaches its first iteration boundary, then the real shared
  `BudgetController` must stop the run before any patch call.
- The ConPTY scenario requires the user-facing `max_iterations` reason,
  persisted `budget_exceeded` state and exit reason, no workspace mutation,
  and a usable prompt afterward.
- The first assertion expected the explanatory sentence on one visual line;
  ConPTY correctly wrapped it. The final predicate normalizes terminal
  whitespace while retaining the full message contract.
- `pnpm typecheck` and the complete offline `pnpm test` gate passed: 630 unit,
  80 Desktop, 10 TUI render, 2 PTY lifecycle, 8 TUI E2E and 13 recovery
  assertions. Both ABI matrices restored Electron. No live LLM call occurred
  and `custom.txt` was not read.
- Rollback removes only the isolated settings fixture and budget PTY case; it
  does not alter the production budget controller or user data.

### 2026-07-29 - Native TUI provider configuration

- Added a public-input `/provider` workflow that selects the OpenAI preset,
  replaces its endpoint with a non-routable `.invalid` fixture URL, leaves the
  API key empty and confirms the modal.
- The workflow requires `cli-providers.json` to persist OpenAI as active with
  the exact URL/model/protocol, and requires one append-only `model_change`
  event in the session JSONL. Restarting the TUI and opening the picker must
  reload the fixture URL from that store.
- The scenario submits no task and asserts that no workspace-state SQLite
  database exists, so no agent Run or provider request can occur. Ambient
  provider keys are cleared; `custom.txt` was not read.
- `pnpm typecheck` and the complete offline `pnpm test` gate passed: 630 unit,
  80 Desktop-main, 10 TUI render, 2 PTY lifecycle, all 9 TUI E2E workflows
  and 13 recovery assertions. Both restorative ABI matrices returned
  `better-sqlite3` to Electron 33.4.11 / modules 130. The only durable files
  were inside disposable provider/session test roots.
- Rollback removes the provider PTY case and its modal-enter handshake helper;
  production provider storage and picker behavior are unchanged.

### 2026-07-29 - Native TUI redacted provider error

- Added an opt-in offline Mock scenario that emits one raw provider error
  containing a synthetic `sk-...` credential, Bearer authorization header,
  sensitive query value and Windows user-home path. Default Mock behavior is
  unchanged.
- The real ConPTY workflow requires the rendered error row, SQLite `error`
  step and append-only JSONL system message to contain `[REDACTED]` and
  `[USER_HOME]`, never the credential or fixture user name. It also requires a
  persisted `failed` Run and a usable prompt afterward.
- The scenario uses no network and no real provider configuration. Ambient
  provider keys are cleared, the synthetic value exists only in the test
  process, and `custom.txt` was not read.
- The focused Mock test passed 2 assertions, the restorative PTY gate passed
  all 10 E2E workflows, and `pnpm typecheck` passed. The complete offline
  `pnpm test` gate passed 631 unit, 80 Desktop-main, 10 TUI render, 2 PTY
  lifecycle, 10 TUI E2E and 13 recovery assertions; both ABI matrices restored
  Electron 33.4.11 / modules 130.
- Rollback removes the Mock error scenario and its PTY/unit assertions; shared
  production redaction boundaries are unchanged.

### 2026-07-29 - Native TUI large output and scrollback

- Added an opt-in offline Mock scenario that returns exactly 80 numbered lines
  and stops without any tool call. Default Mock behavior is unchanged.
- The real ConPTY workflow requires the total terminal buffer to retain lines
  1 and 80 in order, the bottom viewport to show the tail but not the head, and
  more than 50 native scrollback lines. It then scrolls xterm to the top,
  requires line 1 to re-enter the viewport, restores the bottom, and proves
  `/help` remains usable.
- SQLite and append-only JSONL must each retain the complete 80-line assistant
  response, proving that display scrollback and durable conversation history
  agree. The scenario uses no network or provider key, and `custom.txt` was not
  read.
- The first loaded target gate passed the new scrollback scenario but exposed
  a provider-fixture race: `ctrl+u` could arrive before the modal input effect,
  appending the fixture URL to the preset URL. The PTY driver now retries only
  until the editable URL line is visibly cleared, then writes and confirms the
  replacement value.
- The focused Mock suite passed 3 assertions, the repaired restorative PTY
  gate passed all 11 E2E workflows, and `pnpm typecheck` passed. The complete
  offline `pnpm test` gate passed 632 unit, 80 Desktop-main, 10 TUI render,
  2 PTY lifecycle, 11 TUI E2E and 13 recovery assertions; both ABI matrices
  restored Electron 33.4.11 / modules 130.
- Rollback removes the large-output Mock branch, PTY assertion and three
  harness scroll helpers; production TUI rendering is unchanged.

### 2026-07-29 - Bounded TUI crash cleanup soak

- Added a dedicated `pnpm test:tui:crash-soak` gate so expensive repeated
  process-tree cleanup evidence stays explicit instead of lengthening every
  default developer run.
- Five serial real-ConPTY cycles each stop the process at pending patch
  approval, require the PTY root PID to disappear within the bounded
  terminator window, restart into interrupted-Run recovery without applying
  the patch, exit normally, and immediately remove the entire fixture root.
- The gate uses only the offline Mock provider with ambient keys cleared. It
  performs no network request and does not read `custom.txt`.
- The first soak invocation never submitted a task because the new fixture had
  copied a PowerShell-misdecoded prompt glyph (`鉂?`) instead of the real UTF-8
  `❯`. All five cases timed out before process termination; the ABI wrapper
  still restored Electron. The fixture now uses the same UTF-8 prompt
  handshake as the core E2E suite.
- The corrected named soak passed all 5 cycles in 48.4 seconds (each cycle
  9.4-10.3 seconds), and `pnpm typecheck` passed. The complete offline
  `pnpm test` gate remained green with 632 unit, 80 Desktop-main, 10 TUI
  render, 2 PTY lifecycle, 11 TUI E2E and 13 recovery assertions; all native
  matrices restored Electron 33.4.11 / modules 130.
- Rollback removes the named config/script/test and its evidence row; the
  production TUI and process-tree terminator are unchanged.

### 2026-07-29 - Headless deterministic and recorded-response benchmark

- Replaced the Phase-2-only eval claim with a frozen Goal-v2 matrix covering
  all 13 required Headless fixture categories. Recorded turns stream through
  the production provider contract and shared tool loop; `apply_patch` still
  needs a matching single-use approval before the real tool executor writes.
- Code fixtures cover TypeScript/Python fixes, cross-file features, public API
  refactors, dependency upgrades and generated tests. Verification repair
  feeds a failed verifier result into a second recorded patch. Refusal,
  rejection, budget and cancellation cases assert terminal state plus an
  unchanged workspace.
- Crash recovery closes and reopens a real SQLite store, reconciles a dead
  owner once and proves the recorded pending diff is never replayed. The Git
  fixture creates a disposable local branch and commit from deterministic or
  recorded commit metadata and builds a PR description without pushing or
  contacting a remote.
- Added the formal restorative `pnpm test:eval` gate and excluded its native
  fixture from the ordinary unit discovery path. The gate passed 17/17,
  including scorecard freshness, then restored and re-verified Electron
  33.4.11 / modules 130.
- Published `docs/testing/agent-benchmark-scorecard.md`: deterministic and
  recorded-response rates are 13/13 (100%), unsafe refusal is 1/1, regression
  is 0%, and the existing eight TUI workflow classes are mapped to named
  render/ConPTY gates. The approved live-model rate is explicitly `Not
  measured`; the earlier single read-only smoke is not counted as benchmark
  success.
- The batch was entirely offline: no provider/network call occurred and
  `custom.txt` was not read. Rollback removes the benchmark provider/scorer,
  fixture gate, scorecard and root test entry; disposable SQLite/Git roots are
  deleted by the tests.

### 2026-07-29 - Approved live-model benchmark

- Added the explicit `pnpm test:eval:live` gate. It is absent from default,
  integration, release and CI commands and loads provider, endpoint, model and
  key only from the ignored repository-root `custom.txt`.
- Ran all 13 frozen Headless categories serially against the configured custom
  provider. Code changes were approval-gated and confined to disposable
  workspaces; crash recovery used a disposable SQLite database; Git branch,
  commit and PR-description generation used a temporary local repository with
  no remote.
- The first complete run passed 12/13 (92.31%), exceeding the required >=80%.
  `feature-cross-file` ended with the controlled `terminal_state_failed` code.
  The failure remains in the published denominator; it was not selectively
  retried or replaced.
- Dangerous-request refusal, verification repair, patch-rejection recovery,
  budget exhaustion, cancel/resume, crash recovery and Git workflow all
  passed. Console output contained only category names, booleans and controlled
  reason codes; no raw assistant text, tool arguments, provider error body,
  endpoint/model value or API key was printed or persisted.
- The gate passed its threshold assertion in 155 seconds and the restorative
  wrapper verified Electron 33.4.11 / modules 130 before and after the Node ABI
  run. Rollback removes only the opt-in test/config/script entry and reopens
  `EVAL-001`; it cannot revoke the external model usage already incurred.

### 2026-07-29 - Unicode TUI prompt editor

- Replaced tail-only prompt mutation with a pure Unicode code-point state
  machine covering Left/Right, Home/End, Backspace, forward Delete, Ctrl+W,
  Ctrl+U, history/draft recall, duplicate-submit prevention and a 16,384-point
  input bound. Multiline/tab content renders as visible single-line markers.
- Added bounded raw Windows/ANSI decoding because Ink 5 does not expose
  Home/End in its Key object. Split bracketed paste and coalesced ConPTY key
  sequences are decoded without echoing unknown control sequences.
- Prompt input now remains mounted behind modal routes while its raw listener
  is inactive. Ink tests prove modal and running-state input does not leak and
  the original draft returns afterward. Idle Ctrl+C clears a non-empty draft,
  exits when empty, and the global handler still cancels an active run.
- The first native journey exposed coalesced Home/End/Left/Delete data; the
  decoder was changed to tokenise a chunk in order. Subsequent attempts exposed
  a callback-driven subscription gap, so callbacks moved behind stable refs.
  The final public workflow passed without a model or workspace mutation.
- Focused evidence passed: 13 TUI unit assertions, 15 Ink render assertions and
  3 real ConPTY lifecycle/prompt assertions. `pnpm docs:tui-actions` now emits
  23 keyboard/input actions with complete evidence for every Prompt row; only
  provider-editor controls and skill-picker Escape/Q remain `None`.
- The complete default offline gate passed 632 unit, 17 recorded-eval,
  80 Desktop-main, renderer/preload/CLI, 13 TUI unit, 15 render, 3 lifecycle,
  11 E2E and 13 recovery assertions in 193 seconds. Every native matrix
  restored and re-verified Electron 33.4.11 / modules 130; root typecheck and
  production build also passed.
- This batch was entirely offline and did not read `custom.txt`. Rollback
  restores the previous tail-only editor and removes the new prompt-specific
  unit/ConPTY evidence; it does not affect persisted sessions or workspaces.

### 2026-07-29 - Complete TUI input inventory

- Added Ink interaction evidence for provider-field Backspace, Delete, Ctrl+W
  and Ctrl+U, validating the final submitted draft rather than only checking
  intermediate glyphs. Skill install cancellation now covers Escape, Q and the
  busy-state ownership guard.
- The first provider assertion reproduced a real dropped Ctrl+U after entering
  the URL field. Both provider and skill pickers now register one stable Ink
  input callback and route it through a current ref, eliminating render-time
  unsubscribe/resubscribe gaps.
- `pnpm docs:tui-actions` now reports 19 commands, 23 keyboard/input actions,
  3 modal routes and zero keyboard rows without test identifiers. Generated
  inventory completion closes `TUI-INV-001`; terminal-size, session invalid
  input, read-only-analysis and mouse-disposition work remain separate.
- Focused verification passed 17/17 Ink render assertions and CLI typecheck.
  No LLM/provider request was made and `custom.txt` was not read.
- The complete default offline gate passed 632 unit, 17 recorded-eval,
  80 Desktop-main, renderer/preload/CLI, 13 TUI unit, 17 render, 3 lifecycle,
  11 E2E and 13 recovery assertions in 206 seconds. Electron ABI restoration,
  root typecheck and production build all passed.
- Rollback removes the two interaction cases and restores inline modal input
  handlers; no provider configuration or generated skill is written by tests.

### 2026-07-29 - Complete TUI terminal-size matrix

- Added one pure terminal-layout contract with a supported full-frame minimum
  of 60x20. The documented 120x40, 100x30, 80x24 and 60x20 sizes retain the
  normal frame; either dimension below the boundary renders compact status and
  resize guidance.
- Kept Prompt and blocking modal routes outside the conditional frame, so
  resizing cannot remount the editor or transfer approval/configuration input
  ownership. The normal frame returns immediately after the terminal grows.
- Ink render evidence now covers the full matrix, 59x20 and 60x19 fallbacks,
  and recovery at exactly 60x20. Native ConPTY covers 59x19 warning, recovery
  at 120x40, and a live `helpX` draft across 50x16 to 60x20.
- Focused verification passed 19/19 Ink render assertions, 3/3 real ConPTY
  lifecycle/prompt assertions, CLI typecheck and the generated action
  inventory. The inventory now has 24 input rows and zero missing test IDs.
- The complete default offline gate passed 632 unit, 17 recorded-eval,
  80 Desktop-main, renderer/preload/CLI, 13 TUI unit, 19 render, 3 lifecycle,
  11 E2E and 13 recovery assertions in 206 seconds. Every native matrix
  restored and re-verified Electron 33.4.11 / modules 130; root typecheck also
  passed, followed by a green production build.
- This batch is entirely offline and does not read `custom.txt`. Rollback
  restores width-only layout behavior and removes the compact fallback; it
  does not alter workspaces, sessions or provider settings.

### 2026-07-29 - Prove native read-only analysis

- Re-read Goal Scenario 2 from the source DOCX and implemented its exact five
  steps: enable read-only, read and search, forge a write tool, show the refusal
  in TUI, and prove the workspace is unchanged.
- Added a deterministic Mock path that uses `read_file` and `search_text`, then
  emits `apply_patch` even though read-only schema generation did not advertise
  it. The real dispatcher refuses the call before approval or snapshot/write.
- TUI startup now renders a `read-only` indicator in normal and minimum-size
  chrome. The native test asserts the full refusal text, final assistant
  summary, persisted read/search/forged-call/error steps, no diff/command step,
  no violation file and an identical recursive workspace snapshot.
- Focused verification passed 4/4 Mock scenario tests, 19/19 Ink render
  assertions, CLI typecheck and 12/12 native TUI E2E assertions in 93 seconds.
  The ABI wrapper restored and re-verified Electron 33.4.11 / modules 130.
- The first full-gate attempt exposed a test-only mismatch: the TUI correctly
  rendered the refusal inside a JSON error row as `\"apply_patch\"`, while the
  new predicate searched for unescaped quotes. The assertion now normalizes
  JSON quote escapes before matching; product output and workspace state were
  already correct in the captured failure frame.
- The corrected complete default offline gate passed 633 unit, 17
  recorded-eval, 80 Desktop-main, renderer/preload/CLI, 13 TUI unit, 19
  render, 3 lifecycle, 12 E2E and 13 recovery assertions in 196 seconds.
  Every native matrix restored and re-verified Electron 33.4.11 / modules 130;
  root typecheck and production build passed.
- A final long-path render fixture initially put its expected `projects`
  segment outside the deliberate 24-column read-only suffix. Reordering only
  the synthetic path kept that semantic suffix visible and proved the new gap
  between workspace text and the read-only indicator.
- This batch is entirely offline and does not read `custom.txt`. Rollback
  removes the hostile Mock fixture/E2E and the visual indicator; read-only
  dispatcher enforcement itself remains unchanged.

### 2026-07-29 - Bound long Tool Output and native scrollback

- Replaced the small 80-line display fixture with a controlled public
  `read_file` of a 10 KB file followed by 320 numbered assistant rows. The
  default Mock behavior remains unchanged.
- The native ConPTY workflow proves row ordering, more than 250 retained
  scrollback lines, navigation back to row 1, restoration to row 320 and a
  usable `/help` prompt after completion.
- SQLite must retain no more than 4,000 characters of the Tool Output, include
  the production `…(truncated)` marker and omit the fixture tail. SQLite and
  append-only JSONL must both retain all 320 assistant rows.
- Pure reducer evidence separately proves that live stream state keeps only
  the newest 500 items and trace state only the newest 200, without mutating
  prior arrays.
- Focused verification passed 5/5 Mock scenario tests, 15/15 TUI unit
  assertions and 12/12 native TUI E2E assertions in 77 seconds. The ABI wrapper
  restored and re-verified Electron 33.4.11 / modules 130.
- The first complete gate exposed an existing observer race after provider
  restart: the restored modal advanced correctly, but its field could sit
  outside the current 30-line viewport, so the helper sent duplicate Enter
  keys and eventually saved. Modal transitions are now observed in xterm's
  retained buffer; the product flow and provider assertions are unchanged.
- After a focused 12/12 E2E rerun, the corrected complete default offline gate
  passed 634 unit, 17 recorded-eval, 80 Desktop-main, renderer/preload/CLI,
  15 TUI unit, 19 render, 3 lifecycle, 12 E2E and 13 recovery assertions in
  193 seconds. Every native matrix restored and re-verified Electron 33.4.11 /
  modules 130.
- This batch is entirely offline and does not read `custom.txt`. Rollback
  restores the former 80-line fixture and removes the pure boundary tests; it
  does not change production persistence caps or default provider behavior.

### 2026-07-29 - Prove dynamic-tool construction failure redaction

- Added an explicit optional dynamic-tool factory to CLI service composition
  and an optional service factory to the Ink composition. Both are absent from
  the normal `nlc` entry, so default behavior and provider resolution are
  unchanged.
- A dedicated PTY fixture supplies a factory that throws a multiline error with
  a forged Bearer token and the current user-home path. No environment switch,
  plugin copy or raw-error display path was added.
- The native workflow requires one single-line `[security]` SQLite error step,
  `[REDACTED]` and `[USER_HOME]` in the TUI/SQLite/JSONL, absence of both raw
  values everywhere, a degraded `done` Run and a usable `/help` prompt.
- The first focused E2E run proved token redaction and graceful completion but
  showed the deliberately verbose fixture placed `[USER_HOME]` past the
  100-column row. The fixture now retains the same raw values in the shortest
  two-line error, allowing both placeholders to be observed in one safe line.
- The second run reached persistence assertions and exposed only an incorrect
  test expectation (`model_finished`); the actual persisted normal exit reason
  is `done`. After aligning to the real enum, the complete 12/12 E2E gate passed
  in 75 seconds and restored Electron 33.4.11 / modules 130.
- Focused CLI typecheck and 19/19 Ink render assertions pass. This batch is
  entirely offline and does not read `custom.txt`. Rollback removes only the
  composition seam, fixture and exact E2E evidence.
- The complete default offline gate passed 634 unit, 17 recorded-eval,
  80 Desktop-main, renderer/preload/CLI, 15 TUI unit, 19 render, 3 lifecycle,
  12 E2E and 13 recovery assertions in 190 seconds. Every native matrix
  restored and re-verified Electron 33.4.11 / modules 130.

### 2026-07-29 - Prove corrected provider use on a new Run

- Replaced the persistence-only provider case with the exact Scenario 9 flow.
  Public `/provider` input saves an OpenAI preset with a synthetic key and an
  invalid loopback URL; its first task reaches a real non-retryable HTTP 400
  and persists a `failed` Run.
- Restarting the TUI reloads the invalid provider. The modal changes only the
  endpoint, preserves the stored masked key, saves a second `model_change`, and
  submits a new task that consumes a deterministic OpenAI-compatible SSE
  response and persists `done`.
- The local stub captures `/v1/chat/completions`, the expected Bearer header,
  `gpt-4o` and `stream: true`. The full synthetic key never appears in the
  terminal, and `/help` proves prompt ownership returns after both outcomes.
- The first focused typecheck found a missing test-object brace at line 733;
  correcting that syntax left production code unchanged. CLI typecheck and the
  complete 12/12 native TUI E2E gate then passed in 91 seconds, with Electron
  ABI restored and re-verified.
- The complete default offline gate passed 634 unit, 17 recorded-eval,
  80 Desktop-main, renderer/preload/CLI, 15 TUI unit, 19 render, 3 lifecycle,
  12 E2E and 13 recovery assertions in 199 seconds. Every native matrix
  restored and re-verified Electron 33.4.11 / modules 130; root typecheck and
  production build passed.
- This batch is offline: the server binds only to `127.0.0.1`, no live model or
  external network is used, and `custom.txt` is not read. Rollback restores the
  earlier persistence-only test and reopens exact Scenario 9.

### 2026-07-29 - Make the TUI mouse boundary explicit

- Re-read Goal v2 sections 8-12 from the source DOCX. The source permits an
  explicit Experimental classification when stable application mouse support
  is unavailable, and requires state, keyboard, mouse and manual-verification
  evidence files in addition to the generated action inventory and PTY report.
- `/help` now says that mouse behavior is Experimental: terminal-native wheel
  scrollback only, with clicks and input capture unsupported. The command
  registry unit gate and a real ConPTY help journey require the exact product
  notice.
- The PTY harness detects known X10/VT200/button-event/any-event/UTF-8/SGR/urxvt
  mouse tracking enable sequences across data-chunk boundaries. Normal startup,
  help and exit must complete without ever enabling one.
- Added honest UI-state, keyboard, mouse and release-candidate manual ledgers.
  They record verified paths and retain open PageUp/PageDown, malformed-session,
  Unicode-font/cmd and human release-check gaps rather than converting missing
  capabilities into passes.
- Focused gates passed: CLI typecheck, 15/15 TUI unit, 19/19 Ink render, 3/3
  native ConPTY lifecycle and 12/12 native TUI E2E. The generated inventory
  remained 19 commands, 24 keyboard actions and 3 modals.
- The complete default offline gate passed 634 unit, 17 recorded-eval,
  80 Desktop-main, renderer/preload/CLI, 15 TUI unit, 19 render, 3 lifecycle,
  12 E2E and 13 recovery assertions in 198 seconds. Every native matrix
  restored and re-verified Electron 33.4.11 / modules 130; root typecheck and
  production build passed.
- This batch requires no LLM call and does not read `custom.txt`. Rollback
  removes the help disclosure, mouse-mode observer and four acceptance ledgers,
  reopening `TUI-MOUSE-001`.

### 2026-07-29 - Recover visibly from corrupt or partial Session JSONL

- Session reads now distinguish malformed JSON from valid forward-compatible
  records and return one-based, content-free diagnostics. Project diagnostics
  also report unreadable/missing-header files without raw payloads or absolute
  paths.
- Resume isolates an unterminated crash tail with one newline before opening
  the append writer. The fragment remains available for forensics, but every
  later message starts on a fresh JSONL record and remains readable.
- Startup replay adds a Session warning after recovered messages. `/sessions`
  reports at most 20 redacted file diagnostics and summarizes any remainder;
  an invalid file no longer disappears silently when no valid session exists.
- The native Session workflow creates and branches through public TUI input,
  exits, injects a truncated child tail and invalid-header sibling, then
  restarts. It requires restored history, two safe issue classes, absence of
  both raw fixture payloads, a successful later task/rejection, one retained
  diagnostic and a parseable final JSON record.
- Focused Session and CLI typechecks passed, as did 13/13 SessionStore tests
  and the complete 12/12 native TUI E2E gate in 104 seconds. Electron ABI was
  restored and re-verified.
- The complete default offline gate passed 635 unit, 17 recorded-eval,
  80 Desktop-main, renderer/preload/CLI, 15 TUI unit, 19 render, 3 lifecycle,
  12 E2E and 13 recovery assertions in 191 seconds. Every native matrix
  restored and re-verified Electron 33.4.11 / modules 130; root typecheck and
  production build passed.
- This batch makes no LLM call and does not read `custom.txt`. Rollback removes
  diagnostics and tail isolation, returning to silent malformed-line skipping.

### 2026-07-29 - Validate the PageUp/PageDown prompt contract

- The raw terminal decoder now recognizes standard PageUp (`CSI 5 ~`) and
  PageDown (`CSI 6 ~`) sequences, including coalesced and split input. The
  Prompt handles them as explicit safe reserved no-ops: the draft is preserved
  and scrollback remains terminal-owned.
- Unit, Ink-render and real Windows ConPTY gates require the contract. The
  native journey sends both page keys into a live draft, appends another
  character to prove ordered input processing, clears the prompt and exits
  cleanly.
- The generated inventory now reports 19 commands, 25 keyboard/input actions,
  3 modals and zero input rows without test identifiers. The keyboard matrix
  records automated evidence for all 15 required key groups without claiming
  an application-owned scrollback viewport.
- Focused gates passed: CLI typecheck, 16/16 TUI unit, 20/20 Ink render and 4/4
  native ConPTY lifecycle tests. Root typecheck and production build also
  passed.
- The complete default offline gate passed 635 unit, 17 recorded-eval,
  80 Desktop-main, renderer/preload/CLI, 16 TUI unit, 20 render, 4 lifecycle,
  12 E2E and 13 recovery assertions in 204 seconds. Every restorative matrix
  restored and re-verified Electron 33.4.11 / modules 130.
- Main-target PR #66 now passes Node 22, Node 24, Windows package/installed CLI
  and all CodeQL jobs. Dependency review still fails before audit because the
  repository has Dependency graph disabled; enabling that repository setting
  remains subject to explicit user approval.
- This batch makes no LLM call and does not read `custom.txt`. Rollback removes
  the two explicit page intents and their evidence, returning them to generic
  ignored escape sequences.

### 2026-07-29 - Surface Session write faults and contain session paths

- Session writes are no longer silently best-effort. A failed user/event/state
  append produces one content-free TUI warning, abandons that writer and
  disables further JSONL writes for the turn. Agent work continues, but the
  Run is deliberately created without `sessionId`/`sessionFilePath`; the next
  submission or post-terminal local state event may open a fresh session.
- `SessionWriter` advances its parent pointer only after a successful append.
  Branch/resume writer swaps are transactional, so a rejected target does not
  close the prior active session.
- TUI `/resume` and noninteractive `nlc sessions show <file>` now accept only a
  direct `.json` child of the current project's encoded session folder. Both
  lexical and `realpath` containment are checked, then the Session header must
  match the workspace. List/tree filter lossy folder-encoding collisions and
  expose only a content-free `workspace_mismatch` diagnostic.
- SessionStore now passes 16/16 tests covering external/nested rejection,
  encoded-folder collisions, write-failure parent-chain consistency and the
  prior append/recovery behavior.
- The native Session scenario rejects an outside absolute resume without
  reading its private payload. It then replaces the active Session file with a
  directory, observes `EISDIR`, continues through real Agent approval/rejection,
  proves prompt recovery, restores the forensic file, verifies the failed user
  text was not persisted, confirms the Run has null Session linkage, then
  records `/theme ocean` in a fresh valid Session.
- Two initial E2E attempts reached the expected warning and approval but their
  assertion compared visually wrapped text as a contiguous string. Folding
  terminal whitespace fixed the test-only issue; both failure paths restored
  and re-verified Electron ABI. The final complete 12/12 native E2E gate passed.
- The complete default offline gate passed 638 unit, 17 recorded-eval,
  80 Desktop-main, renderer/preload/CLI, 16 TUI unit, 20 render, 4 lifecycle,
  12 E2E and 13 recovery assertions in 240 seconds. Root typecheck and
  production build passed; every restorative matrix re-verified Electron
  33.4.11 / modules 130.
- This batch makes no LLM call and does not read `custom.txt`. Rollback restores
  silent best-effort writes and unrestricted file-path resume/show behavior.

### 2026-07-29 - Close Session lineage and invalid-target breadth

- A dedicated native ConPTY journey now creates root → child → grandchild
  ancestry through public `/branch` commands, then explicitly branches from the
  active grandchild back to the root to create a sibling.
- Unknown `/resume`, unknown parent-session and unknown message targets are
  exercised through the real TUI. All three fail visibly, create no Session
  file and preserve the sibling as active; a later task appends there.
- On-disk assertions require both header ancestry and first-message `parentId`
  at every branch level. A new process restores the latest sibling and renders
  all four branches without rerunning tools.
- The first E2E attempt reached the correct unknown-message error but compared a
  visually wrapped session id as contiguous text. Whitespace normalization
  fixed that test-only assertion; the final 13/13 native gate passed in 99
  seconds and the restorative ABI wrapper re-verified Electron 33.4.11 /
  modules 130.
- The effective `nlc` package typecheck passed. This batch makes no LLM call and
  does not read `custom.txt`; rollback removes only the additional lineage
  acceptance journey and reopens `TUI-SESSION-001`.
- The complete default offline gate passed 638 unit, 17 recorded-eval,
  80 Desktop-main, renderer/preload/CLI, 16 TUI unit, 20 render, 4 lifecycle,
  13 E2E and 13 recovery assertions in 213 seconds. Every restorative matrix
  restored and re-verified Electron 33.4.11 / modules 130.
- Root typecheck and the production Desktop/CLI build passed.

### 2026-07-29 - Enforce the shared Run FSM and failure taxonomy

- Shared now owns the complete Run-state catalogue, explicit legal transition
  table, terminal-state predicate and stable failure codes. Same-state writes
  remain idempotent; terminal Runs may re-enter `tool_use` only for an explicit
  continuation, while rollback may move supported states to `cancelled`.
- Storage validates each transition inside the same SQLite transaction as the
  update. A missing Run and an invalid edge raise typed lifecycle errors; an
  invalid edge leaves the persisted status unchanged. Startup reconciliation
  uses the same terminal predicate and transition assertion.
- AgentService classifies provider configuration/request, model protocol,
  policy, tool, verification, storage and internal failures. It persists the
  stable code in `exit_reason` and prefixes the separately redacted audit step;
  provider resolution, loop exceptions, initial-context failures and
  multi-agent exits use the same path.
- TUI status now renders the shared form such as
  `failed [provider_request]`. Desktop failure banners use the same shared code
  extraction, while historical free-form failed Runs safely render as
  `internal_failure`.
- The native provider journey proves an HTTP 400 becomes
  `provider_request` in the terminal, SQLite exit reason and error step, then
  corrects the provider and completes a new Run. Two intermediate E2E attempts
  reached the correct state but exposed width-dependent whitespace in the
  test predicate; the final assertion checks independent visual evidence
  fragments and 13/13 scenarios pass.
- The complete default offline gate passed 643 unit, 17 recorded-eval,
  80 Desktop-main, renderer/preload/CLI, 16 TUI unit, 20 render, 4 lifecycle,
  13 E2E and 14 recovery assertions in 239 seconds. Root typecheck and the
  production Desktop/CLI build passed; every restorative matrix re-verified
  Electron 33.4.11 / modules 130.
- This batch makes no LLM call and does not read `custom.txt`. Rollback removes
  the shared transition/error contract and returns Storage to unchecked status
  overwrites and UI surfaces to raw failure strings.

### 2026-07-29 - Trace semantic context provenance and index freshness

- Every built-in semantic result now carries a shared provenance record:
  source, stable chunk id, rank, indexed/current source times, freshness,
  selection reason, truncation state and original character count. Ranking is
  assigned after filtering so the reported reason matches the delivered hit.
- Semantic-index status now compares indexed records with the current project
  scan and reports fresh, modified and missing files plus the last freshness
  check. Search results remain available when stale, but are explicitly
  labelled instead of being presented as current.
- Current mtimes are resolved only through the Desktop Host boundary. Lexical
  and physical workspace containment reject `..`, missing targets and
  junction/symbolic-link escapes before host metadata reaches intelligence
  code.
- Desktop search exposes source, selection reason, freshness and snippet
  truncation. The built-in Agent semantic-search tool receives the same
  provenance; optional fields preserve compatibility with third-party ports.
- Focused semantic/port tests passed 22/22, including exact provenance,
  truncation, modified/missing status and freshness annotation. Desktop-main
  tests cover a valid file plus lexical, missing and physical-link escapes.
- The complete default offline gate passed 645 unit, 17 recorded-eval,
  81 Desktop-main, renderer/preload/CLI, 16 TUI unit, 20 render, 4 lifecycle,
  13 E2E and 14 recovery assertions in 278 seconds. Root typecheck and the
  production Desktop/CLI build passed; every restorative matrix re-verified
  Electron 33.4.11 / modules 130.
- This batch makes no LLM call and does not read `custom.txt`. Rollback removes
  the provenance/freshness surface and restores unlabelled semantic hits;
  `CTX-001` remains open for impact graphs and TUI-specific presentation.

### 2026-07-29 - Analyze modification impact and expand TUI trace detail

- The new read-only `analyze_impact` tool performs a fresh, workspace-contained
  TS/JS scan around a requested module. It returns declaration, direct relative
  import/importer, conventional-test and lexical-call edges plus a sorted list
  of impacted modules and a content-free selection reason.
- Exact and heuristic edges are distinguished. The result states that bare
  packages, tsconfig aliases, re-exports, runtime dispatch and identifier
  shadowing are unresolved rather than presenting lexical calls as a compiler
  graph.
- File count, file bytes, symbol count, call targets, collected edges and
  returned edges all have hard caps. Any scan, symbol or graph cap sets the
  shared `truncated` flag; path resolution continues through the existing
  workspace containment boundary.
- The core read-only tool registry exposes the same contract to Agent runs.
  Focused impact/dispatch tests cover `.js` specifier resolution to TypeScript,
  declarations, importers, tests, callers, impacted modules, path escape
  rejection, selection reason and edge-budget truncation.
- TUI now provides local `/trace [n]`, where 1 is the newest tool result. It
  expands the paired request and bounded result into terminal scrollback,
  identifies recorded tool trace as the context source, reports TUI-level
  truncation and applies secret redaction before display.
- The generated inventory records 20 commands, 25 keyboard actions and 3
  modals. Parser/input/render tests cover completion, submission, one-based
  selection, invalid positions, semantic provenance visibility, redaction and
  the 12,000-character display cap.
- An initial complete run exposed a 5-second registry-test timeout because its
  fixture scanned the entire repository under loaded concurrency; limiting the
  fixture workspace retained real dispatch coverage and the 648/648 unit
  matrix passed. A second run exposed the expected command-order assertion
  after `/trace` was inserted; the real input assertion now verifies `/trace`.
- The final complete default offline gate passed 648 unit, 17 recorded-eval,
  81 Desktop-main, renderer/preload/CLI, 16 TUI unit, 21 render, 4 lifecycle,
  13 E2E and 14 recovery assertions in 340 seconds. Root typecheck passed and
  every restorative matrix re-verified Electron 33.4.11 / modules 130.
- This batch makes no LLM call and does not read `custom.txt`. Rollback removes
  `analyze_impact`, `/trace` and their generated inventory row; `CTX-001`
  remains open for stale-chunk eviction, incremental refresh and explicit
  retrieval token-budget enforcement.

### 2026-07-29 - Refresh semantic context incrementally within explicit budgets

- Desktop semantic rebuilds now call the existing incremental indexer instead
  of unconditionally embedding every scanned file. The production path skips
  unchanged mtimes, replaces changed chunks and evicts chunks for files no
  longer present; blank files are consistently excluded from rebuild and
  freshness scans so they cannot remain perpetually stale.
- Semantic retrieval accepts an explicit shared context budget with a
  512-token default and 8,192-token hard maximum. A conservative estimator
  counts four ASCII characters or one non-ASCII character per token, and the
  ranked snippet set is clipped before it crosses the normalized budget.
- Every built-in hit records its own estimate plus the complete set's budget,
  usage, limitation state, omitted-hit count and estimator. Its content-free
  selection reason distinguishes similarity rank from budget limitation.
- Agent Core exposes `maxContextTokens` in the `semantic_search` schema, passes
  it through the typed port and returns a separate budget summary. `topK` is
  also normalized at the vector boundary with a hard maximum of 50.
- Focused semantic, port, dispatcher and Desktop IPC tests passed 32/32. They
  cover mixed-language clipping, omitted lower-ranked hits, option propagation,
  explicit audit output, the production incremental call and blank-file
  exclusion. Root typecheck passed across all 23 selected workspace projects.
- The complete offline gate passed 650 unit, 17 recorded-eval, 82 Desktop-main,
  renderer/preload/CLI, 16 TUI unit, 21 render, 4 lifecycle, 13 E2E and 14
  recovery assertions in 257 seconds. The production Desktop/CLI build passed,
  and restorative matrices re-verified Electron 33.4.11 / modules 130.
- This batch makes no LLM call and does not read `custom.txt`. Rollback restores
  full semantic rebuilds and removes retrieval-budget fields/enforcement.
  Together with Batches 39-40, it closes `CTX-001`; production embedding
  compatibility evidence remains a separate feature-reality gap.

### 2026-07-29 - Split browser-safe shared exports and smoke packaged startup

- The shared package now has one browser-safe barrel and a conditional browser
  export. Its Node root composes that surface with `nlcRoot`/`nlcSubdir`, so
  Desktop main, CLI and Agent Core retain their filesystem helpers while the
  renderer dependency graph cannot resolve `node:os` or `node:path`.
- The sandboxed preload imports the explicit `@nlc/shared/browser` subpath and
  is emitted as CJS `index.cjs`; the main process loads that exact artifact.
  Renderer and preload source smokes remain green, while the boundary unit test
  proves Node helpers are absent from browser exports and present from Node.
- Desktop production builds now transform 110 renderer modules without the
  previous browser-external warnings. Main and preload still build separately,
  with `contextIsolation`, Chromium sandboxing and `nodeIntegration: false`
  unchanged.
- A new Windows packaged-runtime smoke launches `release/win-unpacked` with an
  isolated `NLC_HOME`. Its hidden window uses the real main, preload and
  renderer bundles, then requires a mounted React root, exposed `agentApi`, and
  absent renderer `require`/`process` globals before returning success.
- The first packaged probe correctly failed because neither `agentApi` nor the
  React root existed. A bounded/redacted Electron `preload-error` revealed
  `module not found: node:os`; changing only the output extension was
  insufficient. Routing preload through the browser subpath fixed the root
  cause, and the rebuilt `win-unpacked` smoke passed in 5.1 seconds.
- PR and release workflows run the packaged-runtime smoke after electron-builder
  and before silent installer verification. Failure handling retains only the
  already redacted `[desktop-smoke]` diagnostic, capped at 2,000 characters.
- Root typecheck, renderer/preload smokes, production build and electron-builder
  directory packaging passed. The complete offline gate passed 652 unit, 17
  recorded-eval, 82 Desktop-main, renderer/preload/CLI, 16 TUI unit, 21 render,
  4 lifecycle, 13 E2E and 14 recovery assertions in 291 seconds; restorative
  matrices re-verified Electron 33.4.11 / modules 130.
- This batch makes no LLM call and does not read `custom.txt`. Rollback removes
  the conditional browser surface, packaged smoke and CJS preload contract,
  restoring the previously warned and package-broken boundary.

## Current blockers

1. `CI-MAIN-001` now has green main-target Node 22/24, Windows
   package/installed CLI and CodeQL evidence. Dependency review fails because
   the repository Dependency graph is disabled, and the combined job stops
   before `pnpm audit`; enabling that repository-level setting requires
   explicit user approval.
2. All exact Goal v2 TUI scenarios pass; mouse disposition and corrupt/partial
   Session recovery are explicit, and all 15 required key groups have automated
   evidence. Session write-failure/path containment and multilevel/cross-parent/
   invalid-target lineage now pass; remaining UI-state cells and
   release-candidate manual verification remain.
3. The broader production goal still requires project-indexer coverage, a VS
   Code adapter, production embedding compatibility evidence and the
   feature/experimental disposition work listed in
   `docs/execution/master-backlog.md`.
