/** Heuristic, language-agnostic file chunker (no tree-sitter). */

import type { RawChunk } from "@coding-agent/shared";
import { SEMANTIC_MAX_CHUNK_CHARS, SEMANTIC_MAX_CHUNK_LINES } from "@coding-agent/shared";

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

/**
 * Matches a top-level declaration boundary across the supported languages and
 * captures the symbol name when present. Covers JS/TS function/class (with
 * optional export/async), Python `def`/`class`, Go `func`, and Rust
 * `fn`/`impl`/`struct`/`enum`/`trait`.
 */
const DECL_BOUNDARY =
  /^\s*(?:export\s+)?(?:default\s+)?(?:public\s+|pub\s+|private\s+)?(?:async\s+)?(?:function|class|def|func|fn|impl|struct|enum|trait)\b\s*\*?\s*([A-Za-z_$][\w$]*)?/;

export function chunkFile(filePath: string, content: string): RawChunk[] {
  const ext = extensionOf(filePath);
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return chunkMarkdown(filePath, content);
  }
  if (CODE_EXTENSIONS.has(ext)) {
    return chunkCode(filePath, content);
  }
  // Skip config/data and other non-indexed files.
  return [];
}

function chunkCode(filePath: string, content: string): RawChunk[] {
  const lines = content.split("\n");
  if (lines.length === 0) return [];

  // Find boundary line indices (0-based). The region before the first boundary
  // (imports, top-level statements) forms its own chunk.
  const boundaries: Array<{ line: number; symbol?: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = DECL_BOUNDARY.exec(lines[i] ?? "");
    if (match) {
      const entry: { line: number; symbol?: string } = { line: i };
      if (match[1]) entry.symbol = match[1];
      boundaries.push(entry);
    }
  }

  const segments: Array<{ start: number; end: number; symbol?: string }> = [];
  if (boundaries.length === 0) {
    segments.push({ start: 0, end: lines.length - 1 });
  } else {
    const firstBoundary = boundaries[0]?.line ?? 0;
    if (firstBoundary > 0) {
      segments.push({ start: 0, end: firstBoundary - 1 });
    }
    for (let b = 0; b < boundaries.length; b++) {
      const current = boundaries[b];
      if (!current) continue;
      const next = boundaries[b + 1];
      const end = next ? next.line - 1 : lines.length - 1;
      const seg: { start: number; end: number; symbol?: string } = { start: current.line, end };
      if (current.symbol) seg.symbol = current.symbol;
      segments.push(seg);
    }
  }

  const chunks: RawChunk[] = [];
  for (const seg of segments) {
    if (isBlank(lines, seg.start, seg.end)) continue;
    for (const window of windowize(seg.start, seg.end, SEMANTIC_MAX_CHUNK_LINES)) {
      const text = capContent(lines.slice(window.start, window.end + 1).join("\n"));
      if (text.trim().length === 0) continue;
      const chunk: RawChunk = {
        filePath,
        startLine: window.start + 1,
        endLine: window.end + 1,
        kind: "code",
        content: text,
      };
      // Only the first window of a segment carries the symbol name.
      if (seg.symbol && window.start === seg.start) chunk.symbolName = seg.symbol;
      chunks.push(chunk);
    }
  }
  return chunks;
}

function chunkMarkdown(filePath: string, content: string): RawChunk[] {
  const lines = content.split("\n");
  if (lines.length === 0) return [];

  // Split on H2/H3 headings; content before the first such heading is its own block.
  const headingIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^#{2,3}\s+/.test(lines[i] ?? "")) headingIndices.push(i);
  }

  const blocks: Array<{ start: number; end: number }> = [];
  if (headingIndices.length === 0) {
    blocks.push({ start: 0, end: lines.length - 1 });
  } else {
    const first = headingIndices[0] ?? 0;
    if (first > 0) blocks.push({ start: 0, end: first - 1 });
    for (let h = 0; h < headingIndices.length; h++) {
      const start = headingIndices[h] ?? 0;
      const next = headingIndices[h + 1];
      const end = next !== undefined ? next - 1 : lines.length - 1;
      blocks.push({ start, end });
    }
  }

  const chunks: RawChunk[] = [];
  for (const block of blocks) {
    if (isBlank(lines, block.start, block.end)) continue;
    // Each block may still exceed the char cap; split into char-bounded pieces
    // while keeping line tracking accurate.
    for (const piece of splitByChars(lines, block.start, block.end)) {
      chunks.push({
        filePath,
        startLine: piece.start + 1,
        endLine: piece.end + 1,
        kind: "doc",
        content: piece.text,
      });
    }
  }
  return chunks;
}

/** Slice [start,end] (0-based, inclusive) into windows of at most maxLines. */
function windowize(start: number, end: number, maxLines: number): Array<{ start: number; end: number }> {
  const windows: Array<{ start: number; end: number }> = [];
  let cursor = start;
  while (cursor <= end) {
    const windowEnd = Math.min(cursor + maxLines - 1, end);
    windows.push({ start: cursor, end: windowEnd });
    cursor = windowEnd + 1;
  }
  return windows;
}

/** Split a line range into char-bounded pieces (used for long markdown blocks). */
function splitByChars(
  lines: string[],
  start: number,
  end: number,
): Array<{ start: number; end: number; text: string }> {
  const pieces: Array<{ start: number; end: number; text: string }> = [];
  let pieceStart = start;
  let buffer: string[] = [];
  let bufferLen = 0;

  for (let i = start; i <= end; i++) {
    const line = lines[i] ?? "";
    const addition = line.length + 1; // include newline
    if (bufferLen + addition > SEMANTIC_MAX_CHUNK_CHARS && buffer.length > 0) {
      pieces.push({ start: pieceStart, end: i - 1, text: capContent(buffer.join("\n")) });
      pieceStart = i;
      buffer = [];
      bufferLen = 0;
    }
    buffer.push(line);
    bufferLen += addition;
  }
  if (buffer.length > 0) {
    pieces.push({ start: pieceStart, end, text: capContent(buffer.join("\n")) });
  }
  return pieces;
}

function capContent(text: string): string {
  return text.length > SEMANTIC_MAX_CHUNK_CHARS ? text.slice(0, SEMANTIC_MAX_CHUNK_CHARS) : text;
}

function isBlank(lines: string[], start: number, end: number): boolean {
  for (let i = start; i <= end; i++) {
    if ((lines[i] ?? "").trim().length > 0) return false;
  }
  return true;
}

function extensionOf(filePath: string): string {
  const lower = filePath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot === -1 ? "" : lower.slice(dot);
}
