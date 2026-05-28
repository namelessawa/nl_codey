import { describe, it, expect } from "vitest";
import {
  buildCommitMessage,
  parseCommitFields,
  generateCommitMessage,
} from "./commit-writer.js";
import { GIT_COAUTHOR_TRAILER, type CommitRequest } from "@coding-agent/shared";

describe("buildCommitMessage", () => {
  it("builds a header with scope, body, changes, verified and trailer", () => {
    const req: CommitRequest = {
      taskNodeId: "t1",
      type: "feat",
      scope: "auth",
      summary: "add login",
      body: "Implements the login flow.",
      changedFiles: ["src/login.ts", "src/api.ts"],
      verifiedBy: "pnpm test (passed in 8.2s)",
    };
    const message = buildCommitMessage(req);
    expect(message).toBe(
      [
        "feat(auth): add login",
        "Implements the login flow.",
        "Changes:\n- src/login.ts\n- src/api.ts",
        "Verified by: pnpm test (passed in 8.2s)",
        GIT_COAUTHOR_TRAILER,
      ].join("\n\n"),
    );
  });

  it("omits the scope when absent", () => {
    const message = buildCommitMessage({
      taskNodeId: "t1",
      type: "fix",
      summary: "handle null",
      body: "",
      changedFiles: [],
    });
    expect(message.startsWith("fix: handle null")).toBe(true);
    expect(message).not.toContain("Changes:");
    expect(message).not.toContain("Verified by:");
    expect(message.endsWith(GIT_COAUTHOR_TRAILER)).toBe(true);
  });
});

describe("parseCommitFields", () => {
  it("parses a clean JSON object", () => {
    const parsed = parseCommitFields(
      '{"type":"feat","scope":"api","summary":"add endpoint","body":"why"}',
    );
    expect(parsed).toEqual({
      type: "feat",
      scope: "api",
      summary: "add endpoint",
      body: "why",
    });
  });

  it("extracts JSON embedded in surrounding prose", () => {
    const parsed = parseCommitFields(
      'Sure! Here is the commit:\n{"type":"fix","summary":"patch bug"}\nHope that helps.',
    );
    expect(parsed?.type).toBe("fix");
    expect(parsed?.summary).toBe("patch bug");
  });

  it("rejects an unknown conventional-commit type", () => {
    expect(parseCommitFields('{"type":"wibble","summary":"x"}')).toBeNull();
  });

  it("returns null when there is no JSON object", () => {
    expect(parseCommitFields("no json here")).toBeNull();
  });

  it("returns null when summary is missing", () => {
    expect(parseCommitFields('{"type":"feat"}')).toBeNull();
  });
});

describe("generateCommitMessage", () => {
  const diff = "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n+line";

  it("uses parsed model output and attaches verifiedBy + changed files", async () => {
    const generate = async () =>
      '{"type":"feat","scope":"core","summary":"do thing","body":"because"}';
    const req = await generateCommitMessage(
      { taskNodeId: "n1", taskDescription: "Do the thing", diff, testResult: "pnpm test ok" },
      generate,
    );
    expect(req.type).toBe("feat");
    expect(req.scope).toBe("core");
    expect(req.summary).toBe("do thing");
    expect(req.changedFiles).toEqual(["x.ts"]);
    expect(req.verifiedBy).toBe("pnpm test ok");
  });

  it("falls back to a deterministic message when output is unparseable", async () => {
    const generate = async () => "totally not json";
    const req = await generateCommitMessage(
      { taskNodeId: "n2", taskDescription: "Fix the parser\nmore detail", diff },
      generate,
    );
    expect(req.type).toBe("chore");
    expect(req.summary).toBe("Fix the parser");
    expect(req.changedFiles).toEqual(["x.ts"]);
  });

  it("falls back when the generate function throws", async () => {
    const generate = async () => {
      throw new Error("network");
    };
    const req = await generateCommitMessage(
      { taskNodeId: "n3", taskDescription: "Add feature", diff },
      generate,
    );
    expect(req.type).toBe("chore");
    expect(req.summary).toBe("Add feature");
  });
});
