import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IPC, type SemanticIndexStatus } from "@nlc/shared";
import type { Services } from "../services.js";

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  scanFiles: vi.fn(),
  reindexChanged: vi.fn(),
  indexFiles: vi.fn(),
  status: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: mocks.ipcHandle },
}));

vi.mock("@nlc/project-indexer", () => ({
  scanFiles: mocks.scanFiles,
}));

vi.mock("../intelligence-services.js", () => ({
  IntelligenceServices: class {
    indexer() {
      return {
        reindexChanged: mocks.reindexChanged,
        indexFiles: mocks.indexFiles,
        status: mocks.status,
      };
    }

    embedder() {
      return {
        model: "mock",
        dimensions: 1,
        async embed(): Promise<number[][]> {
          return [[1]];
        },
      };
    }
  },
}));

import { registerSemanticIpc } from "./semantic-ipc.js";

const roots: string[] = [];
const STATUS: SemanticIndexStatus = {
  totalFiles: 1,
  indexedFiles: 1,
  freshFiles: 1,
  staleFiles: 0,
  missingFiles: 0,
  isStale: false,
  lastUpdated: 1,
  lastChecked: 2,
  building: false,
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.scanFiles.mockResolvedValue(["a.ts", "blank.ts"]);
  mocks.status.mockReturnValue(STATUS);
  mocks.reindexChanged.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("semantic index IPC", () => {
  it("routes rebuild through incremental refresh and emits truthful status", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-semantic-ipc-"));
    roots.push(root);
    const source = path.join(root, "a.ts");
    const blankSource = path.join(root, "blank.ts");
    fs.writeFileSync(source, "export const value = 1;\n", "utf8");
    fs.writeFileSync(blankSource, " \n\t", "utf8");
    const emit = vi.fn();
    const services = {
      storage: {},
      emit,
    } as unknown as Services;

    registerSemanticIpc(services, () => root);
    const registered = mocks.ipcHandle.mock.calls.find(
      (call) => call[0] === IPC.rebuildSemanticIndex,
    )?.[1] as
      | ((
          event: unknown,
          input: unknown,
        ) => Promise<{ ok: true; data: SemanticIndexStatus }>)
      | undefined;

    expect(registered).toBeTypeOf("function");
    const result = await registered!({}, { workspaceId: "ws" });

    expect(result).toEqual({ ok: true, data: STATUS });
    expect(mocks.reindexChanged).toHaveBeenCalledOnce();
    expect(mocks.reindexChanged.mock.calls[0]?.[0]).toBe("ws");
    expect(mocks.reindexChanged.mock.calls[0]?.[1]).toEqual([
      {
        path: "a.ts",
        content: "export const value = 1;\n",
        mtime: fs.statSync(source).mtimeMs,
      },
    ]);
    expect(mocks.indexFiles).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith({
      kind: "index_status",
      workspaceId: "ws",
      status: { ...STATUS, building: true },
    });
    expect(emit).toHaveBeenLastCalledWith({
      kind: "index_status",
      workspaceId: "ws",
      status: STATUS,
    });
  });
});
