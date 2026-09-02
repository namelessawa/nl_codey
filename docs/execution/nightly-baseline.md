# Nightly baseline - 2026-07-29

## Source state

- Fetched remote: `origin`
- Base ref: `origin/main`
- Base commit: `11aa6486c904c393d3948b4b4f8d75a9b094591f`
- Working branch: `codex/audit-production-complete`
- Existing divergent branch preserved: `codex/hardening-reality-audit-p0`
- Untracked directory preserved and excluded from this work:
  `study-mode-e2e-test/`

The repository declares `pnpm@10.33.0`. The machine has system Node
`v24.11.0`/pnpm `10.33.0`; the Codex dependency bundle separately reports Node
`v24.14.0`/pnpm `11.9.0`.

## Dependency installation

| Command | Result |
| --- | --- |
| bundled pnpm 11.9.0 `install --frozen-lockfile` | Initially refused a non-TTY modules purge; CI retry downloaded most packages but timed out and warned that pnpm 11 ignores the root `pnpm.onlyBuiltDependencies` field |
| `CI=true pnpm install --frozen-lockfile` using declared pnpm 10.33.0 | Passed; 481 packages installed/reused; Electron postinstall rebuilt `better-sqlite3` |

The first attempt is recorded because a generic automation runner can select a
different pnpm than the version pinned by the repository.

## Baseline gates

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed for 23 of 24 workspace projects |
| `pnpm build` | Passed for packages and Electron main/preload/renderer |
| `pnpm test` | Failed: 81 files passed, 3 failed; 696 tests passed, 6 failed, 18 skipped |
| `pnpm --filter @nlc/cli typecheck` | Exit 0 but matched no project |
| `pnpm --filter @nlc/cli build` | Exit 0 but matched no project |
| `pnpm --filter nlc typecheck` | Passed |
| `pnpm --filter nlc build` | Failed because `apps/cli/scripts/build.mjs` is missing |
| CLI built artifact `--help` smoke | Failed because `apps/cli/dist/index.js` was not produced |

The package name is `nlc`, not `@nlc/cli`. A "No projects matched" result must
not be treated as a successful CLI gate.

## Test failures

### Storage native ABI

All four `packages/core/storage/src/storage.test.ts` tests failed before their
assertions. `better_sqlite3.node` was compiled for Electron module ABI 130,
while the Node test process required ABI 137. This is a toolchain/gate defect,
not evidence that the storage assertions themselves are wrong.

### Windows child abort timing

`packages/core/sandbox/src/runchild-abort.test.ts` rejected with the expected
`AbortError`, but elapsed time was 2115 ms versus a 1500 ms assertion. The
production path calls `child.kill()` and awaits process close; the isolated and
full-suite behavior must be characterized before changing either code or the
bound. Raising the timeout alone is not an accepted fix.

### Un-gated live Docker debug test

`packages/runtime/agent-core/src/docker-loop.debug.test.ts` ran during ordinary
`pnpm test` because ambient `LLM_API_KEY`/`LLM_BASE_URL` values enabled it. The
provider returned 401 and the test failed because no `run_command` call was
made. Ordinary tests must not consume ambient live credentials or invoke a paid
model. This suite needs an explicit `RUN_AGENT_DEBUG_TESTS=1`-style gate and
must use `custom.txt` only in a deliberately invoked live smoke.

## Build warnings

The renderer build externalized `node:os` and `node:path` imported by
`packages/core/shared/src/paths.ts`. Build exit 0 does not prove that the
browser path is runtime-safe; a renderer smoke test is required.

## Baseline conclusion

The repository typechecks and produces the Desktop bundle, but it is not a
green production baseline. Storage ABI, sandbox abort stability, deterministic
test selection, CLI artifact generation, and all formal TUI gates are open.

Batch 1 recheck after documentation/inventory changes passed typecheck, build,
generator syntax and generator idempotency. A non-Storage, non-debug Vitest run
passed 79 files/693 tests and reproduced only the Windows abort timing failure
(1936 ms versus the 1500 ms assertion).
