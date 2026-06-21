/**
 * `nlc sessions` — shell subcommand for inspecting the on-disk session
 * tree without launching the TUI. Useful for sanity checks, scripts,
 * piping into `jq`, etc.
 *
 * Subcommands:
 *   nlc sessions             # alias for `list`
 *   nlc sessions list        # one row per session in the current cwd
 *   nlc sessions tree        # git-style ASCII tree of the project
 *   nlc sessions show <id>   # dump one session as plain JSONL
 *
 * Flags accepted on every form:
 *   --workspace <path>   run as if cwd were <path>
 *   --data-root <path>   override ~/.nlc
 *   --json               machine-readable output (list/tree only)
 */
import path from "node:path";
import fs from "node:fs";
import { nlcRoot } from "@nlc/shared";
import { SessionStore, renderProjectTree } from "@nlc/session";
import { c, writeLine, writeErrLine } from "../lib/format.js";
import type { ParsedArgs } from "../lib/argv.js";

export async function runSessions(args: ParsedArgs): Promise<number> {
  const dataRoot = (args.flags.get("data-root") ?? nlcRoot()).toString();
  const workspaceRoot = path.resolve(args.flags.get("workspace") ?? process.cwd());
  const sessionRoot = path.join(dataRoot, "agent.session");
  const wantsJson = args.flags.has("json");
  const sub = (args.positional[0] ?? "list").toLowerCase();

  const store = new SessionStore({ root: sessionRoot });

  switch (sub) {
    case "list":
    case "ls":
      return listSessions(store, workspaceRoot, wantsJson);
    case "tree":
    case "log":
      return treeSessions(store, workspaceRoot, wantsJson);
    case "show":
    case "cat": {
      const id = args.positional[1];
      if (!id) {
        writeErrLine('nlc sessions show: missing session id. usage: nlc sessions show <id|file>');
        return 2;
      }
      return showSession(store, workspaceRoot, id);
    }
    default:
      writeErrLine(`nlc sessions: unknown sub-command "${sub}". try list | tree | show.`);
      return 2;
  }
}

function listSessions(store: SessionStore, cwd: string, wantsJson: boolean): number {
  const summaries = store.listProjectSessions(cwd);
  if (wantsJson) {
    process.stdout.write(JSON.stringify(summaries, null, 2) + "\n");
    return 0;
  }
  if (summaries.length === 0) {
    writeLine(c.gray("no sessions on disk yet — submit a task to open one."));
    return 0;
  }
  writeLine(c.bold(`sessions in ${cwd}`));
  const widest = summaries.reduce((n, s) => Math.max(n, s.id.length), 0);
  for (const s of summaries) {
    const branched = s.parent ? c.gray(`  ← ${s.parent.sessionId}/${s.parent.messageId}`) : "";
    writeLine(
      `  ${s.id.padEnd(widest + 2)}${s.messageCount.toString().padStart(3)} msg  ` +
        `${c.gray(formatDate(s.updatedAt))}  ${s.title}${branched}`,
    );
  }
  return 0;
}

function treeSessions(store: SessionStore, cwd: string, wantsJson: boolean): number {
  const sessions = store.loadProjectSessions(cwd);
  const summaries = store.listProjectSessions(cwd);
  if (wantsJson) {
    process.stdout.write(JSON.stringify({ summaries, messageCount: sessions.reduce((n, s) => n + s.messages.length, 0) }, null, 2) + "\n");
    return 0;
  }
  writeLine(renderProjectTree(sessions, summaries));
  return 0;
}

function showSession(store: SessionStore, cwd: string, idOrPath: string): number {
  let filePath = idOrPath;
  // If user passed an id rather than a path, look it up under the cwd's folder.
  if (!idOrPath.endsWith(".json") || !fs.existsSync(idOrPath)) {
    const match = store.listProjectSessions(cwd).find((s) => s.id === idOrPath);
    if (!match) {
      writeErrLine(`nlc sessions show: id "${idOrPath}" not found under ${cwd}`);
      return 1;
    }
    filePath = match.filePath;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  process.stdout.write(raw);
  if (!raw.endsWith("\n")) process.stdout.write("\n");
  return 0;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
