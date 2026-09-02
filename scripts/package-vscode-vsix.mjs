import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createVSIX, listFiles, PackageManager } from "@vscode/vsce";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(root, "apps", "vscode");
const manifest = JSON.parse(
  fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"),
);
const releaseDir = path.join(root, "release");
const target = path.join(
  releaseDir,
  `nl-codey-vscode-${manifest.version}.vsix`,
);
const entry = path.join(extensionRoot, "dist", "extension.cjs");

if (!fs.existsSync(entry) || fs.statSync(entry).size === 0) {
  throw new Error("VS Code extension build is missing; run the extension build first");
}

fs.mkdirSync(releaseDir, { recursive: true });
if (fs.existsSync(target)) fs.rmSync(target);

const files = await listFiles({
  cwd: extensionRoot,
  packageManager: PackageManager.None,
});
for (const required of ["package.json", "README.md", "dist/extension.cjs"]) {
  if (!files.includes(required)) {
    throw new Error(`VSIX input is missing required file: ${required}`);
  }
}
if (
  files.some(
    (file) =>
      file.startsWith("src/") ||
      file.startsWith("node_modules/") ||
      file.endsWith(".map") ||
      /(^|\/)(?:custom\.txt|\.env(?:\.|$))/.test(file),
  )
) {
  throw new Error("VSIX input includes source, dependency, map, or secret files");
}

await createVSIX({
  cwd: extensionRoot,
  packagePath: target,
  dependencies: false,
  skipLicense: true,
});

if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
  throw new Error("VSIX packaging produced no artifact");
}
process.stdout.write(`[vscode-vsix] packaged ${target}\n`);
