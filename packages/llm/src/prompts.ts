import type { AgentPlan } from "@coding-agent/shared";

export const CODING_AGENT_PLAN_PROMPT = `你是一个本地 Coding Agent。你的任务是根据用户请求和项目文件列表，制定最小、安全、可验证的修改计划。

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

export const PATCH_GENERATION_PROMPT = `你是一个本地 Coding Agent。请根据用户任务和已读取的相关文件生成最小修改。

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
  const fence = /^```(?:diff|patch)?\s*\n([\s\S]*?)\n```$/;
  const match = fence.exec(trimmed);
  return (match?.[1] ?? trimmed).trim();
}
