import type {
  AgentTool,
  WebFetchToolInput,
  WebFetchToolOutput,
  WebSearchToolInput,
  WebSearchToolOutput,
} from "@nlc/shared";
import type { WebPort } from "./phase3-deps.js";

/**
 * web_search (Coder): search the web for documentation, error messages, or
 * library usage. Delegates to the injected web port.
 */
export function createWebSearchTool(
  port: WebPort,
): AgentTool<WebSearchToolInput, WebSearchToolOutput> {
  return {
    name: "web_search",
    description: "在网络上搜索文档、错误信息或库用法，返回标题、URL 与摘要列表。",
    run(input) {
      return port.search(input);
    },
  };
}

/**
 * web_fetch (Coder): fetch and extract readable text from a single URL.
 */
export function createWebFetchTool(
  port: WebPort,
): AgentTool<WebFetchToolInput, WebFetchToolOutput> {
  return {
    name: "web_fetch",
    description: "抓取单个 URL 并提取可读文本内容（超长时会被截断）。",
    run(input) {
      return port.fetch(input);
    },
  };
}
