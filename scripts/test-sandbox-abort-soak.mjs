import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = [
  fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)),
  "run",
  "packages/core/sandbox/src/runchild-abort.test.ts",
  "--config",
  "vitest.integration.config.ts",
];

const child = spawn(process.execPath, args, {
  cwd: process.cwd(),
  env: { ...process.env, SANDBOX_ABORT_SOAK: "1" },
  stdio: "inherit",
  windowsHide: true,
});

child.once("error", (error) => {
  process.stderr.write(`sandbox abort soak failed to start: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("close", (code, signal) => {
  if (signal) {
    process.stderr.write(`sandbox abort soak terminated by ${signal}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
