import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app } from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storageRequire = createRequire(
  pathToFileURL(path.join(root, "packages", "core", "storage", "package.json")),
);

app.whenReady().then(() => {
  try {
    const Database = storageRequire("better-sqlite3");
    const db = new Database(":memory:");
    const row = db.prepare("select 1 as ok").get();
    db.close();
    if (row?.ok !== 1) throw new Error("SQLite probe returned an unexpected row");
    process.stdout.write(
      `[storage-abi] Electron ${process.versions.electron}; modules ${process.versions.modules}; smoke passed\n`,
    );
    app.exit(0);
  } catch (error) {
    process.stderr.write(
      `[storage-abi] Electron smoke failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    app.exit(1);
  }
});
