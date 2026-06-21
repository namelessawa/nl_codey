import os from "node:os";
import path from "node:path";

/**
 * Absolute path to the NL_Codey global data directory. All persistent user-level
 * state (settings.json, apikey.bin, data/workspace-state.db, snapshots/, index/,
 * plugins/) lives here and is shared by both the GUI (Electron) and the CLI
 * (`nlc`). The GUI is just a view of this directory; it does not store anything
 * outside of it.
 *
 * Honors the `NLC_HOME` environment variable for test harnesses and one-off
 * overrides; otherwise resolves to `~/.nlc`. Returns an absolute path.
 */
export function nlcRoot(): string {
  const override = process.env.NLC_HOME?.trim();
  if (override && override.length > 0) return path.resolve(override);
  return path.join(os.homedir(), ".nlc");
}

/** Join one or more segments under {@link nlcRoot}. */
export function nlcSubdir(...segments: string[]): string {
  return path.join(nlcRoot(), ...segments);
}
