import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceManifest = JSON.parse(
  fs.readFileSync(path.join(root, "apps", "vscode", "package.json"), "utf8"),
);
const artifact = path.join(
  root,
  "release",
  `nl-codey-vscode-${sourceManifest.version}.vsix`,
);
if (!fs.existsSync(artifact) || fs.statSync(artifact).size === 0) {
  throw new Error("VSIX artifact is missing; run pnpm package:vscode first");
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-vsix-smoke-"));
try {
  const entries = runTar(["-tf", artifact])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((entry) => entry.replaceAll("\\", "/"));

  const required = [
    "[Content_Types].xml",
    "extension.vsixmanifest",
    "extension/package.json",
    "extension/readme.md",
    "extension/dist/extension.cjs",
  ];
  if (
    entries.length !== required.length ||
    entries.some(
      (entry) =>
        entry.startsWith("/") ||
        /^[A-Za-z]:\//.test(entry) ||
        entry.split("/").includes(".."),
    )
  ) {
    throw new Error("VSIX archive has an unexpected or unsafe entry set");
  }
  for (const entry of required) {
    if (!entries.includes(entry)) {
      throw new Error(`VSIX archive is missing required entry: ${entry}`);
    }
  }
  const forbidden = entries.find(
    (entry) =>
      entry.includes("/src/") ||
      entry.includes("/node_modules/") ||
      entry.endsWith(".map") ||
      /(^|\/)(?:custom\.txt|\.env(?:\.|$))/.test(entry),
  );
  if (forbidden) {
    throw new Error(`VSIX archive contains forbidden entry: ${forbidden}`);
  }

  runTar(["-xf", artifact, "-C", tempRoot]);
  const manifestPath = path.join(tempRoot, "extension", "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (
    manifest.name !== "nl-codey" ||
    manifest.publisher !== "nl-codey" ||
    manifest.version !== sourceManifest.version
  ) {
    throw new Error("VSIX manifest identity does not match the source manifest");
  }
  const commandIds = new Set(
    (manifest.contributes?.commands ?? []).map((command) => command.command),
  );
  for (const id of ["nlCodey.runTask", "nlCodey.stopTask"]) {
    if (!commandIds.has(id)) {
      throw new Error(`VSIX manifest is missing command: ${id}`);
    }
  }

  const extensionDir = path.join(tempRoot, "extension");
  const main = path.resolve(extensionDir, manifest.main ?? "");
  if (
    path.dirname(main) !== path.join(extensionDir, "dist") ||
    !fs.existsSync(main) ||
    fs.statSync(main).size === 0
  ) {
    throw new Error("VSIX main entry is missing or outside extension/dist");
  }
  const bundled = fs.readFileSync(main, "utf8");
  if (
    !bundled.includes("nlCodey.runTask") ||
    !bundled.includes("nlCodey.stopTask")
  ) {
    throw new Error("VSIX main entry does not register both public commands");
  }

  process.stdout.write(
    `[vscode-vsix] archive/install-shape smoke passed (${entries.length} entries)\n`,
  );
} finally {
  fs.rmSync(tempRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

function runTar(args) {
  const result = spawnSync("tar", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Could not inspect VSIX archive: ${result.error?.message ?? result.stderr ?? "tar failed"}`,
    );
  }
  return result.stdout ?? "";
}
