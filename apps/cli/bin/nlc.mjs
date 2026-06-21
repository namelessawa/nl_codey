#!/usr/bin/env node
// Entry shim for the `nlc` binary. On a published install, `dist/index.js`
// is the bundled CLI produced by `pnpm --filter nlc build`. In a dev tree
// (no bundle yet) we fall back to running the TypeScript source through
// tsx so contributors can iterate without rebuilding.
//
// The fallback requires `tsx` to be installed — it is a devDependency of
// the workspace, so `pnpm install` always satisfies it locally; a real
// npm-installed user only hits the `compiled` path.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const compiled = path.resolve(here, "..", "dist", "index.js");
const source = path.resolve(here, "..", "src", "index.ts");

if (existsSync(compiled)) {
  await import(pathToFileURL(compiled).href);
} else {
  const tsx = await import("tsx/esm/api").catch(() => null);
  if (!tsx) {
    console.error(
      "nlc: no compiled bundle at " + compiled + " and tsx is not installed.\n" +
        "    Run `pnpm install` at the repo root, or `pnpm --filter nlc build`.",
    );
    process.exit(1);
  }
  // On Windows, tsx.tsImport requires a file:// URL — passing a raw
  // `E:\...` absolute path trips ERR_UNSUPPORTED_ESM_URL_SCHEME.
  await tsx.tsImport(pathToFileURL(source).href, import.meta.url);
}
