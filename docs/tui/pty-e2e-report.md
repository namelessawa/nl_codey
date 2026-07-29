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
Windows validation must leave the flag unset so the default fifteen native PTY
tests and the separate five-cycle crash soak remain mandatory.

| Document scenario | Evidence in the current gate | Result |
| --- | --- | --- |
| 1. First launch / mock / restart | A task is persisted, the process exits, and two later processes replay the latest valid session without running tools | Pass |
| 2. Read-only analysis | Startup displays `read-only`; the Mock reads README, searches a marker, forges an unadvertised `apply_patch`, and the real dispatcher refuses it. TUI and SQLite retain the refusal, while a recursive workspace snapshot stays byte-identical | Pass |
| 3. Patch approve + rollback | The patch is absent before `y`, appears after approval, and is removed by `/rollback` from persisted snapshots | Pass |
| 4. Patch reject | `n` reaches `cancelled`; the target file never appears and the prompt remains usable | Pass |
| Command approve / reject | A whitelisted command stays pending until `y`, then persists command/exit audit output; `n` reaches `cancelled` with no command step | Pass |
| Budget exhaustion | A one-iteration fixture reaches `budget_exceeded`, displays `max_iterations`, persists the exit reason, makes no patch, and returns prompt control | Pass |
| 9. Provider configuration (partial) | `/provider` selects OpenAI, saves an empty-key `.invalid` endpoint, persists the active provider and `model_change`, then reloads that endpoint after restart without creating an agent Run. Invalid→valid correction plus a new Run using it remain | Partial |
| 13. Dynamic-tool construction failure | An explicit CLI service-composition fixture throws a multiline dynamic-tool factory error containing a forged Bearer token and the current user home. The real AgentService records one single-line `[security]` step; TUI, SQLite and JSONL contain only `[REDACTED]` / `[USER_HOME]`, the base agent degrades to `done`, and the prompt remains usable | Pass |
| 14. Large output / scrollback | A public `read_file` returns a 10 KB fixture; SQLite retains at most 4,000 characters with `…(truncated)` and omits the tail. The response then renders 320 numbered message rows: native xterm navigation recovers row 1, bottom restore shows row 320, SQLite/JSONL retain all rows, and `/help` remains usable. Pure reducer tests separately prove 500 stream-item and 200 trace-item memory bounds | Pass |
| 7. Stop / cancel | Ctrl+C aborts delayed Mock streaming, reaches `cancelled`, makes no patch, and returns to `/help` | Pass |
| 10. Session resume / branch / tree | Unique-prefix `/resume`, `/tree`, real message-id branch, header ancestry, child `parentId`, and second restart are asserted | Pass |
| 11. Resize | `pnpm test:tui:render` covers 120x40, 100x30, 80x24 and 60x20; real ConPTY hides trace below 80 columns, shows compact status/size chrome below 60x20 and restores the full frame after growth | Pass |
| Prompt editing | `pnpm test:tui:pty` sends bracketed multiline CJK paste, Escape, Home/End/Left/forward Delete, resizes a live draft through 50x16 and back to 60x20, recalls history and repeats `/help` | Pass |
| 12. Crash recovery | The process is killed at patch approval; restart links SQLite Run to JSONL Session, marks it interrupted once, and leaves the patch absent | Pass |
| Crash-tail soak | `pnpm test:tui:crash-soak` repeats approval termination/recovery five times; every root PID exits within the bound, recovery is visible, normal exit succeeds, and the fixture directory is immediately removable | Pass |

The E2E code never writes a session file directly. It reads the produced JSONL
only after driving public TUI input, to assert the session header and message
parent chain. Approval and rollback evidence similarly observes the workspace
before and after public key/command input.

The mapped lifecycle, prompt, agent/session and crash-tail behaviors above have
native PTY evidence. Exact completion of Scenario 9 plus explicit unsupported-
mouse product copy remain open.
