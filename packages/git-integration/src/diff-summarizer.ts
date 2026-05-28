/** Pure unified-diff parsing helpers. No git invocation. */

export type DiffSummary = {
  files: string[];
  additions: number;
  deletions: number;
};

/**
 * Extract the changed file paths from a unified diff. Prefers the `+++ b/...`
 * target line, falling back to the `diff --git a/... b/...` header so renames
 * and deletions (no `+++ b/`) are still captured. Paths are deduplicated and
 * `/dev/null` is ignored.
 */
export function parseChangedFiles(diff: string): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const lines = diff.split("\n");

  for (const line of lines) {
    const path = extractPath(line);
    if (path && !seen.has(path)) {
      seen.add(path);
      files.push(path);
    }
  }
  return files;
}

function extractPath(line: string): string | null {
  if (line.startsWith("+++ ")) {
    return cleanPath(line.slice(4));
  }
  if (line.startsWith("diff --git ")) {
    // diff --git a/<path> b/<path>
    const match = line.match(/ b\/(.+)$/);
    return match?.[1] ? match[1].trim() : null;
  }
  return null;
}

function cleanPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "/dev/null") return null;
  const stripped = trimmed.replace(/^[ab]\//, "");
  return stripped || null;
}

/**
 * Summarize a unified diff: changed files plus total added/removed line counts.
 * Counts `+`/`-` content lines, excluding the `+++`/`---` file headers.
 */
export function summarizeDiff(diff: string): DiffSummary {
  let additions = 0;
  let deletions = 0;
  const lines = diff.split("\n");

  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }

  return { files: parseChangedFiles(diff), additions, deletions };
}
