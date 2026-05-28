import fs from "node:fs/promises";
import { scanFiles } from "@coding-agent/project-indexer";
import { assertInsideWorkspace } from "@coding-agent/sandbox";
import type {
  AgentTool,
  FindSymbolInput,
  FindSymbolOutput,
  SymbolInfo,
  SymbolKind,
} from "@coding-agent/shared";

/** A language matcher: a regex whose first group is the symbol name. */
type Matcher = { re: RegExp; kind: SymbolKind };

const TS_JS: Matcher[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: "function" },
  { re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
  { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
  { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/, kind: "type" },
  { re: /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: "enum" },
  // const/let arrow functions and exported consts (top-level-ish only).
  { re: /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/, kind: "const" },
];

const PYTHON: Matcher[] = [
  { re: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: "function" },
  { re: /^\s*class\s+([A-Za-z_]\w*)/, kind: "class" },
];

const GO: Matcher[] = [
  { re: /^func\s+(?:\([^)]*\)\s+)?([A-Za-z_]\w*)/, kind: "function" },
  { re: /^type\s+([A-Za-z_]\w*)\s+struct/, kind: "struct" },
  { re: /^type\s+([A-Za-z_]\w*)\s+interface/, kind: "interface" },
  { re: /^type\s+([A-Za-z_]\w*)\s+/, kind: "type" },
  { re: /^(?:const|var)\s+([A-Za-z_]\w*)/, kind: "const" },
];

const RUST: Matcher[] = [
  { re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, kind: "function" },
  { re: /^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/, kind: "struct" },
  { re: /^\s*(?:pub\s+)?enum\s+([A-Za-z_]\w*)/, kind: "enum" },
  { re: /^\s*(?:pub\s+)?trait\s+([A-Za-z_]\w*)/, kind: "interface" },
  { re: /^\s*(?:pub\s+)?type\s+([A-Za-z_]\w*)/, kind: "type" },
  { re: /^\s*(?:pub\s+)?const\s+([A-Za-z_]\w*)/, kind: "const" },
];

function matchersFor(file: string): Matcher[] | null {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) return TS_JS;
  if (/\.py$/.test(file)) return PYTHON;
  if (/\.go$/.test(file)) return GO;
  if (/\.rs$/.test(file)) return RUST;
  return null;
}

function isExported(file: string, signature: string, name: string): boolean {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) return /\bexport\b/.test(signature);
  if (/\.py$/.test(file)) return !name.startsWith("_");
  if (/\.go$/.test(file)) return /^[A-Z]/.test(name);
  if (/\.rs$/.test(file)) return /\bpub\b/.test(signature);
  return false;
}

const MAX_SIGNATURE_CHARS = 200;

/**
 * Extract top-level symbol declarations from a source file by line-based
 * pattern matching. Language is chosen by extension (TS/JS, Python, Go, Rust);
 * unknown extensions yield no symbols. This is a heuristic index — fast and
 * dependency-free — not a full parse, so deeply nested or exotic declarations
 * may be missed. The first matcher to hit a line wins (most specific first).
 */
export function extractSymbols(file: string, content: string): SymbolInfo[] {
  const matchers = matchersFor(file);
  if (!matchers) return [];
  const symbols: SymbolInfo[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (!raw.trim() || raw.trim().startsWith("//") || raw.trim().startsWith("#")) continue;
    for (const m of matchers) {
      const hit = m.re.exec(raw);
      if (hit && hit[1]) {
        const signature = raw.trim().slice(0, MAX_SIGNATURE_CHARS);
        symbols.push({
          name: hit[1],
          kind: m.kind,
          file,
          line: i + 1,
          signature,
          exported: isExported(file, signature, hit[1]),
        });
        break; // one symbol per line
      }
    }
  }
  return symbols;
}

const MAX_FILES_SCANNED = 400;
const MAX_FILE_BYTES = 200 * 1024;
const DEFAULT_MAX_RESULTS = 50;

/**
 * find_symbol: locate symbol declarations across the workspace. With `path`,
 * lists symbols in that single file; with `name`, searches all source files
 * (exact match preferred, case-insensitive substring fallback). Results are
 * capped and never escape the workspace.
 */
export const findSymbolTool: AgentTool<FindSymbolInput, FindSymbolOutput> = {
  name: "find_symbol",
  description: "Find symbol declarations (functions/classes/types/...) by name across the project, or list a file's symbols.",
  async run(input, ctx) {
    const max = Math.min(input.maxResults ?? DEFAULT_MAX_RESULTS, DEFAULT_MAX_RESULTS);
    const files = input.path
      ? [input.path]
      : (await scanFiles(ctx.workspaceRoot, MAX_FILES_SCANNED)).filter((f) => matchersFor(f) !== null);

    const all: SymbolInfo[] = [];
    for (const file of files) {
      if (ctx.signal?.aborted) break;
      let content: string;
      try {
        const abs = assertInsideWorkspace(ctx.workspaceRoot, file);
        const stat = await fs.stat(abs);
        if (stat.size > MAX_FILE_BYTES) continue;
        content = await fs.readFile(abs, "utf8");
      } catch {
        continue; // unreadable/binary/outside — skip
      }
      all.push(...extractSymbols(file, content));
    }

    const filtered = filterByName(all, input.name);
    return { symbols: filtered.slice(0, max), truncated: filtered.length > max };
  },
};

/** Exact-name matches first; fall back to case-insensitive substring matches. */
function filterByName(symbols: SymbolInfo[], name: string | undefined): SymbolInfo[] {
  if (!name) return symbols;
  const exact = symbols.filter((s) => s.name === name);
  if (exact.length > 0) return exact;
  const lower = name.toLowerCase();
  return symbols.filter((s) => s.name.toLowerCase().includes(lower));
}
