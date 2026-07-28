# P0 hardening verification baseline — 2026-07-28

This audit is intentionally scoped to the dynamic-tool trust boundary. The
audited source is the clean remote base
`origin/main@646658186175c2b7523e123257ee5647e6dce40d` plus the three P0 code
commits on `codex/hardening-dynamic-tools-p0-clean`. The earlier
`codex/hardening-reality-audit-p0` branch was preserved and was not merged or
cherry-picked.

No credential value was read, printed, or persisted for this verification.

## Environment

| Item | Observed value |
| --- | --- |
| Node | `v24.11.0` (Node module ABI 137) |
| pnpm | `10.33.0` |
| OS | Windows 11 Pro `10.0.26200` (build 26200) |
| Clean source base | `origin/main@6466581` |
| P0 code head before documentation | `6806af3` |
| Worktree | `E:\pythonproject\coding-agent-dynamic-tools-p0-clean` |

Before documentation generation, the clean branch was three commits ahead of
`origin/main` with no uncommitted code changes.

## Commands actually executed

| Command | Exit | Observed result |
| --- | ---: | --- |
| `pnpm install` | 0 | 24 workspace projects; lockfile current; 481 packages linked; Desktop postinstall rebuilt `better-sqlite3` for Electron successfully. |
| `pnpm --filter @nlc/agent-core typecheck` | 0 | Agent Core `tsc --noEmit` passed. |
| `pnpm exec vitest run packages/runtime/agent-core/src` | 0 | 17 files passed; 142 tests passed; 12 environment-gated tests skipped. |
| `pnpm typecheck` | 0 | All 23 participating workspace projects passed. |
| `pnpm test` | 1 | 84 files: 83 passed, 1 failed. 709 tests: 686 passed, 4 failed, 19 skipped. |
| `pnpm build` | 0 | Package builds and Electron main/preload/renderer production bundles completed. |

Additional focused verification was also executed:

| Command | Exit | Observed result |
| --- | ---: | --- |
| `pnpm exec vitest run packages/runtime/agent-core/src/dynamic-tools-security.test.ts` | 0 | 15/15 passed after the fix. |
| `pnpm exec vitest run apps/desktop/src/main/services.test.ts` | 0 | 1/1 passed. |
| `pnpm --filter @nlc/desktop typecheck` | 0 | Desktop node and web tsconfigs passed. |

The initial red run of the new Agent Core security file was also observed:
15 tests ran, 3 passed and 12 failed because validation exports and security
audit steps did not yet exist.

## Full-test failure: Storage ABI

All four failures came from
`packages/core/storage/src/storage.test.ts`:

1. initializes an in-memory DB and safely re-runs schema;
2. upgrades the legacy `file_snapshots` schema;
3. persists the workspace → run → steps → snapshot lifecycle;
4. remembers workspaces and respects the list limit.

Every case failed before its behavioral assertion because
`better_sqlite3.node` was compiled for Electron ABI 130 while the Node test
process requires ABI 137. This is a real failed command and is not recorded as
a pass. It is an existing toolchain/ABI split and this P0 did not modify
Storage or its build strategy.

All other test files passed, including the 15 new dynamic-tool tests and the
Desktop production-wiring test.

## Build warnings and limits

- The renderer build warned that `node:os` and `node:path`, imported through
  `packages/core/shared/src/paths.ts`, were externalized for browser
  compatibility. The build still exited 0.
- Vite reports its CJS Node API as deprecated during tests.
- Credential-gated real-LLM/debug suites remained skipped; no live-model result
  is claimed.
- This audit does not claim process isolation for Node plugins. It verifies
  registration/dispatch fail-closed behavior only.
