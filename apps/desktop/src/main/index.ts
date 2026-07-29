import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app } from "electron";
import {
  IPC_EVENT,
  redactSensitiveText,
  type AgentEvent,
} from "@nlc/shared";
import { loadEnv } from "./env.js";
import { buildServices } from "./services.js";
import { broadcast, registerIpc } from "./ipc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererSmoke =
  app.isPackaged && process.argv.includes("--nlc-renderer-smoke");

function createWindow(): void {
  const win = new BrowserWindow({
    show: !rendererSmoke,
    width: 1440,
    height: 900,
    title: "NL_Codey",
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Chromium sandbox enabled. Our preload only touches
      // `electron.contextBridge` and `electron.ipcRenderer` — both
      // sandbox-safe — and the renderer talks to the main process
      // exclusively over IPC. This shrinks the attack surface for any
      // foreign HTML the agent might fetch (web_fetch / readability /
      // LLM markdown rendering) by stripping Node integration from
      // the renderer process entirely.
      sandbox: true,
    },
  });
  if (rendererSmoke) attachRendererSmoke(win);

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  loadEnv(app.getAppPath());
  const services = buildServices((event: AgentEvent) => broadcast(IPC_EVENT, event));
  registerIpc(services);
  createWindow();

  // Probe Docker on boot. We don't await — the renderer queries
  // `getInstallationStatus` on mount, and the broadcast that recheck() emits
  // wakes the modal as soon as the probe lands. A failed probe just means
  // Docker isn't installed, which is the whole reason we run this.
  if (!rendererSmoke) void services.installationGate.recheck();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function attachRendererSmoke(win: BrowserWindow): void {
  let finished = false;
  const deadline = setTimeout(
    () => finish(1, "[desktop-smoke] renderer readiness timed out"),
    30_000,
  );
  deadline.unref();

  const finish = (code: number, message: string): void => {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    const stream = code === 0 ? process.stdout : process.stderr;
    stream.write(`${message}\n`);
    app.exit(code);
  };

  win.webContents.once("did-fail-load", (_event, errorCode) => {
    finish(1, `[desktop-smoke] renderer load failed (${errorCode})`);
  });
  win.webContents.once("preload-error", (_event, _preloadPath, error) => {
    finish(
      1,
      `[desktop-smoke] preload failed: ${redactSensitiveText(error.message, {
        maxLength: 1_000,
        fallback: "preload error",
      })}`,
    );
  });
  win.webContents.once("render-process-gone", () => {
    finish(1, "[desktop-smoke] renderer process exited");
  });
  win.webContents.once("did-finish-load", () => {
    void waitForRendererBoundary(win)
      .then((state) => {
        const ready =
          state.rootMounted &&
          state.agentApi &&
          state.requireAbsent &&
          state.processAbsent;
        finish(
          ready ? 0 : 1,
          ready
            ? "[desktop-smoke] packaged main/preload/renderer boundary passed"
            : `[desktop-smoke] renderer boundary check failed ${JSON.stringify(state)}`,
        );
      })
      .catch(() => {
        finish(1, "[desktop-smoke] renderer boundary evaluation failed");
      });
  });
}

type RendererBoundaryState = {
  rootMounted: boolean;
  agentApi: boolean;
  requireAbsent: boolean;
  processAbsent: boolean;
};

async function waitForRendererBoundary(
  win: BrowserWindow,
): Promise<RendererBoundaryState> {
  const deadline = Date.now() + 10_000;
  let state: RendererBoundaryState = {
    rootMounted: false,
    agentApi: false,
    requireAbsent: false,
    processAbsent: false,
  };
  while (!win.isDestroyed() && Date.now() < deadline) {
    state = (await win.webContents.executeJavaScript(
      `({
        rootMounted: (document.getElementById("root")?.childElementCount ?? 0) > 0,
        agentApi: typeof window.agentApi === "object",
        requireAbsent: typeof globalThis.require === "undefined",
        processAbsent: typeof globalThis.process === "undefined"
      })`,
      true,
    )) as RendererBoundaryState;
    if (
      state.rootMounted &&
      state.agentApi &&
      state.requireAbsent &&
      state.processAbsent
    ) {
      return state;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  return state;
}
