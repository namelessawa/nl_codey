/**
 * Plugin runtime wiring. Builds the dynamic ToolSchema list + dispatcher that
 * the agent's tool loop consumes for plugin tools, and routes invocations
 * through {@link PluginHost} (which re-validates enablement and permissions).
 *
 * Plugin tools are advertised to the model under the namespaced name
 * `plugin__<pluginName>__<toolName>`. The namespace prevents collisions with
 * built-in tools and makes provenance obvious in the run trace.
 *
 * Execution is Docker-only and default-off. The real workspace is copied into
 * bounded staging, the plugin directory is mounted read-only, and no host-user
 * Node fallback exists. Staged changes return as a proposed patch; only the
 * normal apply_patch approval path can write them into the real workspace.
 */

import path from "node:path";
import type {
  LLMToolCall,
  PluginInstallation,
  PluginToolManifest,
  PluginToolParameter,
  ToolContext,
  ToolSchema,
} from "@nlc/shared";
import { PluginHost, type SandboxHandle } from "@nlc/plugin-sdk";
import { RestrictedPluginRunner } from "@nlc/sandbox";
import type { ExecutedTool } from "@nlc/agent-core";
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
  const flags = services.advancedSettings.get();
  if (!flags.pluginsEnabled) return null;

  const installations = services.storage.plugins
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
        description:
          `[plugin: ${installation.manifest.name}] ${tool.description} ` +
          "Runs in a no-network restricted container. Workspace writes are staged " +
          "and returned as proposedPatch; call apply_patch to request host writeback.",
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

  const restrictedRunner = new RestrictedPluginRunner();

  return {
    schemas,
    mutatingNames,
    dispatch: async (call, ctx): Promise<ExecutedTool | null> => {
      const entry = byQualifiedName.get(call.name);
      if (!entry) return null;
      const args = isRecord(call.args) ? call.args : {};
      try {
        const host = new PluginHost(
          () => services.storage.plugins.listPlugins(),
          (mode) => makeSandboxHandle(mode, ctx, restrictedRunner),
        );
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
            ...(result.proposedPatch ? { proposedPatch: result.proposedPatch } : {}),
            ...(result.binaryConflicts
              ? { binaryConflicts: result.binaryConflicts }
              : {}),
            ...(result.applied === false ? { applied: false } : {}),
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

function makeSandboxHandle(
  mode: PluginInstallation["manifest"]["sandbox"],
  ctx: ToolContext,
  runner: RestrictedPluginRunner,
): SandboxHandle {
  if (mode !== "docker") {
    return {
      async runCommand() {
        throw new Error(
          `Plugin sandbox mode "${mode}" is disabled: host-user Node and WSL ` +
            "plugin execution are not production-safe. Reinstall the plugin with " +
            'manifest sandbox "docker"; plugins are default-off when Docker is unavailable.',
        );
      },
    };
  }
  return {
    async runCommand(command) {
      const invocation = parsePluginCommand(command);
      const result = await runner.run({
        pluginRoot: invocation.pluginRoot,
        toolName: invocation.toolName,
        args: invocation.args,
        workspaceRoot: ctx.workspaceRoot,
        runId: ctx.runId,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        timeoutMs: PLUGIN_TIMEOUT_MS,
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        proposedPatch: result.proposedPatch,
        binaryConflicts: result.binaryConflicts.map((change) => change.path),
        applied: false,
      };
    },
  };
}

function parsePluginCommand(command: string): {
  pluginRoot: string;
  toolName: string;
  args: string[];
} {
  const argv = parseArgv(command);
  if (argv[0] === "node") argv.shift();
  const script = argv.shift();
  if (!script) throw new Error("plugin runtime: missing tool script");
  const absolute = path.resolve(script);
  const toolsRoot = path.dirname(absolute);
  if (path.basename(toolsRoot).toLowerCase() !== "tools") {
    throw new Error("plugin runtime: tool script must be inside the plugin tools directory");
  }
  const extension = path.extname(absolute).toLowerCase();
  const toolName = path.basename(absolute, extension);
  if (extension !== ".js" || !/^[a-z][a-z0-9_]*$/.test(toolName)) {
    throw new Error("plugin runtime: invalid tool script name");
  }
  return {
    pluginRoot: path.dirname(toolsRoot),
    toolName,
    args: argv,
  };
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

function truncate(text: string): string {
  return text.length > PLUGIN_OUTPUT_CAP
    ? `${text.slice(0, PLUGIN_OUTPUT_CAP)}…(truncated)`
    : text;
}
