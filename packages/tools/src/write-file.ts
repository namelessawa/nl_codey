import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { assertInsideWorkspace } from "@coding-agent/sandbox";
import type { ToolContext, WriteFileInput, WriteFileOutput } from "@coding-agent/shared";
import type { SnapshotStore } from "./deps.js";

/**
 * Write a file inside the workspace, snapshotting the prior content first.
 * Internal only: the agent never calls this directly — it runs after the user
 * approves a diff (the apply path is preferred; this exists for completeness).
 */
export async function writeFileTool(
  input: WriteFileInput,
  ctx: ToolContext,
  store: SnapshotStore,
): Promise<WriteFileOutput> {
  const abs = assertInsideWorkspace(ctx.workspaceRoot, input.path);
  const before = existsSync(abs) ? await fs.readFile(abs, "utf8") : "";

  const snap = store.addSnapshot(input.runId, input.path, before);
  await fs.mkdir(dirOf(abs), { recursive: true });
  await fs.writeFile(abs, input.content, "utf8");
  store.setSnapshotAfter(snap.id, input.content);

  return { path: input.path, bytesWritten: Buffer.byteLength(input.content, "utf8") };
}

function dirOf(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx === -1 ? "." : p.slice(0, idx);
}
