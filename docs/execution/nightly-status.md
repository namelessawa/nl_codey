# Nightly execution status

Goal: `NLC-PRODUCTION-COMPLETE`

Overall state: **ACTIVE - DEFAULT AND INTEGRATION GREEN; P0 WORK REMAINS**

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

## Current blockers

1. Remaining TUI command-approval, budget, provider, crash-tail, redaction and
   large-output scenarios still lack full ConPTY coverage.
2. Historical migration coverage still needs more fixtures plus
   backup-before-upgrade/failure-recovery behavior.
3. Rollback still needs many-change, partial-change and restart evidence before
   its P0 data-integrity item can close.
