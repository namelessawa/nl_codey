import type {
  AgentEvent,
  AgentRun,
  AgentRunDetail,
  AgentRunState,
  AgentSettings,
  AgentStepType,
  BudgetLimits,
  ChatLLMProvider,
  LLMMessage,
  LLMToolCall,
  RunCommandOutput,
  TestFailureReport,
  ToolContext,
} from "@coding-agent/shared";
import { clampBudgetLimits, contextWindowFor, DEFAULT_BUDGET_LIMITS } from "@coding-agent/shared";
import type { Storage } from "@coding-agent/storage";
import { detectProject } from "@coding-agent/project-indexer";
import { listFilesTool, parseTestFailure, runCommandTool } from "@coding-agent/tools";
import { rollbackRun } from "./rollback.js";
import { BudgetController } from "./budget.js";
import { runToolLoop, type ToolLoopOutcome } from "./loop.js";
import { AGENT_TOOL_SCHEMAS, createToolExecutor } from "./tools-registry.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import { SUMMARIZE_PROMPT } from "./compressor.js";
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
  emit: (event: AgentEvent) => void;
};

type Pending = { patch: string; command: string | null };
type Approval = { resolve: (approved: boolean) => void };

/** GUI-agnostic agent orchestrator. One instance per main process. */
export class AgentService {
  private readonly storage: Storage;
  private readonly resolveLLM: () => ChatLLMProvider;
  private readonly getAgentSettings: () => AgentSettings;
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
    this.emit = deps.emit;
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
    return runCommandTool.run({ command }, { workspaceRoot: ws.rootPath, runId: "adhoc" });
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
    const initialMessages: LLMMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
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
    const execute = createToolExecutor({
      ctx,
      storage: this.storage,
      allowShellExecution: settings.allowShellExecution,
    });
    const budget = new BudgetController(this.budgetLimits());

    // Regression guard: snapshot the test/build state before any edit in this
    // turn. For a continueTask, this re-baselines against the (already-modified)
    // workspace, which is correct — we want to detect regressions relative to
    // what passes now, not the original pristine state.
    await this.captureBaseline(runId, ctx, settings.allowShellExecution);

    try {
      const outcome = await runToolLoop(messages, {
        llm,
        tools: AGENT_TOOL_SCHEMAS,
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
        requiresApproval: (call) => call.name === "apply_patch",
        waitForApproval: (call) => this.awaitApproval(runId, call),
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
      const out = await runCommandTool.run({ command }, ctx);
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
      out = await runCommandTool.run({ command }, ctx);
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

  /** Summarize old conversation context via the LLM (compression callback). */
  private async summarizeContext(
    llm: ChatLLMProvider,
    text: string,
    signal: AbortSignal,
  ): Promise<string> {
    const out = await llm.complete({
      messages: [
        { role: "system", content: SUMMARIZE_PROMPT },
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
    this.pending.set(runId, { patch, command: null });
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
        this.addStep(
          runId,
          "message",
          `预算耗尽（${outcome.reason}）。已应用的修改保留，可选择回滚或手动继续。`,
        );
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

  private budgetLimits(): BudgetLimits {
    return clampBudgetLimits(DEFAULT_BUDGET_LIMITS);
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
