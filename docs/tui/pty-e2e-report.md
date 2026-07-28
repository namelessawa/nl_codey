# Windows ConPTY end-to-end report

Date: 2026-07-29
Gate: `pnpm test:tui:e2e`
Provider: deterministic `mock`; ambient provider keys explicitly cleared
Credential file: `custom.txt` was not read

The gate launches the CLI through the real Windows ConPTY path in an isolated
temporary workspace and data root. Because the TUI opens SQLite, the test runs
inside the restorative Storage ABI matrix: Electron ABI is verified, the
cached host-Node binary is selected, the test runs, and Electron ABI is
restored and verified in `finally`.

Native PTY assertions run by default on interactive Windows. GitHub-hosted
Windows runners execute as non-interactive service sessions and have produced
no output bytes with system ConPTY, the bundled ConPTY DLL, or winpty. The
hosted workflows therefore set the explicit `NLC_SKIP_NATIVE_PTY=1` capability
flag. They still run the deterministic TUI unit/render suites and every other
default, integration, package, and installer gate. Interactive and self-hosted
Windows validation must leave the flag unset so all ten native PTY scenarios
remain mandatory.

| Document scenario | Evidence in the current gate | Result |
| --- | --- | --- |
| 1. First launch / mock / restart | A task is persisted, the process exits, and two later processes replay the latest valid session without running tools | Pass |
| 3. Patch approve + rollback | The patch is absent before `y`, appears after approval, and is removed by `/rollback` from persisted snapshots | Pass |
| 4. Patch reject | `n` reaches `cancelled`; the target file never appears and the prompt remains usable | Pass |
| Command approve / reject | A whitelisted command stays pending until `y`, then persists command/exit audit output; `n` reaches `cancelled` with no command step | Pass |
| Budget exhaustion | A one-iteration fixture reaches `budget_exceeded`, displays `max_iterations`, persists the exit reason, makes no patch, and returns prompt control | Pass |
| 7. Stop / cancel | Ctrl+C aborts delayed Mock streaming, reaches `cancelled`, makes no patch, and returns to `/help` | Pass |
| 10. Session resume / branch / tree | Unique-prefix `/resume`, `/tree`, real message-id branch, header ancestry, child `parentId`, and second restart are asserted | Pass |
| 11. Resize | Covered by `pnpm test:tui:pty`: resize below 80 columns hides the trace pane and exits cleanly | Pass |
| 12. Crash recovery | The process is killed at patch approval; restart links SQLite Run to JSONL Session, marks it interrupted once, and leaves the patch absent | Pass |

The E2E code never writes a session file directly. It reads the produced JSONL
only after driving public TUI input, to assert the session header and message
parent chain. Approval and rollback evidence similarly observes the workspace
before and after public key/command input.

Still open from the document's 14-scenario matrix: provider configuration,
redacted error display, and large-output/scrollback behavior. These remain
explicit blockers rather than inferred coverage.
