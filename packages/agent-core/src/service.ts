import type {
  AgentEvent,
  AgentRun,
  AgentRunDetail,
  AgentRunState,
  AgentSettings,
  AgentStepType,
  BudgetLimits,
  ChatLLMProvider,
  LLMToolCall,
  RunCommandOutput,
  ToolContext,
} from "@coding-agent/shared";
import { clampBudgetLimits, DEFAULT_BUDGET_LIMITS } from "@coding-agent/shared";
import type { Storage } from "@coding-agent/storage";
import { detectProject } from "@coding-agent/project-indexer";
import { listFilesTool, readFileTool, runCommandTool } from "@coding-agent/tools";
import { extractFilePaths, isExplainTask } from "./intent.js";
import { rollbackRun } from "./rollback.js";
import { BudgetController } from "./budget.js";
import { runToolLoop, type ToolLoopOutcome } from "./loop.js";
import { AGENT_TOOL_SCHEMAS, createToolExecutor } from "./tools-registry.js";
import { SYSTEM_PROMPT } from "./prompts.js";

const EXPLAIN_PROMPT = `你是一个本地 Coding Agent。请阅读给定文件内容，用结构化的中文解释其执行流程、关键函数和数据流。不要修改任何文件，不要输出 diff。`;

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

  constructor(deps: AgentDeps) {
    this.storage = deps.storage;
    this.resolveLLM = deps.resolveLLM;
    this.getAgentSettings = deps.getAgentSettings;
    this.emit = deps.emit;
  }

  listRuns(workspaceId: string): AgentRun[] {
    return this.storage.listRuns(workspaceId);
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
   * Start a run. Provider resolution and the explain short-circuit happen
   * synchronously; the tool-use loop runs in the background and drives the UI
   * via events, so this returns the initial detail immediately.
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

    if (isExplainTask(task)) {
      this.setStatus(run.id, "reading");
      void this.driveExplain(run.id, ws.rootPath, task, llm, controller).catch((err) => {
        this.addStep(run.id, "error", asMessage(err));
        this.setStatus(run.id, "failed");
        this.controllers.delete(run.id);
      });
      return this.getDetail(run.id);
    }

    this.setStatus(run.id, "tool_use");
    void this.driveLoop(run.id, ws.rootPath, task, llm, controller).catch((err) => {
      this.addStep(run.id, "error", asMessage(err));
      this.setStatus(run.id, "failed");
      this.controllers.delete(run.id);
    });
    return this.getDetail(run.id);
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
    task: string,
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

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: await this.buildInitialUserMessage(task, ctx) },
    ];

    try {
      const outcome = await runToolLoop(messages, {
        llm,
        tools: AGENT_TOOL_SCHEMAS,
        budget,
        signal: controller.signal,
        temperature: 0.2,
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
      this.applyOutcome(runId, outcome);
    } finally {
      this.controllers.delete(runId);
      this.approvals.delete(runId);
      this.pending.delete(runId);
    }
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

  // --- internal: explain short-circuit (read-only, non-streaming) ---

  private async driveExplain(
    runId: string,
    workspaceRoot: string,
    task: string,
    llm: ChatLLMProvider,
    controller: AbortController,
  ): Promise<void> {
    try {
      const candidates = dedupe(extractFilePaths(task)).slice(0, 4);
      const blocks = await this.readRelevant(runId, candidates, {
        workspaceRoot,
        runId,
        signal: controller.signal,
      });
      const out = await llm.complete({
        messages: [
          { role: "system", content: EXPLAIN_PROMPT },
          { role: "user", content: `任务：${task}\n\n文件内容：\n${blocks.join("\n\n") || "(未找到文件)"}` },
        ],
        temperature: 0.2,
        signal: controller.signal,
      });
      const explanation = out.text.trim() || `已读取 ${candidates.length} 个文件。${candidates.join(", ")}`;
      this.addStep(runId, "message", explanation);
      this.storage.setRunExitReason(runId, "done");
      this.setStatus(runId, "done");
    } finally {
      this.controllers.delete(runId);
    }
  }

  private async readRelevant(
    runId: string,
    candidates: string[],
    ctx: ToolContext,
  ): Promise<string[]> {
    const blocks: string[] = [];
    for (const path of candidates) {
      this.addStep(runId, "tool_call", `read_file ${path}`);
      try {
        const { content } = await readFileTool.run({ path }, ctx);
        this.addStep(runId, "tool_result", `Read ${path} (${content.length} chars)`);
        blocks.push(`文件: ${path}\n\`\`\`\n${content}\n\`\`\``);
      } catch (err) {
        this.addStep(runId, "error", `read_file ${path} failed: ${asMessage(err)}`);
      }
    }
    return blocks;
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

function dedupe(items: string[]): string[] {
  return [...new Set(items.filter((s) => s.length > 0))];
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
