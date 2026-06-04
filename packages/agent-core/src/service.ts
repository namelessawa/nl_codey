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
  RoleMessageRow,
  RunCommandOutput,
  SandboxPolicy,
  TaskNode,
  TaskNodeStatus,
  TestFailureReport,
  ToolContext,
  ToolSchema,
} from "@coding-agent/shared";
import { clampBudgetLimits, contextWindowFor, DEFAULT_BUDGET_LIMITS } from "@coding-agent/shared";
import type { FileChange } from "@coding-agent/sandbox";
import type { Storage } from "@coding-agent/storage";
import { detectProject } from "@coding-agent/project-indexer";
import { listFilesTool, parseTestFailure, runCommandWithPolicy } from "@coding-agent/tools";
import { rollbackRun } from "./rollback.js";
import { BudgetController } from "./budget.js";
import { runToolLoop, type ToolLoopOutcome } from "./loop.js";
import { agentToolSchemas, createToolExecutor, type ExecutedTool } from "./tools-registry.js";
import { getReadonlySystemPrompt, getSystemPrompt } from "./prompts.js";
import { getSummarizePrompt } from "./compressor.js";
import { evaluateVerification } from "./verifier.js";
import { analyzeRegressions, regressionNote } from "./regression.js";
import { runMultiAgentTask } from "./multi-agent.js";
import { parseRow as parseRoleMessageRow } from "@coding-agent/orchestrator";

/**
 * Optional Phase 4 prompt augmentation. Called once per new run with the
 * workspace id; returned text is appended after the base system prompt so the
 * model sees relevant cross-project patterns + style rules + the fine-tune
 * identity reminder. Implementations should respect their own feature flags
 * and return an empty string when Phase 4 is disabled.
 */
export type Phase4AugmentationFn = (workspaceId: string) => string;

/**
 * Optional Phase 3 port factory. Returns the live semantic-search / memory /
 * web ports for the given workspace, or `null` when Phase 3 is disabled. The
 * factory is called once per run so settings changes (API keys, sandbox mode)
 * take effect on the next task without requiring a restart.
 */
import type { Phase3AgentPorts } from "./phase3-schemas.js";
export type Phase3PortsFn = (workspaceId: string) => Phase3AgentPorts | null;

/**
 * A dynamically-loaded tool bundle (schemas the model sees + a dispatcher).
 * The plugin runtime is the primary consumer; other future runtimes (HTTP
 * tools, MCP servers, etc.) can plug in the same shape.
 *
 * {@link mutatingNames} lists the bundle-level tools whose declared
 * permissions allow workspace mutation (e.g. plugin tools that ask for
 * `write_workspace` or `run_command`). The agent loop uses this set to
 * extend two security gates that previously only knew about the built-in
 * mutating-tool names:
 *
 * - read-only mode strips these names from the advertised schemas AND
 *   refuses them at dispatch time, so a plugin can't edit files or run
 *   shell while the agent is in query-only mode.
 * - degraded mode (Docker missing + user skipped install) also refuses
 *   these names at dispatch time, mirroring the gate that already covers
 *   built-in `run_command` / `apply_patch` / `write_file`.
 *
 * When the bundle source can't classify mutation (an empty array or a
 * missing field) the agent treats every dynamic tool as non-mutating —
 * the historical behaviour. Bundle authors who care about read-only /
 * degraded gating MUST populate this.
 */
export type DynamicToolBundle = {
  schemas: readonly ToolSchema[];
  dispatch: (call: LLMToolCall, ctx: ToolContext) => Promise<ExecutedTool | null>;
  mutatingNames?: readonly string[];
};

/**
 * Optional dynamic tool bundle factory. Called once per driveLoop entry so a
 * plugin enabled mid-session lights up on the next task without restart.
 * Returns null when no dynamic tools are available.
 */
export type DynamicToolBundleFn = () => DynamicToolBundle | null;

const MAX_INITIAL_FILES = 200;
const MAX_STEP_CONTENT = 4000;

/**
 * Strip mutating dynamic-tool schemas from the bundle when read-only mode
 * is active. Returns the bundle unchanged when read-only is off, the
 * mutating set is empty, or the bundle itself is null.
 */
function filterDynamicBundleForReadOnly(
  bundle: DynamicToolBundle | null,
  readOnly: boolean,
): DynamicToolBundle | null {
  if (!bundle || !readOnly) return bundle;
  const mutating = bundle.mutatingNames ?? [];
  if (mutating.length === 0) return bundle;
  const mutSet = new Set(mutating);
  const safeSchemas = bundle.schemas.filter((s) => !mutSet.has(s.name));
  return {
    schemas: safeSchemas,
    dispatch: async (call, ctx) => {
      // Defense in depth: even if the model emits a mutating plugin call we
      // didn't advertise, refuse it before the bundle's dispatcher runs.
      if (mutSet.has(call.name)) {
        return {
          name: call.name,
          resultText: JSON.stringify({
            error:
              `Plugin tool "${call.name}" is disabled while the agent is in ` +
              `read-only (query) mode (declares run_command / write_workspace ` +
              `permission). Propose changes in prose instead.`,
          }),
          isError: true,
        };
      }
      return bundle.dispatch(call, ctx);
    },
    mutatingNames: bundle.mutatingNames,
  };
}

/**
 * Wrap an `assertToolAllowed` callback so it ALSO refuses mutating
 * dynamic-tool names while the installation gate is in degraded mode. We
 * probe the gate by calling it with a known built-in unsafe name
 * (`run_command`) and inheriting whatever it threw — that way the gate's
 * own message phrasing wins and we don't duplicate the degraded-mode
 * detection logic on this side of the boundary.
 *
 * Returns the original callback when there are no mutating dynamic names
 * to gate (the common case for runs without plugins).
 */
function wrapAssertForDynamicPlugins(
  base: ((toolName: string) => void) | undefined,
  mutatingNames: readonly string[] | undefined,
): ((toolName: string) => void) | undefined {
  if (!base) return undefined;
  if (!mutatingNames || mutatingNames.length === 0) return base;
  const mutSet = new Set(mutatingNames);
  return (toolName: string): void => {
    base(toolName);
    if (!mutSet.has(toolName)) return;
    try {
      base("run_command");
    } catch {
      throw new Error(
        `Plugin tool "${toolName}" is disabled while Docker is missing and ` +
          `the installation gate is in degraded mode (this tool declares ` +
          `run_command or write_workspace permission). Install Docker or ` +
          `clear the skip flag from the red Docker badge in the top bar.`,
      );
    }
  };
}

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
  /**
   * Optional Phase 4 augmentation hook. Builds the cross-project pattern hints
   * + style spec + fine-tune identity reminder block and returns the text to
   * append after the base system prompt. When omitted (or returning an empty
   * string) the system prompt is unchanged, preserving Phase 1/2 behaviour.
   */
  getPhase4Augmentation?: Phase4AugmentationFn;
  /**
   * Optional Phase 3 port factory. When it returns a non-null bundle the
   * single-agent loop advertises semantic_search / read_memory / write_memory /
   * web_search / web_fetch in addition to the Phase 1/2 catalogue. Returning
   * null (or omitting the hook) keeps the model at the Phase 1/2 surface.
   */
  getPhase3Ports?: Phase3PortsFn;
  /**
   * Optional dynamic tool bundle factory (plugins, MCP servers, etc.). When
   * it returns non-null the bundle's schemas are advertised after Phase 1/2
   * + Phase 3, and its dispatcher is tried before the built-in switch so a
   * dynamic tool can't be shadowed by a built-in name collision.
   */
  getDynamicTools?: DynamicToolBundleFn;
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
  private readonly getPhase4Augmentation: Phase4AugmentationFn | undefined;
  private readonly getPhase3Ports: Phase3PortsFn | undefined;
  private readonly getDynamicTools: DynamicToolBundleFn | undefined;
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
    this.getPhase4Augmentation = deps.getPhase4Augmentation;
    this.getPhase3Ports = deps.getPhase3Ports;
    this.getDynamicTools = deps.getDynamicTools;
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
    const baseSystemPrompt = this.effectiveReadOnly()
      ? getReadonlySystemPrompt(this.getLanguage())
      : getSystemPrompt(this.getLanguage());
    // Phase 4 augmentation: cross-project pattern hints + style spec +
    // fine-tune identity reminder. The hook is responsible for honoring its
    // own feature flags; when disabled it returns an empty string and the
    // system prompt is unchanged.
    let augmentation = "";
    try {
      augmentation = this.getPhase4Augmentation?.(workspaceId) ?? "";
    } catch {
      // Augmentation is advisory — never let a Phase 4 lookup failure block a run.
      augmentation = "";
    }
    const systemPrompt = augmentation
      ? `${baseSystemPrompt}\n\n${augmentation}`
      : baseSystemPrompt;
    const initialMessages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: await this.buildInitialUserMessage(task, ctx) },
    ];
    // Route to the multi-agent driver when the user opted in; otherwise the
    // long-standing single-agent driveLoop. Multi-agent reuses the same
    // approval / sandbox / verify machinery via a thin adapter so safety
    // guarantees are identical.
    if (this.getAgentSettings().multiAgentEnabled) {
      void this.driveMultiAgentLoop(run.id, workspaceId, ws.rootPath, task, llm, controller).catch((err) => {
        this.addStep(run.id, "error", asMessage(err));
        this.setStatus(run.id, "failed");
        this.controllers.delete(run.id);
      });
      return this.getDetail(run.id);
    }
    void this.driveLoop(run.id, workspaceId, ws.rootPath, initialMessages, llm, controller).catch((err) => {
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
    void this.driveLoop(runId, run.workspaceId, ws.rootPath, messages, llm, controller).catch((err) => {
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
    workspaceId: string,
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
    // Resolve Phase 3 ports once per loop entry. A null return (or a thrown
    // error during construction) cleanly falls back to the Phase 1/2 surface;
    // failures here must NEVER block a normal run.
    let phase3Ports: Phase3AgentPorts | null = null;
    try {
      phase3Ports = this.getPhase3Ports?.(workspaceId) ?? null;
    } catch {
      phase3Ports = null;
    }
    // Resolve the dynamic tool bundle (plugins / future MCP servers) once per
    // loop entry. Same fail-safe: any failure produces null and the agent
    // keeps running on the Phase 1/2 + Phase 3 surface.
    let dynamicBundle: DynamicToolBundle | null = null;
    try {
      dynamicBundle = this.getDynamicTools?.() ?? null;
    } catch {
      dynamicBundle = null;
    }
    // Read-only mode: strip mutating dynamic tools from BOTH the advertised
    // schema and the dispatch path so a plugin can't sneak in a write.
    const safeBundle = filterDynamicBundleForReadOnly(dynamicBundle, readOnly);
    // Degraded mode: extend the installation gate to also refuse mutating
    // plugin tools (the gate's built-in name list only covers internal
    // run_command / apply_patch / write_file).
    const gateAssert = wrapAssertForDynamicPlugins(
      this.assertToolAllowed,
      dynamicBundle?.mutatingNames,
    );
    const execute = createToolExecutor({
      ctx,
      storage: this.storage,
      allowShellExecution: settings.allowShellExecution,
      readOnly,
      sandboxPolicy: this.sandboxPolicy(),
      // Plumb the installation gate to the tool dispatcher so LLM-initiated
      // unsafe tool calls are also refused in degraded mode.
      ...(gateAssert ? { assertToolAllowed: gateAssert } : {}),
      // Sandbox writeback approval: only meaningful when the sandbox is
      // active. The executor falls back to "discard" when no callback is
      // wired, so omitting this on the whitelist path is safe.
      requestSandboxWriteApproval: (call, changes) =>
        this.awaitWritebackApproval(runId, call, changes),
      // Phase 3 port bundle (semantic_search / memory / web). Omitted when
      // null so the executor's Phase 3 dispatcher stays disabled.
      ...(phase3Ports ? { phase3Ports } : {}),
      // Dynamic tool dispatcher (plugins / MCP). Tried before the built-in
      // switch so a plugin tool can't be shadowed by a name collision.
      ...(safeBundle ? { extraDispatcher: safeBundle.dispatch } : {}),
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
      let outcome: ToolLoopOutcome;
      try {
        outcome = await runToolLoop(messages, {
        llm,
        tools: agentToolSchemas({
          readOnly,
          phase3Available: !!phase3Ports,
          ...(safeBundle ? { extraSchemas: safeBundle.schemas } : {}),
        }),
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
          this.safeRunWrite(() =>
            this.storage.addRunUsage(runId, {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              costUsd: usage.costUsd,
              iterations: 1,
            }),
          );
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
          this.safeRunWrite(() => this.storage.addRunUsage(runId, { toolCalls: 1 }));
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
      } catch (loopErr) {
        // runToolLoop threw before reaching a terminal state (LLM stream
        // exception, unexpected callback failure, etc.). Without this branch
        // the run was marked `failed` by the outer .catch but `exit_reason`
        // stayed NULL — the user lost the ability to see WHY the run died.
        // Convert into a synthetic outcome so applyOutcome stamps exit_reason
        // consistently. signal-aborted errors map to cancelled so they don't
        // pollute the failure log.
        outcome = loopErrorToOutcome(loopErr, controller.signal.aborted, messages);
      }
      // Persist the full post-loop conversation so a follow-up (continueTask)
      // resumes from the exact state the model just left, including any mid-
      // loop compression. Race-safe: if the run was cleared concurrently the
      // write silently no-ops instead of crashing the loop tear-down.
      this.safeRunWrite(() => this.storage.saveRunMessages(runId, outcome.finalMessages));
      this.applyOutcome(runId, outcome);
    } finally {
      this.controllers.delete(runId);
      this.approvals.delete(runId);
      this.pending.delete(runId);
      this.baselines.delete(runId);
    }
  }

  /**
   * Multi-agent loop driver. Builds the same executor + Phase 3 ports + plugin
   * bundle the single-agent path uses, then hands them to runMultiAgentTask
   * which wires the Coordinator (Planner → Coder → Reviewer).
   *
   * Approval semantics:
   * - apply_patch / run_command inside coder turns still gate through the
   *   normal user-approval IPC (awaitApproval / awaitCommandConfirmation).
   * - The planner's DAG proposal is auto-approved with a recorded plan
   *   summary step. A future UI handler can intercept the approve() port to
   *   gate this explicitly; today we trust the planner's output because the
   *   model still has to surface concrete diffs through the standard gate.
   * - askHuman returns "cancel" by default — without a wired-up UI, the
   *   safe behaviour on a node failure is to halt rather than silently skip.
   */
  private async driveMultiAgentLoop(
    runId: string,
    workspaceId: string,
    workspaceRoot: string,
    userTask: string,
    llm: ChatLLMProvider,
    controller: AbortController,
  ): Promise<void> {
    const ctx: ToolContext = { workspaceRoot, runId, signal: controller.signal };
    const settings = this.getAgentSettings();
    const readOnly = this.effectiveReadOnly();
    let phase3Ports: Phase3AgentPorts | null = null;
    try {
      phase3Ports = this.getPhase3Ports?.(workspaceId) ?? null;
    } catch {
      phase3Ports = null;
    }
    let dynamicBundle: DynamicToolBundle | null = null;
    try {
      dynamicBundle = this.getDynamicTools?.() ?? null;
    } catch {
      dynamicBundle = null;
    }
    // Same plugin-aware read-only + degraded gates the single-agent path
    // installs. Multi-agent runs go through the same executor, so an
    // unfiltered dynamic bundle would let a plugin tool slip past both
    // gates here too.
    const safeBundle = filterDynamicBundleForReadOnly(dynamicBundle, readOnly);
    const gateAssert = wrapAssertForDynamicPlugins(
      this.assertToolAllowed,
      dynamicBundle?.mutatingNames,
    );

    const execute = createToolExecutor({
      ctx,
      storage: this.storage,
      allowShellExecution: settings.allowShellExecution,
      readOnly,
      sandboxPolicy: this.sandboxPolicy(),
      ...(gateAssert ? { assertToolAllowed: gateAssert } : {}),
      requestSandboxWriteApproval: (call, changes) =>
        this.awaitWritebackApproval(runId, call, changes),
      ...(phase3Ports ? { phase3Ports } : {}),
      ...(safeBundle ? { extraDispatcher: safeBundle.dispatch } : {}),
    });

    const baseSchemas: ToolSchema[] = agentToolSchemas({
      readOnly,
      phase3Available: !!phase3Ports,
      ...(safeBundle ? { extraSchemas: safeBundle.schemas } : {}),
    });

    const budget = new BudgetController(this.budgetLimits());

    this.addStep(runId, "message", `Multi-agent run started. Task: ${userTask}`);

    // Wrap the storage so every multi-agent write also broadcasts a
    // Phase-3 live event. The IPC contract (`task_updated` /
    // `role_message`) was declared but had no production emit points —
    // Phase 3 panels relied entirely on manual reload. This wrapping is
    // the minimum needed to let TaskTreeView / RoleTimeline refresh
    // without the user clicking around.
    const storageRef = this.storage;
    const emit = this.emit;
    const liveStore = {
      createTaskNode: (node: TaskNode): TaskNode => {
        const created = storageRef.createTaskNode(node);
        emit({ kind: "task_updated", runId, node: created });
        return created;
      },
      setTaskNodeStatus: (id: string, status: TaskNodeStatus): void => {
        storageRef.setTaskNodeStatus(id, status);
        const updated = storageRef.getTaskNode(id);
        if (updated) emit({ kind: "task_updated", runId, node: updated });
      },
      addRoleMessage: (row: RoleMessageRow): void => {
        storageRef.addRoleMessage(row);
        try {
          emit({
            kind: "role_message",
            runId,
            message: parseRoleMessageRow(row),
          });
        } catch {
          // A malformed payload is the bus's problem — never let an
          // emit failure unwind the storage write that already
          // succeeded.
        }
      },
    };

    try {
      const outcome = await runMultiAgentTask(
        {
          llm,
          store: liveStore,
          budget,
          ctx,
          signal: controller.signal,
          executor: execute,
          baseSchemas,
          approve: async () => {
            this.addStep(runId, "message", "Planner DAG auto-approved (configure approve() port to add an explicit gate).");
            return true;
          },
          askHuman: async (node, reason) => {
            this.addStep(
              runId,
              "error",
              `Node ${node.id} (${node.title}) needs human attention: ${reason}. Defaulting to cancel.`,
            );
            return "cancel";
          },
          requiresApproval: (call) =>
            call.name === "apply_patch" ||
            (call.name === "run_command" && settings.requireConfirmationBeforeCommand),
          waitForApproval: (call) =>
            call.name === "run_command"
              ? this.awaitCommandConfirmation(runId, call)
              : this.awaitApproval(runId, call),
          verifyAfterPatch: (_call, result) =>
            this.verifyPatch(runId, ctx, settings.allowShellExecution, result),
          onChunk: (chunk) => {
            if (chunk.type === "text_delta" && typeof chunk.text === "string") {
              this.emit({ kind: "delta", runId, text: chunk.text });
            }
          },
          onAssistant: (text, _toolCalls, usage) => {
            if (text.trim()) this.addStep(runId, "message", text);
            this.safeRunWrite(() =>
              this.storage.addRunUsage(runId, {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                costUsd: usage.costUsd,
                iterations: 1,
              }),
            );
            this.setStatus(runId, "tool_use");
          },
          onToolCall: (call) => {
            this.safeRunWrite(() => this.storage.addRunUsage(runId, { toolCalls: 1 }));
            this.addStep(runId, "tool_call", `${call.name} ${summarizeArgs(call)}`.trim());
          },
        },
        runId,
        userTask,
      );

      const finalStatus =
        outcome.status === "done"
          ? "done"
          : outcome.status === "cancelled"
            ? "cancelled"
            : "failed";
      const summary = buildMultiAgentSummary(userTask, outcome.status, outcome.nodes);
      this.addStep(
        runId,
        finalStatus === "done" ? "message" : "error",
        `Multi-agent run finished with status=${outcome.status} (${outcome.nodes.length} nodes).`,
      );
      // Persist a synthetic conversation so a follow-up via continueTask can
      // resume on the single-agent loop with the original task + node-by-node
      // recap as context. Without this, multi-agent runs were silently
      // un-continuable (loadRunMessages returned empty → "predates multi-turn").
      this.safeRunWrite(() =>
        this.storage.saveRunMessages(
          runId,
          buildMultiAgentRunMessages(this.getLanguage(), userTask, summary),
        ),
      );
      this.safeRunWrite(() => this.storage.setRunExitReason(runId, finalStatus));
      this.setStatus(runId, finalStatus);
    } catch (err) {
      const errSummary = `Multi-agent run failed: ${asMessage(err)}`;
      this.addStep(runId, "error", asMessage(err));
      // Even on error, preserve at least the user task so a follow-up has
      // somewhere to anchor. The synthetic assistant turn includes the
      // failure reason so the model can react appropriately.
      this.safeRunWrite(() =>
        this.storage.saveRunMessages(
          runId,
          buildMultiAgentRunMessages(this.getLanguage(), userTask, errSummary),
        ),
      );
      this.safeRunWrite(() => this.storage.setRunExitReason(runId, "failed"));
      this.setStatus(runId, "failed");
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
    // Every storage write is race-safe: if the user cleared this run while
    // the loop was tearing down, the writes silently no-op and the in-memory
    // tear-down (controllers/approvals/baselines) still runs in the finally.
    switch (outcome.state) {
      case "done":
        this.safeRunWrite(() => this.storage.setRunExitReason(runId, "done"));
        this.setStatus(runId, "done");
        break;
      case "failed":
        this.addStep(runId, "error", outcome.reason);
        this.safeRunWrite(() => this.storage.setRunExitReason(runId, "failed"));
        this.setStatus(runId, "failed");
        break;
      case "cancelled":
        this.safeRunWrite(() => this.storage.setRunExitReason(runId, "cancelled"));
        this.setStatus(runId, "cancelled");
        break;
      case "budget_exceeded":
        this.addStep(runId, "message", this.budgetExceededMessage(outcome.reason));
        this.safeRunWrite(() => this.storage.setRunExitReason(runId, outcome.reason));
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
    try {
      const step = this.storage.addStep(runId, type, content);
      this.emit({ kind: "step_added", step });
    } catch (err) {
      // Race with clearRuns: the run row was deleted while we still held an
      // active loop. The SQLite FK constraint fires on INSERT — swallow so
      // the doomed loop tears down quietly instead of unhandled-rejecting in
      // the main process. Re-throw anything else (real storage failure).
      if (isStaleRunStorageError(err)) return;
      throw err;
    }
  }

  private setStatus(runId: string, status: AgentRunState): void {
    try {
      const run = this.storage.updateRunStatus(runId, status);
      this.emit({ kind: "run_updated", run });
    } catch (err) {
      if (isStaleRunStorageError(err)) return;
      throw err;
    }
  }

  /**
   * Race-safe wrapper around an arbitrary storage write keyed on a runId.
   * Same swallow-FK-violation behaviour as {@link addStep}: when clearRuns
   * concurrently deleted the run, the write silently no-ops instead of
   * crashing the background loop. Real storage failures still propagate.
   */
  private safeRunWrite(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      if (isStaleRunStorageError(err)) return;
      throw err;
    }
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * True when `err` indicates the agent_runs row that a write was keyed on has
 * been deleted concurrently (the `clearRuns` race). Two shapes are recognised:
 *
 *  - better-sqlite3 throws `SqliteError` with `.code = SQLITE_CONSTRAINT_FOREIGNKEY`
 *    on FK-violating INSERTs (addStep, addSnapshot, saveRunMessages, …).
 *  - storage's `updateRunStatus` / `addRunUsage` throws a plain `Error` with
 *    message `Run not found: <id>` after the UPDATE affects zero rows.
 *
 * Exported so the matching unit tests can assert the classifier directly
 * without needing a real SQLite handle.
 */
export function isStaleRunStorageError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") return true;
  if (err.message.startsWith("Run not found:")) return true;
  return false;
}

/**
 * Convert an error thrown out of `runToolLoop` into a structured outcome so
 * `applyOutcome` can stamp `exit_reason` consistently. When the controller's
 * signal is already aborted (user clicked Stop, clearRuns fired), the run
 * maps to `cancelled` rather than `failed` to keep failure metrics honest.
 *
 * Exported so the unit test can assert the branch logic without spinning up
 * the full driveLoop dependency graph.
 */
export function loopErrorToOutcome(
  err: unknown,
  aborted: boolean,
  finalMessages: LLMMessage[],
): ToolLoopOutcome {
  if (aborted) return { state: "cancelled", finalMessages };
  return { state: "failed", reason: asMessage(err), finalMessages };
}

/**
 * Compose a short human-readable summary of a multi-agent outcome from the
 * underlying TaskNode list. Used both as a step log entry and (more
 * importantly) as the synthetic assistant turn we persist into the run
 * conversation so `continueTask` has something to anchor a follow-up on.
 *
 * The summary is bounded: each node title/description is truncated and the
 * list is capped at 20 entries so a runaway DAG can't blow up the next turn's
 * context window.
 */
export function buildMultiAgentSummary(
  userTask: string,
  status: string,
  nodes: readonly { id: string; title: string; status: string; description: string }[],
): string {
  const head = `Multi-agent run completed with status=${status} (${nodes.length} nodes).`;
  if (nodes.length === 0) return `${head}\n(No sub-tasks were produced.)`;
  const bulletCap = 20;
  const bullets = nodes.slice(0, bulletCap).map((n) => {
    const desc = n.description.length > 140 ? `${n.description.slice(0, 137)}…` : n.description;
    return `- [${n.status}] ${n.title}: ${desc}`;
  });
  if (nodes.length > bulletCap) bullets.push(`- … and ${nodes.length - bulletCap} more`);
  return [head, "", `Original task: ${userTask}`, "", "Node-by-node recap:", ...bullets].join("\n");
}

/**
 * Build the synthetic LLMMessage[] persisted at the end of a multi-agent run.
 * Keeps the conversation structure familiar to the single-agent loop that
 * continueTask uses: system prompt + original user task + an assistant turn
 * summarising what already happened.
 */
export function buildMultiAgentRunMessages(
  lang: LanguagePreference,
  userTask: string,
  assistantSummary: string,
): LLMMessage[] {
  return [
    { role: "system", content: getSystemPrompt(lang) },
    { role: "user", content: userTask },
    { role: "assistant", content: assistantSummary },
  ];
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
