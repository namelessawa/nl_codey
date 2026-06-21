import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateBuildPreferenceDataset,
  validateContinueAgentTask,
  validateContributeGlobalPattern,
  validateCreateFinetuneJob,
  validateCreateMemory,
  validateDeleteGlobalPattern,
  validateDeleteMemory,
  validateGetStyleSpec,
  validateInstallPlugin,
  validateListEvalRuns,
  validateListFrozenSnapshots,
  validateListMemory,
  validatePluginId,
  validatePromoteModel,
  validateProposalId,
  validateReadFile,
  validateRecordFeedbackSignal,
  validateRegisterWorkerNode,
  validateRunAgentTask,
  validateRunCommand,
  validateRunId,
  validateSetPluginEnabled,
  validateSetSandboxMode,
  validateSetWorkspaceContribution,
  validateSnoozeProposal,
  validateUpdateMemory,
  validateUpdatePhase4Settings,
  validateUpsertStyleSpec,
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

  describe("Phase 4 validators", () => {
    describe("validateContributeGlobalPattern", () => {
      const base = {
        title: "t",
        description: "d",
        exampleSnippet: "e",
        sourceProjects: ["ws-1"],
        tags: ["k"],
        confidence: 0.5,
        embedding: [0.1, 0.2],
      };
      it("accepts a well-formed payload", () => {
        const out = validateContributeGlobalPattern({ input: { ...base } });
        expect(out.input.confidence).toBe(0.5);
        expect(out.input.embedding).toEqual([0.1, 0.2]);
      });
      it("rejects confidence outside [0,1]", () => {
        expect(() =>
          validateContributeGlobalPattern({ input: { ...base, confidence: 1.5 } }),
        ).toThrow(/confidence must be in/);
      });
      it("rejects non-array embedding", () => {
        expect(() =>
          validateContributeGlobalPattern({ input: { ...base, embedding: "x" } }),
        ).toThrow(/embedding must be an array/);
      });
      it("rejects embedding with > 4096 dims", () => {
        expect(() =>
          validateContributeGlobalPattern({
            input: { ...base, embedding: new Array(5000).fill(0) },
          }),
        ).toThrow(/too many dimensions/);
      });
      it("rejects oversized title", () => {
        expect(() =>
          validateContributeGlobalPattern({ input: { ...base, title: "x".repeat(300) } }),
        ).toThrow(/title is too long/);
      });
    });

    describe("validateDeleteGlobalPattern / validateProposalId / validatePluginId / validatePromoteModel", () => {
      it("accepts a non-empty id", () => {
        expect(validateDeleteGlobalPattern({ id: "p1" })).toEqual({ id: "p1" });
        expect(validateProposalId({ id: "x" })).toEqual({ id: "x" });
        expect(validatePluginId({ id: "x" })).toEqual({ id: "x" });
        expect(validatePromoteModel({ modelId: "m-1" })).toEqual({ modelId: "m-1" });
      });
      it("rejects empty/missing id", () => {
        expect(() => validateDeleteGlobalPattern({ id: "" })).toThrow(/must not be empty/);
        expect(() => validatePromoteModel({})).toThrow(/modelId must be a string/);
      });
    });

    describe("validateSetWorkspaceContribution", () => {
      it("rejects unknown contribution mode", () => {
        expect(() =>
          validateSetWorkspaceContribution({ workspaceId: "w", mode: "public" }),
        ).toThrow(/mode must be one of/);
      });
      it("accepts known modes", () => {
        expect(
          validateSetWorkspaceContribution({ workspaceId: "w", mode: "isolated" }).mode,
        ).toBe("isolated");
        expect(
          validateSetWorkspaceContribution({ workspaceId: "w", mode: "contribute" }).mode,
        ).toBe("contribute");
      });
    });

    describe("validateGetStyleSpec", () => {
      it("accepts null workspaceId for global scope", () => {
        expect(validateGetStyleSpec({ scope: "global", workspaceId: null })).toEqual({
          scope: "global",
          workspaceId: null,
        });
      });
      it("rejects unknown scope", () => {
        expect(() =>
          validateGetStyleSpec({ scope: "personal", workspaceId: null }),
        ).toThrow(/scope must be one of/);
      });
    });

    describe("validateUpsertStyleSpec", () => {
      const okSpec = {
        scope: "project",
        workspaceId: "w-1",
        rules: [],
        derivedFrom: { codebaseStats: { files: 10 }, acceptedDiffs: 1, rejectedDiffs: 0 },
        version: 1,
        updatedAt: 0,
      };
      it("accepts an empty rules list", () => {
        const out = validateUpsertStyleSpec({ spec: okSpec });
        expect(out.spec.rules).toEqual([]);
      });
      it("rejects unknown rule.category", () => {
        const bad = {
          ...okSpec,
          rules: [
            {
              id: "r1",
              category: "alignment",
              rule: "x",
              examples: [],
              strength: "must",
              confidence: 1,
              signalCount: 0,
              source: "manual",
              createdAt: 0,
              updatedAt: 0,
            },
          ],
        };
        expect(() => validateUpsertStyleSpec({ spec: bad })).toThrow(
          /rules\[0\]\.category must be one of/,
        );
      });
    });

    describe("validateRecordFeedbackSignal", () => {
      const base = {
        workspaceId: "w",
        runId: "r",
        taskNodeId: null,
        kind: "diff_accepted",
        before: "x",
        after: null,
        reason: null,
        filePath: null,
      };
      it("accepts well-formed payload", () => {
        const out = validateRecordFeedbackSignal({ signal: base });
        expect(out.signal.kind).toBe("diff_accepted");
        expect(out.signal.taskNodeId).toBeNull();
      });
      it("rejects unknown kind", () => {
        expect(() =>
          validateRecordFeedbackSignal({ signal: { ...base, kind: "diff_loved" } }),
        ).toThrow(/kind must be one of/);
      });
      it("rejects oversized before/after", () => {
        expect(() =>
          validateRecordFeedbackSignal({ signal: { ...base, before: "x".repeat(300_000) } }),
        ).toThrow(/before is too long/);
      });
    });

    describe("validateBuildPreferenceDataset", () => {
      it("accepts workspaceId only", () => {
        expect(validateBuildPreferenceDataset({ workspaceId: "w" })).toEqual({
          workspaceId: "w",
        });
      });
      it("accepts optional name", () => {
        expect(
          validateBuildPreferenceDataset({ workspaceId: "w", name: "ds-1" }),
        ).toEqual({ workspaceId: "w", name: "ds-1" });
      });
    });

    describe("validateCreateFinetuneJob", () => {
      it("accepts known method", () => {
        const out = validateCreateFinetuneJob({
          input: { name: "j", baseModel: "b", datasetId: "d", method: "lora" },
        });
        expect(out.input.method).toBe("lora");
      });
      it("rejects unknown method", () => {
        expect(() =>
          validateCreateFinetuneJob({
            input: { name: "j", baseModel: "b", datasetId: "d", method: "rlhf" },
          }),
        ).toThrow(/method must be one of/);
      });
    });

    describe("validateSnoozeProposal", () => {
      it("requires untilTs", () => {
        expect(() => validateSnoozeProposal({ id: "p" })).toThrow(/untilTs/);
      });
      it("accepts id + untilTs", () => {
        expect(validateSnoozeProposal({ id: "p", untilTs: 123 })).toEqual({
          id: "p",
          untilTs: 123,
        });
      });
    });

    describe("validateRegisterWorkerNode", () => {
      const base = {
        id: "n",
        hostname: "h",
        endpoint: "https://worker.local:7000/api",
        status: "online",
        activeAssignments: [],
        capabilities: ["docker"],
        lastHeartbeat: 0,
      };
      it("accepts an https endpoint", () => {
        const out = validateRegisterWorkerNode({ node: base });
        expect(out.node.endpoint).toBe("https://worker.local:7000/api");
      });
      it("rejects file:// endpoints (no SSRF redirect surface)", () => {
        expect(() =>
          validateRegisterWorkerNode({ node: { ...base, endpoint: "file:///etc/passwd" } }),
        ).toThrow(/must use http\(s\)/);
      });
      it("rejects malformed URLs", () => {
        expect(() =>
          validateRegisterWorkerNode({ node: { ...base, endpoint: "not-a-url" } }),
        ).toThrow(/not a valid URL/);
      });
      it("rejects unknown status", () => {
        expect(() =>
          validateRegisterWorkerNode({ node: { ...base, status: "haunted" } }),
        ).toThrow(/status must be one of/);
      });
    });

    describe("validateSetPluginEnabled", () => {
      it("requires boolean enabled", () => {
        expect(() => validateSetPluginEnabled({ id: "x", enabled: 1 })).toThrow(
          /enabled must be a boolean/,
        );
      });
    });

    describe("validateListFrozenSnapshots / validateListEvalRuns", () => {
      it("tolerates undefined / null", () => {
        expect(validateListFrozenSnapshots(undefined)).toEqual({});
        expect(validateListFrozenSnapshots(null)).toEqual({});
        expect(validateListEvalRuns(undefined)).toEqual({});
      });
      it("passes through optional filters", () => {
        expect(validateListFrozenSnapshots({ modelId: "m" })).toEqual({ modelId: "m" });
        expect(validateListEvalRuns({ taskId: "t", modelId: "m" })).toEqual({
          taskId: "t",
          modelId: "m",
        });
      });
    });

    describe("validateUpdatePhase4Settings", () => {
      const baseSettings = {
        globalMemoryEnabled: false,
        styleProfileEnabled: true,
        learningEnabled: true,
        finetuneEnabled: false,
        distributedEnabled: false,
        proactiveEnabled: false,
        pluginsEnabled: false,
        contributionMode: "isolated",
        proactiveScanIntervalMin: 30,
      };
      it("rejects non-boolean feature flags", () => {
        expect(() =>
          validateUpdatePhase4Settings({
            settings: { ...baseSettings, globalMemoryEnabled: "yes" },
          }),
        ).toThrow(/globalMemoryEnabled must be a boolean/);
      });
      it("rejects out-of-range proactiveScanIntervalMin", () => {
        expect(() =>
          validateUpdatePhase4Settings({
            settings: { ...baseSettings, proactiveScanIntervalMin: 0 },
          }),
        ).toThrow(/proactiveScanIntervalMin must be in/);
        expect(() =>
          validateUpdatePhase4Settings({
            settings: { ...baseSettings, proactiveScanIntervalMin: 99999 },
          }),
        ).toThrow(/proactiveScanIntervalMin must be in/);
      });
      it("rejects non-integer proactiveScanIntervalMin", () => {
        expect(() =>
          validateUpdatePhase4Settings({
            settings: { ...baseSettings, proactiveScanIntervalMin: 3.5 },
          }),
        ).toThrow(/must be an integer/);
      });
      it("rejects unknown contributionMode", () => {
        expect(() =>
          validateUpdatePhase4Settings({
            settings: { ...baseSettings, contributionMode: "open_source" },
          }),
        ).toThrow(/contributionMode must be one of/);
      });
      it("accepts a well-formed payload", () => {
        const out = validateUpdatePhase4Settings({ settings: baseSettings });
        expect(out.settings.proactiveScanIntervalMin).toBe(30);
      });
    });
  });
});
