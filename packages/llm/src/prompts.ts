import type { AgentPlan, LanguagePreference } from "@coding-agent/shared";

/**
 * Phase 1 plan + patch prompts, parameterised by user language. The Phase 2
 * autonomous loop uses the system prompt from agent-core/prompts.ts; these
 * two are only consumed by the legacy two-pass flow and by the mock provider
 * for offline testing.
 */

const PLAN_PROMPT_ZH = `你是 NL_Codey，一个本地代码代理。你的任务是根据用户请求和项目文件列表，制定最小、安全、可验证的修改计划。

你只能在 workspace root 内工作。
你不能直接修改文件。
你需要先判断应该搜索哪些关键词、可能涉及哪些文件、最终可能需要运行什么验证命令。

请严格输出 JSON，不要输出 Markdown，不要输出解释性文字。

JSON 格式如下：

{
  "summary": "对任务的简短理解",
  "searchQueries": ["用于搜索代码的关键词"],
  "likelyFiles": ["可能相关的文件路径"],
  "suggestedCommands": ["建议运行的验证命令"]
}`;

const PLAN_PROMPT_EN = `You are NL_Codey, a local coding agent. Your task is to produce a minimal, safe, verifiable plan of changes based on the user's request and the project file list.

You may only work within the workspace root.
You cannot modify files directly.
You should first decide which keywords to search for, which files might be involved, and which validation commands might eventually need to be run.

Output strict JSON only. Do not output Markdown. Do not output explanatory text.

JSON format:

{
  "summary": "a brief understanding of the task",
  "searchQueries": ["keywords for searching the code"],
  "likelyFiles": ["paths to files that may be relevant"],
  "suggestedCommands": ["validation commands to suggest running"]
}`;

const PATCH_PROMPT_ZH = `你是 NL_Codey，一个本地代码代理。请根据用户任务和已读取的相关文件生成最小修改。

要求：
1. 只输出 unified diff。
2. 不要输出 Markdown。
3. 不要输出解释说明。
4. 不要修改无关文件。
5. 不要进行大规模重构。
6. 保持现有代码风格。
7. 优先做最小可验证修改。
8. 如果无法安全修改，请输出空字符串。

unified diff 必须使用 workspace 相对路径，形如：
--- a/src/foo.ts
+++ b/src/foo.ts`;

const PATCH_PROMPT_EN = `You are NL_Codey, a local coding agent. Generate the minimum modification based on the user's task and the relevant files already read.

Requirements:
1. Output unified diff only.
2. Do not output Markdown.
3. Do not output explanations.
4. Do not modify unrelated files.
5. Do not do large-scale refactoring.
6. Preserve the existing code style.
7. Prefer the smallest verifiable change.
8. If no safe modification is possible, output an empty string.

The unified diff must use workspace-relative paths, like:
--- a/src/foo.ts
+++ b/src/foo.ts`;

/** Get the plan prompt in the requested language. */
export function getPlanPrompt(lang: LanguagePreference): string {
  return lang === "en-US" ? PLAN_PROMPT_EN : PLAN_PROMPT_ZH;
}

/** Get the patch-generation prompt in the requested language. */
export function getPatchPrompt(lang: LanguagePreference): string {
  return lang === "en-US" ? PATCH_PROMPT_EN : PATCH_PROMPT_ZH;
}

/**
 * Backwards-compatible defaults. Existing imports still resolve to the
 * Chinese prompts. The mock provider in this package matches on the first
 * 24 characters of these constants to detect which call type it's serving;
 * see {@link MOCK_PROMPT_PREFIXES} for the multi-language detection set.
 */
export const CODING_AGENT_PLAN_PROMPT = PLAN_PROMPT_ZH;
export const PATCH_GENERATION_PROMPT = PATCH_PROMPT_ZH;

/**
 * Prefixes the mock provider uses to identify which prompt it's responding
 * to. We include both languages so the mock keeps working when the user
 * switches the UI language to English.
 */
export const MOCK_PROMPT_PREFIXES = {
  plan: [PLAN_PROMPT_ZH.slice(0, 24), PLAN_PROMPT_EN.slice(0, 24)],
  patch: [PATCH_PROMPT_ZH.slice(0, 24), PATCH_PROMPT_EN.slice(0, 24)],
} as const;

/** Robustly extract and parse the plan JSON, tolerating code fences/prose. */
export function parsePlan(text: string): AgentPlan {
  const json = extractJsonObject(text);
  if (!json) {
    throw new Error("LLM did not return parseable plan JSON");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("LLM returned invalid plan JSON");
  }
  return normalizePlan(parsed);
}

function normalizePlan(value: unknown): AgentPlan {
  const obj = (value ?? {}) as Record<string, unknown>;
  return {
    summary: typeof obj.summary === "string" ? obj.summary : "",
    searchQueries: toStringArray(obj.searchQueries),
    likelyFiles: toStringArray(obj.likelyFiles),
    suggestedCommands: toStringArray(obj.suggestedCommands),
  };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Find the first balanced { ... } block in arbitrary text. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Strip Markdown code fences a model may wrap a diff in, despite instructions. */
export function stripDiffFences(text: string): string {
  const trimmed = text.trim();
  // Hand-rolled fence detection. The previous regex
  //   /^```(?:diff|patch)?\s*\n([\s\S]*?)\n```$/
  // is polynomial in input size on inputs like "```\n" + " ".repeat(n) because
  // `\s*\n` and `[\s\S]*?` together force backtracking across the whole body
  // when the closing fence is absent (CodeQL js/polynomial-redos).
  if (!trimmed.startsWith("```")) return trimmed;
  if (!trimmed.endsWith("```")) return trimmed;
  // Strip opening fence header up to the first newline.
  const afterOpen = trimmed.slice(3);
  const headerEnd = afterOpen.indexOf("\n");
  if (headerEnd === -1) return trimmed;
  const header = afterOpen.slice(0, headerEnd).trim();
  if (header && header !== "diff" && header !== "patch") return trimmed;
  // Closing fence must sit on its own line at the end.
  const bodyStart = headerEnd + 1;
  const bodyEnd = afterOpen.length - 3;
  if (bodyEnd <= bodyStart) return trimmed;
  if (afterOpen.charCodeAt(bodyEnd - 1) !== 10) return trimmed;
  return afterOpen.slice(bodyStart, bodyEnd - 1).trim();
}
