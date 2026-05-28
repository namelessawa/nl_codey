/** LLM-driven task decomposition: prompt building + tolerant JSON parsing. */

import {
  TASK_MAX_NODES,
  TASK_MIN_NODES,
  type TaskBreakdown,
  type TaskNodeProposal,
} from "@coding-agent/shared";

import { validateBreakdown } from "./task-tree.js";

/** A minimal LLM call: prompt in, raw text out. */
export type GenerateFn = (prompt: string) => Promise<string>;

/**
 * Build the full Planner prompt instructing the model to emit a strict JSON
 * TaskBreakdown. The contract is described inline so any compatible model can
 * follow it without external schema.
 */
export function buildPlannerPrompt(userTask: string, context?: string): string {
  const contextBlock = context && context.trim() !== ""
    ? `\n\nRepository context:\n${context.trim()}`
    : "";

  return [
    "You are the Planner for a coding agent. Decompose the user's task into a",
    "directed acyclic graph (DAG) of independently executable sub-tasks.",
    "",
    "Rules:",
    `- Produce between ${TASK_MIN_NODES} and ${TASK_MAX_NODES} sub-tasks.`,
    "- Each sub-task must be small, focused, and verifiable on its own.",
    '- "dependsOn" lists ids of sub-tasks that must complete first. No cycles.',
    '- "filesScope" lists glob patterns of files the sub-task may modify',
    "  (e.g. \"src/api/**\"). Sub-tasks that touch the same files must depend",
    "  on each other so they never run in parallel.",
    '- "verifyCommand" is an optional shell command that validates the sub-task.',
    "",
    "Respond with ONLY a JSON object, no prose, no markdown fences, matching:",
    "{",
    '  "root": "<id of the top-level task>",',
    '  "tasks": [',
    "    {",
    '      "id": "string",',
    '      "title": "string",',
    '      "description": "string",',
    '      "dependsOn": ["string"],',
    '      "verifyCommand": "string | null",',
    '      "filesScope": ["string"]',
    "    }",
    "  ]",
    "}",
    "",
    `User task:\n${userTask.trim()}${contextBlock}`,
  ].join("\n");
}

/**
 * Decompose a task via the model. Parses the model output tolerantly (strips
 * code fences / surrounding prose by extracting the first balanced object),
 * validates the result, and returns both the breakdown and any issues. On
 * unparseable output, returns a single-node fallback wrapping the whole task.
 */
export async function decompose(
  userTask: string,
  generate: GenerateFn,
  context?: string,
): Promise<{ breakdown: TaskBreakdown; issues: string[] }> {
  const prompt = buildPlannerPrompt(userTask, context);
  const raw = await generate(prompt);

  const parsed = parseBreakdown(raw);
  if (!parsed) {
    const fallback = singleNodeFallback(userTask);
    return {
      breakdown: fallback,
      issues: ["Planner output was not valid JSON; fell back to a single-node breakdown."],
    };
  }

  const issues = validateBreakdown(parsed);
  return { breakdown: parsed, issues };
}

/** A trivial one-task breakdown that wraps the entire user request. */
export function singleNodeFallback(userTask: string): TaskBreakdown {
  const node: TaskNodeProposal = {
    id: "task-1",
    title: truncate(userTask.trim(), 80) || "Complete the requested task",
    description: userTask.trim() || "Complete the requested task.",
    dependsOn: [],
  };
  return { root: node.id, tasks: [node] };
}

/**
 * Extract and parse the first balanced `{...}` object from arbitrary text,
 * tolerating markdown code fences and surrounding prose. Returns null when no
 * valid breakdown object can be recovered.
 */
function parseBreakdown(raw: string): TaskBreakdown | null {
  const candidate = extractFirstObject(raw);
  if (!candidate) return null;
  try {
    const obj = JSON.parse(candidate) as unknown;
    return coerceBreakdown(obj);
  } catch {
    return null;
  }
}

/** Find the first balanced brace-delimited substring, respecting JSON strings. */
function extractFirstObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/** Validate the parsed JSON has the shape of a TaskBreakdown. */
function coerceBreakdown(obj: unknown): TaskBreakdown | null {
  if (typeof obj !== "object" || obj === null) return null;
  const record = obj as Record<string, unknown>;
  const tasksRaw = record.tasks;
  if (!Array.isArray(tasksRaw)) return null;

  const tasks: TaskNodeProposal[] = [];
  for (const item of tasksRaw) {
    const node = coerceProposal(item);
    if (!node) return null;
    tasks.push(node);
  }

  const root = typeof record.root === "string" && record.root !== ""
    ? record.root
    : (tasks[0]?.id ?? "");
  return { root, tasks };
}

function coerceProposal(item: unknown): TaskNodeProposal | null {
  if (typeof item !== "object" || item === null) return null;
  const r = item as Record<string, unknown>;
  if (typeof r.id !== "string") return null;

  const proposal: TaskNodeProposal = {
    id: r.id,
    title: typeof r.title === "string" ? r.title : "",
    description: typeof r.description === "string" ? r.description : "",
    dependsOn: Array.isArray(r.dependsOn)
      ? r.dependsOn.filter((d): d is string => typeof d === "string")
      : [],
  };
  if (typeof r.verifyCommand === "string") proposal.verifyCommand = r.verifyCommand;
  if (Array.isArray(r.filesScope)) {
    proposal.filesScope = r.filesScope.filter((s): s is string => typeof s === "string");
  }
  return proposal;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
