import type { ProjectKind } from "./agent.js";

/**
 * A lightweight project summary derived from the workspace file list, shown in
 * the GUI so the user sees what kind of project is open and which validation
 * commands the agent will prefer. Mirrors the main-process detector's
 * heuristics on filenames only (no disk reads), so it is pure and testable.
 */
export type ProjectCard = {
  kind: ProjectKind;
  /** Marker files that determined the kind (e.g. package.json, go.mod). */
  markers: string[];
  suggestedCommands: string[];
  fileCount: number;
  /** Counts by file extension, most frequent first (top entries only). */
  topExtensions: Array<{ ext: string; count: number }>;
};

const MAX_TOP_EXTENSIONS = 5;

export function deriveProjectCard(files: string[]): ProjectCard {
  const set = new Set(files.map((f) => f.split("\\").join("/")));
  const has = (name: string): boolean => set.has(name);

  let kind: ProjectKind = "unknown";
  const markers: string[] = [];
  const suggestedCommands: string[] = [];

  if (has("package.json")) {
    kind = "node";
    markers.push("package.json");
    const runner = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm";
    suggestedCommands.push(runner === "npm" ? "npm test" : `${runner} test`);
    if (has("tsconfig.json")) {
      markers.push("tsconfig.json");
      suggestedCommands.push("npx tsc --noEmit");
    }
  } else if (has("pyproject.toml") || has("pytest.ini")) {
    kind = "python";
    markers.push(has("pyproject.toml") ? "pyproject.toml" : "pytest.ini");
    suggestedCommands.push("pytest");
  } else if (has("go.mod")) {
    kind = "go";
    markers.push("go.mod");
    suggestedCommands.push("go test ./...");
  } else if (has("Cargo.toml")) {
    kind = "rust";
    markers.push("Cargo.toml");
    suggestedCommands.push("cargo test");
  }

  return {
    kind,
    markers,
    suggestedCommands,
    fileCount: files.length,
    topExtensions: countExtensions(files),
  };
}

function countExtensions(files: string[]): Array<{ ext: string; count: number }> {
  const counts = new Map<string, number>();
  for (const f of files) {
    const base = f.split(/[\\/]/).pop() ?? f;
    const dot = base.lastIndexOf(".");
    const ext = dot > 0 ? base.slice(dot) : "(none)";
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext))
    .slice(0, MAX_TOP_EXTENSIONS);
}
