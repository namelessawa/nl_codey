import {
  type CommitRequest,
  type CommitResult,
  GIT_COAUTHOR_TRAILER,
} from "@coding-agent/shared";
import { runGit } from "./git-exec.js";
import { parseChangedFiles } from "./diff-summarizer.js";

/**
 * Build a Conventional-Commits message:
 *
 *   type(scope): summary
 *
 *   <body>
 *
 *   Changes:
 *   - file-a
 *   - file-b
 *
 *   Verified by: <verifiedBy>
 *
 *   Co-Authored-By: coding-agent <agent@local>
 *
 * Scope and the body/verified lines are omitted when absent. Pure function.
 */
export function buildCommitMessage(req: CommitRequest): string {
  const header = req.scope
    ? `${req.type}(${req.scope}): ${req.summary}`
    : `${req.type}: ${req.summary}`;

  const blocks: string[] = [header];

  const body = req.body.trim();
  if (body) blocks.push(body);

  if (req.changedFiles.length > 0) {
    const list = req.changedFiles.map((file) => `- ${file}`).join("\n");
    blocks.push(`Changes:\n${list}`);
  }

  if (req.verifiedBy && req.verifiedBy.trim()) {
    blocks.push(`Verified by: ${req.verifiedBy.trim()}`);
  }

  blocks.push(GIT_COAUTHOR_TRAILER);

  return blocks.join("\n\n");
}

/** Input for LLM-assisted commit message generation. */
export type CommitGenerationInput = {
  taskNodeId: string;
  taskDescription: string;
  diff: string;
  testResult?: string;
};

/** Generate raw text from a prompt (e.g. an LLM call). */
export type GenerateFn = (prompt: string) => Promise<string>;

type ParsedCommitFields = {
  type: string;
  scope?: string;
  summary: string;
  body: string;
};

/**
 * Ask the model for `{type, scope, summary, body}` JSON describing the change,
 * parse it robustly, and assemble a `CommitRequest`. Falls back to a
 * deterministic request derived from the task description if the model output
 * cannot be parsed.
 */
export async function generateCommitMessage(
  input: CommitGenerationInput,
  generate: GenerateFn,
): Promise<CommitRequest> {
  const changedFiles = parseChangedFiles(input.diff);
  const prompt = buildPrompt(input, changedFiles);

  let parsed: ParsedCommitFields | null = null;
  try {
    const raw = await generate(prompt);
    parsed = parseCommitFields(raw);
  } catch {
    parsed = null;
  }

  const fields = parsed ?? fallbackFields(input.taskDescription);

  const request: CommitRequest = {
    taskNodeId: input.taskNodeId,
    type: fields.type,
    summary: fields.summary,
    body: fields.body,
    changedFiles,
  };
  if (fields.scope) request.scope = fields.scope;
  if (input.testResult && input.testResult.trim()) {
    request.verifiedBy = input.testResult.trim();
  }
  return request;
}

function buildPrompt(input: CommitGenerationInput, changedFiles: string[]): string {
  return [
    "You are writing a Conventional Commits message for a code change.",
    "Respond with ONLY a JSON object of the form:",
    '{"type":"feat|fix|refactor|docs|test|chore|perf","scope":"optional","summary":"imperative one-line summary","body":"why and what"}',
    "",
    `Task: ${input.taskDescription}`,
    `Changed files: ${changedFiles.join(", ") || "(none detected)"}`,
    input.testResult ? `Test result: ${input.testResult}` : "",
    "",
    "Diff:",
    input.diff,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Conventional-commit types we accept from the model. */
const VALID_TYPES = new Set([
  "feat",
  "fix",
  "refactor",
  "docs",
  "test",
  "chore",
  "perf",
  "ci",
  "style",
  "build",
]);

/** Robustly extract a JSON object from model output and validate fields. */
export function parseCommitFields(raw: string): ParsedCommitFields | null {
  const json = extractJsonObject(raw);
  if (!json) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;

  const record = obj as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  if (!type || !summary || !VALID_TYPES.has(type)) return null;

  const body = typeof record.body === "string" ? record.body.trim() : "";
  const scopeRaw = typeof record.scope === "string" ? record.scope.trim() : "";

  const fields: ParsedCommitFields = { type, summary, body };
  if (scopeRaw) fields.scope = scopeRaw;
  return fields;
}

/** Find the first balanced `{...}` JSON object in a string. */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

function fallbackFields(taskDescription: string): ParsedCommitFields {
  const firstLine = taskDescription.split("\n")[0]?.trim() ?? "";
  const summary = (firstLine || "apply agent changes").slice(0, 72);
  return { type: "chore", summary, body: taskDescription.trim() };
}

/**
 * Stage all changes and create a commit. Returns the new commit sha and the
 * exact message that was written.
 */
export async function commit(cwd: string, req: CommitRequest): Promise<CommitResult> {
  const message = buildCommitMessage(req);

  const add = await runGit(cwd, ["add", "-A"]);
  if (add.exitCode !== 0) {
    throw new Error(`git add failed: ${add.stderr.trim() || "unknown error"}`);
  }

  const committed = await runGit(cwd, ["commit", "-m", message]);
  if (committed.exitCode !== 0) {
    throw new Error(`git commit failed: ${committed.stderr.trim() || "unknown error"}`);
  }

  const head = await runGit(cwd, ["rev-parse", "HEAD"]);
  if (head.exitCode !== 0) {
    throw new Error(`git rev-parse HEAD failed: ${head.stderr.trim() || "unknown error"}`);
  }

  return { sha: head.stdout.trim(), message };
}
