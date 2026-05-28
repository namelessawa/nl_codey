import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { assertInsideWorkspace } from "@coding-agent/sandbox";
import type { AgentTool, ReadFileRangeInput, ReadFileRangeOutput } from "@coding-agent/shared";
import { TOOL_LIMITS } from "@coding-agent/shared";
import { TOOL_CODES, ToolError } from "./errors.js";

/**
 * Read a 1-indexed, inclusive line range from a text file. Returns the total
 * line count so the model can decide whether to keep reading. Capped at
 * {@link TOOL_LIMITS.maxReadRangeLines} lines per call.
 */
export const readFileRangeTool: AgentTool<ReadFileRangeInput, ReadFileRangeOutput> = {
  name: "read_file_range",
  description: "Read an inclusive 1-indexed line range from a text file.",
  async run(input, ctx): Promise<ReadFileRangeOutput> {
    const { path, startLine, endLine } = input;
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
      throw new ToolError(
        TOOL_CODES.readFailed,
        "Invalid range: require integer startLine >= 1 and endLine >= startLine",
      );
    }
    if (endLine - startLine + 1 > TOOL_LIMITS.maxReadRangeLines) {
      throw new ToolError(
        TOOL_CODES.readFailed,
        `Range too large: at most ${TOOL_LIMITS.maxReadRangeLines} lines per call`,
      );
    }
    const abs = assertInsideWorkspace(ctx.workspaceRoot, path);
    if (!existsSync(abs)) throw new ToolError(TOOL_CODES.readFailed, `File not found: ${path}`);
    const buf = await fs.readFile(abs);
    if (buf.includes(0)) throw new ToolError(TOOL_CODES.binaryFile, `Cannot read binary file: ${path}`);

    const lines = buf.toString("utf8").split("\n");
    const totalLines = lines.length;
    const slice = lines.slice(startLine - 1, endLine);
    return {
      path,
      startLine,
      endLine: Math.min(endLine, totalLines),
      content: slice.join("\n"),
      totalLines,
    };
  },
};
