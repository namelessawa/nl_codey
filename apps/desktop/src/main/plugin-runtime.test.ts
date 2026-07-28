import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginInstallation } from "@nlc/shared";
import type { Services } from "./services.js";

const { restrictedRun } = vi.hoisted(() => ({
  restrictedRun: vi.fn(),
}));

vi.mock("@nlc/sandbox", () => ({
  RestrictedPluginRunner: class {
    run = restrictedRun;
  },
}));

import { buildPluginBundle } from "./plugin-runtime.js";

beforeEach(() => {
  restrictedRun.mockReset();
});

describe("Desktop restricted plugin runtime", () => {
  it("fails closed for legacy whitelist manifests without starting a runner", async () => {
    const bundle = buildPluginBundle(servicesWith(plugin("whitelist")));
    expect(bundle).not.toBeNull();

    const result = await bundle!.dispatch(
      { id: "call-1", name: "plugin__demo__inspect", args: {} },
      { workspaceRoot: "C:\\workspace", runId: "run-1" },
    );

    expect(result?.isError).toBe(true);
    expect(result?.resultText).toContain("host-user Node");
    expect(restrictedRun).not.toHaveBeenCalled();
  });

  it("returns staged Docker changes as an unapplied proposed patch", async () => {
    restrictedRun.mockResolvedValue({
      stdout: "inspected",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      changes: [{ kind: "added", path: "proposal.txt", content: "safe\n" }],
      binaryConflicts: [],
      proposedPatch: "--- /dev/null\n+++ b/proposal.txt\n",
      applied: false,
    });
    const bundle = buildPluginBundle(servicesWith(plugin("docker")));

    const result = await bundle!.dispatch(
      { id: "call-1", name: "plugin__demo__inspect", args: { value: "hello" } },
      { workspaceRoot: "C:\\workspace", runId: "run-1" },
    );
    const body = JSON.parse(result!.resultText) as Record<string, unknown>;

    expect(result?.isError).toBe(false);
    expect(body.proposedPatch).toContain("proposal.txt");
    expect(body.applied).toBe(false);
    expect(restrictedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginRoot: expect.stringContaining("demo"),
        toolName: "inspect",
        workspaceRoot: "C:\\workspace",
        runId: "run-1",
      }),
    );
    expect(bundle!.schemas[0]?.description).toContain("call apply_patch");
  });
});

function plugin(sandbox: PluginInstallation["manifest"]["sandbox"]): PluginInstallation {
  return {
    id: "plugin-1",
    installPath: "C:\\plugins\\demo",
    enabled: true,
    approvedPermissions: ["run_command", "write_workspace"],
    installedAt: 1,
    manifest: {
      name: "demo",
      version: "1.0.0",
      sandbox,
      tools: [
        {
          name: "inspect",
          description: "inspect workspace",
          parameters: { value: { type: "string" } },
          permissions: ["run_command", "write_workspace"],
        },
      ],
    },
  };
}

function servicesWith(installation: PluginInstallation): Services {
  return {
    advancedSettings: { get: () => ({ pluginsEnabled: true }) },
    storage: {
      plugins: {
        listPlugins: () => [installation],
      },
    },
  } as unknown as Services;
}
