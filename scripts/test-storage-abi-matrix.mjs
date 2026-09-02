import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storageRequire = createRequire(
  pathToFileURL(path.join(root, "packages", "core", "storage", "package.json")),
);
const rootRequire = createRequire(pathToFileURL(path.join(root, "package.json")));
const desktopRequire = createRequire(
  pathToFileURL(path.join(root, "apps", "desktop", "package.json")),
);
const betterSqliteEntry = storageRequire.resolve("better-sqlite3");
const betterSqliteRoot = path.resolve(path.dirname(betterSqliteEntry), "..");
const betterSqliteRequire = createRequire(
  pathToFileURL(path.join(betterSqliteRoot, "package.json")),
);
const betterSqliteVersion = JSON.parse(
  fs.readFileSync(path.join(betterSqliteRoot, "package.json"), "utf8"),
).version;
const prebuildInstall = betterSqliteRequire.resolve("prebuild-install/bin.js");
const nodeGyp = rootRequire.resolve("node-gyp/bin/node-gyp.js");
const nativeBinary = path.join(
  betterSqliteRoot,
  "build",
  "Release",
  "better_sqlite3.node",
);
const electronExecutable = desktopRequire("electron");
const electronSmoke = path.join(root, "scripts", "storage-electron-smoke.mjs");
const pnpmCli = process.env.npm_execpath;
const mode = process.argv[2] ?? "--node";
const nodeVitestConfig = mode === "--node-vitest" ? process.argv[3] : undefined;
const nodeBinaryCache = path.join(
  root,
  "node_modules",
  ".cache",
  "nlc-native",
  `better-sqlite3-${betterSqliteVersion}-node-${process.versions.modules}-${process.platform}-${process.arch}.node`,
);

if (!pnpmCli || !fs.existsSync(pnpmCli)) {
  throw new Error("test:storage:abi must be launched through pnpm");
}
if (!fs.existsSync(nativeBinary)) {
  throw new Error(`better-sqlite3 native binary not found: ${nativeBinary}`);
}

function run(label, command, args, cwd = root) {
  process.stdout.write(`[storage-abi] ${label}\n`);
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} exited with code ${result.status ?? "unknown"}`);
  }
}

if (mode === "--electron-only") {
  run("verify installed Electron ABI", electronExecutable, [electronSmoke]);
  process.exit(0);
}
if (mode === "--node-vitest" && !nodeVitestConfig) {
  throw new Error("--node-vitest requires a Vitest config path");
}
if (mode !== "--node" && mode !== "--node-vitest") {
  throw new Error(`Unknown storage ABI mode: ${mode}`);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-storage-abi-"));
const electronBackup = path.join(tempRoot, "better_sqlite3.electron.node");
let primaryFailure;
let restorationFailure;

try {
  run("verify installed Electron ABI", electronExecutable, [electronSmoke]);
  fs.copyFileSync(nativeBinary, electronBackup);
  if (fs.existsSync(nodeBinaryCache)) {
    process.stdout.write(
      `[storage-abi] restore cached host Node binary (${process.versions.modules})\n`,
    );
    fs.copyFileSync(nodeBinaryCache, nativeBinary);
  } else {
    try {
      run(
        "install better-sqlite3 prebuild for host Node",
        process.execPath,
        [
          prebuildInstall,
          "--runtime",
          "node",
          "--target",
          process.versions.node,
          "--force",
        ],
        betterSqliteRoot,
      );
    } catch {
      process.stdout.write(
        "[storage-abi] no matching Node prebuild; compiling from source\n",
      );
      run(
        "compile better-sqlite3 for host Node",
        process.execPath,
        [nodeGyp, "rebuild", "--release"],
        betterSqliteRoot,
      );
    }
    fs.mkdirSync(path.dirname(nodeBinaryCache), { recursive: true });
    fs.copyFileSync(nativeBinary, nodeBinaryCache);
  }
  const vitestConfig = nodeVitestConfig ?? "vitest.storage.config.ts";
  run(
    nodeVitestConfig
      ? `run Node tests from ${nodeVitestConfig}`
      : "run Node storage migration/lifecycle tests",
    process.execPath,
    [
      pnpmCli,
      "exec",
      "vitest",
      "run",
      "--config",
      vitestConfig,
    ],
  );
} catch (error) {
  primaryFailure = error;
} finally {
  try {
    if (!fs.existsSync(electronBackup)) {
      throw new Error("Electron ABI backup was not created");
    }
    fs.copyFileSync(electronBackup, nativeBinary);
    run("verify restored Electron ABI", electronExecutable, [electronSmoke]);
  } catch (error) {
    restorationFailure = error;
  }
  fs.rmSync(tempRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}

if (primaryFailure || restorationFailure) {
  if (primaryFailure) {
    process.stderr.write(
      `[storage-abi] matrix failed: ${
        primaryFailure instanceof Error ? primaryFailure.message : String(primaryFailure)
      }\n`,
    );
  }
  if (restorationFailure) {
    process.stderr.write(
      `[storage-abi] restoration failed: ${
        restorationFailure instanceof Error
          ? restorationFailure.message
          : String(restorationFailure)
      }\n`,
    );
  }
  process.exit(1);
}

process.stdout.write("[storage-abi] Node tests passed; Electron ABI restored\n");
