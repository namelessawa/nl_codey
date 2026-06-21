/** Offline test doubles: an in-memory MemoryStore and a deterministic embedder. */
import { randomUUID } from "node:crypto";
import type {
  EmbeddingProvider,
  MemoryEntry,
  MemoryEntryInput,
  MemoryEntryPatch,
  MemoryFilter,
} from "@nlc/shared";
import type { MemoryStore } from "./project-memory.js";

/** A minimal in-memory implementation of the MemoryStore port for tests. */
export class FakeMemoryStore implements MemoryStore {
  private readonly entries = new Map<string, MemoryEntry>();
  private readonly embeddings = new Map<string, number[] | null>();

  createMemory(
    workspaceId: string,
    input: MemoryEntryInput,
    embedding?: number[],
  ): MemoryEntry {
    const id = randomUUID();
    const entry: MemoryEntry = {
      id,
      workspaceId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      tags: input.tags ?? [],
      createdAt: Date.now(),
      usefulness: 0,
    };
    if (input.sourceRunId) entry.sourceRunId = input.sourceRunId;
    this.entries.set(id, entry);
    this.embeddings.set(id, embedding ?? null);
    return entry;
  }

  listMemory(workspaceId: string, filter?: MemoryFilter): MemoryEntry[] {
    const includeHidden = filter?.includeHidden ?? false;
    return [...this.entries.values()].filter((e) => {
      if (e.workspaceId !== workspaceId) return false;
      if (filter?.kind && e.kind !== filter.kind) return false;
      if (!includeHidden && e.usefulness <= -3) return false;
      if (filter?.search) {
        const hay = `${e.title} ${e.body}`.toLowerCase();
        if (!hay.includes(filter.search.toLowerCase())) return false;
      }
      if (filter?.tags && filter.tags.length > 0) {
        if (!filter.tags.every((t) => e.tags.includes(t))) return false;
      }
      return true;
    });
  }

  listMemoryWithEmbeddings(
    workspaceId: string,
  ): { entry: MemoryEntry; embedding: number[] | null }[] {
    return this.listMemory(workspaceId, { includeHidden: true }).map(
      (entry) => ({
        entry,
        embedding: this.embeddings.get(entry.id) ?? null,
      }),
    );
  }

  getMemory(id: string): MemoryEntry | null {
    return this.entries.get(id) ?? null;
  }

  updateMemory(id: string, patch: MemoryEntryPatch): MemoryEntry | null {
    const existing = this.entries.get(id);
    if (!existing) return null;
    const updated: MemoryEntry = { ...existing, ...patch };
    this.entries.set(id, updated);
    return updated;
  }

  touchMemory(id: string, delta = 1): void {
    const existing = this.entries.get(id);
    if (!existing) return;
    this.entries.set(id, {
      ...existing,
      usefulness: existing.usefulness + delta,
      lastUsedAt: Date.now(),
    });
  }

  deleteMemory(id: string): boolean {
    this.embeddings.delete(id);
    return this.entries.delete(id);
  }

  /** Test-only: directly seed an entry with a chosen embedding and timestamps. */
  seed(entry: MemoryEntry, embedding: number[] | null): void {
    this.entries.set(entry.id, entry);
    this.embeddings.set(entry.id, embedding);
  }
}

/**
 * Deterministic offline embedder. Maps text to a fixed-dimension vector by
 * hashing tokens into buckets, so similar text yields similar vectors.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model = "fake-embedding";
  readonly dimensions: number;

  constructor(dimensions = 16) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
    for (const token of tokens) {
      let hash = 0;
      for (let i = 0; i < token.length; i += 1) {
        hash = (hash * 31 + token.charCodeAt(i)) | 0;
      }
      const bucket = Math.abs(hash) % this.dimensions;
      vec[bucket] = (vec[bucket] ?? 0) + 1;
    }
    return vec;
  }
}

/** Build a complete MemoryEntry for seeding tests. */
export function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: overrides.id ?? randomUUID(),
    workspaceId: overrides.workspaceId ?? "ws-1",
    kind: overrides.kind ?? "fact",
    title: overrides.title ?? "Untitled",
    body: overrides.body ?? "",
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? Date.now(),
    usefulness: overrides.usefulness ?? 0,
    ...(overrides.lastUsedAt !== undefined
      ? { lastUsedAt: overrides.lastUsedAt }
      : {}),
    ...(overrides.sourceRunId !== undefined
      ? { sourceRunId: overrides.sourceRunId }
      : {}),
  };
}
