/**
 * Project memory facade + the `MemoryStore` persistence port.
 *
 * This package never imports `@nlc/storage`. Instead it depends on the
 * `MemoryStore` interface below, which lists exactly the persistence methods
 * the memory package calls. The main process injects the real Storage.
 */
import type {
  MemoryEntry,
  MemoryEntryInput,
  MemoryEntryPatch,
  MemoryExport,
  MemoryFilter,
} from "@nlc/shared";

/** Persistence port. Implemented by the real Storage in the main process. */
export interface MemoryStore {
  createMemory(
    workspaceId: string,
    input: MemoryEntryInput,
    embedding?: number[],
  ): MemoryEntry;
  listMemory(workspaceId: string, filter?: MemoryFilter): MemoryEntry[];
  listMemoryWithEmbeddings(
    workspaceId: string,
  ): { entry: MemoryEntry; embedding: number[] | null }[];
  getMemory(id: string): MemoryEntry | null;
  updateMemory(id: string, patch: MemoryEntryPatch): MemoryEntry | null;
  touchMemory(id: string, delta?: number): void;
  deleteMemory(id: string): boolean;
}

/** Current export envelope version. */
export const MEMORY_EXPORT_VERSION = 1 as const;

/** Create a memory entry, optionally with a precomputed embedding. */
export function createEntry(
  store: MemoryStore,
  workspaceId: string,
  input: MemoryEntryInput,
  embedding?: number[],
): MemoryEntry {
  return store.createMemory(workspaceId, input, embedding);
}

/** List memory entries for a workspace, optionally filtered. */
export function listEntries(
  store: MemoryStore,
  workspaceId: string,
  filter?: MemoryFilter,
): MemoryEntry[] {
  return store.listMemory(workspaceId, filter);
}

/** Apply a partial update to an existing entry. */
export function updateEntry(
  store: MemoryStore,
  id: string,
  patch: MemoryEntryPatch,
): MemoryEntry | null {
  return store.updateMemory(id, patch);
}

/** Delete an entry by id. Returns true if a row was removed. */
export function deleteEntry(store: MemoryStore, id: string): boolean {
  return store.deleteMemory(id);
}

/** Build a versioned export envelope of all (visible) memory for a workspace. */
export function exportMemory(
  store: MemoryStore,
  workspaceId: string,
): MemoryExport {
  const entries = store.listMemory(workspaceId, { includeHidden: true });
  return {
    version: MEMORY_EXPORT_VERSION,
    workspaceId,
    exportedAt: Date.now(),
    entries,
  };
}

/**
 * Import a previously exported envelope into a workspace.
 *
 * Returns the count of entries imported. Tolerates missing optional fields for
 * forward compatibility, but validates the envelope version and entry shape.
 */
export function importMemory(
  store: MemoryStore,
  workspaceId: string,
  data: MemoryExport,
): number {
  if (!data || data.version !== MEMORY_EXPORT_VERSION) {
    throw new Error(
      `Unsupported memory export version: ${data ? data.version : "missing"}`,
    );
  }
  const entries = Array.isArray(data.entries) ? data.entries : [];
  let imported = 0;
  for (const raw of entries) {
    const input = toEntryInput(raw);
    if (!input) continue;
    store.createMemory(workspaceId, input);
    imported += 1;
  }
  return imported;
}

const VALID_KINDS = new Set(["decision", "preference", "failure", "fact"]);

/** Coerce a possibly-partial exported entry into a creation input, or null. */
function toEntryInput(raw: Partial<MemoryEntry>): MemoryEntryInput | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = raw.kind;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!kind || !VALID_KINDS.has(kind) || title.length === 0) return null;
  const body = typeof raw.body === "string" ? raw.body : "";
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === "string")
    : [];
  const input: MemoryEntryInput = { kind, title, body, tags };
  if (typeof raw.sourceRunId === "string") {
    input.sourceRunId = raw.sourceRunId;
  }
  return input;
}
