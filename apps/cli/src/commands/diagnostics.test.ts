import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "@nlc/shared";
import type { ParsedArgs } from "../lib/argv.js";

const mocked = vi.hoisted(() => ({
  run: null as AgentRun | null,
  close: vi.fn(),
  listSteps: vi.fn(),
  listSnapshots: vi.fn(),
  listTaskNodes: vi.fn(),
  listGitActions: vi.fn(),
}));

vi.mock("@nlc/storage", () => ({
  Storage: class {
    getRun() {
      return mocked.run;
    }
    listSteps() {
      return mocked.listSteps();
    }
    listSnapshots() {
      return mocked.listSnapshots();
    }
    listTaskNodes() {
      return mocked.listTaskNodes();
    }
    listGitActions() {
      return mocked.listGitActions();
    }
    close() {
      mocked.close();
    }
  },
}));

import { runDiagnostics } from "./diagnostics.js";
import { parseArgv } from "../lib/argv.js";

const roots: string[] = [];

afterEach(() => {
  mocked.run = null;
  mocked.close.mockReset();
  mocked.listSteps.mockReset();
  mocked.listSnapshots.mockReset();
  mocked.listTaskNodes.mockReset();
  mocked.listGitActions.mockReset();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("[cli] diagnostics export", () => {
  it("parses '-' as the explicit diagnostics stdout destination", () => {
    const parsed = parseArgv(["diagnostics", "run-1", "--output", "-"]);
    expect(parsed.flags.get("output")).toBe("-");
  });

  it("requires a Run id without opening storage", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runDiagnostics(args())).resolves.toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("missing run id"),
    );
    expect(mocked.close).not.toHaveBeenCalled();
  });

  it("writes sanitized JSON to stdout without source-bearing records", async () => {
    mocked.run = {
      id: "run-1",
      workspaceId: "workspace-1",
      userTask: "private user request",
      status: "failed",
      createdAt: 1,
      updatedAt: 2,
    };
    mocked.listSteps.mockReturnValue([
      {
        id: "step-1",
        runId: "run-1",
        type: "error",
        content: "Authorization: Bearer cli-secret",
        createdAt: 1,
      },
      {
        id: "step-2",
        runId: "run-1",
        type: "diff",
        content: "+source-secret",
        createdAt: 2,
      },
    ]);
    mocked.listSnapshots.mockReturnValue([
      {
        id: "snapshot-1",
        runId: "run-1",
        filePath: "C:\\Users\\alice\\private.ts",
        beforeContent: "snapshot-secret",
        createdAt: 1,
      },
    ]);
    mocked.listTaskNodes.mockReturnValue([]);
    mocked.listGitActions.mockReturnValue([]);
    let stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    await expect(
      runDiagnostics(args(["run-1"], [["json", "true"]])),
    ).resolves.toBe(0);

    const bundle = JSON.parse(stdout) as {
      run: { userTaskChars: number };
      steps: Array<{ detail?: string }>;
      snapshots: Array<{ filePath: string }>;
    };
    expect(bundle.run.userTaskChars).toBe("private user request".length);
    expect(bundle.steps[0]?.detail).toContain("[REDACTED]");
    expect(bundle.snapshots[0]?.filePath).toContain("[USER_HOME]");
    expect(stdout).not.toMatch(
      /private user request|cli-secret|source-secret|snapshot-secret|alice/,
    );
    expect(mocked.close).toHaveBeenCalledOnce();
  });

  it("reports an unknown Run and closes storage", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(runDiagnostics(args(["missing"]))).resolves.toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("Run not found"),
    );
    expect(mocked.close).toHaveBeenCalledOnce();
  });

  it("creates an owner-only file once and never overwrites it", async () => {
    prepareRun();
    const root = temporaryRoot();
    const target = path.join(root, "diagnostics.json");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const commandArgs = args(
      ["run-1"],
      [
        ["data-root", root],
        ["output", target],
      ],
    );

    await expect(runDiagnostics(commandArgs)).resolves.toBe(0);
    const first = fs.readFileSync(target, "utf8");
    expect(JSON.parse(first)).toMatchObject({
      schemaVersion: 1,
      run: { id: "run-1" },
    });
    if (process.platform !== "win32") {
      expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    }

    fs.writeFileSync(target, "do-not-overwrite", "utf8");
    await expect(runDiagnostics(commandArgs)).resolves.toBe(1);
    expect(fs.readFileSync(target, "utf8")).toBe("do-not-overwrite");
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("EEXIST"));
  });

  it("refuses a missing output parent without creating it", async () => {
    prepareRun();
    const root = temporaryRoot();
    const missing = path.join(root, "missing", "diagnostics.json");
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await expect(
      runDiagnostics(
        args(
          ["run-1"],
          [
            ["data-root", root],
            ["output", missing],
          ],
        ),
      ),
    ).resolves.toBe(2);
    expect(fs.existsSync(path.dirname(missing))).toBe(false);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("output directory does not exist"),
    );
  });
});

function args(
  positional: string[] = [],
  flags: Array<[string, string]> = [],
): ParsedArgs {
  return {
    positional,
    flags: new Map(flags),
    raw: [],
  };
}

function prepareRun(): void {
  mocked.run = {
    id: "run-1",
    workspaceId: "workspace-1",
    userTask: "",
    status: "done",
    createdAt: 1,
    updatedAt: 2,
  };
  mocked.listSteps.mockReturnValue([]);
  mocked.listSnapshots.mockReturnValue([]);
  mocked.listTaskNodes.mockReturnValue([]);
  mocked.listGitActions.mockReturnValue([]);
}

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-diagnostics-cli-"));
  roots.push(root);
  return root;
}
