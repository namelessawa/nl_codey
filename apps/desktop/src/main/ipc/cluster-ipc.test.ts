import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC } from "@nlc/shared";
import type { Services } from "../services.js";

const electron = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (event: unknown, ...args: unknown[]) => Promise<unknown>
  >(),
  handle: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: electron.handle.mockImplementation(
      (
        channel: string,
        handler: (event: unknown, ...args: unknown[]) => Promise<unknown>,
      ) => {
        electron.handlers.set(channel, handler);
      },
    ),
  },
}));

import {
  DISTRIBUTED_UNAVAILABLE_MESSAGE,
  registerClusterIpc,
} from "./cluster-ipc.js";

beforeEach(() => {
  electron.handlers.clear();
  electron.handle.mockClear();
});

describe("cluster IPC production boundary", () => {
  it.each([IPC.listWorkerNodes, IPC.registerWorkerNode])(
    "rejects %s without touching storage",
    async (channel) => {
      const storage = {
        cluster: {
          listWorkerNodes: vi.fn(),
          upsertWorkerNode: vi.fn(),
        },
      };
      registerClusterIpc({ storage } as unknown as Services);
      const handler = electron.handlers.get(channel);

      await expect(handler?.({}, { node: {} })).resolves.toEqual({
        ok: false,
        error: DISTRIBUTED_UNAVAILABLE_MESSAGE,
      });
      expect(storage.cluster.listWorkerNodes).not.toHaveBeenCalled();
      expect(storage.cluster.upsertWorkerNode).not.toHaveBeenCalled();
    },
  );
});
