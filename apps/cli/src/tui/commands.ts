/**
 * Slash-command parser. Opencode uses a global `⌘K` palette; we
 * deliberately don't take a global keybind — instead the user types
 * `/help`, `/exit`, `/workspaces`, etc. straight into the prompt and
 * presses Enter. The prompt component intercepts a leading slash and
 * routes through here.
 *
 * Each command returns an effect description for the host App to apply.
 * Keep the result a plain discriminated union — no DOM, no Ink — so the
 * parser stays unit-testable and component-agnostic.
 */

export type CommandEffect =
  | { kind: "noop" }
  | { kind: "exit" }
  | { kind: "clear" }
  | { kind: "show-help" }
  | { kind: "show-trace"; position: number | null }
  | { kind: "list-workspaces" }
  | { kind: "show-settings" }
  | { kind: "switch-workspace"; path: string }
  | { kind: "init"; force: boolean }
  | { kind: "list-skills" }
  | { kind: "skills-generate"; description: string }
  | { kind: "theme"; name: string | null }
  | { kind: "sessions" }
  | { kind: "tree" }
  | { kind: "branch"; messageId: string; sessionId: string | null }
  | { kind: "resume"; target: string }
  | { kind: "rollback"; runId: string | null }
  | { kind: "model"; spec: string | null }
  | { kind: "think"; level: string | null }
  | { kind: "provider" }
  | { kind: "unknown"; raw: string };

export type CommandSpec = {
  name: string;
  /** Short hint shown by `:help`. */
  hint: string;
};

export const MOUSE_SUPPORT_NOTICE =
  "Mouse: Experimental - terminal scrollback wheel only; clicks and input capture are unsupported.";

export const COMMANDS: readonly CommandSpec[] = [
  { name: "/help", hint: "Show this command catalogue." },
  { name: "/trace [<n>]", hint: "Expand the latest (or nth-latest) tool result with provenance." },
  { name: "/init", hint: "Scaffold .nlc/ in the current workspace (--force to overwrite)." },
  { name: "/skills", hint: "List skills the agent loop currently sees." },
  { name: "/skills-generate <desc>", hint: "Use the LLM to author a new skill, then pick where to install." },
  { name: "/theme [<name>]", hint: "List presets or switch theme — try /theme rainbow." },
  { name: "/settings", hint: "Show resolved ~/.nlc/settings.json." },
  { name: "/workspaces", hint: "List previously opened workspaces." },
  { name: "/cd <path>", hint: "Switch the active workspace root." },
  { name: "/sessions", hint: "List every session JSON under this project." },
  { name: "/tree", hint: "Render the project's conversation tree (git-style)." },
  { name: "/branch <msg> [<session>]", hint: "Start a new session branched from a message id." },
  { name: "/resume <session>", hint: "Switch the active session to an existing file." },
  { name: "/rollback [<run>]", hint: "Restore snapshots from the latest (or selected) run." },
  { name: "/provider", hint: "Open the provider picker (presets + 5 custom slots)." },
  { name: "/model [<provider/model>]", hint: "Show or change the active LLM and log the swap." },
  { name: "/think [<level>]", hint: "Show or change the thinking level and log the swap." },
  { name: "/clear", hint: "Clear the message stream." },
  { name: "/exit", hint: "Quit the TUI." },
  { name: "/quit", hint: "Alias for /exit." },
] as const;

/**
 * Live-filter the catalogue while the user types in the prompt. `partial`
 * is the raw input string — `""` returns no suggestions (popup hidden),
 * `"/"` returns every command, `"/he"` returns prefix matches.
 *
 * Matching is case-insensitive prefix on the command base name (i.e. the
 * `/help` part, not the `<path>` placeholder). Order follows the canonical
 * COMMANDS list so the user sees the same sequence every time.
 */
export function matchCommands(partial: string): readonly CommandSpec[] {
  if (!partial.startsWith("/")) return [];
  const q = partial.slice(1).toLowerCase();
  if (q.length === 0) return COMMANDS;
  return COMMANDS.filter((c) => {
    const base = c.name.split(/\s+/)[0]!.slice(1).toLowerCase();
    return base.startsWith(q);
  });
}

/** Returns null if the line isn't a command (no leading slash). */
export function parseCommand(line: string): CommandEffect | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) return null;
  // Strip the slash, split on whitespace.
  const parts = trimmed.slice(1).split(/\s+/);
  const head = parts[0]?.toLowerCase() ?? "";
  switch (head) {
    case "":
      return { kind: "noop" };
    case "exit":
    case "quit":
    case "q":
      if (parts.length > 1) return { kind: "unknown", raw: trimmed };
      return { kind: "exit" };
    case "clear":
      if (parts.length > 1) return { kind: "unknown", raw: trimmed };
      return { kind: "clear" };
    case "help":
    case "?":
      if (parts.length > 1) return { kind: "unknown", raw: trimmed };
      return { kind: "show-help" };
    case "trace": {
      const raw = parts[1]?.trim() ?? "";
      if (!raw) return { kind: "show-trace", position: null };
      const position = Number(raw);
      if (!Number.isInteger(position) || position < 1 || parts.length > 2) {
        return { kind: "unknown", raw: trimmed };
      }
      return { kind: "show-trace", position };
    }
    case "workspaces":
    case "ws":
      if (parts.length > 1) return { kind: "unknown", raw: trimmed };
      return { kind: "list-workspaces" };
    case "settings":
    case "set":
      if (parts.length > 1) return { kind: "unknown", raw: trimmed };
      return { kind: "show-settings" };
    case "cd": {
      const target = parts.slice(1).join(" ").trim();
      if (!target) return { kind: "unknown", raw: trimmed };
      return { kind: "switch-workspace", path: target };
    }
    case "init": {
      const options = parts.slice(1);
      if (
        options.length > 1 ||
        options.some((option) => option !== "--force" && option !== "-f")
      ) {
        return { kind: "unknown", raw: trimmed };
      }
      const force = options.length === 1;
      return { kind: "init", force };
    }
    case "skills":
    case "sk":
      if (parts.length > 1) return { kind: "unknown", raw: trimmed };
      return { kind: "list-skills" };
    case "skills-generate":
    case "skill-gen":
    case "sg": {
      const description = parts.slice(1).join(" ").trim();
      return { kind: "skills-generate", description };
    }
    case "theme":
    case "th": {
      const name = parts.slice(1).join(" ").trim();
      return { kind: "theme", name: name.length > 0 ? name : null };
    }
    case "sessions":
    case "list-sessions":
      if (parts.length > 1) return { kind: "unknown", raw: trimmed };
      return { kind: "sessions" };
    case "tree":
    case "log":
      if (parts.length > 1) return { kind: "unknown", raw: trimmed };
      return { kind: "tree" };
    case "branch": {
      const messageId = parts[1]?.trim() ?? "";
      const sessionId = parts[2]?.trim() ?? "";
      if (!messageId || parts.length > 3) {
        return { kind: "unknown", raw: trimmed };
      }
      return { kind: "branch", messageId, sessionId: sessionId.length > 0 ? sessionId : null };
    }
    case "resume":
    case "checkout": {
      const target = parts.slice(1).join(" ").trim();
      if (!target) return { kind: "unknown", raw: trimmed };
      return { kind: "resume", target };
    }
    case "rollback":
    case "undo": {
      if (parts.length > 2) return { kind: "unknown", raw: trimmed };
      const runId = parts[1]?.trim() ?? "";
      return { kind: "rollback", runId: runId.length > 0 ? runId : null };
    }
    case "model":
    case "mdl": {
      const spec = parts.slice(1).join(" ").trim();
      return { kind: "model", spec: spec.length > 0 ? spec : null };
    }
    case "think":
    case "thinking": {
      const level = parts.slice(1).join(" ").trim();
      return { kind: "think", level: level.length > 0 ? level : null };
    }
    case "provider":
    case "providers":
    case "p":
      if (parts.length > 1) return { kind: "unknown", raw: trimmed };
      return { kind: "provider" };
    default:
      return { kind: "unknown", raw: trimmed };
  }
}

/** Multi-line help text rendered when `:help` fires. */
export function renderHelp(): string {
  const widest = COMMANDS.reduce((n, c) => Math.max(n, c.name.length), 0);
  const catalogue = COMMANDS.map(
    (c) => `  ${c.name.padEnd(widest + 2)}${c.hint}`,
  );
  return [...catalogue, "", MOUSE_SUPPORT_NOTICE].join("\n");
}
