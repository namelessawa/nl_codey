import { describe, expect, it } from "vitest";
import type {
  PluginInstallation,
  PluginManifest,
  PluginPermission,
} from "@coding-agent/shared";
import { authorize, validateManifest } from "./manifest-schema.js";
import { PluginLoader, type PermissionPrompter, type PluginRepository } from "./plugin-loader.js";
import { PluginHost, renderCommand } from "./plugin-host.js";

const goodManifest: PluginManifest = {
  name: "deploy-tool",
  version: "1.0.0",
  description: "deploy preview env",
  tools: [
    {
      name: "deploy_preview",
      description: "deploy preview environment",
      parameters: { branch: { type: "string" } },
      permissions: ["run_command", "network:deploy.example.com"],
    },
  ],
  sandbox: "wsl",
};

describe("validateManifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = validateManifest(goodManifest);
    expect(result.ok).toBe(true);
  });

  it("rejects missing version", () => {
    const result = validateManifest({ ...goodManifest, version: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown sandbox", () => {
    const result = validateManifest({ ...goodManifest, sandbox: "vmwhatever" as never });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown permission", () => {
    const result = validateManifest({
      ...goodManifest,
      tools: [
        {
          ...goodManifest.tools[0]!,
          permissions: ["evil:thing" as unknown as PluginPermission],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects non-snake_case tool names", () => {
    const result = validateManifest({
      ...goodManifest,
      tools: [{ ...goodManifest.tools[0]!, name: "DeployPreview" }],
    });
    expect(result.ok).toBe(false);
  });

  // Regression: previously isKnownPermission did startsWith for every prefix,
  // so garbage strings starting with a real token slipped through validation
  // and persisted into installed manifests, even though the host's
  // exact-match authorize() would never grant them at runtime.
  it.each([
    "run_command_extra",
    "read_workspace_anything",
    "write_workspace_evil",
    "read_memory_dump",
  ])("rejects garbage permission that merely starts with a known token: %s", (perm) => {
    const result = validateManifest({
      ...goodManifest,
      tools: [
        {
          ...goodManifest.tools[0]!,
          permissions: [perm as unknown as PluginPermission],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects bare network: with no host suffix", () => {
    const result = validateManifest({
      ...goodManifest,
      tools: [
        {
          ...goodManifest.tools[0]!,
          permissions: ["network:" as unknown as PluginPermission],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts network:<host> with a real suffix", () => {
    const result = validateManifest({
      ...goodManifest,
      tools: [
        {
          ...goodManifest.tools[0]!,
          permissions: ["network:api.example.com" as PluginPermission],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });
});

describe("authorize", () => {
  it("allows exact permission match", () => {
    const result = authorize("run_command", ["run_command", "read_workspace"]);
    expect(result.allowed).toBe(true);
  });

  it("denies undeclared network host", () => {
    const result = authorize("network:evil.com", ["network:deploy.example.com"]);
    expect(result.allowed).toBe(false);
  });
});

function makeRepo() {
  const installs: PluginInstallation[] = [];
  let counter = 0;
  return {
    installs,
    installPlugin(manifest: PluginManifest, installPath: string, approved: PluginPermission[]) {
      const i: PluginInstallation = {
        id: `inst-${counter++}`,
        manifest,
        installPath,
        enabled: true,
        approvedPermissions: approved,
        installedAt: Date.now(),
      };
      installs.push(i);
      return i;
    },
    listPlugins: () => [...installs],
    setPluginEnabled(id: string, enabled: boolean) {
      const i = installs.find((x) => x.id === id);
      if (!i) return null;
      i.enabled = enabled;
      return { ...i };
    },
    uninstallPlugin(id: string) {
      const idx = installs.findIndex((x) => x.id === id);
      if (idx < 0) return false;
      installs.splice(idx, 1);
      return true;
    },
  } satisfies PluginRepository & { installs: PluginInstallation[] };
}

describe("PluginLoader", () => {
  it("installs and approves only the permissions user ticks", async () => {
    const repo = makeRepo();
    const prompter: PermissionPrompter = {
      ask: async () => ["run_command"],
    };
    const loader = new PluginLoader(repo, prompter);
    const result = await loader.install(goodManifest, "/tmp/plugin");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.installation.approvedPermissions).toEqual(["run_command"]);
    }
  });

  it("declines installation when invalid manifest", async () => {
    const repo = makeRepo();
    const prompter: PermissionPrompter = { ask: async () => [] };
    const loader = new PluginLoader(repo, prompter);
    const result = await loader.install({ name: "" }, "/tmp/plugin");
    expect(result.ok).toBe(false);
  });

  // P1.3 regression: the IPC handler passes the renderer's per-checkbox
  // selection as preApprovedPermissions; the loader must honor it without
  // routing through the prompter.
  it("honors preApprovedPermissions and skips the prompter", async () => {
    const repo = makeRepo();
    let prompted = false;
    const prompter: PermissionPrompter = {
      ask: async () => {
        prompted = true;
        return [];
      },
    };
    const loader = new PluginLoader(repo, prompter);
    const result = await loader.install(goodManifest, "/tmp/plugin", ["run_command"]);
    expect(prompted).toBe(false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.installation.approvedPermissions).toEqual(["run_command"]);
    }
  });

  it("filters preApprovedPermissions to the manifest's requested set", async () => {
    const repo = makeRepo();
    const prompter: PermissionPrompter = { ask: async () => [] };
    const loader = new PluginLoader(repo, prompter);
    // network:other.com isn't in goodManifest.tools[0].permissions, so it
    // must be filtered out even if a buggy renderer ships it.
    const result = await loader.install(goodManifest, "/tmp/plugin", [
      "run_command",
      "network:other.com" as PluginPermission,
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.installation.approvedPermissions).toEqual(["run_command"]);
    }
  });

  it("declines when preApprovedPermissions intersection is empty", async () => {
    const repo = makeRepo();
    const prompter: PermissionPrompter = { ask: async () => [] };
    const loader = new PluginLoader(repo, prompter);
    const result = await loader.install(goodManifest, "/tmp/plugin", [
      "network:other.com" as PluginPermission,
    ]);
    expect(result.ok).toBe(false);
  });
});

describe("PluginHost", () => {
  it("rejects invocation of undeclared permission", async () => {
    const installation: PluginInstallation = {
      id: "inst-1",
      manifest: goodManifest,
      installPath: "/tmp/x",
      enabled: true,
      approvedPermissions: ["run_command"], // missing network:deploy
      installedAt: 0,
    };
    const host = new PluginHost(
      () => [installation],
      () => ({
        runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      }),
    );
    await expect(
      host.invoke({
        installationId: "inst-1",
        toolName: "deploy_preview",
        args: { branch: "main" },
      }),
    ).rejects.toThrow(/Permission denied/);
  });

  it("dispatches an authorized invocation", async () => {
    const installation: PluginInstallation = {
      id: "inst-1",
      manifest: goodManifest,
      installPath: "/tmp/x",
      enabled: true,
      approvedPermissions: ["run_command", "network:deploy.example.com"],
      installedAt: 0,
    };
    let calls = 0;
    const host = new PluginHost(
      () => [installation],
      () => ({
        runCommand: async () => {
          calls++;
          return { stdout: "deployed", stderr: "", exitCode: 0 };
        },
      }),
    );
    const result = await host.invoke({
      installationId: "inst-1",
      toolName: "deploy_preview",
      args: { branch: "main" },
    });
    expect(result.output).toBe("deployed");
    expect(calls).toBe(1);
  });

  it("rejects disabled plugin", async () => {
    const installation: PluginInstallation = {
      id: "inst-1",
      manifest: goodManifest,
      installPath: "/tmp/x",
      enabled: false,
      approvedPermissions: ["run_command", "network:deploy.example.com"],
      installedAt: 0,
    };
    const host = new PluginHost(
      () => [installation],
      () => ({ runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }) }),
    );
    await expect(
      host.invoke({
        installationId: "inst-1",
        toolName: "deploy_preview",
        args: {},
      }),
    ).rejects.toThrow(/disabled/);
  });
});

describe("renderCommand", () => {
  it("shell-escapes arg values so injection token closes inside the quoted arg", () => {
    const cmd = renderCommand("x", { branch: 'main"; rm -rf /' }, "/p");
    // The injected `"` must appear escaped, not as a bare delimiter.
    expect(cmd).toContain('\\"');
    // The whole malicious payload is INSIDE a quoted, escaped string —
    // shell sees one argument, not a chained command.
    // We assert the leading `"` of the arg is opened, the escaped `\"` is
    // present, and the closing `"` wraps the whole literal.
    expect(cmd).toMatch(/--branch "main\\".*\/"$/);
  });
});
