import { describe, it, expect } from "vitest";
import type { AgentRun, AgentRunState, AgentStep } from "./agent.js";
import type { AgentEvent } from "./ipc.js";
import { reduceAgentDetail } from "./agent-detail.js";

function makeRun(id: string, status: AgentRunState, createdAt = 1000): AgentRun {
  return {
    id,
    workspaceId: "ws1",
    userTask: "do a thing",
    status,
    createdAt,
    updatedAt: createdAt,
  };
}

function makeStep(runId: string, content: string): AgentStep {
  return { id: `step-${content}`, runId, type: "message", content, createdAt: 1 };
}

describe("reduceAgentDetail", () => {
  describe("when there is no current detail", () => {
    it("seeds detail from a run_updated event so the UI reacts as soon as a run starts", () => {
      // Regression: events used to be dropped while detail was null, so a real
      // (slow) LLM run showed zero feedback until the whole pipeline finished.
      const run = makeRun("r1", "planning");
      const event: AgentEvent = { kind: "run_updated", run };

      const next = reduceAgentDetail(null, event);

      expect(next).toEqual({ run, steps: [], pendingPatch: null });
    });

    it("ignores a step_added event (no run context to attach it to yet)", () => {
      const event: AgentEvent = { kind: "step_added", step: makeStep("r1", "hi") };
      expect(reduceAgentDetail(null, event)).toBeNull();
    });

    it("ignores a patch_ready event with no run context", () => {
      const event: AgentEvent = { kind: "patch_ready", runId: "r1", patch: "diff" };
      expect(reduceAgentDetail(null, event)).toBeNull();
    });
  });

  describe("when a detail for the current run exists", () => {
    it("appends a step for the current run", () => {
      const prev = { run: makeRun("r1", "reading"), steps: [], pendingPatch: null };
      const step = makeStep("r1", "read file");

      const next = reduceAgentDetail(prev, { kind: "step_added", step });

      expect(next?.steps).toEqual([step]);
    });

    it("updates the run on a matching run_updated", () => {
      const prev = { run: makeRun("r1", "planning"), steps: [], pendingPatch: null };
      const updated = makeRun("r1", "editing");

      const next = reduceAgentDetail(prev, { kind: "run_updated", run: updated });

      expect(next?.run.status).toBe("editing");
    });

    it("sets pendingPatch on a matching patch_ready", () => {
      const prev = { run: makeRun("r1", "editing"), steps: [], pendingPatch: null };

      const next = reduceAgentDetail(prev, { kind: "patch_ready", runId: "r1", patch: "the diff" });

      expect(next?.pendingPatch).toBe("the diff");
    });

    it("ignores a step belonging to a different run", () => {
      const prev = { run: makeRun("r1", "reading"), steps: [], pendingPatch: null };
      const step = makeStep("other", "stray");

      const next = reduceAgentDetail(prev, { kind: "step_added", step });

      expect(next).toBe(prev);
    });
  });

  describe("switching between runs", () => {
    it("adopts a newer run so a second run also streams live", () => {
      const prev = { run: makeRun("r1", "done", 1000), steps: [makeStep("r1", "old")], pendingPatch: "old" };
      const newer = makeRun("r2", "planning", 2000);

      const next = reduceAgentDetail(prev, { kind: "run_updated", run: newer });

      expect(next).toEqual({ run: newer, steps: [], pendingPatch: null });
    });

    it("ignores a stale run_updated for an older run", () => {
      const prev = { run: makeRun("r2", "planning", 2000), steps: [], pendingPatch: null };
      const older = makeRun("r1", "done", 1000);

      const next = reduceAgentDetail(prev, { kind: "run_updated", run: older });

      expect(next).toBe(prev);
    });
  });
});
