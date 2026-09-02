import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliRoot = path.join(root, "apps", "cli");
const pnpmCli = process.env.npm_execpath;

if (!pnpmCli || !fs.existsSync(pnpmCli)) {
  throw new Error("smoke:cli:artifact must be launched through pnpm");
}
for (const required of ["bin/nlc.mjs", "dist/index.js"]) {
  if (!fs.existsSync(path.join(cliRoot, required))) {
    throw new Error(`CLI artifact is missing ${required}; run pnpm --filter nlc build`);
  }
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-cli-package-"));

try {
  run(process.execPath, [
    pnpmCli,
    "--filter",
    "nlc",
    "pack",
    "--pack-destination",
    tempRoot,
  ]);

  const archives = fs
    .readdirSync(tempRoot)
    .filter((entry) => entry.endsWith(".tgz"))
    .map((entry) => path.join(tempRoot, entry));
  if (archives.length !== 1) {
    throw new Error(`Expected one CLI tarball, found ${archives.length}`);
  }

  const unpackedRoot = path.join(tempRoot, "unpacked");
  fs.mkdirSync(unpackedRoot);
  run("tar", ["-xzf", archives[0], "-C", unpackedRoot]);

  const packageRoot = path.join(unpackedRoot, "package");
  for (const required of ["package.json", "bin/nlc.mjs", "dist/index.js"]) {
    if (!fs.existsSync(path.join(packageRoot, required))) {
      throw new Error(`Packed CLI is missing ${required}`);
    }
  }
  if (fs.existsSync(path.join(packageRoot, "src"))) {
    throw new Error("Packed CLI unexpectedly contains TypeScript source");
  }

  const installRoot = path.join(tempRoot, "installed");
  fs.mkdirSync(installRoot);
  run(process.execPath, [
    findNpmCli(),
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--prefer-offline",
    "--prefix",
    installRoot,
    archives[0],
  ]);

  const installedBin = path.join(
    installRoot,
    "node_modules",
    "nlc",
    "bin",
    "nlc.mjs",
  );
  const help = run(process.execPath, [installedBin, "--help"], {
    capture: true,
    cwd: installRoot,
  });
  if (!/\bUsage:\s*\r?\n\s+nlc\b/.test(help.stdout)) {
    throw new Error("Installed CLI help output did not contain the expected usage");
  }
  process.stdout.write("[cli-artifact] packed, installed, and ran nlc --help\n");
} finally {
  fs.rmSync(tempRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}

function findNpmCli() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const npmCli = candidates.find((candidate) => fs.existsSync(candidate));
  if (!npmCli) throw new Error("Unable to locate npm-cli.js beside the Node runtime");
  return npmCli;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: process.env,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stderr ?? "");
      process.stderr.write(result.stdout ?? "");
    }
    throw new Error(`${path.basename(command)} exited with code ${result.status ?? "unknown"}`);
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
