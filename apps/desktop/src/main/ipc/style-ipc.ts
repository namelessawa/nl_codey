/** Style-profile IPC handlers: get/upsert style spec + extract from codebase. */

import { IPC } from "@nlc/shared";
import { extractStyleSpec } from "@nlc/style-profile";
import {
  validateGetStyleSpec,
  validateUpsertStyleSpec,
  validateWorkspaceId,
} from "../validators.js";
import { handle } from "../ipc-handle.js";
import { readSampleFiles } from "../file-sampler.js";
import type { Services } from "../services.js";

type RequireRoot = (workspaceId: string) => string;

export function registerStyleIpc(services: Services, requireRoot: RequireRoot): void {
  const { storage } = services;

  handle(IPC.getStyleSpec, (raw) => {
    const { scope, workspaceId } = validateGetStyleSpec(raw);
    return storage.style.getStyleSpec(scope, workspaceId);
  });
  handle(IPC.upsertStyleSpec, (raw) => {
    const { spec } = validateUpsertStyleSpec(raw);
    return storage.style.upsertStyleSpec(spec);
  });
  handle(IPC.extractStyleSpecFromCodebase, async (raw) => {
    const { workspaceId } = validateWorkspaceId(raw);
    const root = requireRoot(workspaceId);
    const files = await readSampleFiles(root, 50);
    const spec = extractStyleSpec(files, { scope: "project", workspaceId });
    return storage.style.upsertStyleSpec(spec);
  });
}
