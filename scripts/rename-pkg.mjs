#!/usr/bin/env node
// Safe bulk rename @nlc/* -> @nlc/* across the repo.
//
// Uses Node's UTF-8 default for read/write — no BOM, no Windows-codepage
// double-decoding. Preserves CRLF/LF as found.
//
// One-shot script: run with `node scripts/rename-pkg.mjs` from repo root.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL(".", import.meta.url).pathname.replace(/^\//, ""));
const ROOT = path.resolve(process.cwd());
const FROM = "@nlc/";
const TO = "@nlc/";

const INCLUDE_EXT = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs",
  ".json", ".yaml", ".yml",
  ".md",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "out", "dist", "build",
  "artifacts", "nightly", "experiments", ".turbo",
  ".pnpm-store",
]);

const SKIP_FILES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
]);

let scanned = 0;
let changed = 0;
let skipped = 0;

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!INCLUDE_EXT.has(ext)) continue;
    scanned++;
    const orig = fs.readFileSync(full, "utf8");
    if (!orig.includes(FROM)) {
      skipped++;
      continue;
    }
    const next = orig.split(FROM).join(TO);
    if (next === orig) {
      skipped++;
      continue;
    }
    fs.writeFileSync(full, next, "utf8");
    changed++;
  }
}

walk(ROOT);

console.log(JSON.stringify({ root: ROOT, scanned, changed, skipped }, null, 2));
