import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  throw new Error("smoke:desktop:runtime requires Windows");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(
  root,
  "release",
  "win-unpacked",
  "NL_Codey.exe",
);
if (!fs.existsSync(executable) || fs.statSync(executable).size === 0) {
  throw new Error(
    "Packaged app is missing; run the Desktop electron-builder step first",
  );
}

const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "nlc-desktop-runtime-smoke-"),
);
try {
  const result = spawnSync(executable, ["--nlc-renderer-smoke"], {
    cwd: root,
    env: {
      ...process.env,
      NLC_HOME: path.join(tempRoot, "data"),
    },
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  if (result.error) {
    throw new Error(
      result.error.code === "ETIMEDOUT"
        ? "Packaged Desktop renderer smoke timed out"
        : "Packaged Desktop renderer smoke could not launch",
    );
  }
  if (result.status !== 0) {
    const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .split(/\r?\n/)
      .find((line) => line.startsWith("[desktop-smoke]"));
    throw new Error(
      `Packaged Desktop renderer smoke exited with ${result.status ?? "unknown"}` +
        (diagnostic ? `: ${diagnostic.slice(0, 2_000)}` : ""),
    );
  }
  process.stdout.write(
    "[desktop-smoke] packaged main/preload/renderer launch passed\n",
  );
} finally {
  fs.rmSync(tempRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
