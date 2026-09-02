/** Content-minimized, redacted Run diagnostics shared by every host. */

import type { AgentRun, AgentStep, FileSnapshot } from "./agent.js";
import type { GitAction } from "./git.js";
import type { TaskNode } from "./task.js";
import { redactSensitiveText } from "./redaction.js";

export const RUN_DIAGNOSTICS_SCHEMA_VERSION = 1;
export const RUN_DIAGNOSTICS_LIMITS = {
  steps: 500,
  snapshots: 500,
  tasks: 200,
  gitActions: 200,
} as const;

export type RunDiagnosticsInput = {
  run: AgentRun;
  steps: readonly AgentStep[];
  snapshots: readonly FileSnapshot[];
  tasks: readonly TaskNode[];
  gitActions: readonly GitAction[];
};

export type RunDiagnosticsBundle = {
  schemaVersion: typeof RUN_DIAGNOSTICS_SCHEMA_VERSION;
  generatedAt: number;
  run: {
    id: string;
    workspaceId: string;
    status: AgentRun["status"];
    createdAt: number;
    updatedAt: number;
    durationMs: number;
    userTaskChars: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    toolCallCount: number;
    iterationCount: number;
    modelName: string | null;
    exitReason: string | null;
    sessionLinked: boolean;
    runtimeOwned: boolean;
  };
  totals: {
    steps: number;
    snapshots: number;
    tasks: number;
    gitActions: number;
  };
  dropped: {
    steps: number;
    snapshots: number;
    tasks: number;
    gitActions: number;
  };
  steps: Array<{
    type: AgentStep["type"];
    createdAt: number;
    contentChars: number;
    detail?: string;
  }>;
  snapshots: Array<{
    filePath: string;
    beforeExisted: boolean;
    afterExisted: boolean | null;
    createdAt: number;
    iteration: number;
    snapshotType: string;
  }>;
  tasks: Array<{
    id: string;
    status: TaskNode["status"];
    dependencyCount: number;
    fileScopeCount: number;
    hasVerifier: boolean;
    createdAt: number;
    updatedAt: number;
  }>;
  gitActions: Array<{
    action: GitAction["action"];
    ref: string | null;
    createdAt: number;
  }>;
};

export function buildRunDiagnostics(
  input: RunDiagnosticsInput,
  generatedAt = Date.now(),
): RunDiagnosticsBundle {
  const steps = takeTail(input.steps, RUN_DIAGNOSTICS_LIMITS.steps);
  const snapshots = takeTail(
    input.snapshots,
    RUN_DIAGNOSTICS_LIMITS.snapshots,
  );
  const tasks = takeTail(input.tasks, RUN_DIAGNOSTICS_LIMITS.tasks);
  const gitActions = takeTail(
    input.gitActions,
    RUN_DIAGNOSTICS_LIMITS.gitActions,
  );
  return {
    schemaVersion: RUN_DIAGNOSTICS_SCHEMA_VERSION,
    generatedAt,
    run: {
      id: input.run.id,
      workspaceId: input.run.workspaceId,
      status: input.run.status,
      createdAt: input.run.createdAt,
      updatedAt: input.run.updatedAt,
      durationMs: Math.max(0, input.run.updatedAt - input.run.createdAt),
      userTaskChars: input.run.userTask.length,
      inputTokens: finiteOrZero(input.run.inputTokens),
      outputTokens: finiteOrZero(input.run.outputTokens),
      costUsd: finiteOrZero(input.run.costUsd),
      toolCallCount: finiteOrZero(input.run.toolCallCount),
      iterationCount: finiteOrZero(input.run.iterationCount),
      modelName: safeOptional(input.run.modelName),
      exitReason: safeOptional(input.run.exitReason),
      sessionLinked: Boolean(input.run.sessionId),
      runtimeOwned: Boolean(input.run.runtimeInstanceId || input.run.ownerPid),
    },
    totals: {
      steps: input.steps.length,
      snapshots: input.snapshots.length,
      tasks: input.tasks.length,
      gitActions: input.gitActions.length,
    },
    dropped: {
      steps: input.steps.length - steps.length,
      snapshots: input.snapshots.length - snapshots.length,
      tasks: input.tasks.length - tasks.length,
      gitActions: input.gitActions.length - gitActions.length,
    },
    steps: steps.map((step) => ({
      type: step.type,
      createdAt: step.createdAt,
      contentChars: step.content.length,
      ...(hasDiagnosticDetail(step.type)
        ? { detail: safeText(step.content, 1_000, "Diagnostic unavailable") }
        : {}),
    })),
    snapshots: snapshots.map((snapshot) => ({
      filePath: safeText(snapshot.filePath, 500, "[PATH REDACTED]"),
      beforeExisted: snapshot.beforeExisted !== false,
      afterExisted: snapshot.afterExisted ?? null,
      createdAt: snapshot.createdAt,
      iteration: snapshot.iteration ?? 0,
      snapshotType: snapshot.snapshotType ?? "before_run",
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      status: task.status,
      dependencyCount: task.dependsOn.length,
      fileScopeCount: task.filesScope?.length ?? 0,
      hasVerifier: Boolean(task.verifyCommand),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })),
    gitActions: gitActions.map((action) => ({
      action: action.action,
      ref: safeOptional(action.ref, 500),
      createdAt: action.createdAt,
    })),
  };
}

function hasDiagnosticDetail(type: AgentStep["type"]): boolean {
  return type === "error" || type === "command";
}

function safeOptional(
  value: string | null | undefined,
  maxLength = 500,
): string | null {
  return value ? safeText(value, maxLength, "Diagnostic unavailable") : null;
}

function safeText(value: unknown, maxLength: number, fallback: string): string {
  return redactSensitiveText(value, { maxLength, fallback });
}

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function takeTail<T>(values: readonly T[], limit: number): readonly T[] {
  return values.length <= limit ? values : values.slice(values.length - limit);
}
