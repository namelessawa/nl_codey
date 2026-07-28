# NLC production-complete decision log

## D-001 - Use latest remote main, preserve divergent work

Date: 2026-07-29

Decision: fetch `origin`, preserve `codex/hardening-reality-audit-p0`, and create
`codex/audit-production-complete` from current `origin/main`.

Reason: Goal v2 requires a current remote baseline. The prior branch was nine
commits behind `origin/main` and five commits ahead on a different history.
Rebasing or deleting it would mix or risk existing work.

## D-002 - Do not touch residual untracked study fixture

Date: 2026-07-29

Decision: exclude `study-mode-e2e-test/` from every command, patch and commit.

Reason: it remained after switching branches and may belong to the user or the
preserved branch. It is not required for the current baseline.

## D-003 - Evidence status is red despite passing build

Date: 2026-07-29

Decision: keep the Goal active and blocked in its completion ledger.

Reason: root typecheck/build passed, but Storage ABI, Windows abort, ambient
live debug, CLI artifact, TUI coverage and plugin isolation gates are open.
A successful build cannot override those failures.

## D-004 - Repository pnpm version is authoritative

Date: 2026-07-29

Decision: use system pnpm `10.33.0`, matching `packageManager`, for repository
commands. Record but do not use bundled pnpm `11.9.0` for the baseline.

Reason: pnpm 11 changed non-TTY purge behavior and ignored the existing
`pnpm.onlyBuiltDependencies` location, creating noise unrelated to the pinned
toolchain.

## D-005 - Default tests must never infer permission for a live model

Date: 2026-07-29

Decision: treat ambient `LLM_API_KEY`/`LLM_BASE_URL` activation as a test defect.
Live suites require a dedicated opt-in flag.

Reason: ordinary unit/integration gates must be deterministic, offline and safe
from accidental spend or secret-bearing output.

## D-006 - Explicit live calls use ignored custom.txt only

Date: 2026-07-29

Decision: when a batch deliberately runs a live smoke, parse the ignored
repository-root `custom.txt` at process start and inject its values only into
that child process. Never commit, echo or persist the API key.

Reason: this follows the execution request while preserving the Goal's secret
handling requirements.

## D-007 - Generated inventory is discovery, not acceptance

Date: 2026-07-29

Decision: generate the current TUI inventory from implementation and mark every
row without a committed test as incomplete.

Reason: static discovery prevents undocumented public actions, but Goal v2
also requires component, ANSI frame and real PTY evidence.
