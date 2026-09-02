# Windows ConPTY end-to-end report

Date: 2026-07-29
Gate: `pnpm test:tui:e2e`
Provider: deterministic `mock` plus a loopback OpenAI-compatible protocol stub;
ambient provider keys explicitly cleared
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
Windows validation must leave the flag unset so the default eighteen native PTY
tests and the separate five-cycle crash soak remain mandatory.

| Document scenario | Evidence in the current gate | Result |
| --- | --- | --- |
| 1. First launch / mock / restart | A task is persisted, the process exits, and two later processes replay the latest valid session without running tools | Pass |
| 2. Read-only analysis | Startup displays `read-only`; the Mock reads README, searches a marker, forges an unadvertised `apply_patch`, and the real dispatcher refuses it. TUI and SQLite retain the refusal, while a recursive workspace snapshot stays byte-identical | Pass |
| 3. Patch approve + rollback | The patch is absent before `y`, appears after approval, and is removed by `/rollback` from persisted snapshots | Pass |
| 4. Patch reject | `n` reaches `cancelled`; the target file never appears and the prompt remains usable | Pass |
| Command approve / reject | A whitelisted command stays pending until `y`, then persists command/exit audit output; `n` reaches `cancelled` with no command step | Pass |
| Budget exhaustion | A one-iteration fixture reaches `budget_exceeded`, displays `max_iterations`, persists the exit reason, makes no patch, and returns prompt control | Pass |
| 9. Provider configuration | `/provider` selects OpenAI with a synthetic key and a loopback endpoint that returns HTTP 400. The first Run persists `failed`; after restart the modal reloads the invalid setting, corrects only its endpoint, preserves the masked key, and a new Run receives deterministic SSE. The stub records `/v1/chat/completions`, Bearer auth, `gpt-4o` and `stream: true`; SQLite/JSONL persist the two model changes and the second `done` Run without displaying the key | Pass |
| Settings and Skill install | `/settings` renders the loopback provider/model/base URL, language and only “from environment” for the synthetic key. `/skills-generate` opens the real picker; Down then Up changes the target, no file exists before Enter, and project confirmation sends one `stream: false` completion to the local stub. The generated file appears only under project `.nlc/skills`, exact bytes match the validated response, `/skills` discovers it, and neither screen nor scrollback contains the key | Pass |
| 13. Dynamic-tool construction failure | An explicit CLI service-composition fixture throws a multiline dynamic-tool factory error containing a forged Bearer token and the current user home. The real AgentService records one single-line `[security]` step; TUI, SQLite and JSONL contain only `[REDACTED]` / `[USER_HOME]`, the base agent degrades to `done`, and the prompt remains usable | Pass |
| 14. Large output / scrollback | A public `read_file` returns a 10 KB fixture; SQLite retains at most 4,000 characters with `…(truncated)` and omits the tail. The response then renders 320 numbered message rows: native xterm navigation recovers row 1, bottom restore shows row 320, SQLite/JSONL retain all rows, and `/help` remains usable. Pure reducer tests separately prove 500 stream-item and 200 trace-item memory bounds | Pass |
| 7. Stop / cancel | Ctrl+C aborts delayed Mock streaming, reaches `cancelled`, makes no patch, and returns to `/help` | Pass |
| 10. Session resume / branch / tree | Unique-prefix `/resume`, `/tree`, real message-id branch, header ancestry, child `parentId`, and restart are asserted. A second native journey creates root → child → grandchild lineage, explicitly branches from the active grandchild back to the root, rejects unknown resume/session/message targets without changing the active writer or file count, continues on the sibling and restores it after restart. An outside absolute `/resume` is rejected without reading its private payload. A public-created child receives a truncated tail plus invalid-header sibling, recovers valid history, then has its active file replaced by a directory: TUI reports the real write failure, Agent work continues, the Run remains unlinked, and no failed-capture message enters JSONL | Pass |
| 11. Resize | `pnpm test:tui:render` covers 120x40, 100x30, 80x24 and 60x20; real ConPTY hides trace below 80 columns, shows compact status/size chrome below 60x20 and restores the full frame after growth | Pass |
| Prompt editing | `pnpm test:tui:pty` sends bracketed multiline CJK paste, Escape, Home/End/Left/forward Delete, recognizes PageUp/PageDown without changing the draft, resizes a live draft through 50x16 and back to 60x20, recalls history and repeats `/help` | Pass |
| Mouse boundary | `/help` labels terminal-native wheel scrollback Experimental and clicks/input capture unsupported. The real lifecycle harness scans split terminal output and proves no known mouse tracking enable sequence was emitted before clean exit | Pass (explicit unsupported contract) |
| Terminal modes | The harness tracks split DEC private-mode sequences. Normal `/exit` and idle Ctrl+C both observe cursor hide followed by cursor show, finish with the cursor visible, and prove the application never enters alternate-screen mode | Pass |
| 12. Crash recovery | The process is killed at patch approval; restart links SQLite Run to JSONL Session, marks it interrupted once, and leaves the patch absent | Pass |
| Crash-tail soak | `pnpm test:tui:crash-soak` repeats approval termination/recovery five times; every root PID exits within the bound, recovery is visible, normal exit succeeds, and the fixture directory is immediately removable | Pass |

The E2E code creates normal sessions only through public TUI input. The Session
fault case modifies that disposable public-created JSONL only after clean exit
to simulate a truncated crash tail and adds one invalid-header sibling. It then
drives restart, diagnostics and continued input through the public TUI.
Approval and rollback evidence similarly observes the workspace before and
after public key/command input.

All exact Goal v2 TUI scenarios and implemented UI-state cells now have native
PTY or named render/unit evidence. Session multilevel/cross-parent and
nonexistent-id breadth is closed. Release-candidate manual verification remains
separate product-completion work.
