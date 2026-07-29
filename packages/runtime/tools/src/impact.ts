import fs from "node:fs/promises";
import path from "node:path";
import { scanFiles } from "@nlc/project-indexer";
import { assertInsideWorkspace } from "@nlc/sandbox";
import type {
  AgentTool,
  AnalyzeImpactInput,
  AnalyzeImpactOutput,
  ImpactEdge,
  SymbolInfo,
} from "@nlc/shared";
import { extractSymbols } from "./symbols.js";

const MAX_FILES_SCANNED = 400;
const MAX_FILE_BYTES = 200 * 1024;
const DEFAULT_MAX_RESULTS = 100;
const MAX_SYMBOLS = 50;
const MAX_CALL_SYMBOLS = 25;
const MAX_COLLECTED_EDGES = 400;
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /(?:^|\/)(?:__tests__\/.*|[^/]+\.(?:test|spec)\.[cm]?[jt]sx?)$/;
const RESOLVABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

type SourceFile = { path: string; content: string };

/**
 * Analyze the bounded, fresh workspace view around one TS/JS module.
 *
 * Exact edges cover declarations and relative imports. Test edges are direct
 * imports from conventional test paths. Calls are deliberately labelled
 * heuristic because this dependency-free scanner cannot resolve aliases,
 * overloads, re-exports, runtime dispatch, or shadowed identifiers.
 */
export const analyzeImpactTool: AgentTool<AnalyzeImpactInput, AnalyzeImpactOutput> = {
  name: "analyze_impact",
  description:
    "Analyze a TypeScript/JavaScript module's declarations, direct relative imports/importers, associated tests, and lexical symbol callers.",
  async run(input, ctx) {
    const target = normalizeRelativePath(input.path);
    if (!SOURCE_EXTENSION.test(target)) {
      throw new Error("analyze_impact supports TypeScript/JavaScript modules only");
    }
    const maxResults = Math.max(
      1,
      Math.min(input.maxResults ?? DEFAULT_MAX_RESULTS, DEFAULT_MAX_RESULTS),
    );
    const scanned = await scanFiles(ctx.workspaceRoot, MAX_FILES_SCANNED);
    const candidates = [
      target,
      ...scanned.filter((file) => SOURCE_EXTENSION.test(file) && file !== target),
    ];
    const sources: SourceFile[] = [];
    for (const file of candidates) {
      if (ctx.signal?.aborted) break;
      const source = await readBoundedSource(ctx.workspaceRoot, file);
      if (source) sources.push(source);
    }
    const targetSource = sources.find((source) => source.path === target);
    if (!targetSource) throw new Error(`Impact target is missing or unreadable: ${target}`);

    const knownFiles = new Set(sources.map((source) => source.path));
    const allSymbols = extractSymbols(target, targetSource.content);
    const symbols = allSymbols.slice(0, MAX_SYMBOLS);
    const callableSymbols = selectCallableSymbols(allSymbols, input.symbol);
    const requestedSymbols = callableSymbols.slice(0, MAX_CALL_SYMBOLS);
    const collected: ImpactEdge[] = [];
    let collectionTruncated = false;

    for (const symbol of symbols) {
      collected.push({
        kind: "declares",
        from: target,
        to: `${target}#${symbol.name}`,
        line: symbol.line,
        symbol: symbol.name,
        confidence: "exact",
      });
    }

    for (const source of sources) {
      for (const dependency of relativeImports(source.path, source.content, knownFiles)) {
        if (source.path !== target && dependency !== target) continue;
        if (collected.length >= MAX_COLLECTED_EDGES) {
          collectionTruncated = true;
          break;
        }
        collected.push({
          kind: "imports",
          from: source.path,
          to: dependency,
          confidence: "exact",
        });
        if (dependency === target && TEST_FILE.test(source.path)) {
          if (collected.length >= MAX_COLLECTED_EDGES) {
            collectionTruncated = true;
            break;
          }
          collected.push({
            kind: "tests",
            from: source.path,
            to: target,
            confidence: "exact",
          });
        }
      }
      if (collectionTruncated) break;
    }
    if (!collectionTruncated) {
      for (const source of sources) {
        if (
          collectLexicalCalls(
            source,
            target,
            requestedSymbols,
            collected,
            MAX_COLLECTED_EDGES,
          )
        ) {
          collectionTruncated = true;
          break;
        }
      }
    }

    const deduped = dedupeEdges(collected);
    const impactedFiles = [
      ...new Set(
        deduped
          .filter(
            (edge) =>
              edge.from !== target &&
              (edge.to === target || edge.to.startsWith(`${target}#`)),
          )
          .map((edge) => edge.from),
      ),
    ].sort();
    const scanTruncated = scanned.length >= MAX_FILES_SCANNED;
    const edgeTruncated = deduped.length > maxResults || collectionTruncated;
    const symbolTruncated =
      allSymbols.length > symbols.length ||
      callableSymbols.length > requestedSymbols.length;
    return {
      target,
      coverage: "typescript-javascript",
      symbols,
      edges: deduped.slice(0, maxResults),
      impactedFiles,
      scannedFiles: sources.length,
      selectionReason:
        `fresh bounded scan of ${sources.length} TS/JS modules; ` +
        "exact relative-import/declaration edges plus labelled lexical-call heuristics",
      truncated: scanTruncated || edgeTruncated || symbolTruncated,
      limitations: [
        "Bare package specifiers and tsconfig path aliases are not resolved.",
        "Call edges are lexical heuristics; runtime dispatch, shadowing, and re-exports may differ.",
        `The workspace scan is capped at ${MAX_FILES_SCANNED} files, each file at ${MAX_FILE_BYTES} bytes, symbols at ${MAX_SYMBOLS}, and call targets at ${MAX_CALL_SYMBOLS}.`,
      ],
    };
  },
};

async function readBoundedSource(
  root: string,
  file: string,
): Promise<SourceFile | null> {
  try {
    const absolute = assertInsideWorkspace(root, file);
    const stat = await fs.stat(absolute);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return { path: normalizeRelativePath(file), content: await fs.readFile(absolute, "utf8") };
  } catch {
    return null;
  }
}

function normalizeRelativePath(file: string): string {
  return file.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function selectCallableSymbols(
  symbols: readonly SymbolInfo[],
  requested: string | undefined,
): SymbolInfo[] {
  if (requested) return symbols.filter((symbol) => symbol.name === requested);
  return symbols.filter(
    (symbol) =>
      symbol.exported &&
      (symbol.kind === "function" || symbol.kind === "method" || symbol.kind === "const"),
  );
}

function relativeImports(
  importer: string,
  content: string,
  knownFiles: ReadonlySet<string>,
): string[] {
  const resolved = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    for (const specifier of importSpecifiers(line)) {
      const target = resolveRelativeImport(importer, specifier, knownFiles);
      if (target) resolved.add(target);
    }
  }
  return [...resolved].sort();
}

function importSpecifiers(line: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /^\s*import\s*["']([^"']+)["']/g,
    /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      if (match[1]?.startsWith(".")) out.push(match[1]);
    }
  }
  return out;
}

function resolveRelativeImport(
  importer: string,
  specifier: string,
  knownFiles: ReadonlySet<string>,
): string | null {
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer), specifier),
  );
  if (base === ".." || base.startsWith("../") || path.posix.isAbsolute(base)) {
    return null;
  }
  const candidates = new Set<string>([base]);
  const currentExtension = path.posix.extname(base);
  const withoutExtension = currentExtension ? base.slice(0, -currentExtension.length) : base;
  for (const extension of RESOLVABLE_EXTENSIONS) {
    candidates.add(`${withoutExtension}${extension}`);
    candidates.add(`${base}${extension}`);
    candidates.add(`${base}/index${extension}`);
  }
  for (const candidate of candidates) {
    if (knownFiles.has(candidate)) return candidate;
  }
  return null;
}

function collectLexicalCalls(
  source: SourceFile,
  target: string,
  symbols: readonly SymbolInfo[],
  out: ImpactEdge[],
  limit: number,
): boolean {
  if (symbols.length === 0) return false;
  const lines = source.content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    for (const symbol of symbols) {
      if (source.path === target && index + 1 === symbol.line) continue;
      const call = new RegExp(`\\b${escapeRegExp(symbol.name)}\\s*\\(`);
      if (!call.test(line)) continue;
      if (out.length >= limit) return true;
      out.push({
        kind: "calls",
        from: source.path,
        to: `${target}#${symbol.name}`,
        line: index + 1,
        symbol: symbol.name,
        confidence: "heuristic",
      });
    }
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeEdges(edges: readonly ImpactEdge[]): ImpactEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = [
      edge.kind,
      edge.from,
      edge.to,
      edge.line ?? "",
      edge.symbol ?? "",
    ].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
