# Windows ConPTY end-to-end report

Date: 2026-07-29
Gate: `pnpm test:tui:e2e`
Provider: deterministic `mock`; ambient provider keys explicitly cleared
Credential file: `custom.txt` was not read

The gate launches the bundled CLI through the real Windows ConPTY path in an
isolated temporary workspace and data root. Because the TUI opens SQLite, the
test runs inside the restorative Storage ABI matrix: Electron ABI is verified,
the cached host-Node binary is selected, the test runs, and Electron ABI is
restored and verified in `finally`.

| Document scenario | Evidence in the current gate | Result |
| --- | --- | --- |
| 1. First launch / mock / restart | A task is persisted, the process exits, and two later processes replay the latest valid session without running tools | Pass |
| 3. Patch approve + rollback | The patch is absent before `y`, appears after approval, and is removed by `/rollback` from persisted snapshots | Pass |
| 4. Patch reject | `n` reaches `cancelled`; the target file never appears and the prompt remains usable | Pass |
| 7. Stop / cancel | Ctrl+C aborts delayed Mock streaming, reaches `cancelled`, makes no patch, and returns to `/help` | Pass |
| 10. Session resume / branch / tree | Unique-prefix `/resume`, `/tree`, real message-id branch, header ancestry, child `parentId`, and second restart are asserted | Pass |
| 11. Resize | Covered by `pnpm test:tui:pty`: resize below 80 columns hides the trace pane and exits cleanly | Pass |

The E2E code never writes a session file directly. It reads the produced JSONL
only after driving public TUI input, to assert the session header and message
parent chain. Approval and rollback evidence similarly observes the workspace
before and after public key/command input.

Still open from the document's 14-scenario matrix: command approval/rejection,
budget exhaustion, provider configuration, crash-tail recovery, redacted error
display, and large-output/scrollback behavior. These remain explicit blockers
rather than inferred coverage.
