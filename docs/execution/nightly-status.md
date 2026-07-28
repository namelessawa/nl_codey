# Nightly execution status

Goal: `NLC-PRODUCTION-COMPLETE`

Overall state: **ACTIVE - RED BASELINE**

## Batch board

| Batch | Branch | Scope | State | Evidence |
| --- | --- | --- | --- | --- |
| 1 | `codex/audit-production-complete` | Reality audit, control files, generated TUI inventory, current-doc path corrections | Ready for draft review; gate red on SBOX-ABORT-001 | Baseline captured; 18 commands, 18 key actions and 3 modal routes discovered |
| 2 | `codex/p1-test-cli-foundation` | Formal test configs, live/debug opt-in gate, CLI build/smoke | Ready for draft review; integration gate remains red by design | Default offline gate: 685 passed; CLI bundle/help/version passed |
| 3 | `codex/p1-tui-render-foundation` | TUI unit/render/ANSI frame tests | Pending | No committed TUI tests at baseline |
| 4 | `codex/p1-tui-pty-harness` | Windows ConPTY + resize/key/cleanup primitives | Pending | No PTY dependency or harness at baseline |
| 5 | `codex/p1-tui-core-workflows` | Core approval/reject/stop/session/recovery scenarios | Pending | Depends on PTY harness |
| 6 | `codex/p0-storage-abi-gate` | Node/Electron ABI + migration gates | Pending | Four storage tests ABI-blocked |
| 7 | `codex/p0-sandbox-abort-stability` | Windows abort/process-tree stability | Pending | Full suite measured 2115 ms vs 1500 ms |
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

## Current blockers

1. Real storage assertions cannot run with the postinstall Electron binary in
   a Node process.
2. Windows child-process abort exceeds its documented 1500 ms bound.
3. TUI key/modal/render, PTY and end-to-end workflows still lack committed
   coverage.
4. Run/Session crash reconciliation and a unified mutation approval boundary
   are not yet proved.
5. Full Node plugin execution remains outside an OS-enforced capability
   boundary.
