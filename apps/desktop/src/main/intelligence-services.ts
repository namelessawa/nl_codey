/** Intelligence main-process services: embedder, memory retriever, semantic indexer. */

import { createEmbeddingProvider, SemanticIndexer } from "@nlc/semantic-index";
import { MemoryRetriever } from "@nlc/memory";
import type { EmbeddingProvider, SandboxMode } from "@nlc/shared";
import type { Services } from "./services.js";

/**
 * Lazily-built intelligence helpers (embedder, memory retriever, semantic
 * indexer). The embedder is resolved from current settings each time so an
 * added/changed API key takes effect without restart; when no key is
 * configured a deterministic mock embedder is used (offline-friendly).
 *
 * Sandbox mode is intentionally NOT stored here. It lives in
 * `AppSettings.agent.sandboxMode` so the GUI selector, the AgentService
 * dispatch, and the on-screen badge always read from a single persistent
 * source. The methods below are thin compatibility shims for the legacy
 * per-workspace IPC signatures.
 */
export class IntelligenceServices {
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

  /**
   * `workspaceId` is ignored — sandbox mode is a global setting. Kept in
   * the signature to preserve the IPC contract; the GUI will get the same
   * mode regardless of which workspace is open.
   */
  getSandboxMode(_workspaceId: string): SandboxMode {
    return this.services.settings.getSettings().agent.sandboxMode;
  }

  /**
   * Writes the new mode to `AppSettings.agent.sandboxMode`. Pre-validates by
   * re-using the settings validator so a malformed value is rejected the
   * same way it would be from the Settings panel.
   */
  setSandboxMode(_workspaceId: string, mode: SandboxMode): SandboxMode {
    const current = this.services.settings.getSettings();
    const next = {
      ...current,
      agent: { ...current.agent, sandboxMode: mode, sandboxEnabled: true },
    };
    this.services.settings.updateSettings(next);
    return mode;
  }
}
