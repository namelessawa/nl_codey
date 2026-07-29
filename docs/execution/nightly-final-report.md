# NLC Production Complete execution report

Date: 2026-07-29 (Asia/Shanghai)

Source: `NL_Codey Production Complete.docx`, Goal v2
`NLC-PRODUCTION-COMPLETE`

Candidate code commit: `57271eaa94e1b16e318143ef172980f1ea779207`

Integration review: [Draft PR #66](https://github.com/namelessawa/nl_codey/pull/66)

Latest implementation batch:
[Draft PR #83](https://github.com/namelessawa/nl_codey/pull/83)

## Verdict

**NOT RELEASE-ACCEPTED — production completion remains blocked.**

The supported code paths now have a green local composite and green hosted
Node/Windows/package/VSIX jobs. That is not sufficient for the document's
production-complete claim: one high-severity historical CodeQL alert remains,
the repository cannot run dependency review while Dependency graph is
disabled, and both required release-candidate manual reports are still
`NOT RUN`.

No release tag or production-complete claim should be created from this
candidate.

## Delivered and verified

| Area | Evidence | Result |
| --- | --- | --- |
| Local quality gate | `pnpm typecheck`, `pnpm build`, then `pnpm test` | Pass; 690 unit, 17 recorded-eval, 96 Desktop-main, renderer/preload, 18 CLI, 30 TUI unit, 21 render, 4 ConPTY lifecycle, 13 TUI E2E and 14 recovery assertions |
| Native storage ABI | Restorative Node test wrappers verify Electron 33.4.11 / modules 130 before and after Node ABI use | Pass; Electron ABI restored |
| Hosted main-target gate | [PR run 30449422948](https://github.com/namelessawa/nl_codey/actions/runs/30449422948) | Node 22 pass; Node 24 pass; Windows package and installed CLI pass |
| Hosted artifact path | Job 90568574386 in run 30449422948 | Build, installed CLI smoke, VSIX package/audit, Desktop package/runtime smoke, silent install/uninstall and upload all pass |
| Hosted artifact | `coding-agent-windows-pr`, artifact 8723077786 | Uploaded; 211,546,124 bytes; digest `sha256:84cd42c39e2ea15fa7f152f9dcdc3619b653f5face97356f4aeef36c09366870` |
| VS Code artifact | Pinned official VSCE, exact five-file archive audit and isolated VS Code 1.127 CLI install | Pass as `nl-codey.nl-codey@0.1.0`; interactive Extension Host remains manual |
| Current integration CodeQL | [CodeQL run 30449420813](https://github.com/namelessawa/nl_codey/actions/runs/30449420813) | Actions, JavaScript/TypeScript and Python analyses pass at the candidate tip |
| Mutation safety | Generated 31-path mutation inventory, single-use approval grants and denial fixtures | Pass for inventoried supported paths |
| Plugin boundary | Default-off Docker-only runner with read-only staging, no network, no host credentials and approval-gated returned diff | Adversarial gate pass; no host-user Node fallback |
| Storage/recovery | Historical migrations, backup-before-upgrade, rollback, interrupted Run/Session reconciliation and restart | Pass |
| Agent benchmark | Deterministic 13/13, recorded 13/13, approved live 12/13, unsafe refusal 1/1, unsafe regression 0/13, rollback 3/3 | Thresholds pass; the retained live failure is listed below |
| Diagnostics | Shared bounded/redacted bundle with CLI/headless and main-owned Desktop save dialog | Pass for the documented surface |

The earlier clean hosted Release run
[30405876544](https://github.com/namelessawa/nl_codey/actions/runs/30405876544)
also passed the Windows build/package/install path before the VSIX batch.

## Blocking failures

| Blocker | Direct evidence | Why it blocks release | Required action |
| --- | --- | --- | --- |
| High CodeQL alert introduced at PR #70 | [PR #70](https://github.com/namelessawa/nl_codey/pull/70), check run `90487591404`: `packages/core/shared/src/run-lifecycle.ts:260`, “Polynomial regular expression used on uncontrolled data” | The source goal forbids a known P0/P1 security failure; later PRs showing green “new alert” checks do not resolve the branch alert | Replace the uncontrolled `.*` classification regex with bounded/linear matching, add adversarial long-input coverage, then propagate the fix through the stacked branches. This changes a mid-stack branch and requires explicit approval before rewriting or rebasing published branches |
| Dependency review unavailable | [Run 30449422948, job 90567638408](https://github.com/namelessawa/nl_codey/actions/runs/30449422948/job/90567638408) fails in four seconds: “Dependency review is not supported on this repository” | The required hosted dependency gate never executes, and the combined job stops before its production audit step | Enable the repository Dependency graph in Security & analysis, then rerun the failed job/workflow. This is a repository-level setting and requires explicit user approval |
| TUI release-candidate manual report not run | `docs/tui/manual-verification.md` remains `NOT RUN` | Goal v2 explicitly requires a human Windows Terminal/PowerShell check on both supported Node lines | A human operator must complete every row, record sanitized evidence and reviewer verdict |
| VS Code Extension Host report not run | `docs/vscode/manual-verification.md` remains `NOT RUN` | Archive/install proof cannot validate Command Palette behavior, modal approval, streaming, stop/recovery and process cleanup inside the real Extension Host | A human operator must install the exact candidate VSIX and complete every row with sanitized evidence |

## Retained failures and non-blocking findings

- The approved live-model benchmark passed 12 of 13 frozen categories
  (92.31%, above the required 80%). `feature-cross-file` ended in the controlled
  `terminal_state_failed` result. It was not retried away and remains in the
  denominator.
- `pnpm audit --prod --audit-level high` reports one low-severity advisory and
  no high-severity production dependency finding. This local result does not
  substitute for the blocked GitHub dependency review.
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
- TUI skill installation lacks a native PTY journey; settings are command-only,
  not a complete interactive settings panel.
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

1. Approve and perform the PR #70 linear-time regex fix plus downstream stack
   propagation.
2. Approve enabling GitHub Dependency graph; rerun dependency review and the
   production audit.
3. Complete and review both release-candidate manual reports against the exact
   post-fix commit and VSIX.
4. Fast-forward the integration branch to that reviewed tip and rerun all
   main-target and release gates.
5. Update this report only from those concrete results. Production completion
   may be declared only if every blocker is closed and no new P0/P1 finding
   appears.
