import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  throw new Error("smoke:windows:installer requires Windows");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.join(root, "release");
const installers = fs
  .readdirSync(releaseRoot)
  .filter((entry) => /^NL_Codey-Setup-.*\.exe$/i.test(entry))
  .map((entry) => path.join(releaseRoot, entry));

if (installers.length !== 1) {
  throw new Error(`Expected one NSIS installer, found ${installers.length}`);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-installer-smoke-"));
const installRoot = path.join(tempRoot, "app");

try {
  run(installers[0], ["/S", `/D=${installRoot}`], "silent install");

  const executable = path.join(installRoot, "NL_Codey.exe");
  const uninstaller = path.join(installRoot, "Uninstall NL_Codey.exe");
  for (const required of [executable, uninstaller]) {
    if (!fs.existsSync(required) || fs.statSync(required).size === 0) {
      throw new Error(`Installed artifact is missing ${path.basename(required)}`);
    }
  }

  run(uninstaller, ["/S"], "silent uninstall");
  waitForRemoval(installRoot, 15_000);
  process.stdout.write("[windows-installer] silent install and uninstall passed\n");
} finally {
  fs.rmSync(tempRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} exited with code ${result.status ?? "unknown"}`);
  }
}

function waitForRemoval(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (fs.existsSync(target) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  if (fs.existsSync(target)) {
    throw new Error("Silent uninstall did not remove the temporary installation");
  }
}
