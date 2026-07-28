import { describe, expect, it } from "vitest";
import { colorDisabled, parseArgv } from "../lib/argv.js";
import {
  COMMANDS,
  matchCommands,
  parseCommand,
  renderHelp,
} from "./commands.js";

describe("[tui] command registry", () => {
  it("keeps every catalogued command parseable and present in help", () => {
    const help = renderHelp();

    for (const spec of COMMANDS) {
      const base = spec.name.split(/\s+/)[0]!;
      const takesRequiredArg =
        base === "/cd" ||
        base === "/skills-generate" ||
        base === "/branch" ||
        base === "/resume";
      const sample = takesRequiredArg
        ? base === "/branch"
          ? `${base} message-1`
          : `${base} sample`
        : base;
      const effect = parseCommand(sample);

      expect(effect, spec.name).not.toBeNull();
      expect(effect?.kind, spec.name).not.toBe("unknown");
      expect(help).toContain(spec.name);
    }
  });

  it("maps public aliases to the same effects", () => {
    expect(parseCommand("/p")).toEqual({ kind: "provider" });
    expect(parseCommand("/q")).toEqual({ kind: "exit" });
    expect(parseCommand("/checkout abc")).toEqual({ kind: "resume", target: "abc" });
    expect(parseCommand("/log")).toEqual({ kind: "tree" });
  });

  it("preserves spaced arguments and rejects missing required values", () => {
    expect(parseCommand("/cd E:\\repo with spaces")).toEqual({
      kind: "switch-workspace",
      path: "E:\\repo with spaces",
    });
    expect(parseCommand("/branch")).toEqual({ kind: "unknown", raw: "/branch" });
    expect(parseCommand("/resume   ")).toEqual({ kind: "unknown", raw: "/resume" });
  });

  it("filters command suggestions case-insensitively", () => {
    expect(matchCommands("plain text")).toEqual([]);
    expect(matchCommands("/HE").map((item) => item.name)).toEqual(["/help"]);
    expect(matchCommands("/").length).toBe(COMMANDS.length);
  });
});

describe("[cli] argv", () => {
  it("separates positionals, boolean flags, valued flags and -- passthrough", () => {
    const parsed = parseArgv([
      "run",
      "--workspace",
      "E:\\repo with spaces",
      "--yes",
      "--",
      "--literal",
      "task",
    ]);

    expect(parsed.positional).toEqual(["run", "--literal", "task"]);
    expect(parsed.flags.get("workspace")).toBe("E:\\repo with spaces");
    expect(parsed.flags.get("yes")).toBe("true");
  });

  it("supports equals syntax and does not consume the next flag as a value", () => {
    const parsed = parseArgv(["--data-root=C:\\nlc", "--json", "--no-color"]);

    expect(parsed.flags.get("data-root")).toBe("C:\\nlc");
    expect(parsed.flags.get("json")).toBe("true");
    expect(parsed.flags.get("no-color")).toBe("true");
    expect(parsed.positional).toEqual([]);
  });

  it("honours the explicit no-color flag", () => {
    expect(colorDisabled(parseArgv(["--no-color"]))).toBe(true);
  });
});
