import { spawn } from "node:child_process";
import fs from "node:fs";
import { rgPath } from "@vscode/ripgrep";
import { IGNORED_DIRS } from "@coding-agent/project-indexer";
import {
  type AgentTool,
  type SearchMatch,
  type SearchTextInput,
  type SearchTextOutput,
  TOOL_LIMITS,
} from "@coding-agent/shared";
import { TOOL_CODES, ToolError } from "./errors.js";

type RgJsonEvent = {
  type: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string };
  };
};

/** Resolve the ripgrep binary: bundled @vscode/ripgrep, else a clear error. */
function resolveRgPath(): string {
  if (rgPath && fs.existsSync(rgPath)) return rgPath;
  throw new ToolError(
    TOOL_CODES.ripgrepMissing,
    "ripgrep binary not found (expected bundled @vscode/ripgrep). Reinstall dependencies.",
  );
}

export const searchTextTool: AgentTool<SearchTextInput, SearchTextOutput> = {
  name: "search_text",
  description: "Search project text with ripgrep (workspace-scoped, capped results).",
  async run(input, ctx) {
    const max = Math.min(input.maxResults ?? TOOL_LIMITS.maxSearchResults, TOOL_LIMITS.maxSearchResults);
    const bin = resolveRgPath();
    const args = [
      "--json",
      "--max-count",
      String(max),
      ...[...IGNORED_DIRS].flatMap((dir) => ["--glob", `!${dir}/**`]),
      "--",
      input.query,
      ".",
    ];

    const matches = await new Promise<SearchMatch[]>((resolve, reject) => {
      const child = spawn(bin, args, { cwd: ctx.workspaceRoot });
      const collected: SearchMatch[] = [];
      let buffer = "";

      ctx.signal?.addEventListener("abort", () => child.kill());

      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        let nl = buffer.indexOf("\n");
        while (nl !== -1 && collected.length < max) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          const match = parseRgLine(line);
          if (match) collected.push(match);
          nl = buffer.indexOf("\n");
        }
        if (collected.length >= max) child.kill();
      });

      child.on("error", (err) =>
        reject(new ToolError(TOOL_CODES.searchFailed, `ripgrep failed: ${err.message}`)),
      );
      // rg exits 1 when there are no matches; that is not an error here.
      child.on("close", () => resolve(collected.slice(0, max)));
    });

    return { query: input.query, matches };
  },
};

function parseRgLine(line: string): SearchMatch | null {
  if (!line.trim()) return null;
  let event: RgJsonEvent;
  try {
    event = JSON.parse(line) as RgJsonEvent;
  } catch {
    return null;
  }
  if (event.type !== "match" || !event.data) return null;
  const path = event.data.path?.text;
  const lineNumber = event.data.line_number;
  const text = event.data.lines?.text ?? "";
  if (!path || typeof lineNumber !== "number") return null;
  return {
    path: path.split("\\").join("/"),
    line: lineNumber,
    text: text.replace(/\r?\n$/, "").slice(0, TOOL_LIMITS.maxSearchContextChars),
  };
}
