/**
 * Plugin runtime wiring. Builds the dynamic ToolSchema list + dispatcher that
 * the agent's tool loop consumes for plugin tools, and routes invocations
 * through {@link PluginHost} (which re-validates enablement and permissions).
 *
 * Plugin tools are advertised to the model under the namespaced name
 * `plugin__<pluginName>__<toolName>`. The namespace prevents collisions with
 * built-in tools and makes provenance obvious in the run trace.
 *
 * Sandbox modes:
 * - whitelist  — spawn Node directly with cwd locked to the workspace and a
 *                hard timeout. This bypasses the user-typed-command whitelist
 *                deliberately: plugin commands are structured invocations
 *                whose permissions were already approved at install time.
 * - docker/wsl — return a runtime error. Strong-sandbox plugin execution
 *                requires bundling Node into the sandbox image; that is out
 *                of scope for this iteration and will surface as a clean,
 *                actionable failure to the model instead of a silent retry.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import type {
  LLMToolCall,
  PluginInstallation,
  PluginToolManifest,
  PluginToolParameter,
  ToolContext,
  ToolSchema,
} from "@coding-agent/shared";
import { PluginHost, type SandboxHandle } from "@coding-agent/plugin-sdk";
import type { ExecutedTool } from "@coding-agent/agent-core";
import type { Services } from "./services.js";

const PLUGIN_TOOL_PREFIX = "plugin__";
const PLUGIN_TIMEOUT_MS = 60_000;
const PLUGIN_OUTPUT_CAP = 100 * 1024;

export type PluginBundle = {
  schemas: ToolSchema[];
  dispatch: (call: LLMToolCall, ctx: ToolContext) => Promise<ExecutedTool | null>;
  /**
   * Qualified plugin-tool names whose declared permissions allow workspace
   * mutation (`run_command` or `write_workspace`). agent-core consumes
   * this to extend the read-only filter and the degraded-mode gate to
   * cover plugins, mirroring the protection already enforced on the
   * built-in `run_command` / `apply_patch` / `write_file` tools.
   */
  mutatingNames: string[];
};

/**
 * Compose the plugin tool bundle for the current state of the database. Called
 * once per driveLoop entry so a plugin enabled/installed mid-session lights up
 * on the next task without a restart. Returns null when the plugin feature is
 * disabled or when there are no enabled plugin tools to advertise.
 */
export function buildPluginBundle(services: Services): PluginBundle | null {
  const flags = services.phase4Settings.get();
  if (!flags.pluginsEnabled) return null;

  const installations = services.storage.phase4
    .listPlugins()
    .filter((inst) => inst.enabled);
  if (installations.length === 0) return null;

  // Map qualified tool name → (installation, raw tool manifest) so dispatch
  // can recover both without re-iterating the entire plugin list.
  type Entry = { installation: PluginInstallation; tool: PluginToolManifest };
  const byQualifiedName = new Map<string, Entry>();
  const schemas: ToolSchema[] = [];
  // Names of plugin tools whose declared permissions allow mutation —
  // emitted to agent-core so read-only mode strips them from the
  // advertised schema and degraded mode refuses them at dispatch.
  const mutatingNames: string[] = [];

  for (const installation of installations) {
    for (const tool of installation.manifest.tools) {
      const qualifiedName = qualifyToolName(installation.manifest.name, tool.name);
      byQualifiedName.set(qualifiedName, { installation, tool });
      schemas.push({
        name: qualifiedName,
        description: `[plugin: ${installation.manifest.name}] ${tool.description}`,
        parameters: {
          type: "object",
          properties: parametersToJsonSchemaProperties(tool.parameters),
          additionalProperties: false,
        },
      });
      if (declaresMutatingPermission(tool)) mutatingNames.push(qualifiedName);
    }
  }

  if (schemas.length === 0) return null;

  const host = new PluginHost(
    () => services.storage.phase4.listPlugins(),
    (mode) => makeSandboxHandle(mode),
  );

  return {
    schemas,
    mutatingNames,
    dispatch: async (call, _ctx): Promise<ExecutedTool | null> => {
      const entry = byQualifiedName.get(call.name);
      if (!entry) return null;
      const args = isRecord(call.args) ? call.args : {};
      try {
        const result = await host.invoke({
          installationId: entry.installation.id,
          toolName: entry.tool.name,
          args,
        });
        return {
          name: call.name,
          resultText: JSON.stringify({
            output: truncate(result.output),
            exitCode: result.exitCode,
          }),
          isError: result.exitCode !== 0,
        };
      } catch (err) {
        return {
          name: call.name,
          resultText: JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
          isError: true,
        };
      }
    },
  };
}

/**
 * Stable, collision-free qualified name. Underscores in the plugin or tool
 * name are preserved (plugin manifests already enforce snake_case at install
 * time) so the round-trip is faithful.
 */
export function qualifyToolName(pluginName: string, toolName: string): string {
  return `${PLUGIN_TOOL_PREFIX}${pluginName}__${toolName}`;
}

function parametersToJsonSchemaProperties(
  parameters: Record<string, PluginToolParameter>,
): Record<string, { type: string; description?: string; enum?: string[] }> {
  const out: Record<string, { type: string; description?: string; enum?: string[] }> = {};
  for (const [key, value] of Object.entries(parameters)) {
    const prop: { type: string; description?: string; enum?: string[] } = { type: value.type };
    if (value.description !== undefined) prop.description = value.description;
    if (value.enum !== undefined) prop.enum = value.enum;
    out[key] = prop;
  }
  return out;
}

function makeSandboxHandle(mode: PluginInstallation["manifest"]["sandbox"]): SandboxHandle {
  if (mode === "whitelist") {
    return {
      async runCommand(cmd, env) {
        return execNode(cmd, env);
      },
    };
  }
  // Strong sandbox plugin execution requires bundling Node into the sandbox
  // image. Until that lands, fail closed with a clear, actionable message
  // instead of pretending the call ran.
  return {
    async runCommand() {
      throw new Error(
        `Plugin sandbox mode "${mode}" is not yet supported for plugin invocations. ` +
          `Switch the plugin manifest to "whitelist" sandbox or wait for the docker/wsl plugin runner.`,
      );
    },
  };
}

/**
 * Execute the plugin's rendered command. Every plugin tool resolves to a
 * `node "<installPath>/tools/<name>.js" --k v ...` invocation (see
 * {@link renderCommand} in `@coding-agent/plugin-sdk`); we split the command
 * into argv and spawn `process.execPath` directly with `ELECTRON_RUN_AS_NODE=1`
 * so the same binary works in development (where execPath is Node) AND in a
 * packaged Electron build (where execPath is the Electron exe — without the
 * env var it would re-launch the whole app instead of running the script).
 * No shell expansion, no whitelist matching — the structural permission gate
 * already authorised the call.
 */
function execNode(
  cmd: string,
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const argv = parseArgv(cmd);
    if (argv.length === 0) {
      reject(new Error("plugin runtime: empty command"));
      return;
    }
    // Drop the leading `node` token if present — we use process.execPath.
    if (argv[0] === "node") argv.shift();
    const scriptPath = argv.shift();
    if (!scriptPath) {
      reject(new Error("plugin runtime: missing script path"));
      return;
    }
    // The plugin install path is recorded by the install gate and trusted at
    // dispatch time. We still resolve to an absolute path so a malformed
    // manifest can't break out of cwd resolution.
    const absolute = path.resolve(scriptPath);

    let stdout = "";
    let stderr = "";
    const child = spawn(process.execPath, [absolute, ...argv], {
      cwd: path.dirname(absolute),
      // Plugins run as full Node processes — declared permissions are
      // advisory once the script is executing. Scrub the parent
      // environment so a plugin can't read LLM API keys, Git/NPM tokens,
      // cloud credentials, etc., from `process.env`. The whitelisted
      // base preserves what a Node script needs to find its
      // interpreter / temp dir / user home; the caller-supplied `env`
      // (rendered by plugin-sdk from approved permissions) wins on top.
      // ELECTRON_RUN_AS_NODE is appended LAST and is host-controlled — a
      // plugin must never be able to unset it, or a packaged build would
      // re-launch the whole Electron app instead of running the script.
      env: {
        ...scrubPluginEnv(process.env),
        ...(env ?? {}),
        ELECTRON_RUN_AS_NODE: "1",
      },
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, PLUGIN_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < PLUGIN_OUTPUT_CAP) stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < PLUGIN_OUTPUT_CAP) stderr += chunk.toString("utf-8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

/**
 * Minimal POSIX-ish argv splitter. The plugin renderCommand uses
 * double-quoted arguments with backslash escapes — we walk the string and
 * unquote them. Not a general shell parser; intentionally narrow.
 */
function parseArgv(cmd: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < cmd.length) {
    while (i < cmd.length && cmd[i] === " ") i += 1;
    if (i >= cmd.length) break;
    if (cmd[i] === '"') {
      i += 1;
      let buf = "";
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === "\\" && i + 1 < cmd.length) {
          i += 1;
          buf += cmd[i];
        } else {
          buf += cmd[i];
        }
        i += 1;
      }
      i += 1; // closing quote
      out.push(buf);
    } else {
      let buf = "";
      while (i < cmd.length && cmd[i] !== " ") {
        buf += cmd[i];
        i += 1;
      }
      out.push(buf);
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A plugin tool counts as mutating when it asks for either of the two
 * permissions that can change workspace state — `run_command` (shell
 * execution) or `write_workspace` (file writes). Network or read-only
 * permissions don't count.
 */
function declaresMutatingPermission(tool: PluginToolManifest): boolean {
  for (const perm of tool.permissions) {
    if (perm === "run_command" || perm === "write_workspace") return true;
  }
  return false;
}

/**
 * Variables that must NEVER leak into a plugin's process environment.
 * Plugin scripts run as full Node processes with all the power that
 * implies; the declared-permissions model only constrains the host-side
 * SDK helpers. We drop:
 *
 * - LLM provider credentials (every provider's typical env key).
 * - Source-control / package-registry tokens (Git, GitHub, npm).
 * - Cloud credentials (AWS, GCP, Azure).
 * - Database / queue URLs that contain credentials in the string.
 * - Anything whose name looks like a key / token / secret / password.
 *
 * Plus a structural rule: drop every key starting with `npm_config_` —
 * pnpm/yarn/npm CLIs project the full registry credential set into that
 * namespace.
 */
const PLUGIN_ENV_DENY_NAMES = new Set([
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "OPENROUTER_API_KEY",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "HUGGINGFACE_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITLAB_TOKEN",
  "NPM_TOKEN",
  "NPMRC",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AZURE_CLIENT_SECRET",
  "GCP_SERVICE_ACCOUNT_KEY",
  "DATABASE_URL",
  "REDIS_URL",
  "MONGODB_URI",
]);
const PLUGIN_ENV_DENY_REGEX = /(?:^|_)(api[_-]?key|token|secret|password|passwd|credential)s?(?:$|_)/i;

function scrubPluginEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (PLUGIN_ENV_DENY_NAMES.has(key)) continue;
    if (key.startsWith("npm_config_")) continue;
    if (PLUGIN_ENV_DENY_REGEX.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function truncate(text: string): string {
  return text.length > PLUGIN_OUTPUT_CAP
    ? `${text.slice(0, PLUGIN_OUTPUT_CAP)}…(truncated)`
    : text;
}
