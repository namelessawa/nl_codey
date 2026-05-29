/**
 * Model registry. Manages base + LoRA adapter versions; enforces invariant
 * "exactly one active model at a time". One-click rollback to base is the
 * paramount safety property: any user, any time, can revert.
 */
import type { ModelRegistryEntry } from "@coding-agent/shared";

export interface ModelRegistryStore {
  registerModel(entry: Omit<ModelRegistryEntry, "id" | "createdAt">): ModelRegistryEntry;
  setActiveModel(id: string): ModelRegistryEntry | null;
  getActiveModel(): ModelRegistryEntry | null;
  listModels(): ModelRegistryEntry[];
  rollbackToBase(): ModelRegistryEntry | null;
}

export class ModelRegistry {
  constructor(private readonly store: ModelRegistryStore) {}

  /** Register a base (pretrained, no adapter) model. */
  registerBase(name: string, makeActive = true): ModelRegistryEntry {
    return this.store.registerModel({
      name,
      kind: "base",
      baseModel: name,
      active: makeActive,
      evalDelta: null,
      artifactPath: null,
    });
  }

  /** Register a LoRA adapter; activation requires explicit setActive call. */
  registerAdapter(args: {
    name: string;
    baseModel: string;
    artifactPath: string;
    evalDelta: number | null;
  }): ModelRegistryEntry {
    return this.store.registerModel({
      name: args.name,
      kind: "lora_adapter",
      baseModel: args.baseModel,
      active: false,
      evalDelta: args.evalDelta,
      artifactPath: args.artifactPath,
    });
  }

  registerEmbeddingAdapter(args: {
    name: string;
    baseModel: string;
    artifactPath: string;
    evalDelta: number | null;
  }): ModelRegistryEntry {
    return this.store.registerModel({
      name: args.name,
      kind: "embedding_adapter",
      baseModel: args.baseModel,
      active: false,
      evalDelta: args.evalDelta,
      artifactPath: args.artifactPath,
    });
  }

  /** Promote a candidate to active. Caller MUST have confirmed eval gate passed. */
  promote(modelId: string): ModelRegistryEntry | null {
    return this.store.setActiveModel(modelId);
  }

  /** Instant rollback. Always allowed. Never fails (returns null only if no base exists). */
  rollbackToBase(): ModelRegistryEntry | null {
    return this.store.rollbackToBase();
  }

  getActive(): ModelRegistryEntry | null {
    return this.store.getActiveModel();
  }

  list(): ModelRegistryEntry[] {
    return this.store.listModels();
  }
}
