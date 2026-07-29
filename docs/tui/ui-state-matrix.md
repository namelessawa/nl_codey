# TUI UI-state matrix

Date: 2026-07-29

This matrix maps the visible TUI surface to committed evidence. `Pass` means
the named supported behavior has automated evidence. `Partial` records a real
surface whose full Goal v2 state breadth is not yet proved. `N/A` means the
surface is not implemented and is not advertised.

## Visible regions

| Region | Supported states and transitions | Evidence | Result / residual gap |
| --- | --- | --- | --- |
| Header | First render, workspace, provider/model, run status, wide/narrow/minimum layout | `chrome.render.test.tsx`; `conpty.pty.test.ts` | Pass |
| Workspace information | Windows path, long path, CJK content, read-only suffix | `chrome.render.test.tsx`; `core-workflows.e2e.pty.test.ts` read-only case | Pass |
| Provider / model indicator | Default Mock, selected OpenAI, restart persistence, corrected provider used by a new Run | `chrome.render.test.tsx`; provider configuration E2E | Pass |
| Sandbox / read-only indicator | Writable default and explicit read-only display; forged write is denied | `chrome.render.test.tsx`; read-only E2E | Pass |
| Message history | Empty, user/assistant/tool/error/security rows, session replay, 320-row history | `chrome.render.test.tsx`; core workflow E2E | Pass |
| Streaming assistant message | Streaming text, stop/cancel, final message separation | `chrome.render.test.tsx`; stop E2E | Pass |
| Tool trace | Empty, running/completed/error rows, hidden below 80 columns, 200-item memory bound | `chrome.render.test.tsx`; `stream-bounds.test.ts`; ConPTY resize | Pass |
| Budget information | Normal budget and explicit `budget_exceeded` reason | `chrome.render.test.tsx`; budget E2E | Pass |
| Prompt input | Empty, plain/CJK/multiline/long input, cursor editing, history, PageUp/PageDown safe no-op, modal/run ownership, resize preservation | `prompt-editor.test.ts`; `inputs.render.test.tsx`; ConPTY prompt journeys | Pass |
| Footer shortcuts | Wide and narrow shortcut copy; modal input supersedes prompt | `chrome.render.test.tsx`; `inputs.render.test.tsx` | Pass |
| Status notifications | Idle, running, done, failed, cancelled, interrupted, budget exceeded | render and core workflow E2E suites | Pass for current runtime states; shared FSM taxonomy remains open |
| Error notifications | Provider HTTP error, policy refusal, redacted security failure | read-only, provider and dynamic-tool E2E cases | Pass for covered error classes; shared typed error taxonomy remains open |
| Approval interface | Patch/command pending, approve, reject, rollback and input blocking | `inputs.render.test.tsx`; patch/command E2E cases | Pass |
| Provider picker modal | Open, navigate, edit, cancel, save, invalid Run, reload/correct/save, focus return | `inputs.render.test.tsx`; provider E2E | Pass |
| Skill install picker modal | Navigate, confirm, Escape/Q cancel, busy input ownership | `inputs.render.test.tsx` | Partial: no native PTY install journey |
| Tab bars | No public tab-bar component or route is implemented | generated `action-inventory.md` | N/A; must be added to discovery if introduced |
| Session tree | `/sessions` and `/tree` append stream views; resume/branch/restart lineage; multilevel and explicit cross-parent branches; invalid resume/session/message targets preserve the active writer; corrupt/partial diagnostics; resumed append isolation; visible write failure; contained resume/show and collision isolation | session core tests; native session E2E | Pass |
| Help view | Generated command catalogue plus explicit mouse support boundary | `commands.test.ts`; ConPTY `/help` journey | Pass |
| Settings view | `/settings` appends resolved non-secret settings; `/model` and `/think` disclose current limitations | command registry tests | Partial: no interactive settings modal or full setting matrix |
| Feature-specific panels | Current Provider and Skill pickers are inventoried above | generated `action-inventory.md` | Partial: future panels must enter discovery and evidence gates |

## Cross-cutting state axes

| Axis | Current evidence | Result |
| --- | --- | --- |
| First render / empty / success | Component render plus native idle/start/complete journeys | Pass |
| Loading / streaming / failure | Streaming, provider failure, redacted security failure and budget exhaustion | Pass for implemented paths |
| Long text / CJK / wide characters | Long paths, bounded paste, CJK editing and 10 KB Tool Output | Pass |
| 120x40, 100x30, 80x24, 60x20 | Named render matrix | Pass |
| Below 60x20 and dynamic resize | Explicit size warning, retained prompt/modal ownership, recovery after growth | Pass |
| Dark / light themes | Theme render fixtures | Pass |
| Reduced animation | The TUI has no animation or motion subsystem | N/A |
| No-Unicode-font fallback | A Unicode-capable terminal font is required; no ASCII-only rendering mode is advertised | Explicitly unsupported |
| Windows Terminal + PowerShell | Real local Windows ConPTY gates launch through PowerShell | Pass automated; release-candidate human check pending |
| `cmd.exe` | The supported interactive host is Windows Terminal with PowerShell; legacy Console Host / `cmd.exe` is not a release target | Explicitly unsupported |

This file is an evidence ledger, not a blanket completion claim. Open and
Partial cells remain release blockers until implemented, explicitly unsupported,
or covered by repeatable manual evidence.
