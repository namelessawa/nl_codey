/**
 * Tiny argv parser — no third-party dependency. Splits the input into
 * positional arguments and a flag bag.
 *
 * Supported shapes:
 *   --flag                   → flags has "flag" (value "true")
 *   --flag=value             → flags has "flag" = "value"
 *   --flag value             → flags has "flag" = "value"
 *   -f                       → flags has "f" (value "true")
 *   -f value                 → flags has "f" = "value"
 *   --                       → everything after goes verbatim into positional
 *   positional               → appended to .positional
 *
 * No globbing, no auto-coercion, no subcommand-aware routing — the entry
 * point handles subcommand dispatch by inspecting positional[0].
 */
export type ParsedArgs = {
  positional: string[];
  flags: Map<string, string>;
  raw: readonly string[];
};

const FLAG_TAKES_NO_VALUE = new Set([
  "help", "h",
  "version", "V",
  "yes", "y",
  "quiet", "q",
  "verbose",
  "no-color",
  "json",
  "host-protocol",
]);

export function parseArgv(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a === "--") {
      for (let j = i + 1; j < argv.length; j++) positional.push(argv[j]!);
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        const name = a.slice(2, eq);
        flags.set(name, a.slice(eq + 1));
        i += 1;
        continue;
      }
      const name = a.slice(2);
      const next = argv[i + 1];
      if (
        FLAG_TAKES_NO_VALUE.has(name) ||
        next === undefined ||
        (next.startsWith("-") && !(name === "output" && next === "-"))
      ) {
        flags.set(name, "true");
        i += 1;
      } else {
        flags.set(name, next);
        i += 2;
      }
      continue;
    }
    if (a.startsWith("-") && a.length > 1) {
      const name = a.slice(1);
      const next = argv[i + 1];
      if (
        FLAG_TAKES_NO_VALUE.has(name) ||
        next === undefined ||
        (next.startsWith("-") && !(name === "output" && next === "-"))
      ) {
        flags.set(name, "true");
        i += 1;
      } else {
        flags.set(name, next);
        i += 2;
      }
      continue;
    }
    positional.push(a);
    i += 1;
  }
  return { positional, flags, raw: argv };
}

/** True when --no-color was passed or NO_COLOR is set in env. */
export function colorDisabled(args: ParsedArgs): boolean {
  if (args.flags.has("no-color")) return true;
  if (process.env.NO_COLOR && process.env.NO_COLOR.length > 0) return true;
  return false;
}
