# NLC production-complete master backlog

Priority order follows the Goal v2 specification. An item is closed only by a
committed implementation plus the named reproducible evidence.

## P0 - security and mutation control

| ID | Work | Acceptance evidence | State |
| --- | --- | --- | --- |
| SEC-PLUGIN-001 | Replace host-user Node plugin execution with a restricted, default-off runner; read-only workspace, network off, no Home/SSH/Git credentials, CPU/memory/process/file/time limits | Adversarial plugin integration tests prove denied host file, secret, network and process access; changes return as approval-gated diffs | Open |
| SEC-APPROVAL-001 | Trace every mutation path (built-in, sandbox writeback, plugin, MCP, multi-agent, Git, proactive, fine-tune, TUI key/command) through one capability/approval/audit contract | Machine-readable mutation inventory and denial/approval tests for every path | Open |
| SEC-SECRET-001 | Apply one bounded redaction contract to provider/tool/plugin/sandbox/SQLite/JSONL/TUI errors | Regression fixtures cover keys, bearer headers, user-home paths and sensitive URLs | Open |

Dynamic tool schema/classification/dispatch hardening is merged on the baseline
and remains a regression gate; it does not close process isolation.

## P0 - data integrity and recovery

| ID | Work | Acceptance evidence | State |
| --- | --- | --- | --- |
| DATA-ABI-001 | Split Node and Electron storage native-module gates with deterministic rebuild ordering | `test:storage:node`, `test:storage:electron`, and migrations all green on clean CI | Done in Batch 6; clean-CI workflow wiring remains under CI-RELEASE-001 |
| DATA-MIG-001 | Add supported historical migration fixtures, backup-before-upgrade and documented failure recovery | Real-file fixtures pass; failed migration leaves a recoverable backup | Open |
| REC-RUN-001 | Add startup reconciler for non-terminal Runs and interrupted tool/apply windows | Desktop and TUI restart tests mark/recover interrupted Runs without replaying writes | Done in Batch 8 |
| REC-LINK-001 | Define and persist stable SQLite Run ↔ JSONL Session linkage | Branch/resume/restart lineage E2E proves no cross-session delta or orphan Run | Done in Batch 8 |
| REC-ROLLBACK-001 | Prove rollback after one/many/partial changes and restart | Real workspace + storage fixtures restore exact bytes and state | Open |

## P0/P1 - broken gates and flakes

| ID | Work | Acceptance evidence | State |
| --- | --- | --- | --- |
| CI-CLI-001 | Restore the missing CLI build script and a real installed-artifact help smoke | `pnpm --filter nlc build` and packaged `nlc --help` pass | Done in Batch 2 |
| CI-SPLIT-001 | Add formal unit/desktop-main/renderer/preload/CLI/TUI/integration configs and named root scripts | Each command selects at least one intended test and fails on zero matches | Done in Batches 2-4 |
| CI-LIVE-001 | Remove debug/live suites from default test discovery unless explicitly enabled | Default tests make zero network/model calls; explicit smoke loads ignored `custom.txt` | Open |
| SBOX-ABORT-001 | Fix/characterize Windows process-tree abort without timeout inflation | Repeated isolated and loaded runs stop promptly, leave no child and preserve AbortError | Done in Batch 7 |
| CI-RELEASE-001 | Add Node-version/Windows/build/package/CodeQL/dependency/CLI smoke gates | Required checks all green; no blanket production-test exclusion | Open |

## P1 - TUI product surface

| ID | Work | Acceptance evidence | State |
| --- | --- | --- | --- |
| TUI-INV-001 | Generate commands, aliases, keys and modal routes from implementation | `pnpm docs:tui-actions`; CI fails on generated diff or missing handler metadata | In progress |
| TUI-UNIT-001 | Parser, prompt editing, approval, provider and session command unit tests | `pnpm test:tui:unit` green with invalid/missing/long/CJK cases | Open |
| TUI-RENDER-001 | Ink component/state/size/theme/ANSI frame tests | `pnpm test:tui:render` covers 120x40, 100x30, 80x24, 60x20 and minimum-size fallback | Open |
| TUI-PTY-001 | Windows ConPTY harness with stable key send, resize, frame capture and cleanup | `pnpm test:tui:pty`; real keys and resize, cursor/mouse/alternate-screen restored | Open |
| TUI-E2E-001 | Implement the 14 Goal v2 PTY scenarios | `pnpm test:tui:e2e`; sanitized evidence report with no orphan processes | Open |
| TUI-PROMPT-001 | Complete cursor/Home/End/history/paste/control-character semantics | Unit + PTY evidence; input survives resize and modal focus | Open |
| TUI-SESSION-001 | Interactive session list/tree/resume/branch and recovery | Lineage and restart E2E; corrupt/partial JSONL visible but non-fatal | Open |
| TUI-MOUSE-001 | Either implement and test mouse lifecycle or label unsupported | Mouse matrix and PTY cleanup evidence, or explicit unsupported product copy | Open |
| TUI-MIN-001 | Add height-aware minimum terminal fallback | No layout corruption; prompt/status retained or explicit size warning | Open |

## P1/P2 - runtime, intelligence and product completion

| ID | Work | Acceptance evidence | State |
| --- | --- | --- | --- |
| FSM-001 | Shared explicit Run transition table and error taxonomy | Invalid transitions rejected; Desktop/TUI render shared state/error codes | Open |
| EVAL-001 | Required deterministic, recorded, opt-in live and TUI workflow fixtures | Published scorecard meets Goal thresholds with zero unsafe regression | Open |
| CTX-001 | Provenance, impact graph, stale-index and selection-reason surface | Trace/detail output and correctness fixtures | Open |
| RENDERER-001 | Split browser-safe paths from Node helpers | Renderer/preload tests and packaged runtime smoke | Open |
| INDEX-001 | Add project-indexer ignore/symlink/binary/language tests | Dedicated suite green | Open |
| VSCE-001 | VS Code host adapter using shared runtime/policy | Extension smoke + security tests + docs | Open |
| FEATURE-001 | Intelligent diff, model router, Git workflow agent, MCP, Skills, diagnostics export | Desktop/TUI/CLI/headless/security/docs evidence for each, or documented alternative | Open |
| DIST-001 | Authenticated distributed transport or explicit non-production removal | mTLS transport/recovery integration evidence, or feature remains scaffold/default-off | Open |

## Release evidence

- Maintain `docs/tui/ui-state-matrix.md`,
  `docs/tui/keyboard-matrix.md`, `docs/tui/mouse-matrix.md`,
  `docs/tui/pty-e2e-report.md`, and `docs/tui/manual-verification.md`.
- Generate `docs/execution/nightly-final-report.md` only after the current
  execution ends; it must state failures and residual risks, not just passes.
