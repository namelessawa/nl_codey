import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeLine, writeErrLine, c } from "../lib/format.js";
import type { ParsedArgs } from "../lib/argv.js";

/**
 * `nlc gui` — launch the Electron desktop window in the background.
 *
 * Discovery order:
 *   1. `--exe <path>` flag — explicit override (e.g. CI smoke tests).
 *   2. `NLC_GUI_EXE` env var.
 *   3. The packaged binary on a real install:
 *        Windows: `%ProgramFiles%/NL_Codey/NL_Codey.exe`
 *                 (electron-builder default install path)
 *        Override via NLC_GUI_EXE on macOS / Linux installs.
 *   4. Dev fallback — run `pnpm --filter @nlc/desktop dev` from the repo
 *      root. Found by walking up from this file until pnpm-workspace.yaml
 *      shows up.
 *
 * The GUI is detached so the CLI shell returns immediately; output is
 * redirected to `~/.nlc/gui.log` (only created when the dev fallback runs;
 * the packaged binary writes through Electron's own log channel).
 */
export async function runGui(args: ParsedArgs): Promise<number> {
  const explicit = args.flags.get("exe") ?? process.env.NLC_GUI_EXE;
  if (explicit) {
    return launch(explicit, [], "explicit");
  }

  const packaged = candidatePackagedPath();
  if (packaged && existsSync(packaged)) {
    return launch(packaged, [], "packaged");
  }

  const repoRoot = findRepoRoot();
  if (!repoRoot) {
    writeErrLine(
      "nlc gui: could not find a packaged install or a development repo to run from.\n" +
        "  Try `NLC_GUI_EXE=<path>` or run from the monorepo root.",
    );
    return 1;
  }

  writeLine(c.gray(`nlc gui: dev fallback — pnpm --filter @nlc/desktop dev (cwd ${repoRoot})`));
  return launchDev(repoRoot);
}

function candidatePackagedPath(): string | null {
  if (process.platform === "win32") {
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    return path.join(programFiles, "NL_Codey", "NL_Codey.exe");
  }
  if (process.platform === "darwin") {
    return "/Applications/NL_Codey.app/Contents/MacOS/NL_Codey";
  }
  return null;
}

function launch(exe: string, extraArgs: readonly string[], source: string): number {
  writeLine(c.gray(`nlc gui: launching ${source} → ${exe}`));
  const child = spawn(exe, extraArgs, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return 0;
}

function launchDev(repoRoot: string): number {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "pnpm.cmd" : "pnpm";
  const child = spawn(cmd, ["--filter", "@nlc/desktop", "dev"], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  child.unref();
  writeLine(c.gray("nlc gui: dev server detached; check the Electron window for progress"));
  return 0;
}

function findRepoRoot(): string | null {
  // Start from this module's location and walk up until pnpm-workspace.yaml.
  // Falls back to cwd so a globally-installed nlc still finds a dev tree if
  // the user invokes it from inside one.
  const seeds = [
    path.dirname(fileURLToPath(import.meta.url)),
    process.cwd(),
  ];
  for (const seed of seeds) {
    let dir = seed;
    for (let i = 0; i < 8; i++) {
      if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}
