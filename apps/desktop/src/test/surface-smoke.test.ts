import { afterEach, describe, expect, it, vi } from "vitest";
import { IPC } from "@nlc/shared";
import { applyAppearance } from "../renderer/src/appearance.js";

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener,
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("[renderer] appearance smoke", () => {
  it("resolves system theme and disables transitions with reduced motion", () => {
    const attrs = new Map<string, string>();
    vi.stubGlobal("document", {
      documentElement: {
        setAttribute: (name: string, value: string) => attrs.set(name, value),
      },
    });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: true }),
    });

    applyAppearance({
      theme: "system",
      language: "en-US",
      fontSize: "medium",
      density: "compact",
      showPipeline: true,
      reduceMotion: true,
      smoothTransitions: true,
    });

    expect(Object.fromEntries(attrs)).toMatchObject({
      "data-theme": "light",
      "data-density": "compact",
      "data-pipeline": "on",
      "data-motion": "off",
      "data-transitions": "off",
    });
  });

  it("forwards only a Run id for diagnostics export", async () => {
    const exportRunDiagnostics = vi
      .fn()
      .mockResolvedValue({ ok: true, data: { filePath: null } });
    vi.stubGlobal("window", {
      agentApi: { exportRunDiagnostics },
    });
    vi.resetModules();
    const { api } = await import("../renderer/src/api.js");

    await api.exportRunDiagnostics("run-1");

    expect(exportRunDiagnostics).toHaveBeenCalledWith({ runId: "run-1" });
  });
});

describe("[preload] bridge smoke", () => {
  it("exposes AgentApi and routes calls through the typed IPC channel", async () => {
    vi.resetModules();
    await import("../preload/index.js");

    expect(electron.exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [, api] = electron.exposeInMainWorld.mock.calls[0] as [
      string,
      {
        openWorkspace: () => Promise<unknown>;
        exportRunDiagnostics: (args: { runId: string }) => Promise<unknown>;
      },
    ];
    electron.invoke.mockResolvedValue({ ok: true, data: null });

    await api.openWorkspace();
    await api.exportRunDiagnostics({ runId: "run-1" });

    expect(electron.exposeInMainWorld.mock.calls[0]?.[0]).toBe("agentApi");
    expect(electron.invoke).toHaveBeenCalledWith(IPC.openWorkspace);
    expect(electron.invoke).toHaveBeenCalledWith(IPC.exportRunDiagnostics, {
      runId: "run-1",
    });
  });
});
