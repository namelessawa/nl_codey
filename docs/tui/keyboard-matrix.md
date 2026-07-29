# TUI keyboard matrix

Date: 2026-07-29

The generated source of truth for implemented inputs is
`docs/tui/action-inventory.md`. This matrix adds the Goal v2 focus/state
dimensions and explicitly records required keys that are not implemented.

## Required keys

| Key | Prompt / idle | Modal / approval | Running / streaming | Evidence | Result |
| --- | --- | --- | --- | --- | --- |
| Enter | Submit a non-empty task/command once; ignore empty/whitespace | Advance/save provider, confirm skill target | Prompt is inactive while the Run owns input | `inputs.render.test.tsx`; provider and workflow E2E | Pass |
| Escape | Clear prompt/palette | Cancel Provider/Skill picker | Does not leak into inactive prompt | `inputs.render.test.tsx`; ConPTY prompt journey | Pass |
| Ctrl+C | Clear non-empty prompt, then exit when empty | Blocking surface retains ownership | Abort active provider/run and return prompt control | render, lifecycle and stop E2E | Pass |
| Ctrl+Enter | Insert newline when a distinct modified sequence is exposed | No modal binding | Prompt inactive | `prompt-editor.test.ts` | Pass at decoder level; terminal encoding varies |
| Ctrl+W | Delete previous word at cursor | Edit active provider field | Prompt inactive | `inputs.render.test.tsx` | Pass |
| Ctrl+U | Clear input | Clear active provider field | Prompt inactive | render plus native Provider E2E | Pass |
| Backspace | Delete previous Unicode code point; handles BS/DEL variants | Edit active provider field | Prompt inactive | `prompt-editor.test.ts`; `inputs.render.test.tsx` | Pass |
| Delete | Delete at cursor | Edit active provider field | Prompt inactive | render plus native prompt journey | Pass |
| Tab | Complete/select next command suggestion | No public generic modal-tab route | Prompt inactive | `inputs.render.test.tsx` | Pass for implemented route |
| Shift+Tab | Reverse-select command suggestion | No public generic modal-tab route | Prompt inactive | `inputs.render.test.tsx` | Pass for implemented route |
| Arrow keys | Left/right cursor; up/down suggestion/history | Up/down Provider/Skill selection | Prompt inactive | render plus native prompt journey | Pass |
| PageUp | No application binding | No application binding | Terminal scrollback remains terminal-owned | generated inventory | Not implemented |
| PageDown | No application binding | No application binding | Terminal scrollback remains terminal-owned | generated inventory | Not implemented |
| Home | Move cursor to start | No modal binding | Prompt inactive | render plus native prompt journey | Pass |
| End | Move cursor to end | No modal binding | Prompt inactive | render plus native prompt journey | Pass |

## Additional public input

| Surface | Keys / input | Evidence | Result |
| --- | --- | --- | --- |
| Prompt | Plain text, CJK, bounded multiline bracketed paste, control filtering | unit, Ink render and native ConPTY prompt tests | Pass |
| Approval | `Y` approves; `N` or `Q` rejects | render and patch/command E2E | Pass |
| Provider picker | Up/Down, Enter, Escape; field editing keys | render and provider E2E | Pass |
| Skill install picker | Up/Down, Enter, Escape/Q | Ink render tests | Pass at component level |
| Terminal | Resize across 120x40, 100x30, 80x24, 60x20 and below minimum | render and native ConPTY | Pass |

Thirteen of the fifteen required key groups have committed automated evidence.
PageUp and PageDown are not advertised as application shortcuts; native
terminal scrollback is the current alternative. Focus coverage includes idle,
modal/approval, streaming/cancellation, completion and post-restart flows.
