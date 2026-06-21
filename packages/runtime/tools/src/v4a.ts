import { TOOL_CODES, ToolError } from "./errors.js";

/**
 * V4A patch format support. Unlike a unified diff, V4A is line-number-free: it
 * locates edits by surrounding context, which is more robust to small model
 * mistakes. Example:
 *
 *   *** Begin Patch
 *   *** Update File: src/parser.ts
 *   @@ function parseConfig
 *    const result = JSON.parse(raw);
 *   -return result;
 *   +return result as Config;
 *   *** Add File: src/new.ts
 *   +export const x = 1;
 *   *** Delete File: src/old.ts
 *   *** End Patch
 */

export type V4AOp =
  | { op: "update"; path: string; hunks: V4AHunk[] }
  | { op: "add"; path: string; content: string }
  | { op: "delete"; path: string };

export type V4AHunk = {
  /** Optional @@ locator (e.g. enclosing function), narrows the search. */
  locator?: string;
  /** Context + removed lines, in order — the block to find in the file. */
  oldLines: string[];
  /** Context + added lines, in order — what replaces the matched block. */
  newLines: string[];
};

const BEGIN = "*** Begin Patch";
const END = "*** End Patch";

/** Cheap detection: does this text look like a V4A patch envelope? */
export function isV4APatch(text: string): boolean {
  return text.trimStart().startsWith(BEGIN);
}

/** Parse a V4A patch into file operations. Throws ToolError on malformed input. */
export function parseV4A(text: string): V4AOp[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => l.trim() === BEGIN);
  if (start === -1) {
    throw new ToolError(TOOL_CODES.patchInvalid, "V4A patch missing '*** Begin Patch'");
  }
  const ops: V4AOp[] = [];
  let i = start + 1;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === END) break;

    const update = matchPrefix(line, "*** Update File:");
    const add = matchPrefix(line, "*** Add File:");
    const del = matchPrefix(line, "*** Delete File:");

    if (update !== null) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !isSectionMarker(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i++;
      }
      ops.push({ op: "update", path: normalize(update), hunks: parseHunks(body, update) });
    } else if (add !== null) {
      const added: string[] = [];
      i++;
      while (i < lines.length && !isSectionMarker(lines[i] ?? "")) {
        const l = lines[i] ?? "";
        added.push(l.startsWith("+") ? l.slice(1) : l);
        i++;
      }
      ops.push({ op: "add", path: normalize(add), content: added.join("\n") });
    } else if (del !== null) {
      ops.push({ op: "delete", path: normalize(del) });
      i++;
    } else {
      // Stray line between sections (often a blank); skip it.
      i++;
    }
  }

  if (ops.length === 0) {
    throw new ToolError(TOOL_CODES.patchInvalid, "V4A patch contains no file operations");
  }
  return ops;
}

function parseHunks(body: string[], path: string): V4AHunk[] {
  const hunks: V4AHunk[] = [];
  let current: V4AHunk | null = null;

  const flush = (): void => {
    if (current && (current.oldLines.length > 0 || current.newLines.length > 0)) {
      hunks.push(current);
    }
    current = null;
  };

  for (const raw of body) {
    if (raw.startsWith("@@")) {
      flush();
      current = { locator: raw.slice(2).trim() || undefined, oldLines: [], newLines: [] };
      continue;
    }
    if (!current) current = { oldLines: [], newLines: [] };
    if (raw.startsWith("+")) {
      current.newLines.push(raw.slice(1));
    } else if (raw.startsWith("-")) {
      current.oldLines.push(raw.slice(1));
    } else {
      // Context line: a leading space is the convention, but tolerate bare lines.
      const text = raw.startsWith(" ") ? raw.slice(1) : raw;
      current.oldLines.push(text);
      current.newLines.push(text);
    }
  }
  flush();

  if (hunks.length === 0) {
    throw new ToolError(TOOL_CODES.patchInvalid, `V4A Update File ${path} has no hunks`);
  }
  return hunks;
}

/** Apply all hunks for one file to its current content, returning the new content. */
export function applyV4AHunks(before: string, hunks: V4AHunk[], path: string): string {
  let lines = before.split("\n");

  for (const hunk of hunks) {
    if (hunk.oldLines.length === 0) {
      // Pure insertion: append after the locator line, or at end of file.
      const at = hunk.locator ? findLocator(lines, hunk.locator) : lines.length;
      const insertAt = at === -1 ? lines.length : at;
      lines = [...lines.slice(0, insertAt), ...hunk.newLines, ...lines.slice(insertAt)];
      continue;
    }
    const matchAt = findBlock(lines, hunk.oldLines, hunk.locator);
    if (matchAt === -1) {
      throw new ToolError(
        TOOL_CODES.patchApplyFailed,
        `V4A hunk did not match in ${path} (context not found). The file may differ from what the patch expects.`,
      );
    }
    lines = [...lines.slice(0, matchAt), ...hunk.newLines, ...lines.slice(matchAt + hunk.oldLines.length)];
  }

  return lines.join("\n");
}

/** Find a contiguous run of `block` in `lines`; optionally start after a locator. */
function findBlock(lines: string[], block: string[], locator?: string): number {
  const from = locator ? Math.max(0, findLocator(lines, locator)) : 0;
  for (let i = from; i + block.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < block.length; j++) {
      if (lines[i + j] !== block[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function findLocator(lines: string[], locator: string): number {
  const idx = lines.findIndex((l) => l.includes(locator));
  return idx === -1 ? -1 : idx + 1;
}

function matchPrefix(line: string, prefix: string): string | null {
  return line.startsWith(prefix) ? line.slice(prefix.length).trim() : null;
}

function isSectionMarker(line: string): boolean {
  return line.startsWith("*** ");
}

function normalize(path: string): string {
  return path.replace(/^[ab]\//, "").split("\\").join("/");
}
