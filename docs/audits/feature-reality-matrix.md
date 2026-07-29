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
Functional: 20
Partial: 2
Scaffold: 1
Dead: 0
Unknown: 0
```

No whole module is rated Production. That is an evidence statement, not a claim
that the functional modules are unusable.

## Apps

| Module | Runtime and entry | Test/build evidence | Material gap | Rating |
| --- | --- | --- | --- | --- |
| `apps/desktop` | Electron main/preload/React renderer; main constructs shared Storage, AgentService and LLM provider | Main, preload, renderer, recovery and packaged Windows gates pass | Renderer imports Node path helpers through shared; full public workflow E2E remains incomplete | Functional |
| `apps/cli` | Non-interactive CLI and Ink TUI use shared Agent Core and JSONL session store | Bundle/help/version, prompt state-machine, render, real Windows ConPTY workflows, crash soak and installed-artifact smoke pass | Provider-editor/skill-cancel evidence, the full terminal-size matrix and explicit mouse disposition remain incomplete | Functional |

## Core

| Module | Runtime and entry | Test evidence | Material gap | Rating |
| --- | --- | --- | --- | --- |
| `packages/core/shared` | Shared models, IPC, settings and policy types used across apps/packages | Six suites | Browser-safe and Node-only path utilities are not split | Functional |
| `packages/core/sandbox` | Workspace containment, command whitelist/router, WSL/Docker staging and verified cross-platform process-tree termination | Six suites including Docker-gated and descendant-cleanup paths | Host whitelist has no OS resource/syscall isolation; native Job Object/AppContainer host remains unimplemented | Functional |
| `packages/core/storage` | SQLite workspaces/runs/steps/snapshots plus advanced stores | Ten Node lifecycle/migration tests, historical backup/failure fixtures, rollback recovery and Electron native-load checks pass through restorative ABI matrices | Automated backup-retention policy and longer-duration corruption drills remain incomplete | Functional |
| `packages/core/session` | Branchable JSONL conversation store used by CLI | Store/tree/path plus native branch/resume/restart and Run-linkage E2E pass | Desktop interoperability and malformed-history UX breadth remain incomplete | Functional |

## Runtime

| Module | Runtime and entry | Test evidence | Material gap | Rating |
| --- | --- | --- | --- | --- |
| `packages/runtime/llm` | OpenAI-compatible and Anthropic streaming providers, timeout/retry/redaction | Six suites plus explicit opt-in smoke definitions | Live provider compatibility/release evidence is incomplete | Functional |
| `packages/runtime/tools` | Bounded file/search/patch/command/git/symbol/port tools | Eight suites plus the generated 31-path mutation inventory | Supported mutation paths share single-use approval/capability enforcement; OS-level host whitelist isolation remains limited | Functional |
| `packages/runtime/agent-core` | Shared autonomous loop, budget, verify/repair, rollback, compression and multi-agent entry | Unit/recovery suites, 13/13 deterministic/recorded fixtures and a 12/13 approved live benchmark pass | Explicit production state machine/error taxonomy remains incomplete | Functional |

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
| `packages/advanced/plugin-sdk` | Manifest/install/grant/host logic used by Desktop's default-off plugin runtime | SDK, Desktop adapter, restricted-runner unit and real Docker adversarial gates | Docker Desktop and the pinned image must be pre-provisioned; non-Docker manifests intentionally fail closed | Functional |
| `packages/advanced/finetune` | Desktop job/model registry and external runner hooks | One suite | No bundled complete trainer/evaluator or production job isolation | Partial |
| `packages/advanced/distributed` | Coordinator/node/assignment logic and IPC list/register surface | One suite | No authenticated remote transport or production dispatch path | Scaffold |

## Cross-cutting evidence

- Desktop and CLI source both construct the shared Storage, AgentService and LLM
  factory; the root build now emits both Desktop and CLI artifacts.
- Dynamic tool bundles now require complete mutation classification, reject
  reserved/undeclared calls, keep multi-agent role schemas and allowlists
  aligned, and persist bounded/redacted security failures.
- Plugin dispatch has no host-user Node fallback. Docker-only execution receives
  a credential-filtered staging copy under an OS-enforced resource/network
  boundary and can return only an unapplied proposed patch.
- SQLite is the Run-state store and JSONL is the CLI conversation store.
  Stable Run/session linkage, dead-owner reconciliation, restart idempotency
  and no-write replay are proved by Storage and native ConPTY recovery gates.
- The root build and default offline test gate pass. The explicit integration
  gate passes with a restorative Node/Electron Storage ABI matrix. Windows
  abort has a named 12-run isolated plus 8-way loaded soak, preserves
  `AbortError`, and proves descendant cleanup without timeout inflation.
- TUI discovery currently finds 19 catalogued slash commands, 23 keyboard/input
  actions, three modal routes, no mouse implementation and seven committed
  CLI/TUI Vitest files. Three native lifecycle/prompt journeys, 11 core E2E
  workflows and a separate five-cycle crash soak pass; the two inventory rows
  without tests remain incomplete. See `docs/tui/action-inventory.md`.

## Production-rating gate

A module can move to Production only after its supported public operations,
security policy, persistence/recovery behavior, error redaction, supported
platforms and release artifact have named reproducible evidence. This audit
must be updated when those gates land; README wording must never outrun it.
