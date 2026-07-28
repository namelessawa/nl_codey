/**
 * Opt-in multi-agent driver. When {@link AgentSettings.multiAgentEnabled} is
 * true, AgentService routes the task through this module instead of the
 * single-agent {@link runToolLoop} path. We reuse the existing executor
 * (approval gate, sandbox policy, verify-after-patch, snapshots) and just
 * wrap it in role-specific tool loops keyed off the orchestrator's
 * {@link ROLE_TOOLS} allowlists.
 *
 * The orchestration spine itself is the package
 * `@nlc/orchestrator` — Coordinator + Scheduler + MessageBus +
 * review-loop. Here we only supply the LLM-driven role implementations and
 * the storage adapters those ports need.
 */

import type {
  ChatLLMProvider,
  LLMMessage,
  LLMToolCall,
  ReviewComment,
  ReviewResult,
  RoleMessageRow,
  TaskBreakdown,
  TaskNode,
  TaskNodeStatus,
  ToolContext,
  ToolSchema,
} from "@nlc/shared";
import {
  CODER_PROMPT,
  Coordinator,
  MessageBus,
  PLANNER_PROMPT,
  REVIEWER_PROMPT,
  ROLE_TOOLS,
  type CoordinatorResult,
  type ToolRole,
} from "@nlc/orchestrator";
import { BudgetController } from "./budget.js";
import { runToolLoop } from "./loop.js";
import type { ExecutedTool } from "./tools-registry.js";

/**
 * Schemas for the orchestrator-only tools. These are merged into the base
 * schema list before role-specific filtering so each role's loop sees the
 * names its ROLE_TOOLS entry allows. The existing single-agent path never
 * includes them in {@link agentToolSchemas}.
 */
export const ORCHESTRATOR_TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "propose_task_breakdown",
    description:
      "Submit a TaskNode DAG decomposition. Use this exactly once as your final action; do NOT write code yourself.",
    parameters: {
      type: "object",
      properties: {
        root: {
          type: "string",
          description:
            "Id of the entry sub-task. MUST exactly match the `id` of one of the entries in `tasks` (typically the task with no dependsOn). NOT a free-form label.",
        },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              dependsOn: { type: "array", items: { type: "string" } },
              verifyCommand: { type: "string", description: "Optional verification command." },
              filesScope: {
                type: "array",
                items: { type: "string" },
                description: "Optional glob patterns of files this sub-task may touch.",
              },
            },
            required: ["id", "title", "description", "dependsOn"],
          },
        },
      },
      required: ["root", "tasks"],
      additionalProperties: false,
    },
  },
  {
    name: "update_task_status",
    description: "Report the current TaskNode's lifecycle status (running / succeeded / failed / blocked).",
    parameters: {
      type: "object",
      properties: {
        taskNodeId: { type: "string" },
        status: { type: "string", enum: ["running", "succeeded", "failed", "blocked"] },
        note: { type: "string" },
      },
      required: ["taskNodeId", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "request_review",
    description:
      "Hand the current TaskNode's diff + test output to the reviewer. Use this as your final action once the change is ready.",
    parameters: {
      type: "object",
      properties: {
        taskNodeId: { type: "string" },
        diff: { type: "string" },
        testOutput: { type: "string" },
      },
      required: ["taskNodeId", "diff", "testOutput"],
      additionalProperties: false,
    },
  },
  {
    name: "approve_change",
    description: "Approve the current TaskNode's changes. Reviewer-only.",
    parameters: {
      type: "object",
      properties: {
        taskNodeId: { type: "string" },
        note: { type: "string" },
      },
      required: ["taskNodeId"],
      additionalProperties: false,
    },
  },
  {
    name: "request_changes",
    description: "Reject the current TaskNode's changes with structured comments. Reviewer-only.",
    parameters: {
      type: "object",
      properties: {
        taskNodeId: { type: "string" },
        comments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              file: { type: "string" },
              line: { type: "number" },
              severity: { type: "string", enum: ["warning", "blocker"] },
              message: { type: "string" },
            },
            required: ["file", "line", "severity", "message"],
          },
        },
      },
      required: ["taskNodeId", "comments"],
      additionalProperties: false,
    },
  },
];

/** Storage surface the multi-agent driver requires. */
export interface MultiAgentStore {
  createTaskNode(node: TaskNode): TaskNode;
  setTaskNodeStatus(id: string, status: TaskNodeStatus): void;
  addRoleMessage(row: RoleMessageRow): void;
}

export type MultiAgentDeps = {
  llm: ChatLLMProvider;
  store: MultiAgentStore;
  budget: BudgetController;
  ctx: ToolContext;
  signal: AbortSignal;
  /** The executor from createToolExecutor — Phase 1/2 + Phase 3 + plugins. */
  executor: (call: LLMToolCall) => Promise<ExecutedTool>;
  /** Base tool schemas (without orchestrator tools). Role filtering picks subsets. */
  baseSchemas: readonly ToolSchema[];
  /** Approval for the planner's proposed DAG. */
  approve: () => Promise<boolean>;
  /** Escalation when a node exhausts review or fails. */
  askHuman: (node: TaskNode, reason: string) => Promise<"retry" | "skip" | "cancel">;
  /** Approval gate / verify hooks identical to single-agent driveLoop. */
  requiresApproval?: (call: LLMToolCall) => boolean;
  waitForApproval?: (call: LLMToolCall) => Promise<boolean>;
  verifyAfterPatch?: (call: LLMToolCall, resultText: string) => Promise<string | null>;
  onChunk?: (chunk: { type: string; text?: string }) => void;
  onAssistant?: (text: string, toolCalls: unknown[], usage: { inputTokens: number; outputTokens: number; costUsd: number }) => void;
  onToolCall?: (call: LLMToolCall) => void;
};

/** Drive a complete multi-agent run. Returns the Coordinator's final outcome. */
export async function runMultiAgentTask(
  deps: MultiAgentDeps,
  parentRunId: string,
  userTask: string,
): Promise<CoordinatorResult> {
  const bus = new MessageBus({
    persist: (row) => deps.store.addRoleMessage(row),
  });

  const coordinator = new Coordinator({
    plan: (task) => runPlanner(deps, task),
    runCoder: (node, comments) => runCoder(deps, node, comments),
    runReviewer: (node, diff, testOutput) => runReviewer(deps, node, diff, testOutput),
    persistNode: (node) => deps.store.createTaskNode(node),
    updateNode: (id, status) => deps.store.setTaskNodeStatus(id, status),
    bus,
    askHuman: deps.askHuman,
    approve: deps.approve,
  });

  return coordinator.run(parentRunId, userTask);
}

type RoleToolAccess = {
  schemas: ToolSchema[];
  allowedToolNames: ReadonlySet<string>;
};

/**
 * Build both halves of a role's capability boundary from the same filtered
 * schema list. Dynamic tools are intentionally absent from {@link ROLE_TOOLS},
 * so a validated bundle does not grant any multi-agent role permission by
 * itself. A future role policy must add a name explicitly before the schema
 * is exposed or the call can execute.
 */
function toolAccessForRole(
  baseSchemas: readonly ToolSchema[],
  role: ToolRole,
): RoleToolAccess {
  const rolePolicy = new Set(ROLE_TOOLS[role]);
  const combined = [...baseSchemas, ...ORCHESTRATOR_TOOL_SCHEMAS];
  const schemas = combined.filter((schema) => rolePolicy.has(schema.name));
  return {
    schemas,
    allowedToolNames: new Set(schemas.map((schema) => schema.name)),
  };
}

function roleDeniedToolResult(role: ToolRole, toolName: string): string {
  return JSON.stringify({
    code: "role_tool_denied",
    role,
    toolName,
    error: `Role "${role}" is not allowed to execute tool "${toolName}".`,
  });
}

async function runPlanner(
  deps: MultiAgentDeps,
  userTask: string,
): Promise<TaskBreakdown> {
  let breakdown: TaskBreakdown | null = null;
  const toolAccess = toolAccessForRole(deps.baseSchemas, "planner");
  const messages: LLMMessage[] = [
    { role: "system", content: PLANNER_PROMPT },
    { role: "user", content: userTask },
  ];

  const outcome = await runToolLoop(messages, {
    llm: deps.llm,
    tools: toolAccess.schemas,
    budget: deps.budget,
    signal: deps.signal,
    temperature: 0.2,
    // Planner's allowlist (ROLE_TOOLS.planner) contains only read tools, so in
    // a well-formed run no approval prompt will fire. But the model still
    // chooses what to call — if it ever emits a mutating name the host gates
    // are the last line of defense. Forward them instead of hard-wiring no-op
    // gates that would silently let such a call through.
    requiresApproval: deps.requiresApproval ?? (() => false),
    waitForApproval: deps.waitForApproval ?? (async () => true),
    ...(deps.onChunk ? { onChunk: deps.onChunk } : {}),
    ...(deps.onAssistant ? { onAssistant: deps.onAssistant } : {}),
    ...(deps.onToolCall ? { onToolCall: deps.onToolCall } : {}),
    executeTool: async (call) => {
      if (!toolAccess.allowedToolNames.has(call.name)) {
        return roleDeniedToolResult("planner", call.name);
      }
      if (call.name === "propose_task_breakdown") {
        const args = call.args as Record<string, unknown>;
        breakdown = {
          root: typeof args.root === "string" ? args.root : "root",
          tasks: Array.isArray(args.tasks) ? (args.tasks as TaskBreakdown["tasks"]) : [],
        };
        return JSON.stringify({ accepted: true, taskCount: breakdown.tasks.length, issues: [] });
      }
      // Planner uses ordinary read tools via the shared executor.
      const result = await deps.executor(call);
      return result.resultText;
    },
  });

  // Surface terminal outcomes explicitly. Without this branch a cancelled or
  // budget-exhausted planner falls into the "did not produce a task breakdown"
  // error below, which is misleading (the planner never got to run, the user
  // cancelled or the budget tripped). Service-level error handling converts
  // the throw into the right run state once it sees an honest message.
  if (outcome.state !== "done") {
    throw new Error(plannerOutcomeError(outcome));
  }

  if (!breakdown) {
    throw new Error(
      "Planner did not produce a task breakdown. The model must call propose_task_breakdown.",
    );
  }
  return breakdown;
}

function plannerOutcomeError(outcome: { state: string; reason?: string }): string {
  if (outcome.state === "cancelled") return "Planner cancelled by user.";
  if (outcome.state === "budget_exceeded") {
    return `Planner aborted: budget exceeded (${outcome.reason ?? "unknown"}).`;
  }
  if (outcome.state === "failed") {
    return `Planner failed: ${outcome.reason ?? "unknown error"}.`;
  }
  return `Planner exited with unexpected state: ${outcome.state}.`;
}

async function runCoder(
  deps: MultiAgentDeps,
  node: TaskNode,
  reviewComments?: ReviewComment[],
): Promise<{ diff: string; testOutput: string }> {
  // Track diff + test output from the model's tool calls. The model is
  // expected to end by calling request_review with these explicitly; if it
  // doesn't, we fall back to whatever the most recent apply_patch /
  // run_command yielded so the reviewer still has something to look at.
  let pendingReview: { diff: string; testOutput: string } | null = null;
  let lastDiff = "";
  let lastTestOutput = "";
  const toolAccess = toolAccessForRole(deps.baseSchemas, "coder");

  const userParts: string[] = [
    `TaskNode handoff: ${node.title}`,
    "",
    node.description,
  ];
  if (node.filesScope && node.filesScope.length > 0) {
    userParts.push("", `filesScope: ${node.filesScope.join(", ")}`);
  }
  if (node.verifyCommand) {
    userParts.push("", `verifyCommand: ${node.verifyCommand}`);
  }
  if (reviewComments && reviewComments.length > 0) {
    userParts.push(
      "",
      "Previous review requested changes; address every blocker before re-requesting review:",
      ...reviewComments.map(
        (c) => `- ${c.file}:${c.line} [${c.severity}] ${c.message}`,
      ),
    );
  }

  const messages: LLMMessage[] = [
    { role: "system", content: CODER_PROMPT },
    { role: "user", content: userParts.join("\n") },
  ];

  const outcome = await runToolLoop(messages, {
    llm: deps.llm,
    tools: toolAccess.schemas,
    budget: deps.budget,
    signal: deps.signal,
    temperature: 0.2,
    // Coder is the only role that produces file writes / shell calls, so it
    // does need the host's approval gates. Default to permissive no-ops only
    // when the host didn't wire them (test harnesses) so existing tests stay
    // green.
    requiresApproval: deps.requiresApproval ?? (() => false),
    waitForApproval: deps.waitForApproval ?? (async () => true),
    ...(deps.onChunk ? { onChunk: deps.onChunk } : {}),
    ...(deps.onAssistant ? { onAssistant: deps.onAssistant } : {}),
    ...(deps.onToolCall ? { onToolCall: deps.onToolCall } : {}),
    ...(deps.verifyAfterPatch ? { verifyAfterPatch: deps.verifyAfterPatch } : {}),
    executeTool: async (call) => {
      if (!toolAccess.allowedToolNames.has(call.name)) {
        return roleDeniedToolResult("coder", call.name);
      }
      if (call.name === "request_review") {
        const args = call.args as Record<string, unknown>;
        pendingReview = {
          diff: typeof args.diff === "string" ? args.diff : lastDiff,
          testOutput: typeof args.testOutput === "string" ? args.testOutput : lastTestOutput,
        };
        return JSON.stringify({ requested: true });
      }
      if (call.name === "update_task_status") {
        // Advisory — the Coordinator drives the authoritative status.
        return JSON.stringify({ recorded: true });
      }
      const result = await deps.executor(call);
      // Snapshot the most recent diff / test output for the fallback path.
      if (call.name === "apply_patch") {
        const args = call.args as Record<string, unknown>;
        if (typeof args.patch === "string") lastDiff = args.patch;
      } else if (call.name === "run_command") {
        try {
          const parsed = JSON.parse(result.resultText) as {
            exitCode?: number;
            stdout?: string;
            stderr?: string;
          };
          lastTestOutput = `exit ${parsed.exitCode ?? "?"}\n${parsed.stdout ?? ""}\n${parsed.stderr ?? ""}`.trim();
        } catch {
          // Non-JSON result: keep the previous value.
        }
      }
      return result.resultText;
    },
  });

  // A non-`done` outcome means the coder never reached request_review. Without
  // this branch we'd return whatever empty / partial diff and testOutput were
  // captured, the reviewer would predictably emit "changes_requested" against
  // an empty diff, and the review loop would burn another iteration on a run
  // that should already be terminating. Surface the failure so the coordinator
  // escalates immediately.
  if (outcome.state !== "done") {
    throw new Error(roleOutcomeError("Coder", outcome, node.id));
  }

  return pendingReview ?? { diff: lastDiff, testOutput: lastTestOutput };
}

function roleOutcomeError(
  role: string,
  outcome: { state: string; reason?: string },
  nodeId: string,
): string {
  if (outcome.state === "cancelled") return `${role} cancelled by user (node ${nodeId}).`;
  if (outcome.state === "budget_exceeded") {
    return `${role} aborted on node ${nodeId}: budget exceeded (${outcome.reason ?? "unknown"}).`;
  }
  if (outcome.state === "failed") {
    return `${role} failed on node ${nodeId}: ${outcome.reason ?? "unknown error"}.`;
  }
  return `${role} exited on node ${nodeId} with unexpected state: ${outcome.state}.`;
}

async function runReviewer(
  deps: MultiAgentDeps,
  node: TaskNode,
  diff: string,
  testOutput: string,
): Promise<ReviewResult> {
  const toolAccess = toolAccessForRole(deps.baseSchemas, "reviewer");
  const userMsg = [
    `Review TaskNode: ${node.title}`,
    "",
    `Description: ${node.description}`,
    `filesScope: ${(node.filesScope ?? []).join(", ") || "(any)"}`,
    "",
    "--- Diff ---",
    diff || "(empty)",
    "",
    "--- Test output ---",
    testOutput || "(empty)",
    "",
    "Respond with the strict JSON ReviewResult object exactly as described. No prose, no markdown fences.",
  ].join("\n");

  const messages: LLMMessage[] = [
    { role: "system", content: REVIEWER_PROMPT },
    { role: "user", content: userMsg },
  ];

  let finalText = "";
  const outcome = await runToolLoop(messages, {
    llm: deps.llm,
    tools: toolAccess.schemas,
    budget: deps.budget,
    signal: deps.signal,
    temperature: 0,
    // Reviewer's allowlist includes run_command (see ROLE_TOOLS.reviewer in
    // packages/orchestrator/src/roles.ts:51), so it CAN trigger the host's
    // command-confirmation gate. Forward the host gates instead of hard-wiring
    // no-ops — otherwise the reviewer silently bypasses approval that the
    // single-agent and coder paths already honor.
    requiresApproval: deps.requiresApproval ?? (() => false),
    waitForApproval: deps.waitForApproval ?? (async () => true),
    ...(deps.onChunk ? { onChunk: deps.onChunk } : {}),
    onAssistant: (text, toolCalls, usage) => {
      if (text.trim()) finalText = text.trim();
      deps.onAssistant?.(text, toolCalls, usage);
    },
    ...(deps.onToolCall ? { onToolCall: deps.onToolCall } : {}),
    executeTool: async (call) => {
      if (!toolAccess.allowedToolNames.has(call.name)) {
        return roleDeniedToolResult("reviewer", call.name);
      }
      if (call.name === "approve_change" || call.name === "request_changes") {
        // Reviewer's authoritative output is the JSON in the assistant
        // message; the tool calls are advisory acknowledgements only.
        return JSON.stringify({ recorded: true });
      }
      const result = await deps.executor(call);
      return result.resultText;
    },
  });

  // A non-`done` outcome means the reviewer never emitted a verdict. Without
  // this branch we'd parse an empty `finalText`, fall into the JSON-failure
  // fallback at parseReviewResult, and report a phantom "changes_requested"
  // verdict — which the review loop would then iterate on, burning more
  // budget on a run the user already cancelled (or that already exhausted).
  if (outcome.state !== "done") {
    throw new Error(roleOutcomeError("Reviewer", outcome, node.id));
  }

  return parseReviewResult(finalText);
}

/**
 * Parse the reviewer's JSON output. The prompt explicitly forbids markdown
 * fences, but production LLMs occasionally add them anyway — we strip a
 * single fence pair and try again before falling back to a "changes_requested"
 * verdict that surfaces the problem instead of silently passing the node.
 */
export function parseReviewResult(text: string): ReviewResult {
  const cleaned = stripCodeFence(text.trim());
  try {
    const parsed = JSON.parse(cleaned) as ReviewResult;
    return {
      correctness: parsed.correctness ?? "fail",
      scope_compliance: parsed.scope_compliance ?? "fail",
      regression_risk: parsed.regression_risk ?? "high",
      style_consistency: parsed.style_consistency ?? "fail",
      comments: Array.isArray(parsed.comments) ? parsed.comments : [],
      verdict: parsed.verdict ?? "changes_requested",
    };
  } catch {
    return {
      correctness: "fail",
      scope_compliance: "fail",
      regression_risk: "high",
      style_consistency: "fail",
      comments: [
        {
          file: "(reviewer-output)",
          line: 0,
          severity: "blocker",
          message: `Reviewer returned non-JSON output: ${text.slice(0, 200)}`,
        },
      ],
      verdict: "changes_requested",
    };
  }
}

function stripCodeFence(text: string): string {
  // Hand-rolled fence detection. The previous regex
  //   /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i
  // is polynomial in input length (CodeQL js/polynomial-redos) because
  // `\s*\n` and `[\s\S]*?` together backtrack the whole body when the
  // closing fence is missing or malformed.
  if (!text.startsWith("```")) return text;
  // Optional header (e.g. `json`) up to the first newline.
  const headerEnd = text.indexOf("\n");
  if (headerEnd === -1) return text;
  const header = text.slice(3, headerEnd).trim().toLowerCase();
  if (header && header !== "json") return text;
  // Closing fence: a `\n```` followed by only trailing whitespace.
  const closeIdx = text.lastIndexOf("\n```");
  if (closeIdx <= headerEnd) return text;
  const trailing = text.slice(closeIdx + 4);
  for (let i = 0; i < trailing.length; i++) {
    const ch = trailing.charCodeAt(i);
    if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) return text;
  }
  return text.slice(headerEnd + 1, closeIdx);
}
