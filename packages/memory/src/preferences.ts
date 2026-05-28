/**
 * Preference helpers: record `preference`-kind entries and extract preferences
 * from an LLM memory-extraction payload.
 */
import type { MemoryEntryInput } from "@coding-agent/shared";
import { createEntry, type MemoryStore } from "./project-memory.js";
import { parseMemoryExtraction } from "./decision-log.js";

/** Record a single preference entry. */
export function recordPreference(
  store: MemoryStore,
  workspaceId: string,
  title: string,
  body: string,
  options?: { tags?: string[]; sourceRunId?: string },
): MemoryEntryInput {
  const input: MemoryEntryInput = {
    kind: "preference",
    title,
    body,
    tags: options?.tags ?? [],
  };
  if (options?.sourceRunId) input.sourceRunId = options.sourceRunId;
  createEntry(store, workspaceId, input);
  return input;
}

/**
 * Extract preference inputs from an LLM extraction JSON payload. Reuses
 * `parseMemoryExtraction` and keeps only `preference`-kind entries.
 */
export function extractPreferences(json: string): MemoryEntryInput[] {
  return parseMemoryExtraction(json).filter(
    (input) => input.kind === "preference",
  );
}
