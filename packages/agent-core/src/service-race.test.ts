import { describe, expect, it, vi } from "vitest";
import type { Storage } from "@coding-agent/storage";
import {
  AgentService,
  buildMultiAgentRunMessages,
  buildMultiAgentSummary,
  isStaleRunStorageError,
  loopErrorToOutcome,
} from "./service.js";

describe("isStaleRunStorageError", () => {
  it("recognises SQLITE_CONSTRAINT_FOREIGNKEY from better-sqlite3", () => {
    const err = Object.assign(new Error("FOREIGN KEY constraint failed"), {
      code: "SQLITE_CONSTRAINT_FOREIGNKEY",
    });
    expect(isStaleRunStorageError(err)).toBe(true);
  });

  it("recognises the 'Run not found' Error thrown by updateRunStatus / addRunUsage", () => {
    expect(isStaleRunStorageError(new Error("Run not found: run-abc"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isStaleRunStorageError(new Error("disk full"))).toBe(false);
    expect(
      isStaleRunStorageError(Object.assign(new Error("constraint X"), { code: "SQLITE_CONSTRAINT_CHECK" })),
    ).toBe(false);
    expect(isStaleRunStorageError(null)).toBe(false);
    expect(isStaleRunStorageError(undefined)).toBe(false);
    expect(isStaleRunStorageError("string")).toBe(false);
  });
});

/**
 * Verifies the clearRuns-race contract at the AgentService private-helper
 * boundary: storage writes keyed on a runId that was concurrently deleted
 * must silently no-op rather than crash the background loop. The test stubs
 * Storage so it doesn't depend on the better-sqlite3 native ABI.
 */
describe("AgentService race-safety with concurrent clearRuns", () => {
  function makeStubStorage(missing: Set<string>): {
    storage: Storage;
    calls: { addStep: number; updateRunStatus: number; setRunExitReason: number; addRunUsage: number };
  } {
    const calls = { addStep: 0, updateRunStatus: 0, setRunExitReason: 0, addRunUsage: 0 };
    const stub = {
      addStep: (runId: string, type: string, content: string) => {
        calls.addStep += 1;
        if (missing.has(runId)) {
          const err = Object.assign(new Error("FOREIGN KEY constraint failed"), {
            code: "SQLITE_CONSTRAINT_FOREIGNKEY",
          });
          throw err;
        }
        return { id: "s", runId, type, content, createdAt: 0 };
      },
      updateRunStatus: (runId: string, status: string) => {
        calls.updateRunStatus += 1;
        if (missing.has(runId)) throw new Error(`Run not found: ${runId}`);
        return {
          id: runId,
          workspaceId: "ws",
          userTask: "",
          status,
          createdAt: 0,
          updatedAt: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          toolCallCount: 0,
          iterationCount: 0,
          modelName: null,
          exitReason: null,
        };
      },
      addRunUsage: (runId: string) => {
        calls.addRunUsage += 1;
        if (missing.has(runId)) throw new Error(`Run not found: ${runId}`);
        return {
          id: runId,
          workspaceId: "ws",
          userTask: "",
          status: "tool_use",
          createdAt: 0,
          updatedAt: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          toolCallCount: 0,
          iterationCount: 0,
          modelName: null,
          exitReason: null,
        };
      },
      setRunExitReason: (runId: string) => {
        calls.setRunExitReason += 1;
        if (missing.has(runId)) {
          // setRunExitReason currently doesn't read-back, so a real concurrent
          // delete would silently affect 0 rows. We still simulate an FK-style
          // throw here in case the implementation tightens later.
          const err = Object.assign(new Error("FOREIGN KEY constraint failed"), {
            code: "SQLITE_CONSTRAINT_FOREIGNKEY",
          });
          throw err;
        }
      },
      // Unused stubs to satisfy the broader Storage shape — never invoked here.
      getRun: () => null,
      listRuns: () => [],
      listSteps: () => [],
    };
    return { storage: stub as unknown as Storage, calls };
  }

  function makeService(storage: Storage, emit: (event: unknown) => void): AgentService {
    return new AgentService({
      storage,
      resolveLLM: () => {
        throw new Error("unused");
      },
      getAgentSettings: () => ({
        workspacePath: "",
        allowShellExecution: false,
        requireConfirmationBeforeCommand: false,
        sandboxEnabled: false,
        sandboxMode: "whitelist",
        maxAutoSteps: 5,
        budgetUsd: 0.5,
        readOnly: false,
        multiAgentEnabled: false,
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      emit: emit as any,
    });
  }

  it("addStep silently swallows an FK violation against a deleted run", () => {
    const missing = new Set(["run-gone"]);
    const { storage, calls } = makeStubStorage(missing);
    const events: unknown[] = [];
    const service = makeService(storage, (e) => events.push(e));

    expect(() =>
      (service as unknown as {
        addStep: (r: string, t: string, c: string) => void;
      }).addStep("run-gone", "message", "after delete"),
    ).not.toThrow();
    expect(calls.addStep).toBe(1);
    // No step_added event because the row was gone.
    expect(events).toEqual([]);
  });

  it("setStatus silently swallows 'Run not found' against a deleted run", () => {
    const missing = new Set(["run-gone"]);
    const { storage, calls } = makeStubStorage(missing);
    const events: unknown[] = [];
    const service = makeService(storage, (e) => events.push(e));

    expect(() =>
      (service as unknown as {
        setStatus: (r: string, s: string) => void;
      }).setStatus("run-gone", "failed"),
    ).not.toThrow();
    expect(calls.updateRunStatus).toBe(1);
    expect(events).toEqual([]);
  });

  it("safeRunWrite swallows stale-run failures from arbitrary storage writes", () => {
    const missing = new Set(["run-gone"]);
    const { storage, calls } = makeStubStorage(missing);
    const events: unknown[] = [];
    const service = makeService(storage, (e) => events.push(e));

    expect(() =>
      (service as unknown as {
        safeRunWrite: (fn: () => void) => void;
      }).safeRunWrite(() => storage.setRunExitReason("run-gone", "cancelled")),
    ).not.toThrow();
    expect(calls.setRunExitReason).toBe(1);
  });

  it("real storage failures (non-FK) still propagate through addStep", () => {
    const storage = {
      addStep: () => {
        throw new Error("disk write error");
      },
    } as unknown as Storage;
    const service = makeService(storage, () => {});

    expect(() =>
      (service as unknown as {
        addStep: (r: string, t: string, c: string) => void;
      }).addStep("run-1", "message", "x"),
    ).toThrow(/disk write error/);
  });

  it("loopErrorToOutcome reports failed with the error message when not aborted", () => {
    const outcome = loopErrorToOutcome(new Error("LLM stream timeout"), false, [
      { role: "user", content: "task" },
    ]);
    expect(outcome.state).toBe("failed");
    if (outcome.state === "failed") {
      expect(outcome.reason).toBe("LLM stream timeout");
    }
    expect(outcome.finalMessages).toHaveLength(1);
  });

  it("loopErrorToOutcome reports cancelled when the controller was aborted", () => {
    // The user explicitly stopped (or clearRuns fired) — that's not a failure,
    // so exit_reason must read 'cancelled' rather than the AbortError text.
    const outcome = loopErrorToOutcome(new Error("aborted"), true, []);
    expect(outcome.state).toBe("cancelled");
  });

  it("buildMultiAgentSummary captures status header + bulleted node recap", () => {
    const summary = buildMultiAgentSummary("Implement caching", "done", [
      { id: "a", title: "Add cache util", status: "succeeded", description: "Build the LRU cache module" },
      { id: "b", title: "Wire it up", status: "failed", description: "Integrate with API layer" },
    ]);
    expect(summary).toContain("Multi-agent run completed with status=done (2 nodes).");
    expect(summary).toContain("Original task: Implement caching");
    expect(summary).toContain("- [succeeded] Add cache util");
    expect(summary).toContain("- [failed] Wire it up");
  });

  it("buildMultiAgentSummary handles empty node lists gracefully", () => {
    const summary = buildMultiAgentSummary("Cleanup task", "done", []);
    expect(summary).toContain("0 nodes");
    expect(summary).toContain("(No sub-tasks were produced.)");
  });

  it("buildMultiAgentSummary truncates long descriptions and caps the bullet list", () => {
    const longDesc = "x".repeat(300);
    const manyNodes = Array.from({ length: 30 }, (_, i) => ({
      id: `n${i}`,
      title: `Node ${i}`,
      status: "succeeded",
      description: longDesc,
    }));
    const summary = buildMultiAgentSummary("Big task", "done", manyNodes);
    // Each rendered bullet should be truncated to <= 140 chars of description.
    const bulletLines = summary.split("\n").filter((l) => l.startsWith("- [succeeded]"));
    for (const line of bulletLines) {
      expect(line.length).toBeLessThan(220); // title + status + truncated desc + ellipsis
    }
    // Last bullet line summarises the overflow rather than emitting all 30.
    expect(summary).toContain("and 10 more");
  });

  it("buildMultiAgentRunMessages produces a [system, user, assistant] conversation", () => {
    const msgs = buildMultiAgentRunMessages("en-US", "the task", "the summary");
    expect(msgs).toHaveLength(3);
    expect(msgs[0]?.role).toBe("system");
    expect(typeof msgs[0]?.content).toBe("string");
    expect((msgs[0]?.content as string).length).toBeGreaterThan(0);
    expect(msgs[1]).toEqual({ role: "user", content: "the task" });
    expect(msgs[2]).toEqual({ role: "assistant", content: "the summary" });
  });

  it("loopErrorToOutcome stringifies non-Error throws so reason is never empty", () => {
    const outcome = loopErrorToOutcome("provider gave up", false, []);
    expect(outcome.state).toBe("failed");
    if (outcome.state === "failed") {
      expect(outcome.reason).toBe("provider gave up");
    }
  });

  it("happy path still emits the event when the run exists", () => {
    const { storage, calls } = makeStubStorage(new Set());
    const events: unknown[] = [];
    const service = makeService(storage, (e) => events.push(e));

    (service as unknown as {
      addStep: (r: string, t: string, c: string) => void;
    }).addStep("run-1", "message", "hello");

    expect(calls.addStep).toBe(1);
    expect(events).toHaveLength(1);
    expect((events[0] as { kind: string }).kind).toBe("step_added");
  });
});
