/**
 * Proposal generator: wraps the read-only scanner output as Proposal records
 * with deduplication against the existing inbox. Same scan output should not
 * re-emit a proposal already in `new` or `snoozed` state.
 */
import type { Proposal, ProposalInput } from "@nlc/shared";

export type GenerationContext = {
  workspaceId: string;
  existing: Proposal[];
};

export function dedupeAgainstInbox(
  proposals: ProposalInput[],
  context: GenerationContext,
): ProposalInput[] {
  const existingTitles = new Set(
    context.existing
      .filter((p) => p.status === "new" || p.status === "snoozed")
      .map((p) => normalizeTitle(p.title)),
  );
  return proposals.filter((p) => !existingTitles.has(normalizeTitle(p.title)));
}

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}
