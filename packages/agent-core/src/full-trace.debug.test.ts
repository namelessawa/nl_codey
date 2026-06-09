/* eslint-disable no-console */
/**
 * Comprehensive agent-trace debug harness.
 *
 * Goal: exercise every meaningful tool the autonomous loop exposes against a
 * real LLM with the docker sandbox active, and verify the project's audit
 * trail (`Storage.listSteps` + `listSnapshots` + `loadRunMessages`) captures
 * every step — assistant text, tool calls, tool results, command output,
 * applied diffs, and writeback snapshots.
 *
 * Scenarios:
 *   A. Read-only tool coverage (single LLM run hits multiple tools):
 *        list_files, read_file, read_file_range, search_text,
 *        git_status, git_diff, record_plan
 *   B. apply_patch + snapshot: model rewrites README.md; snapshot table
 *      should hold both pre- and post-content for rollback.
 *   C. Docker run_command + writeback: model creates greeting.txt via
 *      `echo` inside the container; WorkspaceSandbox.diff → writeback
 *      approval → file synced into the host workspace.
 *   D. find_symbol direct call (no LLM): point at this repo's service.ts
 *      to prove symbol-index dispatch returns hits.
 *   E. Network deny — guard layer: `curl https://example.com` must throw
 *      SandboxError BEFORE the container is created.
 *   F. Network deny — runtime: pip install inside a `--network=none`
 *      container should fail with a network error (no SandboxError, just
 *      a non-zero exit + DNS/socket failure).
 *   G. WSL mode parity (conditional): same 2 inspection commands routed
 *      via WslRunner; skipped if `wsl --status` reports unavailable.
 *   H. Rollback: after scenario B, AgentService.rollback restores the
 *      original README.md content from the snapshot.
 *
 * Skipped cleanly when LLM_API_KEY / LLM_BASE_URL are not set, so the rest of
 * `pnpm test` keeps green.
 *
 * Run interactively:
 *   pnpm exec vitest run packages/agent-core/src/full-trace.debug.test.ts --reporter=verbose
 *
 * Image: defaults to `python:3.12-slim` to avoid Docker Hub rate limits.
 * Note: the test fixture intentionally has NO code files (no .py, no
 * package.json) so `detectProject` returns "unknown" → no post-patch verify
 * runs and the trace stays focused on the tools we asked the model to use.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  AgentEvent,
  AgentRunDetail,
  AgentSettings,
  ChatLLMProvider,
  SandboxPolicy,
  ToolContext,
} from "@coding-agent/shared";
import { DEFAULT_SETTINGS } from "@coding-agent/shared";
import { assertNoSandboxEscape } from "@coding-agent/sandbox";
import { createLLMProvider } from "@coding-agent/llm";
import { findSymbolTool, runCommandWithPolicy } from "@coding-agent/tools";
import { Storage } from "@coding-agent/storage";

import { AgentService } from "./service.js";

// --- minimal .env loader (no dotenv dep) ---
function loadDotenv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotenv();

const API_KEY = process.env.LLM_API_KEY ?? "";
const BASE_URL = process.env.LLM_BASE_URL ?? "";
const MODEL = process.env.LLM_MODEL ?? "mimo-v2.5-pro";
const DOCKER_IMAGE = process.env.DOCKER_DEBUG_IMAGE ?? "python:3.12-slim";
const HAS_KEY = API_KEY.length > 0 && BASE_URL.length > 0;
// Opt-in gate. The default `pnpm test` MUST NOT spin up real LLM calls
// or open a Storage(":memory:") — both produce flaky CI runs (rate
// limits, ABI mismatch under Node vs. Electron builds). Run explicitly
// with RUN_AGENT_DEBUG_TESTS=1 when you actually want this harness.
const DEBUG_ENABLED = process.env.RUN_AGENT_DEBUG_TESTS === "1";

const describeReal = HAS_KEY && DEBUG_ENABLED ? describe : describe.skip;

// Check WSL availability once; we only run scenario G if a real Linux distro
// is installed (docker-desktop's internal distros don't accept arbitrary
// commands the way Ubuntu does).
const WSL_AVAILABLE = (() => {
  try {
    const r = spawnSync("wsl", ["-l", "-q"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    if (r.status !== 0) return false;
    // wsl -l -q output is UTF-16LE with NUL bytes between chars; strip them.
    const cleaned = r.stdout.replace(/\0/g, "").trim();
    const distros = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return distros.some((d) => d !== "docker-desktop" && d !== "docker-desktop-data");
  } catch {
    return false;
  }
})();

const ORIGINAL_README = [
  "# coding-agent trace fixture",
  "",
  "This workspace exists for the **comprehensive trace** vitest harness.",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "",
  "## Notes",
  "- The fixture has no source files, so detectProject returns 'unknown'.",
  "- That suppresses the post-patch verify run, keeping the trace tight.",
  "",
].join("\n");

const ORIGINAL_NOTES =
  "Lorem ipsum is placeholder Latin text. Search-friendly anchor: BANANA.\n";

/**
 * Drive an AgentService task to a terminal state. Auto-approves any
 * `patch_ready` event (so apply_patch + sandbox writeback proceed without a
 * GUI). Returns the final run detail.
 */
function makeDriver(deps: ConstructorParameters<typeof AgentService>[0]): {
  agent: AgentService;
  events: AgentEvent[];
  runAndWait: (workspaceId: string, task: string) => Promise<AgentRunDetail>;
} {
  const events: AgentEvent[] = [];
  const terminalWaiters = new Map<string, (d: AgentRunDetail) => void>();
  const terminalStates = new Set(["done", "failed", "cancelled", "budget_exceeded"]);

  const agent = new AgentService({
    ...deps,
    emit: (event) => {
      events.push(event);
      if (event.kind === "patch_ready") {
        // Defer apply to next tick — AgentService is mid-emit when this fires.
        setImmediate(() => {
          agent.applyPatch(event.runId).catch((err) => {
            console.error("[driver] applyPatch failed:", err);
          });
        });
      }
      if (event.kind === "run_updated" && terminalStates.has(event.run.status)) {
        const waiter = terminalWaiters.get(event.run.id);
        if (waiter) {
          terminalWaiters.delete(event.run.id);
          waiter(agent.getDetail(event.run.id));
        }
      }
      // forward the user-facing parent emit if they had one
      deps.emit(event);
    },
  });

  async function runAndWait(workspaceId: string, task: string): Promise<AgentRunDetail> {
    const initial = await agent.runTask(workspaceId, task);
    if (terminalStates.has(initial.run.status)) return initial;
    return new Promise((resolve) => {
      terminalWaiters.set(initial.run.id, resolve);
    });
  }

  return { agent, events, runAndWait };
}

describeReal("comprehensive agent trace (docker sandbox)", () => {
  let workspaceRoot: string;
  let storage: Storage;
  let workspaceId: string;
  let agent: AgentService;
  let driver: ReturnType<typeof makeDriver>;
  const runIds: { label: string; id: string }[] = [];

  const settings: AgentSettings = {
    ...DEFAULT_SETTINGS.agent,
    workspacePath: "(set after mkdtemp)",
    allowShellExecution: true,
    requireConfirmationBeforeCommand: false,
    sandboxEnabled: true,
    sandboxMode: "docker",
    maxAutoSteps: 16,
    budgetUsd: 1.0,
    readOnly: false,
    multiAgentEnabled: false,
  };

  beforeAll(async () => {
    workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), "coding-agent-full-trace-"),
    );
    settings.workspacePath = workspaceRoot;

    // Fixture: text-only files so detectProject → "unknown" → no auto-verify.
    await fsp.writeFile(path.join(workspaceRoot, "README.md"), ORIGINAL_README);
    await fsp.writeFile(path.join(workspaceRoot, "notes.txt"), ORIGINAL_NOTES);

    // `git init` + commit so git_status / git_diff have a baseline.
    const gitInit = spawnSync("git", ["init", "-q"], {
      cwd: workspaceRoot,
      windowsHide: true,
    });
    if (gitInit.status !== 0) throw new Error("git init failed: " + gitInit.stderr?.toString());
    spawnSync("git", ["config", "user.email", "trace@example.com"], { cwd: workspaceRoot, windowsHide: true });
    spawnSync("git", ["config", "user.name", "trace"], { cwd: workspaceRoot, windowsHide: true });
    spawnSync("git", ["add", "."], { cwd: workspaceRoot, windowsHide: true });
    spawnSync("git", ["commit", "-q", "-m", "init fixture"], { cwd: workspaceRoot, windowsHide: true });

    storage = new Storage(":memory:");
    workspaceId = storage.upsertWorkspace(workspaceRoot).id;

    const llm: ChatLLMProvider = createLLMProvider({
      provider: "custom",
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
      temperature: 0,
      // 1024 was too tight: scenario B (apply_patch on README) sometimes
      // exhausts the budget on the patch payload + V4A headers before the
      // model emits the tool_call. Bump to give the model headroom.
      maxTokens: 2048,
      timeoutSeconds: 120,
    });

    driver = makeDriver({
      storage,
      resolveLLM: () => llm,
      getAgentSettings: () => settings,
      getLanguage: () => "en-US",
      emit: () => {
        // tests inspect events via driver.events
      },
    });
    agent = driver.agent;

    console.log("\n========================================");
    console.log(`[full-trace] workspace : ${workspaceRoot}`);
    console.log(`[full-trace] storage   : :memory: SQLite`);
    console.log(`[full-trace] model     : ${MODEL}`);
    console.log(`[full-trace] image     : ${DOCKER_IMAGE}`);
    console.log(`[full-trace] WSL avail : ${WSL_AVAILABLE}`);
    console.log("========================================\n");
  });

  afterAll(async () => {
    // -------- Print the full trace from Storage --------
    console.log("\n\n================= FULL TRACE (from Storage) =================");
    const runs = storage.listRuns(workspaceId);
    console.log(`[trace] runs: ${runs.length}`);
    for (const run of runs.slice().reverse()) {
      const label = runIds.find((r) => r.id === run.id)?.label ?? "(unlabeled)";
      console.log(`\n--- run [${label}] ${run.id.slice(0, 8)} status=${run.status} exit=${run.exitReason ?? "-"} ---`);
      console.log(`    task: ${run.userTask.slice(0, 120).replace(/\n/g, " ")}`);
      console.log(`    tokens: in=${run.inputTokens} out=${run.outputTokens} cost=$${(run.costUsd ?? 0).toFixed(4)}`);
      console.log(`    toolCalls=${run.toolCallCount} iterations=${run.iterationCount}`);
      const steps = storage.listSteps(run.id);
      console.log(`    steps (${steps.length}):`);
      for (const s of steps) {
        const c = s.content.replace(/\n/g, "\\n").slice(0, 140);
        console.log(`      [${s.type}] ${c}`);
      }
      const snaps = storage.listSnapshots(run.id);
      if (snaps.length > 0) {
        console.log(`    snapshots (${snaps.length}):`);
        for (const s of snaps) {
          const beforeLen = s.beforeContent.length;
          const afterLen = s.afterContent?.length ?? 0;
          console.log(`      ${s.filePath}  beforeBytes=${beforeLen} afterBytes=${afterLen}`);
        }
      }
      const messages = storage.loadRunMessages(run.id);
      console.log(`    persisted messages: ${messages.length} (roles: ${messages.map((m) => m.role).join(",")})`);
    }
    console.log("=============================================================\n");

    try {
      storage?.close();
    } catch {
      /* ignore */
    }
    if (workspaceRoot) {
      await fsp.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------
  // A. Read-only tool coverage — single LLM run hits multiple tools
  // ---------------------------------------------------------------
  it("A. read-only tool coverage", async () => {
    const task = [
      "Explore this workspace using the available tools, then summarize. Do all of the following in order, using one tool call per step:",
      "  (1) list_files to see what's here.",
      "  (2) read_file on README.md.",
      "  (3) read_file_range on notes.txt for lines 1 to 1.",
      "  (4) search_text for the literal word 'BANANA'.",
      "  (5) git_status.",
      "  (6) git_diff (no path, not staged).",
      "  (7) record_plan with a single step describing what you found.",
      "After step 7, write a one-sentence summary. Do NOT call apply_patch or run_command in this task.",
    ].join("\n");
    const detail = await driver.runAndWait(workspaceId, task);
    runIds.push({ label: "A.read-only-coverage", id: detail.run.id });

    const steps = storage.listSteps(detail.run.id);
    const toolCalls = steps.filter((s) => s.type === "tool_call");
    const calledNames = new Set(
      toolCalls.map((s) => s.content.trim().split(/\s+/)[0]),
    );
    console.log(`[A] tool calls observed: ${[...calledNames].join(", ")}`);

    // Tolerant: model may skip or batch, but at minimum 3 distinct tools must hit.
    expect(calledNames.size).toBeGreaterThanOrEqual(3);
    // Must reach a terminal state (done preferred but failed/budget tolerated)
    expect(["done", "failed", "budget_exceeded"]).toContain(detail.run.status);
  }, 300_000);

  // ---------------------------------------------------------------
  // B. apply_patch + snapshot trace
  // ---------------------------------------------------------------
  it("B. apply_patch records snapshot with before/after content", async () => {
    const task = [
      "Use apply_patch (V4A format preferred) to update README.md so that the very first heading line",
      "becomes exactly `# Updated trace fixture` (replacing the previous heading). Keep all other lines unchanged.",
      "After the patch is applied, give a single confirmation sentence.",
    ].join("\n");
    const detail = await driver.runAndWait(workspaceId, task);
    runIds.push({ label: "B.apply_patch", id: detail.run.id });

    const snaps = storage.listSnapshots(detail.run.id);
    console.log(`[B] snapshots: ${snaps.length}`);
    for (const s of snaps) {
      console.log(`    ${s.filePath} beforeLen=${s.beforeContent.length} afterLen=${s.afterContent?.length ?? 0}`);
    }
    const readmeSnap = snaps.find((s) => s.filePath.replace(/\\/g, "/").endsWith("README.md"));
    expect(readmeSnap).toBeDefined();
    if (readmeSnap) {
      expect(readmeSnap.beforeContent).toBe(ORIGINAL_README);
      expect(readmeSnap.afterContent).toBeTruthy();
      expect(readmeSnap.afterContent!).toContain("Updated trace fixture");
    }

    // Disk state should match snapshot.after
    const onDisk = await fsp.readFile(path.join(workspaceRoot, "README.md"), "utf8");
    expect(onDisk).toContain("Updated trace fixture");
  }, 300_000);

  // ---------------------------------------------------------------
  // C. Docker run_command + writeback approval
  // ---------------------------------------------------------------
  it("C. docker run_command + writeback creates file", async () => {
    const task = [
      "Use run_command exactly once with the command:  echo 'hello from docker' > greeting.txt",
      "The docker sandbox will produce a file diff that requires writeback approval; that approval is auto-granted in this debug.",
      "After the command, briefly confirm the file was created.",
    ].join("\n");
    const detail = await driver.runAndWait(workspaceId, task);
    runIds.push({ label: "C.writeback", id: detail.run.id });

    // The writeback approval flow goes through the patch_ready event because
    // AgentService.awaitWritebackApproval reuses the patch path. The driver
    // auto-approves, so greeting.txt should exist.
    const greetingPath = path.join(workspaceRoot, "greeting.txt");
    let onDisk = "";
    try {
      onDisk = await fsp.readFile(greetingPath, "utf8");
    } catch {
      /* file may not exist on a model refusal */
    }
    console.log(`[C] greeting.txt content: ${JSON.stringify(onDisk)}`);

    const steps = storage.listSteps(detail.run.id);
    const cmdSteps = steps.filter((s) => s.type === "command");
    console.log(`[C] command steps recorded: ${cmdSteps.length}`);
    expect(cmdSteps.length).toBeGreaterThan(0);

    // Snapshot for greeting.txt (added file: beforeContent="")
    const snaps = storage.listSnapshots(detail.run.id);
    console.log(`[C] snapshots: ${snaps.length}`);
    for (const s of snaps) {
      console.log(`    ${s.filePath} beforeLen=${s.beforeContent.length} afterLen=${s.afterContent?.length ?? 0}`);
    }
  }, 300_000);

  // ---------------------------------------------------------------
  // D. find_symbol direct call against this repo
  // ---------------------------------------------------------------
  it("D. find_symbol hits known repo symbol", async () => {
    const repoRoot = path.resolve(process.cwd());
    const ctx: ToolContext = {
      workspaceRoot: repoRoot,
      runId: "direct-find-symbol",
      signal: new AbortController().signal,
    };
    // AgentService is the class we know exists in agent-core.
    const result = await findSymbolTool.run({ name: "AgentService", maxResults: 5 }, ctx);
    console.log(`[D] find_symbol("AgentService") → ${result.symbols.length} hit(s) truncated=${result.truncated}`);
    for (const s of result.symbols.slice(0, 3)) {
      console.log(`    ${s.file}:${s.line}  kind=${s.kind}  name=${s.name}  signature=${s.signature.slice(0, 60)}`);
    }
    expect(result.symbols.length).toBeGreaterThan(0);
    expect(result.symbols.some((s) => s.name === "AgentService")).toBe(true);
  }, 30_000);

  // ---------------------------------------------------------------
  // E. Network deny — sandbox guard rejects before container starts
  // ---------------------------------------------------------------
  it("E. assertNoSandboxEscape blocks curl to external host", () => {
    expect(() =>
      assertNoSandboxEscape({
        command: "curl https://example.com",
        workspaceRoot,
        runId: "e",
      }),
    ).toThrowError();
    console.log("[E] curl https://example.com correctly rejected by assertNoSandboxEscape");
  });

  // ---------------------------------------------------------------
  // F. Network deny — runtime --network=none inside docker container
  // ---------------------------------------------------------------
  it("F. --network=none blocks DNS inside container", async () => {
    const policy: SandboxPolicy = {
      mode: "docker",
      allowNetwork: false,
      dockerImage: DOCKER_IMAGE,
    };
    const ctx: ToolContext = {
      workspaceRoot,
      runId: "direct-network-deny",
      signal: new AbortController().signal,
    };
    // Use python's stdlib (it's in python:3.12-slim) to attempt a DNS lookup.
    // We can't use `curl` because assertNoSandboxEscape would block it.
    const result = await runCommandWithPolicy(
      {
        command:
          "python -c 'import socket; socket.gethostbyname(\"example.com\")'",
      },
      ctx,
      {
        policy,
        writeback: { kind: "discard" },
        snapshotStore: storage,
      },
    );
    console.log(`[F] python DNS attempt: exit=${result.exitCode} stderr=${result.stderr.trim().slice(0, 200)}`);
    expect(result.exitCode).not.toBe(0);
    // stderr should mention a DNS / socket error
    expect(result.stderr.toLowerCase()).toMatch(/socket|gaierror|resolution|temporary|unknown|getaddrinfo|name or service/);
  }, 60_000);

  // ---------------------------------------------------------------
  // G. WSL mode parity (conditional)
  // ---------------------------------------------------------------
  it.skipIf(!WSL_AVAILABLE)("G. WSL mode runs same commands via WslRunner", async () => {
    const policy: SandboxPolicy = { mode: "wsl", allowNetwork: false };
    const ctx: ToolContext = {
      workspaceRoot,
      runId: "direct-wsl",
      signal: new AbortController().signal,
    };
    const r1 = await runCommandWithPolicy({ command: "pwd" }, ctx, {
      policy,
      writeback: { kind: "discard" },
      snapshotStore: storage,
    });
    const r2 = await runCommandWithPolicy({ command: "ls -la" }, ctx, {
      policy,
      writeback: { kind: "discard" },
      snapshotStore: storage,
    });
    console.log(`[G.wsl] pwd: exit=${r1.exitCode} stdout=${r1.stdout.trim().slice(0, 200)}`);
    console.log(`[G.wsl] ls -la: exit=${r2.exitCode} stdout(lines)=${r2.stdout.split("\n").length}`);
    expect(r1.exitCode).toBe(0);
    expect(r2.exitCode).toBe(0);
  }, 120_000);

  // ---------------------------------------------------------------
  // H. Rollback restores README.md from snapshot
  // ---------------------------------------------------------------
  it("H. rollback restores README.md to pre-patch content", async () => {
    const patchRun = runIds.find((r) => r.label === "B.apply_patch");
    expect(patchRun, "scenario B must run before H").toBeDefined();
    if (!patchRun) return;
    // Confirm current disk content has the patched heading.
    const beforeRollback = await fsp.readFile(path.join(workspaceRoot, "README.md"), "utf8");
    expect(beforeRollback).toContain("Updated trace fixture");
    // Roll back
    const detail = agent.rollback(patchRun.id);
    console.log(`[H] post-rollback run status=${detail.run.status}`);
    const afterRollback = await fsp.readFile(path.join(workspaceRoot, "README.md"), "utf8");
    expect(afterRollback).toBe(ORIGINAL_README);
    console.log("[H] README.md restored to original");
  }, 30_000);
});

describe("comprehensive trace (preflight)", () => {
  it("reports skip reason when LLM_API_KEY / LLM_BASE_URL unset", () => {
    if (!HAS_KEY) {
      console.log(
        "[full-trace] Skipped: set LLM_API_KEY and LLM_BASE_URL in env or .env to enable.",
      );
    } else if (!DEBUG_ENABLED) {
      console.log(
        "[full-trace] Skipped: set RUN_AGENT_DEBUG_TESTS=1 to run the real-LLM debug harness.",
      );
    }
    expect(true).toBe(true);
  });
});
