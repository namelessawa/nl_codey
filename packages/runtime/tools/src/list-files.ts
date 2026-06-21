import { scanFiles } from "@nlc/project-indexer";
import {
  type AgentTool,
  type ListFilesInput,
  type ListFilesOutput,
  TOOL_LIMITS,
} from "@nlc/shared";

export const listFilesTool: AgentTool<ListFilesInput, ListFilesOutput> = {
  name: "list_files",
  description: "List project files under the workspace root (ignored dirs excluded, capped).",
  async run(input, ctx) {
    const max = Math.min(input.maxFiles ?? TOOL_LIMITS.maxListedFiles, TOOL_LIMITS.maxListedFiles);
    const files = await scanFiles(ctx.workspaceRoot, max);
    return { files };
  },
};
