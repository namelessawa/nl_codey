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

## D-008 - Recorded-response benchmark is offline evidence, not live evidence

Date: 2026-07-29

Decision: replay frozen assistant turns through the production streaming and
tool contracts for the recorded-response score. Keep the approved live-model
rate separate and unmeasured until an explicitly authorized run loads only
`custom.txt`.

Reason: deterministic replay proves runtime behavior and regression stability,
but it cannot establish provider/model task success. Counting the earlier
single read-only connectivity smoke as a 100% live benchmark would overstate
the evidence and collapse two distinct Goal v2 thresholds.

## D-009 - Preserve the first approved live score, including its failure

Date: 2026-07-29

Decision: publish the first complete frozen live run as 12/13 (92.31%). Keep
`feature-cross-file` as `terminal_state_failed` in the denominator and do not
rerun selectively to replace it with a pass.

Reason: Goal v2 requires an attributable success rate, not a curated best-of
result. The observed rate exceeds the >=80% threshold, while retaining the
failure gives future model/runtime changes a meaningful regression baseline.
