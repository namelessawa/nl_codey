/**
 * Static codebase style extractor. Scans a list of source files and emits
 * a derived StyleSpec. We intentionally extract simple, surface-level rules
 * a human can verify and override; this is NOT a static analyzer that
 * "decides" the team style.
 */
import type { StyleRule, StyleSpec, StyleStrength } from "@coding-agent/shared";
import { addRule, makeEmptySpec, makeRule } from "./style-spec.js";

export type FileSample = {
  /** Relative path. */
  path: string;
  content: string;
  /** Optional last-modified ms timestamp. Included so the same record type can
   *  be reused by the proactive scanner without an extra conversion step. */
  lastModified?: number;
};

export type ExtractorOptions = {
  scope?: "global" | "team" | "project";
  workspaceId?: string | null;
  /** Strength assigned to derived rules (default "should"). */
  derivedStrength?: StyleStrength;
};

/** Light-weight metrics drawn from the file set; surfaced in `derivedFrom`. */
export function computeCodebaseStats(files: FileSample[]): Record<string, number | string> {
  const stats: Record<string, number | string> = {
    fileCount: files.length,
    totalBytes: files.reduce((s, f) => s + f.content.length, 0),
  };

  let singleQuoteFiles = 0;
  let doubleQuoteFiles = 0;
  let semiFiles = 0;
  let noSemiFiles = 0;
  let arrowFnFiles = 0;
  let functionDeclFiles = 0;
  let twoSpaceFiles = 0;
  let fourSpaceFiles = 0;
  let tabFiles = 0;

  for (const f of files) {
    if (!isJSorTS(f.path)) continue;
    if (count(f.content, /(^|[^\\])'[^'\n]{0,80}'/g) > count(f.content, /(^|[^\\])"[^"\n]{0,80}"/g)) {
      singleQuoteFiles++;
    } else {
      doubleQuoteFiles++;
    }
    const lines = f.content.split("\n");
    let withSemi = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*")) continue;
      if (/[;}]$/.test(trimmed)) withSemi++;
    }
    if (withSemi > lines.length / 4) semiFiles++;
    else noSemiFiles++;
    arrowFnFiles += count(f.content, /=>\s*[\{\(]/g) > 0 ? 1 : 0;
    functionDeclFiles += /\bfunction\s+[A-Za-z_]/.test(f.content) ? 1 : 0;
    const indent = detectIndent(f.content);
    if (indent === "tab") tabFiles++;
    else if (indent === 2) twoSpaceFiles++;
    else if (indent === 4) fourSpaceFiles++;
  }

  stats.quotePreference = doubleQuoteFiles >= singleQuoteFiles ? "double" : "single";
  stats.semicolons = semiFiles >= noSemiFiles ? "required" : "omitted";
  stats.functionStyle = arrowFnFiles >= functionDeclFiles ? "arrow" : "declaration";
  if (tabFiles > twoSpaceFiles && tabFiles > fourSpaceFiles) stats.indent = "tab";
  else if (fourSpaceFiles > twoSpaceFiles) stats.indent = "4-space";
  else stats.indent = "2-space";
  return stats;
}

export function extractStyleSpec(
  files: FileSample[],
  options: ExtractorOptions = {},
): StyleSpec {
  const stats = computeCodebaseStats(files);
  let spec = makeEmptySpec(options.scope ?? "project", options.workspaceId ?? null);
  spec = {
    ...spec,
    derivedFrom: {
      codebaseStats: stats,
      acceptedDiffs: 0,
      rejectedDiffs: 0,
    },
  };

  const strength = options.derivedStrength ?? "should";
  const rules: StyleRule[] = [];

  if (stats.quotePreference === "double") {
    rules.push(
      withConfidence(
        makeRule("structure", "字符串字面量使用双引号", strength, "extracted"),
        0.7,
      ),
    );
  } else {
    rules.push(
      withConfidence(
        makeRule("structure", "字符串字面量使用单引号", strength, "extracted"),
        0.7,
      ),
    );
  }
  if (stats.semicolons === "required") {
    rules.push(
      withConfidence(makeRule("structure", "语句结尾必加分号", strength, "extracted"), 0.6),
    );
  } else {
    rules.push(
      withConfidence(makeRule("structure", "省略可选分号", strength, "extracted"), 0.5),
    );
  }
  if (stats.functionStyle === "arrow") {
    rules.push(
      withConfidence(
        makeRule("structure", "局部辅助函数优先使用箭头函数", strength, "extracted"),
        0.55,
      ),
    );
  }
  if (stats.indent === "tab") {
    rules.push(withConfidence(makeRule("structure", "使用 Tab 缩进", "must", "extracted"), 0.9));
  } else if (stats.indent === "4-space") {
    rules.push(withConfidence(makeRule("structure", "使用 4 空格缩进", "must", "extracted"), 0.9));
  } else {
    rules.push(withConfidence(makeRule("structure", "使用 2 空格缩进", "must", "extracted"), 0.9));
  }

  for (const rule of rules) spec = addRule(spec, rule);
  return spec;
}

function withConfidence(rule: StyleRule, confidence: number): StyleRule {
  return { ...rule, confidence };
}

function isJSorTS(p: string): boolean {
  return /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i.test(p);
}

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

function detectIndent(text: string): 2 | 4 | "tab" {
  const lines = text.split("\n");
  let tab = 0;
  let two = 0;
  let four = 0;
  for (const line of lines) {
    if (line.startsWith("\t")) tab++;
    else if (line.startsWith("    ")) four++;
    else if (line.startsWith("  ")) two++;
  }
  if (tab > two + four) return "tab";
  if (four > two) return 4;
  return 2;
}
