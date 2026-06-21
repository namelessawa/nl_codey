/**
 * NL_Codey three-phase agent loop — public entry.
 *
 * Composition:
 *
 *     Phase 1 — initContext   (context.ts)
 *         ↓
 *     Phase 2 — transform     (transform.ts)
 *         ↓
 *     Phase 3 — react         (react.ts)
 *
 * Skill injection: when Phase 1 discovers at least one skill in
 * ~/.nlc/skills or <ws>/.nlc/skills, this module automatically advertises
 * an `invoke_skill` tool to the model and intercepts dispatch — the
 * caller's `executeTool` is never asked about `invoke_skill`. This keeps
 * skill bodies out of the system prompt (Phase 2 token budget stays
 * sane) while still letting the model pull a body in on demand.
 *
 * NO SDK USAGE: everything below goes through the project's own
 * {@link ChatLLMProvider} (which is implemented on plain `fetch`) and
 * `node:fs`. There is no `@anthropic-ai/sdk`, `openai`, or similar.
 */
import type { LLMToolCall, ToolSchema } from "@nlc/shared";
import { phase1InitContext } from "./context.js";
import { phase2Transform } from "./transform.js";
import { phase3ReactLoop } from "./react.js";
import type {
  NlcLoopDeps,
  NlcLoopInput,
  NlcLoopOutcome,
  SkillDescriptor,
} from "./types.js";

export * from "./types.js";
export {
  composeSystemMessage,
  phase1InitContext,
} from "./context.js";
export { phase2Transform } from "./transform.js";
export { phase3ReactLoop } from "./react.js";
export {
  loadSkills,
  parseFrontmatter,
  readMdIfExists,
  readProjectAgents,
  renderSkillsCatalogue,
} from "./loader.js";

/**
 * The auto-injected `invoke_skill` tool. Exported so callers can detect
 * (or filter) it if they wrap NLC loop's tool catalogue for telemetry.
 */
export const INVOKE_SKILL_TOOL: ToolSchema = {
  name: "invoke_skill",
  description:
    "Load the full body of one of the catalogued skills. Call this when the catalogue description matches what you need next; the tool result is the skill's markdown body. Do NOT call without a matching `name`.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Exact name of a skill from the Available skills catalogue (e.g. 'code-review').",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
};

/**
 * Run the three-phase loop end-to-end and return the combined outcome.
 *
 * The caller's `deps.tools` and `deps.executeTool` are extended in-place
 * to also handle `invoke_skill` when skills are present; the caller's
 * own dispatcher is consulted for everything else, so existing tool
 * surfaces (Phase 1/2/3 catalogue, plugin bundle, etc.) work unchanged.
 */
export async function runNlcLoop(
  input: NlcLoopInput,
  deps: NlcLoopDeps,
): Promise<NlcLoopOutcome> {
  // Phase 1
  const phase1 = await phase1InitContext(input, deps);

  // Skill dispatch wrapper: wrap `executeTool` so `invoke_skill` is
  // resolved locally and everything else falls through. Build the lookup
  // once per run; skills don't change inside a single call.
  const skillMap = buildSkillMap(phase1.inputs.skills);
  const extraTools: ToolSchema[] = skillMap.size > 0 ? [INVOKE_SKILL_TOOL] : [];
  const wrappedDeps: NlcLoopDeps = skillMap.size === 0
    ? deps
    : {
        ...deps,
        executeTool: (call: LLMToolCall): Promise<string> => {
          if (call.name === "invoke_skill") {
            return Promise.resolve(resolveInvokeSkill(call, skillMap));
          }
          return deps.executeTool(call);
        },
      };

  // Phase 2
  const phase2 = await phase2Transform(phase1, wrappedDeps);

  // Phase 3
  const phase3 = await phase3ReactLoop(phase2, wrappedDeps, extraTools);

  return {
    ...phase3,
    inputs: phase1.inputs,
    tokensBefore: phase2.tokensBefore,
    tokensAfter: phase2.tokensAfter,
    compressedCount: phase2.compressedCount,
  };
}

// --- internals ---

function buildSkillMap(skills: readonly SkillDescriptor[]): Map<string, SkillDescriptor> {
  const map = new Map<string, SkillDescriptor>();
  for (const s of skills) map.set(s.name, s);
  return map;
}

/**
 * Resolve an `invoke_skill` call to the body text. Returns a JSON-error
 * envelope when the args are malformed or the requested name is missing
 * — same shape the rest of the project's tools use on error so the
 * model can react consistently.
 */
function resolveInvokeSkill(
  call: LLMToolCall,
  skillMap: Map<string, SkillDescriptor>,
): string {
  const args = call.args;
  if (typeof args !== "object" || args === null) {
    return JSON.stringify({ error: "invoke_skill: missing args object" });
  }
  const name = (args as { name?: unknown }).name;
  if (typeof name !== "string" || name.length === 0) {
    return JSON.stringify({ error: "invoke_skill: `name` (string) is required" });
  }
  const skill = skillMap.get(name);
  if (!skill) {
    const available = Array.from(skillMap.keys()).sort().join(", ");
    return JSON.stringify({
      error: `invoke_skill: unknown skill "${name}". Available: ${available || "(none)"}`,
    });
  }
  return skill.body.length > 0
    ? skill.body
    : JSON.stringify({
        warning: `Skill "${name}" has no body — only a description was registered.`,
      });
}
