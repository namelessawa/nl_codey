/**
 * Scaffold a `.nlc/` directory inside a workspace so the user can drop in
 * project-level overrides for {@link phase1InitContext}.
 *
 * What we lay down:
 *   .nlc/
 *     system.md            — project system prompt (template, commented).
 *     agents.md            — project agents description (template).
 *     skills/
 *       example.md         — sample skill with frontmatter walk-through.
 *
 * Existing files are left alone unless `force` is true. Returns a log of
 * what was created vs skipped so the TUI / CLI can surface the result
 * without us coupling to any specific output channel.
 */
import fs from "node:fs";
import path from "node:path";

export type InitOutcome = {
  root: string;
  created: string[];
  skipped: string[];
};

export type InitOptions = {
  force?: boolean;
};

export function initProjectSkeleton(
  workspaceRoot: string,
  opts: InitOptions = {},
): InitOutcome {
  const root = path.resolve(workspaceRoot);
  const force = opts.force === true;
  const created: string[] = [];
  const skipped: string[] = [];

  const files: { relPath: string; content: string }[] = [
    { relPath: path.join(".nlc", "system.md"), content: SYSTEM_TEMPLATE },
    { relPath: path.join(".nlc", "agents.md"), content: AGENTS_TEMPLATE },
    { relPath: path.join(".nlc", "skills", "example.md"), content: EXAMPLE_SKILL },
  ];

  for (const f of files) {
    const abs = path.join(root, f.relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (!force && fs.existsSync(abs)) {
      skipped.push(f.relPath);
      continue;
    }
    fs.writeFileSync(abs, f.content, "utf8");
    created.push(f.relPath);
  }

  return { root, created, skipped };
}

/** Render an {@link InitOutcome} as a multi-line system-message body. */
export function renderInitOutcome(outcome: InitOutcome): string {
  const lines: string[] = [`initialised .nlc/ scaffold in ${outcome.root}`];
  if (outcome.created.length > 0) {
    lines.push("", "created:");
    for (const p of outcome.created) lines.push(`  + ${p}`);
  }
  if (outcome.skipped.length > 0) {
    lines.push("", "skipped (already existed, pass --force to overwrite):");
    for (const p of outcome.skipped) lines.push(`  · ${p}`);
  }
  lines.push(
    "",
    "next: edit .nlc/system.md and .nlc/agents.md to customise this project's prompts.",
    "next: drop more skills into .nlc/skills/<name>.md — see example.md for the format.",
    "they will be picked up automatically on the next agent task.",
  );
  return lines.join("\n");
}

// --- templates ---------------------------------------------------------

const SYSTEM_TEMPLATE = `# Project system prompt

This file is **project-level**. NL_Codey loads it after the built-in base
prompt and after the global \`~/.nlc/system.md\`. Anything written here
overrides those.

Write your project-specific conventions and constraints. Examples:

- Coding style choices (formatter config, naming, file layout).
- Project-specific safety rules (paths the agent must never touch,
  commands that must never run).
- Commit message and PR conventions.
- Required verification commands.

Empty out of the box — the built-in NL_Codey prompt and your global file
already cover the basics. Add only what is genuinely project-specific.
`;

const AGENTS_TEMPLATE = `# Project agents

This file is **project-level**. NL_Codey loads it after the global
\`~/.nlc/agents.md\`. Use it to describe sub-agents, roles, or workflows
that are specific to this codebase.

Examples:

- "When asked to review a PR, run the security-review skill first."
- "Default reviewer for backend changes: senior-eng persona."
- "After every patch, run \`pnpm typecheck\` before reporting."

NL_Codey will also accept \`AGENTS.md\` at the workspace root (project
convention); the \`.nlc/agents.md\` form keeps it tucked under the local
NL_Codey directory if you prefer.
`;

const EXAMPLE_SKILL = `---
name: example-skill
description: Example skill — replace this file or add new ones beside it.
when_to_use: when the user asks NL_Codey to "show me how skills work".
---

# Example skill body

This is the **body** of the skill. The body is loaded on demand: when the
model decides to invoke this skill, NL_Codey's \`invoke_skill\` tool
returns this text and the model continues with the body in context.

## Frontmatter

- \`name\`: how the model invokes the skill (\`invoke_skill { name: "<name>" }\`).
- \`description\`: appears in the model's catalogue (keeps the prompt small).
- \`when_to_use\`: optional hint about when to trigger.

## Body

Put concrete instructions, examples, or templates here. The body is just
markdown; there is no length cap beyond what fits sensibly in a single
tool result.

## How a skill is invoked

1. The model sees this file's description in its system prompt catalogue
   (Phase 1 of the NL_Codey agent loop).
2. The model decides this skill applies and calls
   \`invoke_skill { name: "example-skill" }\`.
3. NL_Codey reads this body from disk and returns it as the tool result.
4. The model continues with the instructions inside the body.

Delete this file or rename it once you have your own skills in place.
`;
