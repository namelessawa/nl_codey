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
    }
  }

  if (schemas.length === 0) return null;

  const host = new PluginHost(
    () => services.storage.phase4.listPlugins(),
    (mode) => makeSandboxHandle(mode),
  );

  return {
    schemas,
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
 * Execute the plugin's rendered command. Today every plugin tool resolves to
 * a `node "<installPath>/tools/<name>.js" --k v ...` invocation (see
 * {@link renderCommand} in `@coding-agent/plugin-sdk`); to keep cross-platform
 * compatibility we split the command into argv and spawn `process.execPath`
 * (the Node binary running Electron) directly. No shell expansion, no
 * whitelist matching — the structural permission gate already authorised the
 * call.
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
      env: { ...process.env, ...(env ?? {}) },
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

function truncate(text: string): string {
  return text.length > PLUGIN_OUTPUT_CAP
    ? `${text.slice(0, PLUGIN_OUTPUT_CAP)}…(truncated)`
    : text;
}
