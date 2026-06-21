/**
 * Phase 3 single-agent port factory. Builds the live SemanticSearchPort /
 * MemoryPort / WebPort bundle that {@link AgentService.getPhase3Ports}
 * returns. Each call is per-workspace so the user's API key, embedder choice,
 * and workspace memory are all resolved at run time — no cached state lives
 * here.
 *
 * The web port uses a DuckDuckGo backend over the global fetch. Fetch-side
 * domain whitelisting is enforced in `@nlc/web-tools/webFetch` so we
 * don't repeat it here.
 */

import {
  createDuckDuckGoBackend,
  webFetch,
  webSearch,
  type SearchBackend,
} from "@nlc/web-tools";
import { searchChunks } from "@nlc/semantic-index";
import type { ExtendedAgentPorts } from "@nlc/agent-core";
import type {
  MemoryRetrievalOptions,
  ReadMemoryHit,
  SemanticSearchToolHit,
  WebFetchToolInput,
  WebSearchToolInput,
  WriteMemoryInput,
} from "@nlc/shared";
import { createEntry, MemoryRetriever } from "@nlc/memory";
import type { Services } from "./services.js";
import { Phase3Services } from "./phase3-services.js";

/**
 * Build the Phase 3 port bundle for a specific workspace. Returns null when
 * the workspace is unknown (defensive: keeps the agent on the Phase 1/2
 * surface instead of crashing on a stale id).
 */
export function buildPhase3Ports(
  services: Services,
  workspaceId: string,
): ExtendedAgentPorts | null {
  const ws = services.storage.getWorkspace(workspaceId);
  if (!ws) return null;
  const phase3 = new Phase3Services(services);
  const embedder = phase3.embedder();
  const retriever = new MemoryRetriever(services.storage, embedder);
  const searchBackend: SearchBackend = createDuckDuckGoBackend();

  return {
    semanticSearch: {
      async search(
        query: string,
        opts?: { topK?: number; kinds?: ("code" | "doc" | "comment")[] },
      ): Promise<SemanticSearchToolHit[]> {
        const hits = await searchChunks(
          services.storage,
          embedder,
          workspaceId,
          query,
          opts ?? {},
        );
        return hits.map((h) => {
          const out: SemanticSearchToolHit = {
            filePath: h.filePath,
            startLine: h.startLine,
            endLine: h.endLine,
            snippet: h.snippet,
            score: h.score,
          };
          if (h.symbolName !== undefined) out.symbolName = h.symbolName;
          return out;
        });
      },
    },

    memory: {
      async read(
        query: string | undefined,
        kind: string | undefined,
        max: number,
      ): Promise<ReadMemoryHit[]> {
        // Empty query => retrieval falls back to keyword (0) + tag bonus +
        // recency, which still yields a reasonable ordering for "what do I
        // know about this workspace" calls.
        const opts: MemoryRetrievalOptions = { workspaceId, maxEntries: max };
        const hits = await retriever.retrieve(query ?? "", opts);
        const filtered = kind ? hits.filter((h) => h.entry.kind === kind) : hits;
        return filtered.map((h) => ({
          id: h.entry.id,
          kind: h.entry.kind,
          title: h.entry.title,
          body: h.entry.body,
          tags: h.entry.tags,
          score: h.score,
        }));
      },
      async write(input: WriteMemoryInput): Promise<{ id: string; kind: string }> {
        // Precompute the embedding so the new entry can be ranked by future
        // retrieval. Failure is non-fatal — without an embedding the entry
        // still surfaces via tag/keyword overlap + recency.
        let embedding: number[] | undefined;
        try {
          const text = `${input.title}\n${input.body}`;
          const vectors = await embedder.embed([text]);
          embedding = vectors[0];
        } catch {
          embedding = undefined;
        }
        const entry = createEntry(
          services.storage,
          workspaceId,
          {
            kind: input.kind,
            title: input.title,
            body: input.body,
            ...(input.tags ? { tags: input.tags } : {}),
          },
          embedding,
        );
        return { id: entry.id, kind: entry.kind };
      },
    },

    web: {
      async search(input: WebSearchToolInput) {
        return webSearch(input, searchBackend);
      },
      async fetch(input: WebFetchToolInput) {
        return webFetch(input);
      },
    },
  };
}
