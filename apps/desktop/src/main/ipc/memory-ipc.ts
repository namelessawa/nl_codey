/** Memory IPC handlers: CRUD + import/export of project memory entries. */

import fs from "node:fs";
import { dialog } from "electron";
import { IPC, type MemoryEntry, type MemoryExport } from "@nlc/shared";
import {
  createEntry,
  deleteEntry,
  exportMemory as buildMemoryExport,
  importMemory as importMemoryEnvelope,
  listEntries,
  updateEntry,
} from "@nlc/memory";
import {
  validateCreateMemory,
  validateDeleteMemory,
  validateListMemory,
  validateUpdateMemory,
  validateWorkspaceId,
} from "../validators.js";
import { handle } from "../ipc-handle.js";
import { IntelligenceServices } from "../intelligence-services.js";
import type { Services } from "../services.js";

export function registerMemoryIpc(services: Services): void {
  const { storage } = services;
  const intelligence = new IntelligenceServices(services);

  handle(IPC.listMemoryEntries, (raw): MemoryEntry[] => {
    const args = validateListMemory(raw);
    return listEntries(storage, args.workspaceId, args.filter);
  });

  handle(IPC.createMemoryEntry, async (raw): Promise<MemoryEntry> => {
    const args = validateCreateMemory(raw);
    const embedding = await embedEntryText(
      intelligence,
      `${args.entry.title}\n${args.entry.body}`,
    );
    return embedding
      ? createEntry(storage, args.workspaceId, args.entry, embedding)
      : createEntry(storage, args.workspaceId, args.entry);
  });

  handle(IPC.updateMemoryEntry, (raw): MemoryEntry => {
    const args = validateUpdateMemory(raw);
    const updated = updateEntry(storage, args.id, args.patch);
    if (!updated) throw new Error("Memory entry not found");
    return updated;
  });

  handle(IPC.deleteMemoryEntry, (raw): { deleted: boolean } => {
    const args = validateDeleteMemory(raw);
    return { deleted: deleteEntry(storage, args.id) };
  });

  handle(IPC.exportMemory, async (raw): Promise<{ filePath: string }> => {
    const args = validateWorkspaceId(raw);
    const envelope = buildMemoryExport(storage, args.workspaceId);
    const result = await dialog.showSaveDialog({
      title: "Export project memory",
      defaultPath: "project-memory.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) throw new Error("Export cancelled");
    fs.writeFileSync(result.filePath, JSON.stringify(envelope, null, 2), "utf8");
    return { filePath: result.filePath };
  });

  // SECURITY: the file path is picked main-side via the OS dialog, NOT
  // received from the renderer. Previously the renderer supplied any path it
  // wanted and the main process happily read it with main's privileges (a
  // compromised renderer could read arbitrary host files). Now the user has
  // to explicitly point at the JSON file every time.
  handle(IPC.importMemory, async (raw): Promise<{ imported: number; filePath: string | null }> => {
    const args = validateWorkspaceId(raw);
    const result = await dialog.showOpenDialog({
      title: "Import project memory",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { imported: 0, filePath: null };
    }
    const filePath = result.filePaths[0]!;
    const text = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(text) as MemoryExport;
    return { imported: importMemoryEnvelope(storage, args.workspaceId, data), filePath };
  });
}

async function embedEntryText(
  intelligence: IntelligenceServices,
  text: string,
): Promise<number[] | null> {
  try {
    const [vec] = await intelligence.embedder().embed([text]);
    return vec ?? null;
  } catch {
    return null;
  }
}
