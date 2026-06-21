/**
 * Plugin host. When an agent invokes a plugin tool, the host:
 *   1. Re-validates that the plugin installation is enabled.
 *   2. Authorizes the requested permission against the approved set.
 *   3. Routes execution through the Phase 3 sandbox.
 *
 * Any failure at any step throws — there is no soft fallthrough.
 */
import type {
  PluginInstallation,
  PluginPermission,
} from "@nlc/shared";
import { authorize } from "./manifest-schema.js";

export type SandboxHandle = {
  /** Run a command in the plugin's declared sandbox mode. */
  runCommand(cmd: string, env?: Record<string, string>): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
};

export type ToolInvocation = {
  installationId: string;
  toolName: string;
  args: Record<string, unknown>;
};

export type InvocationResult = {
  output: string;
  exitCode: number;
};

export class PluginHost {
  constructor(
    private readonly installations: () => PluginInstallation[],
    private readonly sandbox: (mode: PluginInstallation["manifest"]["sandbox"]) => SandboxHandle,
  ) {}

  async invoke(call: ToolInvocation): Promise<InvocationResult> {
    const installation = this.installations().find((i) => i.id === call.installationId);
    if (!installation) {
      throw new Error(`Plugin installation ${call.installationId} not found`);
    }
    if (!installation.enabled) {
      throw new Error(`Plugin ${installation.manifest.name} is disabled`);
    }
    const toolDef = installation.manifest.tools.find((t) => t.name === call.toolName);
    if (!toolDef) {
      throw new Error(
        `Tool ${call.toolName} not declared in plugin ${installation.manifest.name}`,
      );
    }
    // Permission re-check: caller never bypasses this.
    for (const perm of toolDef.permissions) {
      const auth = authorize(perm, installation.approvedPermissions);
      if (!auth.allowed) {
        throw new Error(`Permission denied: ${auth.reason}`);
      }
    }
    const sandbox = this.sandbox(installation.manifest.sandbox);
    const command = renderCommand(toolDef.name, call.args, installation.installPath);
    const result = await sandbox.runCommand(command);
    return {
      output: result.stdout || result.stderr,
      exitCode: result.exitCode,
    };
  }
}

export function renderCommand(
  toolName: string,
  args: Record<string, unknown>,
  installPath: string,
): string {
  // Shell-safe rendering: every argument is wrapped in double quotes after
  // backslash + dollar + quote escaping. Plugin authors should still validate
  // their own inputs.
  const flags = Object.entries(args)
    .map(([key, value]) => `--${key} ${escapeShell(String(value))}`)
    .join(" ");
  return `node "${installPath}/tools/${toolName}.js" ${flags}`.trim();
}

function escapeShell(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

/** Helper: collect every required permission from a manifest. */
export function permissionsForTool(
  installation: PluginInstallation,
  toolName: string,
): PluginPermission[] {
  const tool = installation.manifest.tools.find((t) => t.name === toolName);
  return tool?.permissions ?? [];
}
