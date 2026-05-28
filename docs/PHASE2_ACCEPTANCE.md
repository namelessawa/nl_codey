# Phase 2 — Acceptance Scenarios

This document enumerates the acceptance scenarios for the Phase 2 autonomous,
observable, budget-controlled tool-use agent. Each scenario lists the steps, the
expected result, and where it is verified (automated test or manual GUI check).

Automated coverage runs under `pnpm test`. The only expected failures are the
three `packages/storage` tests, which fail under Node due to the documented
`better-sqlite3` Electron-vs-Node ABI mismatch — not a regression (see
`CLAUDE.md`).

---

## 1. Autonomous tool-use loop

**Scenario.** Open a workspace, enter a task, click **Run**.
**Expected.** The agent streams assistant text token-by-token, calls tools
(`list_files` / `search_text` / `find_symbol` / `read_file`) to explore, and
proposes a patch — without per-tool user prompts.
**Verified.** `loop.test.ts` (drives `list_files` → `apply_patch` → finish);
`acceptance.test.ts` (verify→repair→done).

## 2. Explicit patch approval (safety)

**Scenario.** The agent proposes an `apply_patch`.
**Expected.** The run parks in `waiting_for_user_approval`; nothing is written
until the user clicks **Apply Patch**. **Reject** cancels without writing.
**Verified.** `acceptance.test.ts` ("user rejects the patch" → no execution,
`cancelled`); `loop.test.ts` (rejects approval).

## 3. Automatic verification (Step 6)

**Scenario.** A patch is approved and written.
**Expected.** The agent runs the detected verification command, status moves to
`verifying`; on pass it returns to `tool_use`, on failure to `repairing` with a
parsed failure summary fed back.
**Verified.** `verifier.test.ts` (`evaluateVerification` pass/fail/timeout/parse);
`loop.test.ts` (`verifyAfterPatch` fires only after a successful patch).

## 4. Verify → repair loop (Step 6)

**Scenario.** Verification fails after the first patch.
**Expected.** The agent makes a minimal repair patch and re-verifies, finishing
once it passes.
**Verified.** `acceptance.test.ts` ("verify → repair → done": two patches, two
approvals, two verifications, outcome `done`).

## 5. Regression guard (Step 7)

**Scenario.** Some tests already fail before the agent starts.
**Expected.** A pristine baseline is captured; pre-existing failures are not
treated as regressions, while newly-introduced failures are flagged prominently
so the agent must fix them before finishing.
**Verified.** `regression.test.ts` (`analyzeRegressions` classification,
`regressionNote`).

## 6. Cumulative snapshots + rollback

**Scenario.** Multiple patches are applied across repair iterations, then the
user clicks **Rollback**.
**Expected.** Every applied patch is snapshotted before writing; rollback
restores all files in reverse order (created files removed).
**Verified.** `rollback` path in `service.ts`; `apply-patch.test.ts`
(transactional snapshot-before-write).

## 7. Budget circuit breaker (Step 3)

**Scenario.** A run exceeds its iteration / cost / tool-call / wall-time cap.
**Expected.** The loop stops with `budget_exceeded`; applied changes are kept
and remain rollback-able.
**Verified.** `budget.test.ts`; `acceptance.test.ts` ("budget circuit breaker");
`loop.test.ts` (trips on `maxIterations`).

## 8. Cancellation

**Scenario.** The user clicks **Stop** mid-run (including while parked for
approval).
**Expected.** The run ends `cancelled`; no further tools execute.
**Verified.** `loop.test.ts` (already-aborted signal; rejected approval).

## 9. Context compression (Step 13)

**Scenario.** A long run grows past 60% of the model's context window.
**Expected.** The conversation middle is summarized while the system prompt,
original task, and recent messages are preserved; the run continues.
**Verified.** `compressor.test.ts`; `loop.test.ts` (compresses an oversized
conversation before the next turn).

## 10. Resilient LLM requests (Step 15)

**Scenario.** A provider call hits a transient network error or a 429/5xx.
**Expected.** The request retries with exponential backoff (3 attempts) before
surfacing a readable, key-redacted error; a deliberate abort is never retried.
**Verified.** `http.test.ts` (`withRetries`, `postWithRetries`,
`isRetryableStatus`).

## 11. Observability — trace, timeline, budget (Steps 4, 8)

**Scenario.** During/after a run, inspect the center panel tabs.
**Expected.** **Steps** streams live; **Trace** shows timestamped, filterable
steps with durations and export; **Timeline** shows edit→verify→repair
iterations with status; the **BudgetIndicator** tracks cost/iterations/tools/
time against limits.
**Verified.** `iterations.test.ts` (`deriveIterations`); manual GUI check of the
Trace/Timeline tabs and BudgetIndicator.

## 12. Project card (Step 9)

**Scenario.** Open a workspace.
**Expected.** The left panel shows the detected project kind, preferred
validation commands, file count, and top extensions.
**Verified.** `project-card.test.ts` (`deriveProjectCard`); manual GUI check.

## 13. Symbol navigation (Step 10)

**Scenario.** The agent needs a symbol's definition.
**Expected.** `find_symbol` returns declarations by name across the project (or
lists a file's symbols), capped and workspace-bound.
**Verified.** `symbols.test.ts` (`extractSymbols` per language);
`tools-registry.test.ts` (`find_symbol` dispatch).

## 14. Evaluation suite (Step 14)

**Scenario.** Run the eval suite against the agent.
**Expected.** Each task seeds a workspace, runs the agent, and scores
deterministic checks; a pass-rate report is produced.
**Verified.** `eval/eval.test.ts` (checks, scoring, suite runner, 10 tasks
well-formed).

---

### Running the checks

```powershell
pnpm typecheck   # all 8 projects
pnpm test        # vitest (storage ABI failures expected under Node)
pnpm build       # production build (validates the renderer + bundling)
```
