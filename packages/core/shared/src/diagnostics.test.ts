import { describe, expect, it } from "vitest";
import type { AgentStep, FileSnapshot } from "./agent.js";
import {
  RUN_DIAGNOSTICS_LIMITS,
  buildRunDiagnostics,
} from "./diagnostics.js";

describe("buildRunDiagnostics", () => {
  it("exports bounded metadata without task, diff, snapshot, or payload content", () => {
    const steps = Array.from(
      { length: RUN_DIAGNOSTICS_LIMITS.steps + 2 },
      (_, index): AgentStep => ({
        id: `step-${index}`,
        runId: "run-1",
        type: index === 0 ? "error" : index === 1 ? "diff" : "tool_call",
        content:
          index === 0
            ? "Authorization: Bearer secret-token C:\\Users\\alice\\private"
            : index === 1
              ? "diff --git a/private.ts b/private.ts\n+source-secret"
              : `read_file private-${index}.ts`,
        createdAt: index,
      }),
    );
    const snapshots: FileSnapshot[] = [
      {
        id: "snapshot-1",
        runId: "run-1",
        filePath: "C:\\Users\\alice\\private.ts",
        beforeContent: "snapshot-secret",
        beforeExisted: true,
        afterContent: "after-secret",
        afterExisted: true,
        createdAt: 1,
      },
    ];

    const bundle = buildRunDiagnostics(
      {
        run: {
          id: "run-1",
          workspaceId: "workspace-1",
          userTask: "user-task-secret",
          status: "failed",
          createdAt: 10,
          updatedAt: 30,
          modelName: "gpt-test",
          exitReason: "provider failed",
        },
        steps,
        snapshots,
        tasks: [
          {
            id: "task-1",
            parentRunId: "run-1",
            title: "task-title-secret",
            description: "task-description-secret",
            status: "failed",
            dependsOn: [],
            verifyCommand: "secret-command",
            filesScope: ["private.ts"],
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        gitActions: [
          {
            id: "git-1",
            runId: "run-1",
            action: "pr_generated",
            ref: "agent/test",
            payload: "git-payload-secret",
            createdAt: 3,
          },
        ],
      },
      100,
    );
    const serialized = JSON.stringify(bundle);

    expect(bundle.generatedAt).toBe(100);
    expect(bundle.run.durationMs).toBe(20);
    expect(bundle.run.userTaskChars).toBe("user-task-secret".length);
    expect(bundle.steps).toHaveLength(RUN_DIAGNOSTICS_LIMITS.steps);
    expect(bundle.dropped.steps).toBe(2);
    expect(bundle.snapshots[0]?.filePath).toContain("[USER_HOME]");
    expect(serialized).not.toMatch(
      /secret-token|source-secret|snapshot-secret|after-secret|user-task-secret|task-title-secret|task-description-secret|secret-command|git-payload-secret|alice/,
    );
  });

  it("redacts retained error details and normalizes invalid numeric counters", () => {
    const bundle = buildRunDiagnostics({
      run: {
        id: "run-2",
        workspaceId: "workspace-2",
        userTask: "",
        status: "failed",
        createdAt: 20,
        updatedAt: 10,
        inputTokens: Number.NaN,
        outputTokens: Number.POSITIVE_INFINITY,
        costUsd: -1,
        toolCallCount: 2,
        iterationCount: 3,
      },
      steps: [
        {
          id: "step-1",
          runId: "run-2",
          type: "error",
          content: "api_key=diagnostic-secret",
          createdAt: 1,
        },
      ],
      snapshots: [],
      tasks: [],
      gitActions: [],
    });

    expect(bundle.run.durationMs).toBe(0);
    expect(bundle.run.inputTokens).toBe(0);
    expect(bundle.run.outputTokens).toBe(0);
    expect(bundle.steps[0]?.detail).toContain("[REDACTED]");
    expect(bundle.steps[0]?.detail).not.toContain("diagnostic-secret");
  });
});
