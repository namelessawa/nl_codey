/**
 * Decision-log helpers: record `decision`-kind memory entries and parse the
 * JSON memory-extraction payload an LLM produces at the end of a run.
 */
import type { MemoryEntryInput, MemoryKind } from "@coding-agent/shared";
import { createEntry, type MemoryStore } from "./project-memory.js";

const VALID_KINDS: ReadonlySet<MemoryKind> = new Set<MemoryKind>([
  "decision",
  "preference",
  "failure",
  "fact",
]);

/** Record a single decision entry. */
export function recordDecision(
  store: MemoryStore,
  workspaceId: string,
  title: string,
  body: string,
  options?: { tags?: string[]; sourceRunId?: string },
): MemoryEntryInput {
  const input: MemoryEntryInput = {
    kind: "decision",
    title,
    body,
    tags: options?.tags ?? [],
  };
  if (options?.sourceRunId) input.sourceRunId = options.sourceRunId;
  createEntry(store, workspaceId, input);
  return input;
}

/** Strip a Markdown code fence (```json ... ```), returning the inner text. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  // Drop the opening fence line (``` or ```json) and the trailing fence.
  const withoutOpen = trimmed.replace(/^```[a-zA-Z]*\s*\n?/, "");
  return withoutOpen.replace(/\n?```\s*$/, "").trim();
}

/**
 * Parse an LLM-produced JSON array of `{kind,title,body,tags}` into validated
 * `MemoryEntryInput[]`. Tolerates code fences and malformed JSON (returns []).
 */
export function parseMemoryExtraction(json: string): MemoryEntryInput[] {
  if (typeof json !== "string" || json.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(json));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const results: MemoryEntryInput[] = [];
  for (const item of parsed) {
    const input = toInput(item);
    if (input) results.push(input);
  }
  return results;
}

function toInput(item: unknown): MemoryEntryInput | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== "string" || !VALID_KINDS.has(kind as MemoryKind)) {
    return null;
  }
  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (title.length === 0) return null;
  const body = typeof record.body === "string" ? record.body : "";
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((t): t is string => typeof t === "string")
    : [];
  return { kind: kind as MemoryKind, title, body, tags };
}
