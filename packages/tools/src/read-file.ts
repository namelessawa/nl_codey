import fs from "node:fs/promises";
import { assertInsideWorkspace } from "@coding-agent/sandbox";
import {
  type AgentTool,
  type ReadFileInput,
  type ReadFileOutput,
  TOOL_LIMITS,
} from "@coding-agent/shared";
import { TOOL_CODES, ToolError } from "./errors.js";

export const readFileTool: AgentTool<ReadFileInput, ReadFileOutput> = {
  name: "read_file",
  description: "Read a UTF-8 text file inside the workspace (size-capped, binary rejected).",
  async run(input, ctx) {
    const abs = assertInsideWorkspace(ctx.workspaceRoot, input.path);

    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(abs);
    } catch (err) {
      throw new ToolError(TOOL_CODES.readFailed, `Cannot read file: ${input.path} (${asMessage(err)})`);
    }
    if (stat.size > TOOL_LIMITS.maxReadBytes) {
      throw new ToolError(
        TOOL_CODES.fileTooLarge,
        `File exceeds ${TOOL_LIMITS.maxReadBytes} bytes: ${input.path}`,
      );
    }

    const buf = await fs.readFile(abs);
    if (isBinary(buf)) {
      throw new ToolError(TOOL_CODES.binaryFile, `Refusing to read binary file: ${input.path}`);
    }
    return { path: input.path, content: buf.toString("utf8") };
  },
};

/** Heuristic: a NUL byte in the first 8KB marks the file as binary. */
function isBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8192);
  for (let i = 0; i < limit; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
