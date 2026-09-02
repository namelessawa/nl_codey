/** Directories never scanned, searched, or listed. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  ".venv",
  "__pycache__",
  ".next",
  "out",
]);

export function isIgnoredDir(name: string): boolean {
  return IGNORED_DIRS.has(name.toLowerCase());
}
