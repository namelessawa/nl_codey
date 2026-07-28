# Feature reality matrix - production-complete baseline

Baseline: `origin/main@11aa6486c904c393d3948b4b4f8d75a9b094591f`,
audited 2026-07-29 and continuously updated by the stacked batches in
`docs/execution/nightly-status.md`.

Ratings use source, production callers, committed tests, persistence, failure
paths and runnable build artifacts. Package presence is not production
evidence.

- **Production**: the complete supported surface has integration/recovery/
  release evidence.
- **Functional**: a real runtime path and meaningful tests exist, but broader
  production evidence is incomplete.
- **Partial**: implementation exists but a material advertised path, boundary
  or quality gate is broken/unproved.
- **Scaffold**: types/local logic exist without a production transport/path.

## Summary

```text
Production: 0
Functional: 19
Partial: 3
Scaffold: 1
Dead: 0
Unknown: 0
```

No whole module is rated Production. That is an evidence statement, not a claim
that the functional modules are unusable.

## Apps

| Module | Runtime and entry | Test/build evidence | Material gap | Rating |
| --- | --- | --- | --- | --- |
| `apps/desktop` | Electron main/preload/React renderer; main constructs shared Storage, AgentService and LLM provider | Main, preload and renderer gates pass; root production bundle passes | Renderer imports Node path helpers through shared; recovery not E2E | Functional |
| `apps/cli` | Non-interactive CLI and Ink TUI use shared Agent Core and JSONL session store | Bundle/help/version, command, render and real Windows ConPTY gates pass | Core mutation/session E2E and release packaging remain incomplete | Functional |

## Core

| Module | Runtime and entry | Test evidence | Material gap | Rating |
| --- | --- | --- | --- | --- |
| `packages/core/shared` | Shared models, IPC, settings and policy types used across apps/packages | Six suites | Browser-safe and Node-only path utilities are not split | Functional |
| `packages/core/sandbox` | Workspace containment, command whitelist/router, WSL/Docker staging and Windows Job Object helper | Six suites including Docker-gated paths | Full-suite Windows abort timing is flaky; host whitelist remains weaker than a container | Functional |
| `packages/core/storage` | SQLite workspaces/runs/steps/snapshots plus advanced stores | Four Node lifecycle/migration tests plus Electron native-load checks pass through a restorative ABI matrix | Historical fixtures and backup-before-upgrade failure recovery remain incomplete | Functional |
| `packages/core/session` | Branchable JSONL conversation store used by CLI | Store/tree/path suites | Stable Run linkage and crash reconciliation are not defined; Desktop interoperability unproved | Functional |

## Runtime

| Module | Runtime and entry | Test evidence | Material gap | Rating |
| --- | --- | --- | --- | --- |
| `packages/runtime/llm` | OpenAI-compatible and Anthropic streaming providers, timeout/retry/redaction | Six suites plus explicit opt-in smoke definitions | Live provider compatibility/release evidence is incomplete | Functional |
| `packages/runtime/tools` | Bounded file/search/patch/command/git/symbol/port tools | Eight suites | Whole mutation graph is not yet machine-audited through one approval contract | Functional |
| `packages/runtime/agent-core` | Shared autonomous loop, budget, verify/repair, rollback, compression and multi-agent entry | Seventeen suites; dynamic tool boundary has single/multi-agent regression coverage | Explicit production state machine/error taxonomy and crash recovery are incomplete; eval fixture matrix missing | Functional |

## Intelligence

| Module | Runtime and entry | Test evidence | Material gap | Rating |
| --- | --- | --- | --- | --- |
| `packages/intelligence/project-indexer` | Repository scan/ignore/project detection feeds AgentService | No colocated suite | Ignore, symlink, binary and multi-language behavior lack regression evidence | Partial |
| `packages/intelligence/memory` | Cross-session facts/preferences/failures and retrieval | Five suites | Cross-process recovery and privacy lifecycle evidence is thin | Functional |
| `packages/intelligence/semantic-index` | Chunk/embed/vector search and incremental index service | Five suites | Production embedding/index staleness and provenance are not surfaced end to end | Functional |
| `packages/intelligence/planner` | DAG decomposition, dependency validation and waves | Four suites | Benchmark success and restart persistence are incomplete | Functional |
| `packages/intelligence/orchestrator` | Planner/Coder/Reviewer roles, locks, bus, worker pool | Five suites plus Agent Core role-boundary tests | Restart recovery and distributed execution contract incomplete | Functional |

## Integration

| Module | Runtime and entry | Test evidence | Material gap | Rating |
| --- | --- | --- | --- | --- |
| `packages/integration/git-integration` | Branch/commit/PR/diff helpers exposed by Desktop paths | Four suites | No real remote/credential/approval E2E and no TUI workflow evidence | Functional |
| `packages/integration/web-tools` | Domain-whitelisted fetch/search ports | Three suites | Prompt-injection/provenance display and network-policy E2E incomplete | Functional |

## Advanced/experimental

| Module | Runtime and entry | Test evidence | Material gap | Rating |
| --- | --- | --- | --- | --- |
| `packages/advanced/global-memory` | Desktop IPC and prompt augmentation over persistent knowledge graph | Two suites | Cross-project privacy/recovery integration incomplete | Functional |
| `packages/advanced/style-profile` | Desktop style extraction and feedback paths | One suite | Lifecycle/UI recovery evidence limited | Functional |
| `packages/advanced/learning` | Feedback signal and preference dataset IPC | One suite | Dataset lifecycle/privacy integration limited | Functional |
| `packages/advanced/proactive` | Read-only scan, proposal inbox and scheduler | One suite | Scheduler errors can be skipped and mutation handoff is not in the unified approval inventory | Functional |
| `packages/advanced/plugin-sdk` | Manifest/install/grant/host logic used by Desktop plugin runtime | One suite plus Agent Core dynamic-tool tests | Whitelist mode launches full Node under the host user; manifest permissions do not confine direct syscalls | Partial |
| `packages/advanced/finetune` | Desktop job/model registry and external runner hooks | One suite | No bundled complete trainer/evaluator or production job isolation | Partial |
| `packages/advanced/distributed` | Coordinator/node/assignment logic and IPC list/register surface | One suite | No authenticated remote transport or production dispatch path | Scaffold |

## Cross-cutting evidence

- Desktop and CLI source both construct the shared Storage, AgentService and LLM
  factory; the root build now emits both Desktop and CLI artifacts.
- Dynamic tool bundles now require complete mutation classification, reject
  reserved/undeclared calls, keep multi-agent role schemas and allowlists
  aligned, and persist bounded/redacted security failures.
- Those dispatch controls do not sandbox an already-started Node plugin
  process.
- SQLite is the Run-state store and JSONL is the CLI conversation store, but
  there is no proved stable linkage/reconciler after a crash.
- The root build and default offline test gate pass. The explicit integration
  gate passes with a restorative Node/Electron Storage ABI matrix; Windows
  abort remains under soak because earlier loaded runs exceeded its bound.
- TUI discovery currently finds 18 catalogued slash commands, 19 keyboard/input
  actions, three modal routes, no mouse implementation and four committed
  CLI/TUI Vitest files, including a real Windows ConPTY lifecycle. See
  `docs/tui/action-inventory.md`.

## Production-rating gate

A module can move to Production only after its supported public operations,
security policy, persistence/recovery behavior, error redaction, supported
platforms and release artifact have named reproducible evidence. This audit
must be updated when those gates land; README wording must never outrun it.
