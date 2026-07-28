import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FileSnapshot, LLMToolCall } from "@nlc/shared";
import {
  AGENT_TOOL_SCHEMAS,
  FILE_MUTATING_TOOLS,
  agentToolSchemas,
  createToolExecutor,
} from "./tools-registry.js";
import {
  AgentMutationAuthorizer,
  authorizeMutation,
  type MutationControl,
} from "./mutation-policy.js";

const noopStorage = {
  addSnapshot(): FileSnapshot {
    return { id: "x", runId: "r", filePath: "f", beforeContent: "", createdAt: 0 };
  },
  setSnapshotAfter(): void {},
};

const denyMutation = () =>
  ({ allowed: false, reason: "test did not grant mutation capability" }) as const;

function executor(allowShellExecution: boolean) {
  return createToolExecutor({
    ctx: { workspaceRoot: process.cwd(), runId: "test-run" },
    storage: noopStorage,
    allowShellExecution,
    authorizeMutation: denyMutation,
  });
}

function call(name: string, args: unknown): LLMToolCall {
  return { id: "c1", name, args };
}

describe("AGENT_TOOL_SCHEMAS", () => {
  it("exposes the core tool names", () => {
    expect(AGENT_TOOL_SCHEMAS.map((t) => t.name)).toEqual([
      "list_files",
      "read_file",
      "search_text",
      "apply_patch",
      "run_command",
      "read_file_range",
      "find_symbol",
      "git_status",
      "git_diff",
      "record_plan",
    ]);
  });
});

describe("agentToolSchemas read-only mode", () => {
  it("returns the full schema list when not read-only", () => {
    expect(agentToolSchemas()).toEqual(AGENT_TOOL_SCHEMAS);
    expect(agentToolSchemas({ readOnly: false })).toEqual(AGENT_TOOL_SCHEMAS);
  });

  it("strips every file-mutating tool when read-only", () => {
    const names = agentToolSchemas({ readOnly: true }).map((t) => t.name);
    for (const mutating of FILE_MUTATING_TOOLS) {
      expect(names).not.toContain(mutating);
    }
    // apply_patch is the mutating tool actually present in the base list.
    expect(names).not.toContain("apply_patch");
    // Read-only tools are untouched.
    expect(names).toContain("read_file");
    expect(names).toContain("search_text");
    expect(names).toContain("find_symbol");
  });
});

describe("createToolExecutor read-only guard", () => {
  function readOnlyExecutor() {
    return createToolExecutor({
      ctx: { workspaceRoot: process.cwd(), runId: "test-run" },
      storage: noopStorage,
      allowShellExecution: true,
      readOnly: true,
      authorizeMutation: denyMutation,
    });
  }

  it("refuses apply_patch before writing any snapshot", async () => {
    const res = await readOnlyExecutor()(
      call("apply_patch", { patch: "*** Begin Patch\n*** End Patch" }),
    );
    expect(res.isError).toBe(true);
    expect(res.resultText).toContain("read-only");
    // The guard fires before the apply_patch branch — no patch metadata leaks.
    expect(res.patch).toBeUndefined();
    expect(res.changedFiles).toBeUndefined();
  });

  it("still allows read-only tools through", async () => {
    const res = await readOnlyExecutor()(
      call("read_file_range", { path: "package.json", startLine: 1, endLine: 5 }),
    );
    expect(res.isError).toBe(false);
  });
});

describe("createToolExecutor guards", () => {
  it("returns an error for an unknown tool without throwing", async () => {
    const res = await executor(true)(call("nope", {}));
    expect(res.isError).toBe(true);
    expect(res.resultText).toContain("Unknown tool");
  });

  it("requires the path argument for read_file", async () => {
    const res = await executor(true)(call("read_file", {}));
    expect(res.isError).toBe(true);
    expect(res.resultText).toContain("path");
  });

  it("refuses run_command when shell execution is disabled", async () => {
    const res = await executor(false)(call("run_command", { command: "pnpm test" }));
    expect(res.isError).toBe(true);
    expect(res.resultText).toContain("disabled");
  });

  it("runs find_symbol and returns a symbols payload", async () => {
    const res = await executor(true)(call("find_symbol", { path: "src/symbols.ts", name: "extractSymbols" }));
    expect(res.isError).toBe(false);
    const parsed = JSON.parse(res.resultText) as { symbols: Array<{ name: string }> };
    expect(Array.isArray(parsed.symbols)).toBe(true);
  });
});

describe("createToolExecutor assertToolAllowed gate", () => {
  // The installation gate is consulted BEFORE the dispatcher's switch. A
  // throwing gate must produce a structured error result rather than
  // crashing the executor — that's the loop's contract.
  function withGate(blockedTools: Set<string>) {
    return createToolExecutor({
      ctx: { workspaceRoot: process.cwd(), runId: "test-run" },
      storage: noopStorage,
      allowShellExecution: true,
      authorizeMutation: denyMutation,
      assertToolAllowed: (toolName: string) => {
        if (blockedTools.has(toolName)) {
          throw new Error(`Tool "${toolName}" is disabled in degraded mode`);
        }
      },
    });
  }

  it("blocks run_command before the dispatcher runs the host command", async () => {
    const exec = withGate(new Set(["run_command"]));
    const res = await exec(call("run_command", { command: "pnpm test" }));
    expect(res.isError).toBe(true);
    expect(res.resultText).toContain("degraded mode");
    // The gate fires before the run_command branch, so no command output
    // should be attached to the result.
    expect(res.command).toBeUndefined();
  });

  it("blocks apply_patch before the dispatcher writes any snapshot", async () => {
    const exec = withGate(new Set(["apply_patch"]));
    const res = await exec(call("apply_patch", { patch: "*** Begin Patch\n*** End Patch" }));
    expect(res.isError).toBe(true);
    expect(res.resultText).toContain("degraded mode");
    expect(res.patch).toBeUndefined();
    expect(res.changedFiles).toBeUndefined();
  });

  it("lets safe read-only tools through when the gate allows them", async () => {
    // Only block unsafe tools; read_file_range should still work normally.
    const exec = withGate(new Set(["run_command", "apply_patch"]));
    const res = await exec(
      call("read_file_range", { path: "package.json", startLine: 1, endLine: 5 }),
    );
    expect(res.isError).toBe(false);
  });
});

describe("unified mutation authorization", () => {
  it("classifies built-in and dynamic mutations and consumes approval once", () => {
    const policy = new AgentMutationAuthorizer({
      dynamicMutatingNames: ["plugin__demo__write"],
      requireCommandConfirmation: true,
    });
    const patch = call("apply_patch", {});
    const memory = call("write_memory", {});
    const dynamic = call("plugin__demo__write", {});

    expect(policy.requiresApproval(patch)).toBe(true);
    expect(policy.requiresApproval(memory)).toBe(true);
    expect(policy.requiresApproval(dynamic)).toBe(true);
    expect(policy.authorize(patch).allowed).toBe(false);

    policy.grant(patch);
    expect(policy.authorize(patch).allowed).toBe(true);
    expect(policy.authorize(patch).allowed).toBe(false);
  });

  it("treats the explicit shell setting as a capability grant only when confirmation is off", () => {
    const confirmed = new AgentMutationAuthorizer({
      requireCommandConfirmation: true,
    });
    const delegated = new AgentMutationAuthorizer({
      requireCommandConfirmation: false,
    });
    const command = call("run_command", { command: "pnpm test" });

    expect(confirmed.requiresApproval(command)).toBe(true);
    expect(confirmed.authorize(command).allowed).toBe(false);
    expect(delegated.requiresApproval(command)).toBe(false);
    expect(delegated.authorize(command).allowed).toBe(true);
  });

  it.each<MutationControl>([
    "per_call_approval",
    "sandbox_writeback_approval",
    "explicit_user_action",
    "explicit_modal_confirmation",
    "capability_grant",
    "feature_flag",
    "trusted_recovery",
  ])("denies %s without an audit record", (control) => {
    expect(
      authorizeMutation(control, {
        approved: true,
        explicitUserAction: true,
        capabilityGranted: true,
        featureEnabled: true,
        trustedRuntime: true,
      }).allowed,
    ).toBe(false);
  });

  it("applies denial/allow proofs to every machine-inventoried mutation path", () => {
    const inventoryPath = path.resolve(
      process.cwd(),
      "docs/security/mutation-inventory.json",
    );
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8")) as {
      entries: Array<{
        id: string;
        control: MutationControl;
        source: string[];
        denialEvidence: string;
        approvalEvidence: string | null;
      }>;
    };
    const ids = new Set<string>();
    const fullProof = {
      approved: true,
      explicitUserAction: true,
      capabilityGranted: true,
      featureEnabled: true,
      trustedRuntime: true,
      auditRecorded: true,
    };

    expect(inventory.entries.length).toBeGreaterThanOrEqual(30);
    for (const item of inventory.entries) {
      expect(ids.has(item.id), item.id).toBe(false);
      ids.add(item.id);
      expect(
        authorizeMutation(item.control, {
          ...fullProof,
          auditRecorded: false,
        }).allowed,
        `${item.id} must deny without audit`,
      ).toBe(false);
      expect(fs.existsSync(evidenceFile(item.denialEvidence)), item.id).toBe(true);
      for (const source of item.source) {
        expect(fs.existsSync(path.resolve(process.cwd(), source)), item.id).toBe(true);
      }

      const permanentlyDenied =
        item.control === "role_denied" || item.control === "default_off";
      expect(authorizeMutation(item.control, fullProof).allowed, item.id).toBe(
        !permanentlyDenied,
      );
      if (permanentlyDenied) {
        expect(item.approvalEvidence, item.id).toBeNull();
      } else {
        expect(item.approvalEvidence, item.id).toBeTypeOf("string");
        expect(fs.existsSync(evidenceFile(item.approvalEvidence!)), item.id).toBe(true);
      }
    }
  });
});

function evidenceFile(reference: string): string {
  return path.resolve(process.cwd(), reference.split("#", 1)[0]!);
}
