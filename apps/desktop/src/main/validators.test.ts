import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateContinueAgentTask,
  validateCreateMemory,
  validateDeleteMemory,
  validateInstallPlugin,
  validateListMemory,
  validateReadFile,
  validateRunAgentTask,
  validateRunCommand,
  validateRunId,
  validateSetSandboxMode,
  validateUpdateMemory,
  validateWorkspaceId,
} from "./validators.js";

describe("IPC validators reject malformed payloads", () => {
  describe("validateRunId", () => {
    it("accepts a well-formed payload", () => {
      expect(validateRunId({ runId: "abc-123" })).toEqual({ runId: "abc-123" });
    });
    it("rejects non-objects", () => {
      expect(() => validateRunId(null)).toThrow(/must be an object/);
      expect(() => validateRunId("abc")).toThrow(/must be an object/);
      expect(() => validateRunId([1, 2])).toThrow(/must be an object/);
    });
    it("rejects missing or empty runId", () => {
      expect(() => validateRunId({})).toThrow(/runId must be a string/);
      expect(() => validateRunId({ runId: "" })).toThrow(/runId must not be empty/);
      expect(() => validateRunId({ runId: 42 })).toThrow(/runId must be a string/);
    });
  });

  describe("validateWorkspaceId", () => {
    it("rejects empty/missing workspaceId", () => {
      expect(() => validateWorkspaceId({})).toThrow(/workspaceId must be a string/);
      expect(() => validateWorkspaceId({ workspaceId: "" })).toThrow(/must not be empty/);
    });
  });

  describe("validateRunCommand", () => {
    it("rejects missing command", () => {
      expect(() => validateRunCommand({ workspaceId: "w1" })).toThrow(/command must be a string/);
    });
    it("rejects empty command", () => {
      expect(() => validateRunCommand({ workspaceId: "w1", command: "" })).toThrow(/must not be empty/);
    });
  });

  describe("validateReadFile", () => {
    it("requires a non-empty path", () => {
      expect(() => validateReadFile({ workspaceId: "w1" })).toThrow(/path must be a string/);
      expect(() => validateReadFile({ workspaceId: "w1", path: "" })).toThrow(/must not be empty/);
    });
  });

  describe("validateRunAgentTask / validateContinueAgentTask", () => {
    it("require non-empty workspaceId/runId", () => {
      expect(() => validateRunAgentTask({ task: "x" })).toThrow(/workspaceId must be a string/);
      expect(() => validateContinueAgentTask({ followUp: "x" })).toThrow(/runId must be a string/);
    });
    it("accept empty task / followUp strings (intentional — empty turns are valid)", () => {
      expect(validateRunAgentTask({ workspaceId: "w", task: "" })).toEqual({
        workspaceId: "w",
        task: "",
      });
      expect(validateContinueAgentTask({ runId: "r", followUp: "" })).toEqual({
        runId: "r",
        followUp: "",
      });
    });
  });

  describe("validateSetSandboxMode", () => {
    it("rejects unknown modes", () => {
      expect(() =>
        validateSetSandboxMode({ workspaceId: "w", mode: "bare-metal" }),
      ).toThrow(/mode must be one of/);
    });
    it("accepts whitelist / wsl / docker", () => {
      for (const mode of ["whitelist", "wsl", "docker"] as const) {
        expect(validateSetSandboxMode({ workspaceId: "w", mode }).mode).toBe(mode);
      }
    });
  });

  describe("validateListMemory", () => {
    it("optional filter is well-shaped or absent", () => {
      expect(validateListMemory({ workspaceId: "w" }).filter).toBeUndefined();
      expect(
        validateListMemory({ workspaceId: "w", filter: { kind: "fact", tags: ["a"] } }).filter,
      ).toEqual({ kind: "fact", tags: ["a"] });
    });
    it("rejects unknown memory kind", () => {
      expect(() =>
        validateListMemory({ workspaceId: "w", filter: { kind: "rumor" } }),
      ).toThrow(/filter.kind must be one of/);
    });
  });

  describe("validateCreateMemory / validateUpdateMemory / validateDeleteMemory", () => {
    it("createMemory requires kind/title/body", () => {
      expect(() =>
        validateCreateMemory({ workspaceId: "w", entry: { kind: "fact", title: "t" } }),
      ).toThrow(/entry.body must be a string/);
      expect(() =>
        validateCreateMemory({
          workspaceId: "w",
          entry: { kind: "fact", title: "", body: "b" },
        }),
      ).toThrow(/entry.title must not be empty/);
    });
    it("updateMemory accepts a partial patch", () => {
      const out = validateUpdateMemory({ id: "m1", patch: { title: "new" } });
      expect(out).toEqual({ id: "m1", patch: { title: "new" } });
    });
    it("deleteMemory requires id", () => {
      expect(() => validateDeleteMemory({})).toThrow(/id must be a string/);
    });
  });

  describe("validateInstallPlugin", () => {
    const baseArgs = {
      manifest: { name: "demo", version: "1.0.0" },
      installPath: "/plugins/demo",
      approvedPermissions: ["read_workspace"],
    };

    it("accepts a well-formed payload with known permissions", () => {
      const out = validateInstallPlugin(baseArgs);
      // The validator normalises the path so separators match the host OS
      // (forward slash on POSIX, backslash on Windows). Use path.normalize
      // for the expectation so the assertion is platform-correct.
      expect(out.installPath).toBe(path.normalize("/plugins/demo"));
      expect(out.approvedPermissions).toEqual(["read_workspace"]);
    });

    it("rejects a relative installPath", () => {
      expect(() =>
        validateInstallPlugin({ ...baseArgs, installPath: "plugins/demo" }),
      ).toThrow(/installPath must be an absolute path/);
    });

    it("accepts network:domain permissions (template literal type)", () => {
      const out = validateInstallPlugin({
        ...baseArgs,
        approvedPermissions: ["read_workspace", "network:api.example.com"],
      });
      expect(out.approvedPermissions).toContain("network:api.example.com");
    });

    it("rejects unknown permissions", () => {
      expect(() =>
        validateInstallPlugin({ ...baseArgs, approvedPermissions: ["root_shell"] }),
      ).toThrow(/unknown permission/);
    });

    it("rejects missing manifest fields", () => {
      expect(() =>
        validateInstallPlugin({ ...baseArgs, manifest: { version: "1.0.0" } }),
      ).toThrow(/manifest.name must be a string/);
      expect(() =>
        validateInstallPlugin({ ...baseArgs, manifest: { name: "x" } }),
      ).toThrow(/manifest.version must be a string/);
    });

    it("rejects missing installPath", () => {
      expect(() =>
        validateInstallPlugin({
          manifest: { name: "x", version: "1.0.0" },
          approvedPermissions: [],
        }),
      ).toThrow(/installPath must be a string/);
    });
  });
});
