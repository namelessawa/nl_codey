# NLC Production Complete execution report

Date: 2026-07-29 (Asia/Shanghai)

Source: `NL_Codey Production Complete.docx`, Goal v2
`NLC-PRODUCTION-COMPLETE`

Candidate code commit: `be50f453b3b4644be516363da7a6c530280bbdd0`

Integration review: [Draft PR #66](https://github.com/namelessawa/nl_codey/pull/66)

Latest implementation branch: `codex/production-release-gates-resolved`

## Verdict

**NOT RELEASE-ACCEPTED — production completion remains blocked.**

The approved PR #70 CodeQL fix is propagated through the published stack, the
repository Dependency graph is enabled, and the hosted dependency review plus
production audit now pass. Those closures exposed a separate release risk:
the default branch has 91 open Dependabot alerts, including 23 critical and 25
high alerts concentrated in development/build dependencies. Both required
release-candidate manual reports are also still `NOT RUN`.

No release tag or production-complete claim should be created from this
candidate.

## Delivered and verified

| Area | Evidence | Result |
| --- | --- | --- |
| Local quality gates | `pnpm typecheck`, `pnpm build` and every named `pnpm test` stage | Pass; 692 unit, 17 recorded-eval, 96 Desktop-main, renderer/preload, 18 CLI, 30 TUI unit, 21 render, 4 ConPTY lifecycle, 14 TUI E2E and 14 recovery assertions. The retained first-attempt ConPTY startup failure is listed below |
| Native storage ABI | Restorative Node test wrappers verify Electron 33.4.11 / modules 130 before and after Node ABI use | Pass; Electron ABI restored |
| Hosted main-target gate | [PR run 30449422948](https://github.com/namelessawa/nl_codey/actions/runs/30449422948) | Node 22 pass; Node 24 pass; Windows package and installed CLI pass |
| Hosted artifact path | Job 90568574386 in run 30449422948 | Build, installed CLI smoke, VSIX package/audit, Desktop package/runtime smoke, silent install/uninstall and upload all pass |
| Hosted artifact | `coding-agent-windows-pr`, artifact 8723077786 | Uploaded; 211,546,124 bytes; digest `sha256:84cd42c39e2ea15fa7f152f9dcdc3619b653f5face97356f4aeef36c09366870` |
| VS Code artifact | Pinned official VSCE, exact five-file archive audit and isolated VS Code 1.127 CLI install | Pass as `nl-codey.nl-codey@0.1.0`; interactive Extension Host remains manual |
| Current integration CodeQL | [CodeQL run 30449420813](https://github.com/namelessawa/nl_codey/actions/runs/30449420813) | Actions, JavaScript/TypeScript and Python analyses pass at the candidate tip |
| PR #70 security closure | [PR #70 CodeQL check 90613970104](https://github.com/namelessawa/nl_codey/runs/90613970104) | Pass after replacing the uncontrolled restart classifier with linear matching and adding long-input coverage; rewritten descendants #71-#85 retain the same changes |
| Dependency graph and hosted audit | [Run 30465400035, job 90621759008](https://github.com/namelessawa/nl_codey/actions/runs/30465400035/job/90621759008) | Dependency review and `pnpm audit --prod --audit-level high` pass; the latter reports one low and no high production finding |
| Current security scan | [CodeQL check 90621936063](https://github.com/namelessawa/nl_codey/runs/90621936063) | Actions, JavaScript/TypeScript and Python analyses pass after linear terminal-escape redaction and structural TUI assertions |
| Mutation safety | Generated 31-path mutation inventory, single-use approval grants and denial fixtures | Pass for inventoried supported paths |
| Plugin boundary | Default-off Docker-only runner with read-only staging, no network, no host credentials and approval-gated returned diff | Adversarial gate pass; no host-user Node fallback |
| Storage/recovery | Historical migrations, backup-before-upgrade, rollback, interrupted Run/Session reconciliation and restart | Pass |
| Agent benchmark | Deterministic 13/13, recorded 13/13, approved live 12/13, unsafe refusal 1/1, unsafe regression 0/13, rollback 3/3 | Thresholds pass; the retained live failure is listed below |
| TUI Settings and Skills | Native ConPTY `/settings`, target-gated `/skills-generate`, exact project-only file write and `/skills` refresh through a loopback protocol stub | Pass; synthetic key is absent from screen/scrollback and no external model/network is used |
| Diagnostics | Shared bounded/redacted bundle with CLI/headless and main-owned Desktop save dialog | Pass for the documented surface |

The earlier clean hosted Release run
[30405876544](https://github.com/namelessawa/nl_codey/actions/runs/30405876544)
also passed the Windows build/package/install path before the VSIX batch.

## Blocking failures

| Blocker | Direct evidence | Why it blocks release | Required action |
| --- | --- | --- | --- |
| Default-branch dependency debt | Dependency graph SBOM contains 686 packages; Dependabot reports 91 open npm alerts: 23 critical, 25 high, 30 medium and 13 low. A full local `pnpm audit --audit-level high` reports 53 vulnerable dependency instances: 3 critical, 22 high, 23 moderate and 5 low | The production-only audit is green above high, but vulnerable test, packaging and build tooling such as Vitest, Electron, tar and Vite remains part of the trusted release pipeline | Triage reachability and upgrade or constrain the affected development/build dependency chains in a dedicated reviewed batch; rerun the full audit and all package gates |
| TUI release-candidate manual report not run | `docs/tui/manual-verification.md` remains `NOT RUN` | Goal v2 explicitly requires a human Windows Terminal/PowerShell check on both supported Node lines | A human operator must complete every row, record sanitized evidence and reviewer verdict |
| VS Code Extension Host report not run | `docs/vscode/manual-verification.md` remains `NOT RUN` | Archive/install proof cannot validate Command Palette behavior, modal approval, streaming, stop/recovery and process cleanup inside the real Extension Host | A human operator must install the exact candidate VSIX and complete every row with sanitized evidence |

## Retained failures and non-blocking findings

- The approved live-model benchmark passed 12 of 13 frozen categories
  (92.31%, above the required 80%). `feature-cross-file` ended in the controlled
  `terminal_state_failed` result. It was not retried away and remains in the
  denominator.
- The final composite's first TUI E2E attempt received a blank PTY screen for
  its first three journeys; the following 11 passed. An immediate isolated
  rerun passed all 14/14 in 102 seconds, and the separately resumed recovery
  gate passed 14/14 with the Electron ABI restored. The initial infrastructure
  failure is retained rather than rewritten as a clean first attempt.
- `pnpm audit --prod --audit-level high` reports one low-severity advisory and
  no high-severity production dependency finding locally and in the hosted
  dependency job. This narrower result does not close the full development and
  build-tool dependency backlog.
- VS Code emitted Node's `url.parse()` deprecation warning during isolated CLI
  installation. Installation and extension enumeration succeeded; the warning
  is not attributed to the extension bundle.
- The default suite still reports the existing Vite CJS Node API deprecation
  warnings. All named tests pass.

## Explicit product boundaries

These are honest supported-scope limits, not completed broader features:

- VS Code is rated Partial: multi-root execution, Session browsing and rollback
  UI are not shipped, and interactive host verification is open.
- Desktop is Functional, but a full public-workflow Desktop E2E remains a gap.
- TUI settings are intentionally command-scoped: `/settings` is a non-secret
  read-only view and `/provider` owns provider editing. A generic TUI settings
  panel is not shipped or advertised; native Settings/Skill evidence passes.
- “Intelligent Diff” means deterministic approval-gated unified diff plus
  bounded impact context, not a separate AI diff-review product.
- “Multi-model Router” means explicit provider selection per new Run, not
  automatic routing, fallback or cost/quality policy.
- Git workflow support is local-only. Remote hosting credentials and autonomous
  PR creation are not shipped.
- MCP is unsupported/default-off. Dynamic tools are the narrower audited
  alternative.
- Distributed execution is explicitly non-production and fails closed.
- Plugin process isolation is Docker-only and default-off; manifest permissions
  are not described as OS process isolation.

See `docs/audits/product-feature-surface-matrix.md` and
`docs/audits/feature-reality-matrix.md` for the complete dispositions.

## LLM and secret handling

The two deliberate live-model gates used only the ignored repository-root
`custom.txt`: the provider wiring smoke and the approved 13-case benchmark.
Provider values, keys and raw responses were not committed. Ordinary
typecheck/build/test, artifact and hosted gates were deterministic/offline and
did not read `custom.txt`. The VSIX allowlist and archive smoke explicitly
reject `custom.txt`, `.env`, source maps, source and dependencies.

## Data and workspace integrity

- `study-mode-e2e-test/` was preserved and remains untracked.
- Existing unrelated working-tree states in
  `apps/cli/src/commands/default.ts`,
  `packages/core/storage/src/index.ts`,
  `packages/runtime/llm/src/mock-chat.test.ts` and
  `packages/runtime/tools/src/apply-patch.test.ts` were not staged.
- No user Session, SQLite database, settings file or credential file was
  committed.
- Each implementation batch is independently reviewable in the stacked Draft
  PR chain and records rollback implications in `nightly-status.md`.

## Acceptance path

1. Triage and remediate the critical/high default-branch development and build
   dependency alerts, then rerun the full audit and packaging gates.
2. Complete and review both release-candidate manual reports against the exact
   post-fix commit and VSIX.
3. Fast-forward the integration branch to that reviewed tip and rerun all
   main-target and release gates.
4. Update this report only from those concrete results. Production completion
   may be declared only if every blocker is closed and no new P0/P1 finding
   appears.
