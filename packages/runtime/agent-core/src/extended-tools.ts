/**
 * Extended tool schemas + dispatchers exposed to the single-agent loop.
 *
 * The wider port-backed tool catalogue lives in `createExtendedTools`
 * (`@nlc/tools`), where every tool closes over an injected port.
 * The single-agent loop sees a deliberately narrow subset that is useful
 * outside the multi-agent orchestrator:
 *
 *   - semantic_search   — code/doc retrieval over the local index
 *   - read_memory       — recall project decisions / facts / failures
 *   - write_memory      — persist a fact or decision for future runs
 *   - web_search        — search the web for docs (domain-whitelisted)
 *   - web_fetch         — fetch a single whitelisted URL
 *
 * The orchestrator-only tools (propose_task_breakdown, update_task_status,
 * request_review, approve_change, request_changes) stay off the schema in
 * single-agent mode because they have no consumer; the multi-agent path
 * (Coordinator) advertises them under role-specific allowlists instead.
 */

import type { LLMToolCall, ToolContext, ToolSchema } from "@nlc/shared";
import {
  createReadMemoryTool,
  createSemanticSearchTool,
  createWebFetchTool,
  createWebSearchTool,
  createWriteMemoryTool,
  type MemoryPort,
  type SemanticSearchPort,
  type WebPort,
} from "@nlc/tools";
import type { ExecutedTool } from "./tools-registry.js";

/** Single-agent extended (port-backed) tools exposed to the model. */
export const EXTENDED_AGENT_TOOL_NAMES = [
  "semantic_search",
  "read_memory",
  "write_memory",
  "web_search",
  "web_fetch",
] as const;

export type ExtendedAgentToolName = (typeof EXTENDED_AGENT_TOOL_NAMES)[number];

/**
 * Extended tools that mutate persistent project state (memory entries). In
 * read-only ("instruction") mode they are stripped from the advertised schema
 * AND hard-refused at dispatch, mirroring how `FILE_MUTATING_TOOLS` locks
 * down file writes.
 */
export const EXTENDED_MUTATING_TOOLS: readonly string[] = ["write_memory"];

export const EXTENDED_AGENT_TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "semantic_search",
    description:
      "用自然语言查找代码或文档片段（向量检索）。返回带分数的命中列表（文件、行范围、片段）。先调用 list_files/find_symbol 仍然有用；semantic_search 适合按概念找而不是按确切名字找。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "自然语言查询。" },
        topK: { type: "number", description: "返回前 K 个命中（默认由实现决定）。" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "read_memory",
    description:
      "检索项目记忆库（之前会话里登记过的决策、偏好、失败教训、事实）。可按自然语言查询和/或 kind 过滤。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "可选自然语言检索词。" },
        kind: {
          type: "string",
          enum: ["decision", "preference", "failure", "fact"],
          description: "可选 kind 过滤。",
        },
        maxEntries: { type: "number", description: "最多返回多少条（默认 10）。" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "write_memory",
    description:
      '记录一条可在未来运行中复用的项目记忆。仅允许 kind=fact 或 decision（偏好与失败教训通过 GUI 录入）。',
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["fact", "decision"], description: "记忆条目类型。" },
        title: { type: "string", description: "简短标题。" },
        body: { type: "string", description: "正文（具体内容、引用、原因）。" },
        tags: { type: "array", items: { type: "string" }, description: "可选标签。" },
      },
      required: ["kind", "title", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "web_search",
    description:
      "在网络上搜索（按白名单域）文档、错误信息或库用法。返回标题/URL/摘要列表。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词。" },
        maxResults: { type: "number", description: "最多返回多少条结果。" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "web_fetch",
    description:
      "抓取单个白名单 URL 并提取可读文本。仅允许 https；超长会被截断。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "https URL（必须在域名白名单内）。" },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
];

/**
 * Concrete extended port bundle the single-agent loop runs against. All
 * three ports must be provided together; partial bundles aren't supported
 * because the schema is advertised as a single block.
 */
export type ExtendedAgentPorts = {
  semanticSearch: SemanticSearchPort;
  memory: MemoryPort;
  web: WebPort;
};

/**
 * Build a dispatcher for the extended single-agent tools. Returns `null` when
 * the tool name is not an extended tool so the caller can fall through to its
 * existing built-in dispatch. Errors are caught and returned as structured
 * tool results so the autonomous loop can recover instead of crashing.
 */
export function createExtendedDispatcher(
  ports: ExtendedAgentPorts,
): (call: LLMToolCall, ctx: ToolContext) => Promise<ExecutedTool | null> {
  const semanticSearch = createSemanticSearchTool(ports.semanticSearch);
  const readMemory = createReadMemoryTool(ports.memory);
  const writeMemory = createWriteMemoryTool(ports.memory);
  const webSearch = createWebSearchTool(ports.web);
  const webFetch = createWebFetchTool(ports.web);

  return async (call, ctx) => {
    const args = isRecord(call.args) ? call.args : {};
    try {
      switch (call.name) {
        case "semantic_search": {
          const query = stringArg(args.query);
          if (!query) return err("semantic_search", "Missing required argument: query");
          const topK = numberArg(args.topK);
          const out = await semanticSearch.run(
            topK !== undefined ? { query, topK } : { query },
            ctx,
          );
          return ok("semantic_search", JSON.stringify(out));
        }
        case "read_memory": {
          const out = await readMemory.run(
            {
              ...(stringArg(args.query) ? { query: stringArg(args.query) } : {}),
              ...(stringArg(args.kind)
                ? { kind: stringArg(args.kind) as "decision" | "preference" | "failure" | "fact" }
                : {}),
              ...(numberArg(args.maxEntries) !== undefined ? { maxEntries: numberArg(args.maxEntries) } : {}),
            },
            ctx,
          );
          return ok("read_memory", JSON.stringify(out));
        }
        case "write_memory": {
          const kind = stringArg(args.kind);
          const title = stringArg(args.title);
          const body = stringArg(args.body);
          if (kind !== "fact" && kind !== "decision") {
            return err("write_memory", 'write_memory only accepts kind "fact" or "decision".');
          }
          if (!title) return err("write_memory", "Missing required argument: title");
          if (!body) return err("write_memory", "Missing required argument: body");
          const tags = Array.isArray(args.tags)
            ? (args.tags as unknown[]).filter((t): t is string => typeof t === "string")
            : undefined;
          const out = await writeMemory.run(
            { kind, title, body, ...(tags ? { tags } : {}) },
            ctx,
          );
          return ok("write_memory", JSON.stringify(out));
        }
        case "web_search": {
          const query = stringArg(args.query);
          if (!query) return err("web_search", "Missing required argument: query");
          const maxResults = numberArg(args.maxResults);
          const out = await webSearch.run(
            maxResults !== undefined ? { query, maxResults } : { query },
            ctx,
          );
          return ok("web_search", JSON.stringify(out));
        }
        case "web_fetch": {
          const url = stringArg(args.url);
          if (!url) return err("web_fetch", "Missing required argument: url");
          const out = await webFetch.run({ url }, ctx);
          return ok("web_fetch", JSON.stringify(out));
        }
        default:
          return null;
      }
    } catch (e) {
      return err(call.name, e instanceof Error ? e.message : String(e));
    }
  };
}

function ok(name: string, resultText: string): ExecutedTool {
  return { name, resultText, isError: false };
}

function err(name: string, message: string): ExecutedTool {
  return { name, resultText: JSON.stringify({ error: message }), isError: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberArg(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
