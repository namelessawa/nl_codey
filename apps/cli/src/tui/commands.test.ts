import { describe, expect, it } from "vitest";
import { colorDisabled, parseArgv } from "../lib/argv.js";
import { formatErrorOutput } from "../lib/format.js";
import {
  COMMANDS,
  matchCommands,
  MOUSE_SUPPORT_NOTICE,
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
    expect(help).toContain(MOUSE_SUPPORT_NOTICE);
  });

  it("maps public aliases to the same effects", () => {
    expect(parseCommand("/p")).toEqual({ kind: "provider" });
    expect(parseCommand("/q")).toEqual({ kind: "exit" });
    expect(parseCommand("/checkout abc")).toEqual({ kind: "resume", target: "abc" });
    expect(parseCommand("/undo")).toEqual({ kind: "rollback", runId: null });
    expect(parseCommand("/rollback run-1")).toEqual({
      kind: "rollback",
      runId: "run-1",
    });
    expect(parseCommand("/log")).toEqual({ kind: "tree" });
    expect(parseCommand("/trace")).toEqual({
      kind: "show-trace",
      position: null,
    });
    expect(parseCommand("/trace 2")).toEqual({
      kind: "show-trace",
      position: 2,
    });
  });

  it("preserves spaced arguments and rejects missing required values", () => {
    expect(parseCommand("/cd E:\\repo with spaces")).toEqual({
      kind: "switch-workspace",
      path: "E:\\repo with spaces",
    });
    expect(parseCommand("/branch")).toEqual({ kind: "unknown", raw: "/branch" });
    expect(parseCommand("/resume   ")).toEqual({ kind: "unknown", raw: "/resume" });
    expect(parseCommand("/trace 0")).toEqual({ kind: "unknown", raw: "/trace 0" });
    expect(parseCommand("/trace two")).toEqual({
      kind: "unknown",
      raw: "/trace two",
    });
    expect(parseCommand("/skills-generate")).toEqual({
      kind: "skills-generate",
      description: "",
    });
  });

  it.each([
    ["/exit now", "/exit now"],
    ["/help extra", "/help extra"],
    ["/workspaces extra", "/workspaces extra"],
    ["/settings extra", "/settings extra"],
    ["/init --force extra", "/init --force extra"],
    ["/init --unknown", "/init --unknown"],
    ["/skills extra", "/skills extra"],
    ["/sessions extra", "/sessions extra"],
    ["/tree extra", "/tree extra"],
    ["/branch message session extra", "/branch message session extra"],
    ["/rollback run-1 extra", "/rollback run-1 extra"],
    ["/provider extra", "/provider extra"],
    ["/不存在 参数", "/不存在 参数"],
  ])("rejects malformed exact-arity command %s", (input, raw) => {
    expect(parseCommand(input)).toEqual({ kind: "unknown", raw });
  });

  it("preserves bounded long CJK descriptions without splitting code points", () => {
    const description = "审".repeat(4_096);

    expect(parseCommand(`/skills-generate ${description}`)).toEqual({
      kind: "skills-generate",
      description,
    });
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

  it("redacts bounded stderr text used by every top-level CLI command", () => {
    const result = formatErrorOutput(
      "Authorization: Bearer cli-secret\n" +
        "C:\\Users\\alice\\.npmrc?token=query-secret " +
        "x".repeat(5_000),
    );

    expect(result).toContain("[REDACTED]");
    expect(result).toContain("[USER_HOME]");
    expect(result).not.toMatch(/cli-secret|query-secret|alice/);
    expect(result.length).toBeLessThanOrEqual(4_000);
  });
});
