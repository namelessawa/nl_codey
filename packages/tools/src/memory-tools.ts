import type {
  AgentTool,
  ReadMemoryInput,
  ReadMemoryOutput,
  WriteMemoryInput,
  WriteMemoryOutput,
} from "@nlc/shared";
import { TOOL_CODES, ToolError } from "./errors.js";
import type { MemoryPort } from "./phase3-deps.js";

const DEFAULT_MAX_ENTRIES = 10;

/** Kinds the Coder is permitted to write. Decisions/facts only. */
const WRITABLE_KINDS = new Set<WriteMemoryInput["kind"]>(["fact", "decision"]);

/**
 * read_memory (all roles): retrieve project memory entries, optionally
 * filtered by free-text query and/or kind.
 */
export function createReadMemoryTool(
  port: MemoryPort,
): AgentTool<ReadMemoryInput, ReadMemoryOutput> {
  return {
    name: "read_memory",
    description:
      "检索项目记忆（决策、偏好、失败教训、事实）。可按自然语言查询与/或 kind 过滤。",
    async run(input) {
      const max = input.maxEntries ?? DEFAULT_MAX_ENTRIES;
      const hits = await port.read(input.query, input.kind, max);
      return { hits };
    },
  };
}

/**
 * write_memory (Coder): persist a durable memory entry. Restricted to
 * "fact"/"decision"; any other kind is rejected with a clear ToolError.
 */
export function createWriteMemoryTool(
  port: MemoryPort,
): AgentTool<WriteMemoryInput, WriteMemoryOutput> {
  return {
    name: "write_memory",
    description: '写入一条项目记忆。仅允许 kind 为 "fact" 或 "decision"。',
    async run(input) {
      if (!WRITABLE_KINDS.has(input.kind)) {
        throw new ToolError(
          TOOL_CODES.invalidMemoryKind,
          `write_memory only accepts kind "fact" or "decision", got "${String(input.kind)}".`,
        );
      }
      return port.write(input);
    },
  };
}
