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

## D-010 - Decode prompt input below Ink's lossy Key surface

Date: 2026-07-29

Decision: keep prompt editing in a pure Unicode code-point state machine and
consume Ink's bounded raw input emitter for explicit Windows/ANSI sequences.
Keep the Prompt mounted but inactive behind modal routes so draft/history state
survives without accepting leaked keys.

Reason: Ink 5 parses Home and End internally but omits them from its public Key
object, and real ConPTY may coalesce several key sequences into one data chunk.
Tail-only `useInput` editing therefore could not satisfy the documented cursor,
paste, resize and focus contract deterministically.

## D-011 - Keep modal input subscriptions stable across field renders

Date: 2026-07-29

Decision: Provider and skill-picker `useInput` registrations use one stable
callback that dispatches through a current ref. State and prop changes update
the ref without tearing down the terminal listener.

Reason: the provider evidence reproduced a dropped first Ctrl+U immediately
after the modal advanced to its URL field. An inline handler made Ink
unsubscribe and resubscribe on each render, leaving a short input gap. A stable
registration fixes the product behavior rather than teaching tests to retry.

## D-012 - Keep the prompt mounted below minimum terminal size

Date: 2026-07-29

Decision: treat 60x20 as the supported full-frame boundary. If either
dimension is smaller, replace only the header/live-body pair with compact
status and resize guidance; keep the Prompt and any blocking modal mounted in
their original sibling positions.

Reason: a resize fallback that conditionally remounts the whole application
would discard drafts or approval ownership precisely when terminal geometry is
unstable. Separating the pure size contract from the frame preserves state and
makes all documented boundaries directly render-testable.

## D-013 - Exercise read-only at dispatch, not only schema generation

Date: 2026-07-29

Decision: the deterministic Scenario 2 Mock first uses advertised read/search
tools, then deliberately emits an unadvertised `apply_patch`. Preserve that
hostile call in the loop so the real read-only dispatcher returns the same
user-visible, persisted refusal that protects against a misbehaving provider.

Reason: proving that `apply_patch` is absent from the schema establishes model
guidance, not enforcement. The source document explicitly requires a forged
write-tool attempt; only dispatch-layer refusal plus an unchanged workspace
proves the hard boundary.

## D-014 - Test terminal retention separately from in-memory bounds

Date: 2026-07-29

Decision: exercise Scenario 14 through one public 10 KB `read_file` result and
one 320-row assistant response in real ConPTY. Assert the 4,000-character
persisted Tool Output cap and truncation marker, native xterm navigation,
complete SQLite/JSONL response, and a still-usable prompt. Test the 500-item
stream and 200-item trace reducer caps as pure state transitions.

Reason: terminal scrollback, durable audit/session storage and live React state
have different ownership and limits. A single runaway loop would couple those
boundaries to iteration/tool-call budgets and make failures ambiguous; separate
assertions prove every limit without relaxing the production circuit breakers.

## D-015 - Inject dynamic tools through composition, never environment state

Date: 2026-07-29

Decision: expose an optional dynamic-tool factory on the CLI service builder
and an optional service factory on the Ink composition. Keep both absent in the
normal `nlc` entry. Scenario 13 launches the production TUI through a dedicated
fixture entry that supplies a throwing factory; all handling after composition
uses the real AgentService, SQLite, SessionBridge and renderer.

Reason: CLI does not yet ship Desktop's plugin manager, so its public entry
could not naturally construct a dynamic bundle. An environment-triggered throw
would be a production backdoor, while copying the Desktop plugin host would
create a second runtime. Explicit dependency injection proves the shared
security boundary without changing default CLI behavior or weakening types.

## D-016 - Prove provider use with a loopback protocol boundary

Date: 2026-07-29

Decision: drive Scenario 9 through the public provider modal and a test-owned
HTTP server bound to `127.0.0.1`. Its invalid path returns a deterministic
non-retryable HTTP 400; after restart and modal correction, its valid path
returns a deterministic OpenAI-compatible SSE response. Capture and assert the
new Run's request path, Bearer header, model and streaming flag.

Reason: persistence alone does not prove that a later Agent Run resolves the
saved provider. A loopback protocol stub exercises the production provider and
stream parser without making an external or live-model call, while an explicit
restart prevents retained terminal output from satisfying the corrected-run
assertions.
