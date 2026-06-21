import fs from "node:fs";
import path from "node:path";
import type { ProjectInfo, ProjectKind } from "@nlc/shared";

/**
 * Inspect the workspace root and suggest validation commands. Only commands on
 * the sandbox whitelist are ever suggested. Detection is best-effort and never
 * throws.
 */
export function detectProject(root: string): ProjectInfo {
  const has = (file: string): boolean => fs.existsSync(path.join(root, file));
  const suggested: string[] = [];
  let kind: ProjectKind = "unknown";

  if (has("package.json")) {
    kind = "node";
    const scripts = readPackageScripts(root);
    const runner = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm";
    if (scripts.test) suggested.push(testCommand(runner));
    if (scripts.build) suggested.push(buildCommand(runner));
    if (has("tsconfig.json")) suggested.push("npx tsc --noEmit");
  } else if (has("pyproject.toml") || has("pytest.ini")) {
    kind = "python";
    suggested.push("pytest");
  } else if (has("go.mod")) {
    kind = "go";
    suggested.push("go test ./...");
  } else if (has("Cargo.toml")) {
    kind = "rust";
    suggested.push("cargo test");
  }

  return { kind, suggestedCommands: dedupe(suggested) };
}

function readPackageScripts(root: string): Record<string, string> {
  try {
    const raw = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

function testCommand(runner: string): string {
  return runner === "npm" ? "npm test" : `${runner} test`;
}

function buildCommand(runner: string): string {
  return runner === "npm" ? "npm run build" : `${runner} build`;
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
