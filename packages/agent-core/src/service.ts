import type {
  AgentEvent,
  AgentRun,
  AgentRunDetail,
  AgentRunState,
  AgentSettings,
  AgentStepType,
  LLMProvider,
  RunCommandOutput,
} from "@coding-agent/shared";
import { TOOL_LIMITS } from "@coding-agent/shared";
import type { Storage } from "@coding-agent/storage";
import { detectProject } from "@coding-agent/project-indexer";
import { isCommandAllowed } from "@coding-agent/sandbox";
import {
  CODING_AGENT_PLAN_PROMPT,
  PATCH_GENERATION_PROMPT,
  parsePlan,
  stripDiffFences,
} from "@coding-agent/llm";
import {
  applyPatchTool,
  listFilesTool,
  readFileTool,
  runCommandTool,
  searchTextTool,
} from "@coding-agent/tools";
import { extractFilePaths, isExplainTask } from "./intent.js";
import { rollbackRun } from "./rollback.js";

const EXPLAIN_PROMPT = `你是一个本地 Coding Agent。请阅读给定文件内容，用结构化的中文解释其执行流程、关键函数和数据流。不要修改任何文件，不要输出 diff。`;

export type AgentDeps = {
  storage: Storage;
  /**
   * Resolve the active LLM provider from current settings. Called once per run
   * so saved configuration changes take effect without a restart. May throw a
   * readable error (e.g. missing API key) which is surfaced to the user.
   */
  resolveLLM: () => LLMProvider;
  /** Read the latest agent settings (shell toggle, confirmation, etc.). */
  getAgentSettings: () => AgentSettings;
  emit: (event: AgentEvent) => void;
};

type Pending = { patch: string; command: string | null };

/** GUI-agnostic agent orchestrator. One instance per main process. */
export class AgentService {
  private readonly storage: Storage;
  private readonly resolveLLM: () => LLMProvider;
  private readonly getAgentSettings: () => AgentSettings;
  private readonly emit: (event: AgentEvent) => void;
  private readonly pending = new Map<string, Pending>();
  private readonly controllers = new Map<string, AbortController>();

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
    return this.getDetail(runId);
  }

  rejectPatch(runId: string): AgentRunDetail {
    this.pending.delete(runId);
    this.addStep(runId, "message", "Patch rejected by user");
    this.setStatus(runId, "cancelled");
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

  async runTask(workspaceId: string, task: string): Promise<AgentRunDetail> {
    const ws = this.storage.getWorkspace(workspaceId);
    if (!ws) throw new Error("No workspace open");
    const run = this.storage.createRun(workspaceId, task);
    const controller = new AbortController();
    this.controllers.set(run.id, controller);
    const ctx = { workspaceRoot: ws.rootPath, runId: run.id, signal: controller.signal };

    try {
      this.addStep(run.id, "message", `Task: ${task}`);
      this.setStatus(run.id, "planning");

      // Resolve the provider from current settings; surfaces a readable error
      // (e.g. missing API key) before any tool work begins.
      const llm = this.resolveLLM();

      this.addStep(run.id, "tool_call", "list_files");
      const { files } = await listFilesTool.run({}, ctx);
      this.addStep(run.id, "tool_result", `Listed ${files.length} files`);
      this.throwIfAborted(controller);

      const plan = await this.makePlan(llm, task, files, controller.signal);
      this.addStep(run.id, "message", `Plan: ${plan.summary}`);

      if (isExplainTask(task)) {
        await this.explain(llm, run.id, ctx.workspaceRoot, task, plan.likelyFiles, controller.signal);
        return this.getDetail(run.id);
      }

      this.setStatus(run.id, "searching");
      const searchPaths = await this.search(run.id, plan.searchQueries, ctx);
      this.throwIfAborted(controller);

      this.setStatus(run.id, "reading");
      const fileBlocks = await this.readRelevant(
        run.id,
        dedupe([...plan.likelyFiles, ...searchPaths, ...extractFilePaths(task)]),
        ctx,
      );
      this.throwIfAborted(controller);

      this.setStatus(run.id, "editing");
      const patch = await this.makePatch(llm, task, fileBlocks, controller.signal);
      if (!patch) {
        this.addStep(run.id, "error", "LLM returned no diff; nothing to apply");
        this.setStatus(run.id, "failed");
        return this.getDetail(run.id);
      }

      this.addStep(run.id, "diff", patch);
      this.emit({ kind: "patch_ready", runId: run.id, patch });
      this.pending.set(run.id, { patch, command: this.pickCommand(ctx.workspaceRoot, plan) });
      this.setStatus(run.id, "waiting_for_user_approval");
      return this.getDetail(run.id);
    } catch (err) {
      if (controller.signal.aborted) {
        this.addStep(run.id, "message", "Run cancelled by user");
        this.setStatus(run.id, "cancelled");
      } else {
        this.addStep(run.id, "error", asMessage(err));
        this.setStatus(run.id, "failed");
      }
      return this.getDetail(run.id);
    } finally {
      this.controllers.delete(run.id);
    }
  }

  async applyPatch(runId: string): Promise<AgentRunDetail> {
    const run = this.storage.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const ws = this.storage.getWorkspace(run.workspaceId);
    if (!ws) throw new Error("No workspace open");
    const pending = this.pending.get(runId) ?? this.derivePending(runId);
    if (!pending) throw new Error("No pending patch to apply");

    const controller = new AbortController();
    this.controllers.set(runId, controller);
    const ctx = { workspaceRoot: ws.rootPath, runId, signal: controller.signal };

    try {
      this.setStatus(runId, "applying_patch");
      this.addStep(runId, "tool_call", "apply_patch");
      const result = await applyPatchTool({ runId, patch: pending.patch }, ctx, this.storage);
      this.addStep(runId, "tool_result", `Applied to: ${result.changedFiles.join(", ")}`);

      const settings = this.getAgentSettings();
      if (!pending.command) {
        this.addStep(runId, "message", "No validation command available; applied without running tests");
        this.setStatus(runId, "done");
      } else if (!settings.allowShellExecution) {
        this.addStep(
          runId,
          "message",
          `补丁已应用。Shell 执行已在设置中禁用，跳过验证命令：${pending.command}`,
        );
        this.setStatus(runId, "done");
      } else if (settings.requireConfirmationBeforeCommand) {
        this.addStep(
          runId,
          "message",
          `补丁已应用。验证命令需手动确认后执行（可在底部"运行测试"运行）：${pending.command}`,
        );
        this.setStatus(runId, "done");
      } else {
        this.setStatus(runId, "running_command");
        this.addStep(runId, "command", `$ ${pending.command}`);
        const out = await runCommandTool.run({ command: pending.command }, ctx);
        this.addStep(runId, "command", formatCommandOutput(out));
        if (out.exitCode === 0 && !out.timedOut) {
          this.setStatus(runId, "done");
        } else {
          this.addStep(runId, "error", `Command failed (exit ${out.exitCode}${out.timedOut ? ", timed out" : ""})`);
          this.setStatus(runId, "failed");
        }
      }
      this.pending.delete(runId);
      return this.getDetail(runId);
    } catch (err) {
      this.addStep(runId, "error", asMessage(err));
      this.setStatus(runId, "failed");
      return this.getDetail(runId);
    } finally {
      this.controllers.delete(runId);
    }
  }

  // --- internal helpers ---

  private async makePlan(
    llm: LLMProvider,
    task: string,
    files: string[],
    signal?: AbortSignal,
  ): Promise<ReturnType<typeof parsePlan>> {
    const fileList = files.slice(0, 200).join("\n");
    const out = await llm.complete({
      messages: [
        { role: "system", content: CODING_AGENT_PLAN_PROMPT },
        { role: "user", content: `用户任务：\n${task}\n\n项目文件列表：\n${fileList}` },
      ],
      temperature: 0.1,
      signal,
    });
    return parsePlan(out.text);
  }

  private async search(
    runId: string,
    queries: string[],
    ctx: { workspaceRoot: string; runId: string; signal?: AbortSignal },
  ): Promise<string[]> {
    const paths: string[] = [];
    for (const query of queries.slice(0, 3)) {
      this.addStep(runId, "tool_call", `search_text "${query}"`);
      try {
        const { matches } = await searchTextTool.run({ query }, ctx);
        this.addStep(runId, "tool_result", `${matches.length} matches for "${query}"`);
        for (const m of matches) paths.push(m.path);
      } catch (err) {
        this.addStep(runId, "error", `search_text failed: ${asMessage(err)}`);
      }
    }
    return dedupe(paths);
  }

  private async readRelevant(
    runId: string,
    candidates: string[],
    ctx: { workspaceRoot: string; runId: string; signal?: AbortSignal },
  ): Promise<string[]> {
    const blocks: string[] = [];
    for (const path of candidates.slice(0, TOOL_LIMITS.maxReadFilesPerRun)) {
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

  private async makePatch(
    llm: LLMProvider,
    task: string,
    fileBlocks: string[],
    signal?: AbortSignal,
  ): Promise<string> {
    const out = await llm.complete({
      messages: [
        { role: "system", content: PATCH_GENERATION_PROMPT },
        {
          role: "user",
          content: `用户任务：\n${task}\n\n相关文件内容：\n${fileBlocks.join("\n\n") || "(无)"}`,
        },
      ],
      temperature: 0.1,
      signal,
    });
    return stripDiffFences(out.text);
  }

  private async explain(
    llm: LLMProvider,
    runId: string,
    workspaceRoot: string,
    task: string,
    likelyFiles: string[],
    signal?: AbortSignal,
  ): Promise<void> {
    const candidates = dedupe([...extractFilePaths(task), ...likelyFiles]).slice(0, 4);
    const blocks = await this.readRelevant(runId, candidates, { workspaceRoot, runId });
    const out = await llm.complete({
      messages: [
        { role: "system", content: EXPLAIN_PROMPT },
        { role: "user", content: `任务：${task}\n\n文件内容：\n${blocks.join("\n\n") || "(未找到文件)"}` },
      ],
      temperature: 0.2,
      signal,
    });
    const explanation = out.text.trim() || `已读取 ${candidates.length} 个文件。${candidates.join(", ")}`;
    this.addStep(runId, "message", explanation);
    this.setStatus(runId, "done");
  }

  private pickCommand(workspaceRoot: string, plan: ReturnType<typeof parsePlan>): string | null {
    const detected = detectProject(workspaceRoot).suggestedCommands;
    const fromPlan = plan.suggestedCommands.filter(isCommandAllowed);
    return detected[0] ?? fromPlan[0] ?? null;
  }

  private derivePending(runId: string): Pending | null {
    const steps = this.storage.listSteps(runId);
    const lastDiff = [...steps].reverse().find((s) => s.type === "diff");
    if (!lastDiff) return null;
    const run = this.storage.getRun(runId);
    const ws = run ? this.storage.getWorkspace(run.workspaceId) : null;
    const command = ws ? (detectProject(ws.rootPath).suggestedCommands[0] ?? null) : null;
    return { patch: lastDiff.content, command };
  }

  private addStep(runId: string, type: AgentStepType, content: string): void {
    const step = this.storage.addStep(runId, type, content);
    this.emit({ kind: "step_added", step });
  }

  private setStatus(runId: string, status: AgentRunState): void {
    const run = this.storage.updateRunStatus(runId, status);
    this.emit({ kind: "run_updated", run });
  }

  private throwIfAborted(controller: AbortController): void {
    if (controller.signal.aborted) throw new Error("aborted");
  }
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.filter((s) => s.length > 0))];
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
