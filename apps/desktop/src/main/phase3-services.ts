/** Phase 3 main-process services: embedder, memory retriever, semantic indexer. */

import { createEmbeddingProvider, SemanticIndexer } from "@coding-agent/semantic-index";
import { MemoryRetriever } from "@coding-agent/memory";
import type { EmbeddingProvider, SandboxMode } from "@coding-agent/shared";
import type { Services } from "./services.js";

/**
 * Lazily-built Phase 3 helpers. The embedder is resolved from current settings
 * each time so an added/changed API key takes effect without restart; when no
 * key is configured a deterministic mock embedder is used (offline-friendly).
 */
export class Phase3Services {
  private readonly sandboxModes = new Map<string, SandboxMode>();

  constructor(private readonly services: Services) {}

  embedder(): EmbeddingProvider {
    const config = this.services.settings.getLLMConfig();
    return createEmbeddingProvider({
      apiKey: config.apiKey ?? "",
      baseUrl: config.baseUrl ?? "",
    });
  }

  retriever(): MemoryRetriever {
    return new MemoryRetriever(this.services.storage, this.embedder());
  }

  indexer(): SemanticIndexer {
    return new SemanticIndexer(this.services.storage, this.embedder());
  }

  getSandboxMode(workspaceId: string): SandboxMode {
    return this.sandboxModes.get(workspaceId) ?? "whitelist";
  }

  setSandboxMode(workspaceId: string, mode: SandboxMode): SandboxMode {
    this.sandboxModes.set(workspaceId, mode);
    return mode;
  }
}
