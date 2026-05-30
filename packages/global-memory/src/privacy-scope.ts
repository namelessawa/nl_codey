/**
 * Privacy scope guard. Default is `isolated`: nothing leaves the project.
 * Cross-project pattern extraction is allowed only when a workspace explicitly
 * opts in. Team mode shares within a single trust boundary; cross-org sharing
 * is never enabled in Phase 4.
 */
import type {
  MemoryEntry,
  WorkspaceContributionMode,
} from "@coding-agent/shared";

export type WorkspaceContributionPolicy = {
  workspaceId: string;
  mode: WorkspaceContributionMode;
};

/** Filter project memory sources by their contribution policy. */
export function filterContributableSources<T extends { workspaceId: string; entries: MemoryEntry[] }>(
  sources: T[],
  policies: Map<string, WorkspaceContributionMode>,
): T[] {
  return sources.filter((s) => {
    const mode = policies.get(s.workspaceId) ?? "isolated";
    return mode === "contribute" || mode === "team_shared";
  });
}

/** Validation: is this mode change legal? */
export function canChangeMode(
  current: WorkspaceContributionMode,
  next: WorkspaceContributionMode,
): { ok: boolean; reason?: string } {
  if (current === next) return { ok: true };
  // We allow any transition — including pulling back to isolated (which triggers
  // retraction of past contributions in the caller).
  return { ok: true };
}

/** Confirm a mode change requires explicit user opt-in (never automatic). */
export function requiresUserConsent(next: WorkspaceContributionMode): boolean {
  return next !== "isolated";
}
