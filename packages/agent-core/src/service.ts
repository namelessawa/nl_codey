import type {
  AgentEvent,
  AgentRun,
  AgentRunDetail,
  AgentRunState,
  AgentSettings,
  AgentStepType,
  BudgetLimits,
  ChatLLMProvider,
  LanguagePreference,
  LLMMessage,
  LLMToolCall,
  RunCommandOutput,
  SandboxPolicy,
  TestFailureReport,
  ToolContext,
} from "@coding-agent/shared";
import { clampBudgetLimits, contextWindowFor, DEFAULT_BUDGET_LIMITS } from "@coding-agent/shared";
import type { FileChange } from "@coding-agent/sandbox";
import type { Storage } from "@coding-agent/storage";
import { detectProject } from "@coding-agent/project-indexer";
import { listFilesTool, parseTestFailure, runCommandWithPolicy } from "@coding-agent/tools";
import { rollbackRun } from "./rollback.js";
import { BudgetController } from "./budget.js";
import { runToolLoop, type ToolLoopOutcome } from "./loop.js";
import { agentToolSchemas, createToolExecutor } from "./tools-registry.js";
import { getReadonlySystemPrompt, getSystemPrompt } from "./prompts.js";
import { getSummarizePrompt } from "./compressor.js";
import { evaluateVerification } from "./verifier.js";
import { analyzeRegressions, regressionNote } from "./regression.js";

const MAX_INITIAL_FILES = 200;
const MAX_STEP_CONTENT = 4000;

export type AgentDeps = {
  storage: Storage;
  /**
   * Resolve the active streaming LLM provider from current settings. Called once
   * per run so saved configuration changes take effect without a restart. May
   * throw a readable error (e.g. missing API key) which is surfaced to the user.
   */
  resolveLLM: () => ChatLLMProvider;
  /** Read the latest agent settings (shell toggle, confirmation, etc.). */
  getAgentSettings: () => AgentSettings;
  /**
   * Read the user's UI language preference. The agent system prompt and the
   * compression prompt are emitted in this language so the model thinks and
   * replies in the user's language. Optional — when missing, prompts default
   * to zh-CN for backwards compatibility with the original behaviour.
   */
  getLanguage?: () => LanguagePreference;
  /**
   * Optional gate consulted before EVERY tool dispatch — including the
   * LLM-initiated tool calls inside the autonomous loop. The installation
   * gate (apps/desktop/src/main/installation-gate.ts) uses this to refuse
   * `run_command`/`apply_patch`/`write_file` when Docker is missing and
   * the user opted to skip the install prompt.
   *
   * Must throw a readable Error to deny the call; the executor catches it
   * and feeds the message back to the model so the run can continue with
   * a different action instead of crashing.
   */
  assertToolAllowed?: (toolName: string) => void;
  /**
   * Optional fixed read-only override. When set, every run forces query-only
   * mode regardless of {@link AgentSettings.readOnly}. Useful for headless
   * tests and CI harnesses; production wiring should leave this undefined
   * and let the per-run settings drive the behaviour instead.
   */
  readOnly?: boolean;
  emit: (event: AgentEvent) => void;
};

/**
 * A {@link Pending} entry parks the loop while it waits on the user.
 *
 * - `patch`: the LLM emitted an `apply_patch` tool call — `patch` is the V4A
 *   or unified diff the model wants to apply.
 * - `command_writeback`: an LLM-initiated `run_command` running in
 *   docker/wsl mode produced file changes; `patch` is the unified diff we
 *   synthesised so the GUI's existing diff renderer can preview the changes.
 *
 * Both shapes share the same {@link Approval} lifecycle (resolved by the
 * applyPatch / rejectPatch IPC); the kind discriminates only for logging.
 */
type Pending =
  | { kind: "patch"; patch: string; command: string | null }
  | { kind: "command_writeback"; patch: string; command: string }
  | { kind: "command_confirm"; patch: string; command: string };
type Approval = { resolve: (approved: boolean) => void };

/** GUI-agnostic agent orchestrator. One instance per main process. */
export class AgentService {
  private readonly storage: Storage;
  private readonly resolveLLM: () => ChatLLMProvider;
  private readonly getAgentSettings: () => AgentSettings;
  private readonly getLanguage: () => LanguagePreference;
  private readonly assertToolAllowed: ((toolName: string) => void) | undefined;
  /** Hard override; when undefined, per-run settings.agent.readOnly wins. */
  private readonly readOnlyOverride: boolean | undefined;
  private readonly emit: (event: AgentEvent) => void;
  private readonly pending = new Map<string, Pending>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly approvals = new Map<string, Approval>();
  /** Pristine test-failure baseline per run, for the regression guard. */
  private readonly baselines = new Map<string, TestFailureReport | null>();

  constructor(deps: AgentDeps) {
    this.storage = deps.storage;
    this.resolveLLM = deps.resolveLLM;
    this.getAgentSettings = deps.getAgentSettings;
    // Default to zh-CN so prior callers (and tests that don't wire getLanguage)
    // see the original behaviour.
    this.getLanguage = deps.getLanguage ?? ((): LanguagePreference => "zh-CN");
    this.assertToolAllowed = deps.assertToolAllowed;
    this.readOnlyOverride = deps.readOnly;
    this.emit = deps.emit;
  }

  /** Effective read-only flag: hard override beats settings; default false. */
  private effectiveReadOnly(): boolean {
    if (this.readOnlyOverride !== undefined) return this.readOnlyOverride;
    return this.getAgentSettings().readOnly === true;
  }

  listRuns(workspaceId: string): AgentRun[] {
    return this.storage.listRuns(workspaceId);
  }

  /**
   * Wipe every run for a workspace (steps + snapshots cascade in storage).
   * Active runs are aborted first so background loops don't keep writing into
   * deleted rows; per-run in-memory state (controllers/approvals/baselines/
   * pending) is also purged.
   */
  clearRuns(workspaceId: string): { deleted: number } {
    const runs = this.storage.listRuns(workspaceId);
    for (const run of runs) {
      this.controllers.get(run.id)?.abort();
      const approval = this.approvals.get(run.id);
      if (approval) {
        this.approvals.delete(run.id);
        approval.resolve(false);
      }
      this.controllers.delete(run.id);
      this.pending.delete(run.id);
      this.baselines.delete(run.id);
    }
    const { deleted } = this.storage.deleteRunsForWorkspace(workspaceId);
    return { deleted };
  }

  getDetail(runId: string): AgentRunDetail {
    const run = this.storage.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const steps = this.storage.listSteps(runId);
    let pendingPatch: string | null = this.pending.get(runId)?.patch ?? null;
    if (!pendingPatch && run.status === "waiting_for_user_approval") {
      const lastDiff = [...steps].reverse().find((s) => s.type === "diff");
      pendingPatch = lastDiff?.content ?? null;
    }
    return { run, steps, pendingPatch };
  }

  stop(runId: string): AgentRunDetail {
    this.controllers.get(runId)?.abort();
    // Unblock a loop that is parked waiting for approval so it can observe abort.
    const approval = this.approvals.get(runId);
    if (approval) {
      this.approvals.delete(runId);
      approval.resolve(false);
    }
    return this.getDetail(runId);
  }

  rejectPatch(runId: string): AgentRunDetail {
    const approval = this.approvals.get(runId);
    this.pending.delete(runId);
    this.addStep(runId, "message", "Patch rejected by user");
    if (approval) {
      this.approvals.delete(runId);
      approval.resolve(false); // loop ends as cancelled
    } else {
      this.setStatus(runId, "cancelled");
    }
    return this.getDetail(runId);
  }

  rollback(runId: string): AgentRunDetail {
    const run = this.storage.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const ws = this.storage.getWorkspace(run.workspaceId);
    if (!ws) throw new Error(`Workspace not found: ${run.workspaceId}`);
    rollbackRun({
      workspaceRoot: ws.rootPath,
      snapshots: this.storage.listSnapshots(runId),
      addStep: (type, content) => this.addStep(runId, type, content),
    });
    this.pending.delete(runId);
    this.setStatus(runId, "cancelled");
    return this.getDetail(runId);
  }

  async runCommandDirect(workspaceId: string, command: string): Promise<RunCommandOutput> {
    const ws = this.storage.getWorkspace(workspaceId);
    if (!ws) throw new Error("No workspace open");
    if (!this.getAgentSettings().allowShellExecution) {
      throw new Error("Shell 执行已在设置中禁用，请在设置中开启后重试。");
    }
    // Direct user-typed run: the user explicitly invoked this command, so
    // any side effects belong to the project lifecycle. Apply writeback
    // automatically (still snapshotted so rollback works), no approval gate.
    return runCommandWithPolicy(
      { command },
      { workspaceRoot: ws.rootPath, runId: "adhoc" },
      {
        policy: this.sandboxPolicy(),
        writeback: { kind: "auto" },
        snapshotStore: this.storage,
      },
    );
  }

  /**
   * Build the active sandbox policy from current settings. When the user has
   * disabled sandboxing (or left the legacy "whitelist" mode), commands run
   * through the host whitelist (Phase 2 behavior). Re-read per call so a user
   * toggling the mode in the GUI takes effect on the next command without a
   * restart.
   */
  private sandboxPolicy(): SandboxPolicy {
    const s = this.getAgentSettings();
    if (!s.sandboxEnabled || s.sandboxMode === "whitelist") {
      return { mode: "whitelist", allowNetwork: false };
    }
    return { mode: s.sandboxMode, allowNetwork: false };
  }

  /**
   * Start a run. Provider resolution happens synchronously; the tool-use loop
   * runs in the background and drives the UI via events, so this returns the
   * initial detail immediately.
   */
  async runTask(workspaceId: string, task: string): Promise<AgentRunDetail> {
    const ws = this.storage.getWorkspace(workspaceId);
    if (!ws) throw new Error("No workspace open");
    const run = this.storage.createRun(workspaceId, task);
    const controller = new AbortController();
    this.controllers.set(run.id, controller);

    let llm: ChatLLMProvider;
    try {
      llm = this.resolveLLM();
    } catch (err) {
      this.addStep(run.id, "error", asMessage(err));
      this.setStatus(run.id, "failed");
      this.controllers.delete(run.id);
      return this.getDetail(run.id);
    }

    this.storage.setRunModel(run.id, llm.model);
    this.addStep(run.id, "message", `Task: ${task}`);

    this.setStatus(run.id, "tool_use");
    const ctx: ToolContext = { workspaceRoot: ws.rootPath, runId: run.id, signal: controller.signal };
    const systemPrompt = this.effectiveReadOnly()
      ? getReadonlySystemPrompt(this.getLanguage())
      : getSystemPrompt(this.getLanguage());
    const initialMessages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: await this.buildInitialUserMessage(task, ctx) },
    ];
    void this.driveLoop(run.id, ws.rootPath, initialMessages, llm, controller).catch((err) => {
      this.addStep(run.id, "error", asMessage(err));
      this.setStatus(run.id, "failed");
      this.controllers.delete(run.id);
    });
    return this.getDetail(run.id);
  }

  /**
   * Continue a finished run with a follow-up task. The persisted conversation
   * (system + prior turns + tool calls + results) is loaded and a new user
   * message is appended, so the model sees full context. Re-runs the tool loop
   * on the same runId — sidebar entry stays put, step log extends.
   *
   * Throws if the run is currently in flight or has no persisted conversation
   * (older runs created before multi-turn was added).
   */
  async continueTask(runId: string, followUp: string): Promise<AgentRunDetail> {
    const run = this.storage.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const ws = this.storage.getWorkspace(run.workspaceId);
    if (!ws) throw new Error(`Workspace not found: ${run.workspaceId}`);
    if (this.controllers.has(runId)) {
      throw new Error("Run is already active — wait for it to finish or stop it first.");
    }
    const prior = this.storage.loadRunMessages(runId);
    if (prior.length === 0) {
      throw new Error(
        "This run predates multi-turn support; no conversation was persisted. Start a new run instead.",
      );
    }

    const controller = new AbortController();
    this.controllers.set(runId, controller);

    let llm: ChatLLMProvider;
    try {
      llm = this.resolveLLM();
    } catch (err) {
      this.addStep(runId, "error", asMessage(err));
      this.setStatus(runId, "failed");
      this.controllers.delete(runId);
      return this.getDetail(runId);
    }

    this.storage.setRunModel(runId, llm.model);
    this.addStep(runId, "message", `Follow-up: ${followUp}`);
    this.setStatus(runId, "tool_use");

    const messages: LLMMessage[] = [...prior, { role: "user", content: followUp }];
    void this.driveLoop(runId, ws.rootPath, messages, llm, controller).catch((err) => {
      this.addStep(runId, "error", asMessage(err));
      this.setStatus(runId, "failed");
      this.controllers.delete(runId);
    });
    return this.getDetail(runId);
  }

  /** Approve the pending apply_patch, resuming the loop. */
  async applyPatch(runId: string): Promise<AgentRunDetail> {
    const approval = this.approvals.get(runId);
    if (!approval) throw new Error("No pending patch to apply");
    this.approvals.delete(runId);
    this.pending.delete(runId);
    this.setStatus(runId, "applying_patch");
    approval.resolve(true);
    return this.getDetail(runId);
  }

  // --- internal: the tool-use loop ---

  private async driveLoop(
    runId: string,
    workspaceRoot: string,
    messages: LLMMessage[],
    llm: ChatLLMProvider,
    controller: AbortController,
  ): Promise<void> {
    const ctx: ToolContext = { workspaceRoot, runId, signal: controller.signal };
    const settings = this.getAgentSettings();
    // Snapshot read-only at loop entry so a settings change mid-run can't flip
    // the policy on the live conversation (would surprise the model and the
    // user). Followups re-enter driveLoop and re-read settings.
    const readOnly = this.effectiveReadOnly();
    const execute = createToolExecutor({
      ctx,
      storage: this.storage,
      allowShellExecution: settings.allowShellExecution,
      readOnly,
      sandboxPolicy: this.sandboxPolicy(),
      // Plumb the installation gate to the tool dispatcher so LLM-initiated
      // unsafe tool calls are also refused in degraded mode.
      ...(this.assertToolAllowed
        ? { assertToolAllowed: this.assertToolAllowed }
        : {}),
      // Sandbox writeback approval: only meaningful when the sandbox is
      // active. The executor falls back to "discard" when no callback is
      // wired, so omitting this on the whitelist path is safe.
      requestSandboxWriteApproval: (call, changes) =>
        this.awaitWritebackApproval(runId, call, changes),
    });
    const budget = new BudgetController(this.budgetLimits());

    // Regression guard: snapshot the test/build state before any edit in this
    // turn. For a continueTask, this re-baselines against the (already-modified)
    // workspace, which is correct — we want to detect regressions relative to
    // what passes now, not the original pristine state. Skipped in read-only
    // mode: no edits can happen, so there is nothing to guard against.
    if (!readOnly) {
      await this.captureBaseline(runId, ctx, settings.allowShellExecution);
    }

    try {
      const outcome = await runToolLoop(messages, {
        llm,
        tools: agentToolSchemas({ readOnly }),
        budget,
        signal: controller.signal,
        temperature: 0.2,
        onChunk: (chunk) => {
          if (chunk.type === "text_delta") {
            this.emit({ kind: "delta", runId, text: chunk.text });
          }
        },
        onAssistant: (text, _toolCalls, usage) => {
          if (text.trim()) this.addStep(runId, "message", text);
          this.storage.addRunUsage(runId, {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd: usage.costUsd,
            iterations: 1,
          });
          // Back to acting after each model turn (unless approval flips it).
          this.setStatus(runId, "tool_use");
        },
        compression: {
          contextWindow: contextWindowFor(llm.model),
          summarize: (text) => this.summarizeContext(llm, text, controller.signal),
          onCompressed: (count) =>
            this.addStep(runId, "message", `已压缩 ${count} 条历史消息以节省上下文。`),
        },
        verifyAfterPatch: (_call, result) =>
          this.verifyPatch(runId, ctx, settings.allowShellExecution, result),
        requiresApproval: (call) =>
          call.name === "apply_patch" ||
          (call.name === "run_command" && settings.requireConfirmationBeforeCommand),
        waitForApproval: (call) =>
          call.name === "run_command"
            ? this.awaitCommandConfirmation(runId, call)
            : this.awaitApproval(runId, call),
        onToolCall: (call) => {
          this.storage.addRunUsage(runId, { toolCalls: 1 });
          this.addStep(runId, "tool_call", `${call.name} ${summarizeArgs(call)}`.trim());
        },
        executeTool: async (call) => {
          const res = await execute(call);
          if (res.command) this.addStep(runId, "command", formatCommandOutput(res.command));
          this.addStep(
            runId,
            res.isError ? "error" : "tool_result",
            truncateStep(res.resultText),
          );
          return res.resultText;
        },
      });
      // Persist the full post-loop conversation so a follow-up (continueTask)
      // resumes from the exact state the model just left, including any mid-
      // loop compression.
      this.storage.saveRunMessages(runId, outcome.finalMessages);
      this.applyOutcome(runId, outcome);
    } finally {
      this.controllers.delete(runId);
      this.approvals.delete(runId);
      this.pending.delete(runId);
      this.baselines.delete(runId);
    }
  }

  /** The command used for baseline + post-patch verification, if any. */
  private verifyCommand(ctx: ToolContext): string | undefined {
    return detectProject(ctx.workspaceRoot).suggestedCommands[0];
  }

  /**
   * Regression guard: run the verification command once on the pristine project
   * before any edit, and remember which tests already failed. A `null` baseline
   * (shell disabled or no command) disables regression classification.
   */
  private async captureBaseline(
    runId: string,
    ctx: ToolContext,
    allowShellExecution: boolean,
  ): Promise<void> {
    const command = this.verifyCommand(ctx);
    if (!allowShellExecution || !command) {
      this.baselines.set(runId, null);
      return;
    }
    try {
      // Baseline runs the project's verify command (pytest/npm test/etc.) for
      // its pass/fail status. Cache files (`.pytest_cache`, `__pycache__`)
      // are already in the hard-ignore set so they never appear in diff;
      // anything else the test writes (coverage reports, etc.) is part of the
      // project's own lifecycle, so we auto-apply without prompting.
      const out = await runCommandWithPolicy({ command }, ctx, {
        policy: this.sandboxPolicy(),
        writeback: { kind: "auto" },
        snapshotStore: this.storage,
      });
      const report = parseTestFailure({
        command: out.command,
        stdout: out.stdout,
        stderr: out.stderr,
        exitCode: out.exitCode ?? 1,
      });
      this.baselines.set(runId, report);
      const n = report.failures.length;
      this.addStep(
        runId,
        "message",
        n === 0 ? `回归基线：\`${command}\` 初始通过。` : `回归基线：\`${command}\` 初始有 ${n} 个已存在的失败。`,
      );
    } catch (err) {
      this.baselines.set(runId, null);
      this.addStep(runId, "message", `无法建立回归基线（${asMessage(err)}），跳过回归检测。`);
    }
  }

  /**
   * Automatic post-patch verification: after an approved apply_patch writes,
   * run the project's verification command and feed the result back so the
   * model can repair failures (the verify→repair loop). New failures absent
   * from the baseline are flagged as regressions. Returns null to skip (patch
   * didn't actually apply, or shell execution is disabled).
   */
  private async verifyPatch(
    runId: string,
    ctx: ToolContext,
    allowShellExecution: boolean,
    patchResult: string,
  ): Promise<string | null> {
    if (!patchApplied(patchResult)) return null;
    if (!allowShellExecution) {
      this.addStep(runId, "message", "补丁已应用，但 shell 执行被禁用，跳过自动验证。");
      return "已应用补丁，但 shell 执行被禁用，无法自动验证。请在确认无误后向用户说明需要手动验证。";
    }

    const command = this.verifyCommand(ctx);
    if (!command) {
      this.addStep(runId, "message", "未检测到验证命令，跳过自动验证。");
      return null;
    }

    this.setStatus(runId, "verifying");
    this.addStep(runId, "tool_call", `verify $ ${command}`);
    let out;
    try {
      // Verify-after-patch runs the same project-native command as baseline;
      // same writeback policy applies (see captureBaseline).
      out = await runCommandWithPolicy({ command }, ctx, {
        policy: this.sandboxPolicy(),
        writeback: { kind: "auto" },
        snapshotStore: this.storage,
      });
    } catch (err) {
      this.addStep(runId, "error", `自动验证无法运行：${asMessage(err)}`);
      return `自动验证命令无法运行（${asMessage(err)}）。请检查后继续。`;
    }

    this.addStep(runId, "command", formatCommandOutput(out));
    const verdict = evaluateVerification(out);

    // Regression guard: classify current failures against the pristine baseline.
    const current = parseTestFailure({
      command: out.command,
      stdout: out.stdout,
      stderr: out.stderr,
      exitCode: out.exitCode ?? 1,
    });
    const analysis = analyzeRegressions(this.baselines.get(runId) ?? null, current);
    const note = regressionNote(analysis);
    if (note) this.addStep(runId, "error", note);

    this.addStep(runId, verdict.passed ? "tool_result" : "error", verdict.message);
    this.setStatus(runId, verdict.passed ? "tool_use" : "repairing");
    return note ? `${verdict.message}\n\n${note}` : verdict.message;
  }

  /**
   * Localised "budget exhausted" status line, surfaced to the user when the
   * loop hits its iteration / tool-call / cost cap.
   */
  private budgetExceededMessage(reason: string): string {
    return this.getLanguage() === "en-US"
      ? `Budget exhausted (${reason}). Changes already applied are preserved; you can roll back or continue manually.`
      : `预算耗尽（${reason}）。已应用的修改保留，可选择回滚或手动继续。`;
  }

  /** Summarize old conversation context via the LLM (compression callback). */
  private async summarizeContext(
    llm: ChatLLMProvider,
    text: string,
    signal: AbortSignal,
  ): Promise<string> {
    const out = await llm.complete({
      messages: [
        { role: "system", content: getSummarizePrompt(this.getLanguage()) },
        { role: "user", content: text },
      ],
      temperature: 0.2,
      signal,
    });
    return out.text.trim();
  }

  /** Park the loop until the user approves/rejects the pending patch. */
  private awaitApproval(runId: string, call: LLMToolCall): Promise<boolean> {
    const patch = patchArg(call);
    this.addStep(runId, "diff", patch);
    this.emit({ kind: "patch_ready", runId, patch });
    this.pending.set(runId, { kind: "patch", patch, command: null });
    this.setStatus(runId, "waiting_for_user_approval");
    return new Promise<boolean>((resolve) => {
      this.approvals.set(runId, { resolve });
    });
  }

  /**
   * Park the loop on a docker/wsl run_command that produced file writes. The
   * user sees a synthesised unified diff in the existing approval UI; the
   * executor's `onApprove` callback waits on this promise and applies (or
   * discards) the staged changes based on the user's choice.
   */
  private awaitWritebackApproval(
    runId: string,
    call: LLMToolCall,
    changes: FileChange[],
  ): Promise<boolean> {
    const command = commandArg(call);
    const patch = synthesizeUnifiedDiff(changes);
    this.addStep(
      runId,
      "message",
      `命令 \`${command}\` 在沙盒内修改了 ${changes.length} 个文件，等待你审批后再同步到工作区。`,
    );
    this.addStep(runId, "diff", patch);
    this.emit({ kind: "patch_ready", runId, patch });
    this.pending.set(runId, { kind: "command_writeback", patch, command });
    this.setStatus(runId, "waiting_for_user_approval");
    return new Promise<boolean>((resolve) => {
      this.approvals.set(runId, { resolve });
    });
  }

  /**
   * Pre-execution approval for `run_command` calls when
   * {@link AgentSettings.requireConfirmationBeforeCommand} is on. The user
   * confirms that the command may run; the existing apply/reject IPC handlers
   * resolve the same approval promise (true → execute, false → skip).
   * The pending "patch" payload is a `$ <command>` line so the existing diff
   * renderer in the GUI can show it as a single context line; richer UI can
   * later branch on `Pending.kind`.
   */
  private awaitCommandConfirmation(runId: string, call: LLMToolCall): Promise<boolean> {
    const command = commandArg(call);
    const preview = `$ ${command}`;
    this.addStep(
      runId,
      "message",
      `等待你确认是否执行命令 \`${command}\`（已在设置中开启"运行前确认"）。`,
    );
    this.addStep(runId, "diff", preview);
    this.emit({ kind: "patch_ready", runId, patch: preview });
    this.pending.set(runId, { kind: "command_confirm", patch: preview, command });
    this.setStatus(runId, "waiting_for_user_approval");
    return new Promise<boolean>((resolve) => {
      this.approvals.set(runId, { resolve });
    });
  }

  private applyOutcome(runId: string, outcome: ToolLoopOutcome): void {
    switch (outcome.state) {
      case "done":
        this.storage.setRunExitReason(runId, "done");
        this.setStatus(runId, "done");
        break;
      case "failed":
        this.addStep(runId, "error", outcome.reason);
        this.storage.setRunExitReason(runId, "failed");
        this.setStatus(runId, "failed");
        break;
      case "cancelled":
        this.storage.setRunExitReason(runId, "cancelled");
        this.setStatus(runId, "cancelled");
        break;
      case "budget_exceeded":
        this.addStep(runId, "message", this.budgetExceededMessage(outcome.reason));
        this.storage.setRunExitReason(runId, outcome.reason);
        this.setStatus(runId, "budget_exceeded");
        break;
    }
  }

  private async buildInitialUserMessage(task: string, ctx: ToolContext): Promise<string> {
    let fileList = "(unavailable)";
    try {
      const { files } = await listFilesTool.run({}, ctx);
      fileList = files.slice(0, MAX_INITIAL_FILES).join("\n");
    } catch {
      // Non-fatal: the model can still call list_files itself.
    }
    const project = detectProject(ctx.workspaceRoot);
    const commands = project.suggestedCommands.join(", ") || "(none detected)";
    return [
      `用户任务：\n${task}`,
      `\n项目类型：${project.kind}；建议的验证命令：${commands}`,
      `\n项目文件（前 ${MAX_INITIAL_FILES}）：\n${fileList}`,
    ].join("\n");
  }

  /**
   * Build the per-run budget from the live agent settings. `maxAutoSteps` is
   * surfaced in the GUI as "auto-iteration ceiling", `budgetUsd` as "dollar
   * cap"; both run through {@link clampBudgetLimits} so a misconfigured
   * settings.json can never exceed the absolute hard caps.
   */
  private budgetLimits(): BudgetLimits {
    const s = this.getAgentSettings();
    return clampBudgetLimits({
      ...DEFAULT_BUDGET_LIMITS,
      maxIterations: s.maxAutoSteps,
      maxCostUsd: s.budgetUsd,
    });
  }

  private addStep(runId: string, type: AgentStepType, content: string): void {
    const step = this.storage.addStep(runId, type, content);
    this.emit({ kind: "step_added", step });
  }

  private setStatus(runId: string, status: AgentRunState): void {
    const run = this.storage.updateRunStatus(runId, status);
    this.emit({ kind: "run_updated", run });
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** True when an apply_patch tool result reports a successful write. */
function patchApplied(resultText: string): boolean {
  try {
    const parsed: unknown = JSON.parse(resultText);
    return typeof parsed === "object" && parsed !== null && (parsed as { applied?: unknown }).applied === true;
  } catch {
    return false;
  }
}

function patchArg(call: LLMToolCall): string {
  const args = call.args;
  if (typeof args === "object" && args !== null && "patch" in args) {
    const patch = (args as { patch: unknown }).patch;
    if (typeof patch === "string") return patch;
  }
  return "";
}

function commandArg(call: LLMToolCall): string {
  const args = call.args;
  if (typeof args === "object" && args !== null && "command" in args) {
    const cmd = (args as { command: unknown }).command;
    if (typeof cmd === "string") return cmd;
  }
  return "";
}

/**
 * Build a unified diff string from a sandbox change set so the existing
 * approval UI (which already renders unified diffs for `apply_patch`) can
 * preview a `run_command` writeback without a separate code path. Added /
 * deleted files use `/dev/null` markers the way git does. Plain text — no
 * locale-dependent formatting — so the front-end can rely on a stable shape.
 */
function synthesizeUnifiedDiff(changes: FileChange[]): string {
  const blocks: string[] = [];
  for (const change of changes) {
    if (change.kind === "added") {
      const lines = change.content.split("\n");
      // If the content ends with "\n", split() yields a trailing empty
      // element which would print as an empty "+" line — strip it.
      const trailingNewline = change.content.endsWith("\n");
      const bodyLines = trailingNewline ? lines.slice(0, -1) : lines;
      blocks.push(
        `--- /dev/null\n+++ b/${change.path}\n@@ -0,0 +1,${bodyLines.length} @@\n` +
          bodyLines.map((l) => `+${l}`).join("\n") +
          (bodyLines.length > 0 ? "\n" : ""),
      );
    } else if (change.kind === "deleted") {
      const lines = change.before.split("\n");
      const trailingNewline = change.before.endsWith("\n");
      const bodyLines = trailingNewline ? lines.slice(0, -1) : lines;
      blocks.push(
        `--- a/${change.path}\n+++ /dev/null\n@@ -1,${bodyLines.length} +0,0 @@\n` +
          bodyLines.map((l) => `-${l}`).join("\n") +
          (bodyLines.length > 0 ? "\n" : ""),
      );
    } else {
      // modified — emit a coarse "replace everything" hunk. Real per-line
      // hunking would require the `diff` package; the GUI renders this fine
      // as a unified diff, so we keep the synthesis dependency-light.
      const beforeLines = change.before.split("\n");
      const afterLines = change.after.split("\n");
      const trimTrailing = (lines: string[], src: string): string[] =>
        src.endsWith("\n") ? lines.slice(0, -1) : lines;
      const b = trimTrailing(beforeLines, change.before);
      const a = trimTrailing(afterLines, change.after);
      blocks.push(
        `--- a/${change.path}\n+++ b/${change.path}\n@@ -1,${b.length} +1,${a.length} @@\n` +
          b.map((l) => `-${l}`).join("\n") +
          (b.length > 0 ? "\n" : "") +
          a.map((l) => `+${l}`).join("\n") +
          (a.length > 0 ? "\n" : ""),
      );
    }
  }
  return blocks.join("\n");
}

function summarizeArgs(call: LLMToolCall): string {
  const args = call.args;
  if (typeof args !== "object" || args === null) return "";
  const record = args as Record<string, unknown>;
  if (typeof record.path === "string") return record.path;
  if (typeof record.query === "string") return `"${record.query}"`;
  if (typeof record.command === "string") return `$ ${record.command}`;
  if (typeof record.patch === "string") return "(patch)";
  return "";
}

function truncateStep(text: string): string {
  return text.length > MAX_STEP_CONTENT ? `${text.slice(0, MAX_STEP_CONTENT)}…(truncated)` : text;
}

function formatCommandOutput(out: RunCommandOutput): string {
  return [
    `$ ${out.command}`,
    `exit: ${out.exitCode}${out.timedOut ? " (timed out)" : ""}`,
    out.stdout ? `--- stdout ---\n${out.stdout}` : "",
    out.stderr ? `--- stderr ---\n${out.stderr}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
