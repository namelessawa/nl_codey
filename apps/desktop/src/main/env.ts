import fs from "node:fs";
import path from "node:path";

/**
 * Minimal .env loader (no dependency). Walks up from `startDir` to find a
 * `.env` file and assigns any keys not already present in process.env.
 */
export function loadEnv(startDir: string): void {
  const envPath = findUp(startDir, ".env");
  if (!envPath) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function findUp(startDir: string, fileName: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = path.join(dir, fileName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
