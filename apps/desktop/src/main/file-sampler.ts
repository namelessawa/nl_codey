/** Shared filesystem helper: collect a bounded set of source files for analysis. */

import fs from "node:fs";
import path from "node:path";
import type { FileSample } from "@nlc/style-profile";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  ".next",
  ".venv",
  "__pycache__",
]);

const SAMPLEABLE = /\.(ts|tsx|js|jsx|json|md)$/;
const MAX_FILE_SIZE = 200_000;

/**
 * Walk `root` and return up to `max` text-file samples. Skips standard ignore
 * directories, binary-prone extensions, and files over 200KB. Used by the
 * style-spec extractor, the manual debt-scan IPC, and the proactive scheduler.
 */
export async function readSampleFiles(root: string, max: number): Promise<FileSample[]> {
  const out: FileSample[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < max) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (out.length >= max) break;
      if (!SAMPLEABLE.test(entry.name)) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.size > MAX_FILE_SIZE) continue;
        const content = fs.readFileSync(full, "utf-8");
        out.push({
          path: path.relative(root, full),
          content,
          lastModified: stat.mtimeMs,
        });
      } catch {
        continue;
      }
    }
  }
  return out;
}
