/**
 * Read-only technical-debt scanner.
 *
 * INVARIANT (enforced by spec, must remain true in every release):
 *   - This module NEVER modifies a file.
 *   - This module NEVER schedules a task.
 *   - This module NEVER calls a non-read-only sandbox command.
 *
 * Its sole output is a list of {@link ProposalInput}s. The caller decides
 * whether to surface them, snooze them, or convert them into tasks.
 */
import type { ProposalInput } from "@coding-agent/shared";

export type ScannerFile = {
  path: string;
  content: string;
  /** Used for stale-file detection. Optional so the same input record can be
   *  reused for the style extractor. */
  lastModified?: number;
};

export type ScannerOptions = {
  /** Suppress proposals with effort > this size. */
  maxEffort?: "S" | "M" | "L";
  /** Per-scan ceiling so a noisy run doesn't pollute the inbox. */
  maxProposals?: number;
};

const DEFAULT_OPTIONS: Required<ScannerOptions> = {
  maxEffort: "L",
  maxProposals: 10,
};

/** Heuristic scan that flags common debt patterns. Conservative by design. */
export function scanForDebt(
  workspaceId: string,
  files: ScannerFile[],
  options: ScannerOptions = {},
): ProposalInput[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const proposals: ProposalInput[] = [];

  // 1) Files > 800 lines — refactor candidates.
  for (const file of files) {
    const lines = file.content.split("\n").length;
    if (lines > 800) {
      proposals.push({
        workspaceId,
        kind: "refactor",
        title: `Split oversized file ${file.path} (${lines} lines)`,
        rationale: `Files > 800 lines are hard to navigate. Consider splitting into focused modules.`,
        estimatedEffort: lines > 1500 ? "L" : "M",
        affectedFiles: [file.path],
      });
    }
  }

  // 2) Files with TODO/FIXME counts above threshold.
  for (const file of files) {
    const todos = (file.content.match(/\b(TODO|FIXME|XXX)\b/g) ?? []).length;
    if (todos >= 5) {
      proposals.push({
        workspaceId,
        kind: "tech_debt",
        title: `Resolve ${todos} TODO/FIXME markers in ${file.path}`,
        rationale: `High concentration of unresolved markers; some likely stale.`,
        estimatedEffort: todos >= 15 ? "L" : "M",
        affectedFiles: [file.path],
      });
    }
  }

  // 3) Source files paired with no test file (heuristic: <name>.test.<ext> not present).
  const fileSet = new Set(files.map((f) => f.path));
  for (const file of files) {
    if (!/\.(ts|tsx|js|jsx)$/.test(file.path)) continue;
    if (/\.test\./.test(file.path)) continue;
    const testCandidate = file.path.replace(/\.(ts|tsx|js|jsx)$/, ".test.$1");
    if (!fileSet.has(testCandidate)) {
      proposals.push({
        workspaceId,
        kind: "add_tests",
        title: `Add tests for ${file.path}`,
        rationale: `No co-located test file found.`,
        estimatedEffort: "S",
        affectedFiles: [file.path],
      });
    }
  }

  // 4) Outdated dependency markers (e.g. package.json lockfile signals not handled here;
  //    we only flag obvious patterns visible in code).
  for (const file of files) {
    if (file.path.endsWith("package.json")) {
      const deprecatedMarkers = ["request", "node-uuid", "left-pad"];
      const hits = deprecatedMarkers.filter((m) => file.content.includes(`"${m}"`));
      if (hits.length > 0) {
        proposals.push({
          workspaceId,
          kind: "dependency_update",
          title: `Replace deprecated packages: ${hits.join(", ")}`,
          rationale: `These packages are unmaintained or have well-known successors.`,
          estimatedEffort: "M",
          affectedFiles: [file.path],
        });
      }
    }
  }

  // 5) Doc gap: README missing for a non-trivial package.
  const hasReadme = files.some((f) => /readme\.md$/i.test(f.path));
  const hasNontrivialCode =
    files.filter((f) => /\.(ts|js|py|rs|go)$/.test(f.path)).length > 10;
  if (!hasReadme && hasNontrivialCode) {
    proposals.push({
      workspaceId,
      kind: "doc_gap",
      title: "Add a top-level README",
      rationale: "Project has substantial code but no README to orient newcomers.",
      estimatedEffort: "S",
      affectedFiles: [],
    });
  }

  const effortRank = { S: 0, M: 1, L: 2 } as const;
  const maxRank = effortRank[opts.maxEffort];
  return proposals
    .filter((p) => effortRank[p.estimatedEffort] <= maxRank)
    .slice(0, opts.maxProposals);
}
