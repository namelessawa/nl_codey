# NLC-PRODUCTION-COMPLETE

Status: **NOT COMPLETE - RELEASE BLOCKED**

Source specification: `NL_Codey Production Complete.docx` (Goal v2,
`NLC-PRODUCTION-COMPLETE`).

Baseline:

- Remote base: `origin/main`
- Commit: `11aa6486c904c393d3948b4b4f8d75a9b094591f`
- First delivery branch: `codex/audit-production-complete`
- Baseline date: 2026-07-29 (Asia/Shanghai)

The goal is not satisfied by a successful build or a TUI that merely starts.
It is satisfied only when the public product surfaces have repeatable evidence,
the safety/data/recovery gates are green, and remaining experimental modules
are labeled honestly.

## Completion ledger

| Area | Required outcome | Current evidence | Status |
| --- | --- | --- | --- |
| Security | No known P0/P1 boundary failure, escape, unapproved mutation, or secret leak | PR #70's polynomial classifier and the later terminal-redaction findings are fixed with linear scans and long-input coverage; current CodeQL is green. Enabling Dependabot exposes 91 open default-branch alerts, including 23 critical and 25 high development/build dependency alerts | Blocked pending dependency triage/remediation |
| Storage | Real migrations and run lifecycle pass under Node and Electron ABIs | Restorative ABI gate, historical migration backup/failure recovery and hosted clean release all pass | Complete |
| Recovery | Desktop and TUI reconcile interrupted Runs with JSONL Sessions | Stable linkage, dead-owner reconciliation, restart idempotency and no-write-replay E2E pass | Complete |
| Unified approval | Every built-in, sandbox, plugin, MCP, multi-agent, Git, proactive, fine-tune, TUI command and shortcut mutation is gated/audited | Generated 31-path inventory and single-use approval/denial contract pass | Complete |
| CI | Named unit/integration/desktop/renderer/preload/CLI/TUI/sandbox/plugin/recovery/eval/E2E gates are green | Local composite, current CodeQL, main-target Node 22/24, Windows Desktop/installed-CLI/VSIX artifact, hosted dependency review and production audit pass with Dependency graph enabled | Automated gate complete |
| TUI discovery | Commands, aliases, keys, mouse actions, and modals are generated from implementation | `pnpm docs:tui-actions` discovers 20 commands, 25 keyboard/input actions and 3 modals; every input row has a committed test identifier and missing mouse support is explicit | Complete |
| TUI verification | Unit + render + ANSI frame + Windows ConPTY E2E evidence for every public action/state | All exact Goal v2 scenarios and implemented UI-state cells pass; safe settings and target-gated Skill install have native evidence; mouse is explicitly Experimental; PageUp/PageDown are safe reserved no-ops; Session failure/containment/lineage passes restart evidence | Automated evidence complete; release-candidate manual verification remains |
| Agent benchmark | Deterministic 100%, recorded >=95%, approved live >=80%, plus TUI workflows | Scorecard records deterministic 13/13, recorded 13/13, approved live 12/13 (92.31%), 0 unsafe regressions, rollback 3/3 and TUI workflows 8/8 | Complete |
| Product surfaces | Desktop, TUI, headless eval and VS Code share one runtime and policy | Desktop/TUI share Agent Core; VS Code uses the CLI host protocol, and its exact five-file VSIX passes archive audit plus isolated installation; interactive Extension Host verification remains `NOT RUN` | In progress |
| Release | Windows build/package/install smoke, CodeQL, audit and documented manual verification | PR #70 and current-tip CodeQL pass; run 30465400035 passes Node 22/24, dependency review/production audit, and the Windows package/installed-CLI job. Default-branch critical/high dependency debt and both manual RC reports remain | Blocked |

## Execution invariants

1. Work starts from the latest fetched `origin/main`; `main` is never edited
   directly.
2. Each batch addresses one coherent risk. No automatic merge, force push, or
   unrelated feature work.
3. User data and the preserved untracked `study-mode-e2e-test/` directory are
   not modified.
4. Claims follow evidence. Experimental/scaffold capabilities remain labeled
   that way until their production gate exists.
5. Every batch records commands, failures, changes, residual risk, and rollback
   implications in `docs/execution/nightly-status.md`.
6. TUI rows remain incomplete until a committed test identifier replaces
   `None` in `docs/tui/action-inventory.md`.

## LLM configuration rule for this execution

Any explicit live-model smoke is opt-in and must load provider, base URL, model,
and API key from the ignored repository-root `custom.txt`. The key must never be
printed, committed, placed in SQLite/JSONL, or copied into a test fixture.
Deterministic/default test commands must not make a live-model call. Live tests
must use a dedicated environment gate and redact provider errors before
persistence or display.

## Planned delivery sequence

1. Repository reality audit and generated TUI action inventory.
2. Formal test configurations, deterministic debug-test gates, and a working
   CLI build/smoke entry.
3. TUI unit/render/ANSI frame foundation.
4. Windows ConPTY harness and core TUI workflows.
5. Node/Electron Storage ABI and migration gates.
6. Windows sandbox abort stability.
7. Run/Session startup reconciliation.
8. Unified mutation/approval audit and enforcement.
9. Restricted plugin runner RFC/spike after the preceding P0 gates are green.
10. Benchmarks, remaining product surfaces, release evidence, and final report.

The sequence may be reordered only when a discovered P0 dependency requires it;
the reason must be recorded in the decision log.
