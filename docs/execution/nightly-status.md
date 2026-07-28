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
| 5 | `codex/p1-tui-core-workflows` | Core approval/reject/stop/session/recovery scenarios | Pending | Depends on PTY harness |
| 6 | `codex/p0-storage-abi-gate` | Node/Electron ABI + migration gates | Ready for draft review | Node migration/lifecycle 4/4; Electron load before/after restore passed |
| 7 | `codex/p0-sandbox-abort-stability` | Windows abort/process-tree stability | Pending soak | Latest isolated integration run passed at 1171 ms; prior loaded runs exceeded 3 s |
| 8 | `codex/p0-run-session-recovery` | Startup reconciliation and Run/Session linkage | Pending | No current E2E contract |
| 9 | `codex/p0-unified-approval` | Mutation inventory and common approval enforcement | Pending | Whole graph not yet proved |
| 10 | `codex/p0-plugin-runner-spike` | Restricted plugin runner RFC/spike | Pending | Must follow preceding P0 gates |

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

## Current blockers

1. Windows child-process abort has historical loaded-run failures above its
   documented 1500 ms bound and needs a repeatable soak.
2. Remaining TUI editing keys and end-to-end mutation/session workflows still
   lack committed coverage.
3. Run/Session crash reconciliation and a unified mutation approval boundary
   are not yet proved.
4. Historical migration coverage still needs more fixtures plus
   backup-before-upgrade/failure-recovery behavior.
5. Full Node plugin execution remains outside an OS-enforced capability
   boundary.
