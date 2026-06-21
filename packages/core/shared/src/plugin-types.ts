/** Plugin SDK types: manifests, tools, permissions, installations. */

export type PluginPermission =
  | "run_command"
  | "read_workspace"
  | "write_workspace"
  | "read_memory"
  | `network:${string}`;

export type PluginToolParameter = {
  type: "string" | "number" | "boolean";
  description?: string;
  enum?: string[];
};

export type PluginToolManifest = {
  name: string;
  description: string;
  parameters: Record<string, PluginToolParameter>;
  permissions: PluginPermission[];
};

export type PluginManifest = {
  name: string;
  version: string;
  description?: string;
  author?: string;
  tools: PluginToolManifest[];
  sandbox: "whitelist" | "wsl" | "docker";
};

export type PluginInstallation = {
  id: string;
  manifest: PluginManifest;
  /** Absolute path to plugin folder. */
  installPath: string;
  enabled: boolean;
  /** Permissions the user has explicitly approved. */
  approvedPermissions: PluginPermission[];
  installedAt: number;
};
