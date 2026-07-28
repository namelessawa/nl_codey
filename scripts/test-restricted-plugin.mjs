import { spawnSync } from "node:child_process";
import fs from "node:fs";

const pluginImage =
  "node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293";
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli || !fs.existsSync(pnpmCli)) {
  throw new Error("test:plugin:restricted must be launched through pnpm");
}

const docker = process.platform === "win32" ? "docker.exe" : "docker";
const pull = spawnSync(docker, ["pull", pluginImage], {
  stdio: "inherit",
  env: process.env,
});
if (pull.error) throw pull.error;
if (pull.status !== 0) {
  throw new Error(`restricted plugin image pull exited with code ${pull.status ?? "unknown"}`);
}

const result = spawnSync(
  process.execPath,
  [
    pnpmCli,
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.integration.config.ts",
    "packages/core/sandbox/src/restricted-plugin-runner.integration.test.ts",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      RUN_RESTRICTED_PLUGIN_DOCKER_TESTS: "1",
    },
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
