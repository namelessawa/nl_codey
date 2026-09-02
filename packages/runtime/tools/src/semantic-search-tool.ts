import type {
  AgentTool,
  SemanticSearchOptions,
  SemanticSearchToolInput,
  SemanticSearchToolOutput,
} from "@nlc/shared";
import {
  estimateSemanticTokens,
  normalizeSemanticContextTokenBudget,
  SEMANTIC_TOKEN_ESTIMATOR,
} from "@nlc/shared";
import type { SemanticSearchPort } from "./tool-ports.js";

/**
 * semantic_search (Planner / Coder): natural-language retrieval over indexed
 * code and docs. Delegates ranking to the injected semantic-index port.
 */
export function createSemanticSearchTool(
  port: SemanticSearchPort,
): AgentTool<SemanticSearchToolInput, SemanticSearchToolOutput> {
  return {
    name: "semantic_search",
    description:
      "用自然语言查找代码或文档片段。返回最相关的代码/文档命中（含文件路径、行范围、片段与相关性分数）。",
    async run(input) {
      const maxTokens = normalizeSemanticContextTokenBudget(
        input.maxContextTokens,
      );
      const opts: SemanticSearchOptions = { maxContextTokens: maxTokens };
      if (input.topK !== undefined) opts.topK = input.topK;
      if (input.kinds !== undefined) opts.kinds = input.kinds;
      const hits = await port.search(input.query, opts);
      const builtInUsage = hits
        .map((hit) => hit.provenance?.contextTokensUsed)
        .find((value): value is number => value !== undefined);
      return {
        query: input.query,
        hits,
        budget: {
          maxTokens,
          usedTokens:
            builtInUsage ??
            hits.reduce(
              (total, hit) => total + estimateSemanticTokens(hit.snippet),
              0,
            ),
          limited: hits.some(
            (hit) => hit.provenance?.budgetLimited === true,
          ),
          omittedHits: Math.max(
            0,
            ...hits.map((hit) => hit.provenance?.budgetOmittedHits ?? 0),
          ),
          estimator: SEMANTIC_TOKEN_ESTIMATOR,
        },
      };
    },
  };
}
