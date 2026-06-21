/**
 * Failure library: record `failure`-kind entries ("steps on the rake"), decay
 * stale failures over time, and format a pitfall section for prompt injection.
 */
import type { MemoryEntryInput, MemoryHit } from "@nlc/shared";
import {
  MEMORY_DECAY_DAYS,
  MEMORY_HIDDEN_THRESHOLD,
  MEMORY_MAX_FAILURE_INJECTION,
} from "@nlc/shared";
import { createEntry, type MemoryStore } from "./project-memory.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Record a single failure entry. */
export function recordFailure(
  store: MemoryStore,
  workspaceId: string,
  title: string,
  body: string,
  options?: { tags?: string[]; sourceRunId?: string },
): MemoryEntryInput {
  const input: MemoryEntryInput = {
    kind: "failure",
    title,
    body,
    tags: options?.tags ?? [],
  };
  if (options?.sourceRunId) input.sourceRunId = options.sourceRunId;
  createEntry(store, workspaceId, input);
  return input;
}

/**
 * Decay failure entries that have not been used recently. Any failure whose
 * `lastUsedAt` (falling back to `createdAt`) is older than `MEMORY_DECAY_DAYS`
 * gets `touchMemory(id, -1)`. Entries already at/below the hidden threshold are
 * considered hidden and skipped. Returns the number of entries decayed.
 */
export function decayFailures(
  store: MemoryStore,
  workspaceId: string,
  now: number = Date.now(),
): number {
  const failures = store.listMemory(workspaceId, {
    kind: "failure",
    includeHidden: true,
  });
  const cutoff = now - MEMORY_DECAY_DAYS * MS_PER_DAY;
  let decayed = 0;
  for (const entry of failures) {
    if (entry.usefulness <= MEMORY_HIDDEN_THRESHOLD) continue; // already hidden
    const lastTouch = entry.lastUsedAt ?? entry.createdAt;
    if (lastTouch < cutoff) {
      store.touchMemory(entry.id, -1);
      decayed += 1;
    }
  }
  return decayed;
}

/**
 * Produce the markdown "## 该项目历史踩坑" pitfall section from retrieval hits.
 * Caps at `MEMORY_MAX_FAILURE_INJECTION` items. Returns "" when there are none.
 */
export function formatPitfalls(hits: MemoryHit[]): string {
  const failures = hits
    .filter((hit) => hit.entry.kind === "failure")
    .slice(0, MEMORY_MAX_FAILURE_INJECTION);
  if (failures.length === 0) return "";

  const lines = failures.map((hit, index) => {
    const tags = hit.entry.tags.join(", ");
    const tagSuffix = tags.length > 0 ? `（标签: ${tags}）` : "";
    return `${index + 1}. ${hit.entry.title}${tagSuffix}`;
  });
  return ["## 该项目历史踩坑", ...lines].join("\n");
}
