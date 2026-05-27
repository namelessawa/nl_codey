import fs from "node:fs/promises";
import path from "node:path";
import { isIgnoredDir } from "./ignore.js";

const DEFAULT_MAX_FILES = 500;

/**
 * Walk `root` breadth-first, returning workspace-relative file paths (POSIX
 * separators) with ignored directories skipped and a hard cap on count.
 */
export async function scanFiles(root: string, maxFiles = DEFAULT_MAX_FILES): Promise<string[]> {
  const results: string[] = [];
  const queue: string[] = [root];

  while (queue.length > 0 && results.length < maxFiles) {
    const dir = queue.shift() as string;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable directory: skip rather than fail the whole scan
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isIgnoredDir(entry.name)) queue.push(full);
      } else if (entry.isFile()) {
        results.push(toRelativePosix(root, full));
      }
    }
  }
  results.sort((a, b) => a.localeCompare(b));
  return results;
}

function toRelativePosix(root: string, full: string): string {
  return path.relative(root, full).split(path.sep).join("/");
}
