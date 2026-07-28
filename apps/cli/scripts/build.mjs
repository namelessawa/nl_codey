import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(packageRoot, "dist");
const optionalInkDevtoolsStub = {
  name: "optional-ink-devtools-stub",
  setup(buildContext) {
    buildContext.onResolve(
      { filter: /^react-devtools-core$/ },
      () => ({ path: "react-devtools-core", namespace: "optional-ink-devtools" }),
    );
    buildContext.onLoad(
      { filter: /.*/, namespace: "optional-ink-devtools" },
      () => ({
        contents: "export default { connectToDevTools() {} };",
        loader: "js",
      }),
    );
  },
};

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(packageRoot, "src", "index.ts")],
  outfile: path.join(outDir, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __nlcCreateRequire } from "node:module";',
      "const require = __nlcCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  plugins: [optionalInkDevtoolsStub],
  external: [
    "@vscode/ripgrep",
    "better-sqlite3",
    "bindings",
    "file-uri-to-path",
  ],
});
