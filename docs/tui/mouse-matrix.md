# TUI mouse support matrix

Date: 2026-07-29
Classification: **Experimental**

The application does not install a mouse handler and does not enable terminal
mouse tracking. The only mouse-adjacent behavior is terminal-owned wheel
scrollback, which varies with the terminal host. `/help` states:

> Mouse: Experimental - terminal scrollback wheel only; clicks and input
> capture are unsupported.

## Contract and evidence

| Goal v2 mouse behavior | Supported contract | Evidence / result |
| --- | --- | --- |
| Product disclosure | Experimental; no claim of full mouse support | Unit help-catalogue assertion plus real ConPTY `/help` assertion |
| Enable / disable mouse capture | Application never enables capture | PTY harness scans output for known X10, VT200, button-event, any-event, UTF-8, SGR and urxvt enable sequences; lifecycle test requires none |
| Click | Unsupported | No handler discovered; explicit product copy |
| Double-click | Unsupported | No handler discovered; explicit product copy |
| Wheel | Terminal-native scrollback only | 320-row E2E proves native scrollback retention/navigation without claiming a mouse event |
| Modal item selection | Unsupported by mouse; use keyboard | Provider/Skill keyboard routes are inventoried |
| Tab selection | No tab-bar surface exists | N/A |
| Provider selection | Unsupported by mouse; use Up/Down/Enter | Keyboard render and E2E evidence |
| Session selection | Session list/tree are stream text, not clickable | Use `/resume`, `/branch`, `/tree` |
| Resize coordinate update | No application mouse coordinates exist | N/A |
| Mouse input entering Prompt | Tracking is never enabled, so the app receives no encoded mouse events | Lifecycle no-enable assertion |
| Normal-exit mode restore | No application mouse mode was entered | Lifecycle process exit plus no-enable assertion |
| Crash mode restore | No application mouse mode was entered | Crash/recovery and five-cycle cleanup soak |

## Known terminal boundary

Text selection, copy behavior and wheel scrollback are owned by Windows
Terminal or another host. They are not normalized by Ink and are not portable
application actions. A release-candidate human check must still verify that
wheel scrolling and selection behave acceptably in the named terminal, and
must record the result in `manual-verification.md`.
