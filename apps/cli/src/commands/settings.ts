import { nlcRoot } from "@nlc/shared";
import { writeLine, writeErrLine, c } from "../lib/format.js";
import { loadCliSettings } from "../lib/settings.js";
import type { ParsedArgs } from "../lib/argv.js";

/**
 * `nlc settings` — print the resolved settings (the same file the GUI uses).
 * Subcommands:
 *   nlc settings get <key>     Print one dotted-path key. Returns 2 on miss.
 *
 * Writing is intentionally not exposed: only the GUI knows how to round-trip
 * the encrypted API key safely. CLI users who need to script changes can edit
 * `~/.nlc/settings.json` directly and let the GUI re-merge on next open.
 */
export async function runSettings(args: ParsedArgs): Promise<number> {
  const dataRoot = (args.flags.get("data-root") ?? nlcRoot()).toString();
  const settings = loadCliSettings(dataRoot);
  const action = args.positional[0];

  if (!action || action === "show") {
    if (args.flags.has("json")) {
      writeLine(JSON.stringify(settings.appSettings, null, 2));
      return 0;
    }
    writeLine(c.bold("Data root: ") + dataRoot);
    writeLine(c.bold("Provider:  ") + settings.appSettings.llm.provider);
    writeLine(c.bold("Model:     ") + settings.appSettings.llm.model);
    writeLine(c.bold("Base URL:  ") + (settings.appSettings.llm.baseUrl || "(provider default)"));
    writeLine(
      c.bold("API key:   ") +
        (settings.apiKeyFromEnv
          ? c.green("from environment")
          : c.yellow("not set — export NLC_API_KEY or run the GUI to configure")),
    );
    writeLine(c.bold("Language:  ") + settings.appSettings.ui.language);
    writeLine(c.bold("Theme:     ") + settings.appSettings.ui.theme);
    return 0;
  }

  if (action === "get") {
    const key = args.positional[1];
    if (!key) {
      writeErrLine("nlc settings get: missing key. Try `nlc settings get llm.model`.");
      return 2;
    }
    const value = getDottedKey(settings.appSettings, key);
    if (value === undefined) {
      writeErrLine(`nlc settings get: no such key "${key}".`);
      return 2;
    }
    writeLine(typeof value === "string" ? value : JSON.stringify(value));
    return 0;
  }

  writeErrLine(`nlc settings: unknown action "${action}". Try \`show\` or \`get <key>\`.`);
  return 2;
}

function getDottedKey(obj: unknown, dotted: string): unknown {
  const parts = dotted.split(".");
  let cursor: unknown = obj;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}
