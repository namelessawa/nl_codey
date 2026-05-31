import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app } from "electron";
import { IPC_EVENT, type AgentEvent } from "@coding-agent/shared";
import { loadEnv } from "./env.js";
import { buildServices } from "./services.js";
import { broadcast, registerIpc } from "./ipc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "NL_Codey",
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

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
  void services.installationGate.recheck();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
