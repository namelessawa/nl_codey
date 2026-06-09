/* eslint-disable no-console */
/**
 * Complex-task + agent-call-agent (multi-agent) debug harness.
 *
 * Two scenarios on top of the docker sandbox:
 *
 *   I.  Complex single-agent task — verify→repair loop.
 *       Fixture has buggy `calculator.py` + a plain-Python `verify.py` that
 *       asserts add/mul/sub. The agent must:
 *         1) read the files,
 *         2) run `python verify.py` and observe the AssertionError,
 *         3) apply_patch to fix calculator.py,
 *         4) re-run `python verify.py` and confirm "All tests passed.",
 *         5) summarize.
 *       This exercises the docker sandbox + multi-turn apply_patch +
 *       run_command + writeback discipline + repair-on-failure.
 *
 *   II. Agent-call-agent — multiAgentEnabled = true.
 *       AgentService routes the run through `driveMultiAgentLoop` →
 *       `Coordinator` (Planner → Coder → Reviewer wave executor). Storage
 *       captures three new audit surfaces beyond the Phase 1/2 trace:
 *         - `task_nodes` rows for each sub-task DAG node,
 *         - `role_messages` rows for every cross-role hand-off,
 *         - `agent_steps` enriched with role hand-off entries.
 *       Task is small enough that even a single-node DAG counts as success:
 *       create hello.py + verify_hello.py and run them in docker.
 *
 * Skipped cleanly without LLM_API_KEY / LLM_BASE_URL.
 *
 * Run:
 *   pnpm exec vitest run packages/agent-core/src/complex-multiagent.debug.test.ts --reporter=verbose
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
} from "@coding-agent/shared";
import { DEFAULT_SETTINGS } from "@coding-agent/shared";
import { createLLMProvider } from "@coding-agent/llm";
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
const HAS_KEY = API_KEY.length > 0 && BASE_URL.length > 0;
// Opt-in gate (mirrors full-trace.debug.test.ts): default `pnpm test`
// MUST NOT spawn real LLM calls or open Storage(":memory:"). Set
// RUN_AGENT_DEBUG_TESTS=1 to actually run this harness.
const DEBUG_ENABLED = process.env.RUN_AGENT_DEBUG_TESTS === "1";
const describeReal = HAS_KEY && DEBUG_ENABLED ? describe : describe.skip;

// Buggy calculator: add returns a-b, mul returns a+b, sub correct.
const BUGGY_CALCULATOR = `def add(a, b):
    # BUG: should be a + b
    return a - b


def sub(a, b):
    return a - b


def mul(a, b):
    # BUG: should be a * b
    return a + b
`;

const VERIFY_SCRIPT = `from calculator import add, sub, mul

assert add(1, 2) == 3, f"add(1,2) = {add(1, 2)} (expected 3)"
assert sub(5, 3) == 2, f"sub(5,3) = {sub(5, 3)} (expected 2)"
assert mul(4, 3) == 12, f"mul(4,3) = {mul(4, 3)} (expected 12)"
print("All tests passed.")
`;

// Original task description with NO `root` hint — the fix in PLANNER_PROMPT
// should be sufficient on its own. If this regresses, the prompt fix isn't
// strong enough.
const HELLO_TASK_DESC = [
  "Create a new file `hello.py` that defines a function greet(name) returning the string `Hello, {name}!`",
  "(using an f-string). Then create a second file `verify_hello.py` which: imports greet from hello, asserts",
  "`greet('world') == 'Hello, world!'`, and prints `OK` on success. Finally run `python verify_hello.py` to",
  "confirm it prints `OK`. Report what you did in one sentence.",
].join("\n");

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

describeReal("I. Complex single-agent task — verify→repair", () => {
  let workspaceRoot: string;
  let storage: Storage;
  let workspaceId: string;
  let driver: ReturnType<typeof makeDriver>;
  let runId: string | null = null;

  const settings: AgentSettings = {
    ...DEFAULT_SETTINGS.agent,
    workspacePath: "",
    allowShellExecution: true,
    requireConfirmationBeforeCommand: false,
    sandboxEnabled: true,
    sandboxMode: "docker",
    maxAutoSteps: 24,
    budgetUsd: 2.0,
    readOnly: false,
    multiAgentEnabled: false,
  };

  beforeAll(async () => {
    workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "coding-agent-complex-"));
    settings.workspacePath = workspaceRoot;
    await fsp.writeFile(path.join(workspaceRoot, "calculator.py"), BUGGY_CALCULATOR);
    await fsp.writeFile(path.join(workspaceRoot, "verify.py"), VERIFY_SCRIPT);
    // git init for git_status / git_diff (even though we don't expect them used here).
    spawnSync("git", ["init", "-q"], { cwd: workspaceRoot, windowsHide: true });
    spawnSync("git", ["config", "user.email", "x@x"], { cwd: workspaceRoot, windowsHide: true });
    spawnSync("git", ["config", "user.name", "x"], { cwd: workspaceRoot, windowsHide: true });
    spawnSync("git", ["add", "."], { cwd: workspaceRoot, windowsHide: true });
    spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: workspaceRoot, windowsHide: true });

    storage = new Storage(":memory:");
    workspaceId = storage.upsertWorkspace(workspaceRoot).id;

    const llm: ChatLLMProvider = createLLMProvider({
      provider: "custom",
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
      temperature: 0,
      maxTokens: 2048,
      timeoutSeconds: 180,
    });

    driver = makeDriver({
      storage,
      resolveLLM: () => llm,
      getAgentSettings: () => settings,
      getLanguage: () => "en-US",
      emit: () => {},
    });
    console.log(`\n[I] workspace=${workspaceRoot}`);
  });

  afterAll(async () => {
    if (runId) printRunTrace(storage, runId, "I.complex-verify-repair");
    try { storage?.close(); } catch { /* ignore */ }
    if (workspaceRoot) await fsp.rm(workspaceRoot, { recursive: true, force: true });
  });

  it("fixes the bugs and proves verify.py passes", async () => {
    const task = [
      "The workspace contains a buggy `calculator.py` and a `verify.py` script that exercises it.",
      "Do the following in order, using one tool call at a time:",
      "  (1) read_file calculator.py and verify.py so you understand the contract.",
      "  (2) run_command:  python verify.py    # observe which assertion fails.",
      "  (3) apply_patch on calculator.py to fix every bug you saw. You may need more than one patch.",
      "  (4) run_command:  python verify.py    # confirm 'All tests passed.' (exit code 0).",
      "  (5) report in one sentence what you changed.",
      "",
      "Note: the docker sandbox auto-verify command (pytest) is NOT installed in the image; if you see",
      "'pytest: command not found' after apply_patch, that is the framework's automatic verify, ignore",
      "it and proceed with your own `python verify.py` run.",
    ].join("\n");
    const detail = await driver.runAndWait(workspaceId, task);
    runId = detail.run.id;

    console.log(`[I] outcome status=${detail.run.status} exit=${detail.run.exitReason ?? "-"} toolCalls=${detail.run.toolCallCount}`);

    // Disk should be fixed.
    const finalCalc = await fsp.readFile(path.join(workspaceRoot, "calculator.py"), "utf8");
    console.log(`[I] final calculator.py:\n${finalCalc}`);
    // add fix: return a + b ; mul fix: return a * b
    expect(finalCalc).toMatch(/return\s+a\s*\+\s*b/);
    expect(finalCalc).toMatch(/return\s+a\s*\*\s*b/);

    // Snapshots: at least one apply_patch happened.
    const snaps = storage.listSnapshots(detail.run.id);
    expect(snaps.length).toBeGreaterThan(0);

    // The agent must have run python verify.py at least twice (initial fail + post-fix pass).
    const steps = storage.listSteps(detail.run.id);
    const verifyRuns = steps.filter(
      (s) => s.type === "tool_call" && s.content.includes("python verify.py"),
    );
    console.log(`[I] python verify.py invocations: ${verifyRuns.length}`);
    expect(verifyRuns.length).toBeGreaterThanOrEqual(2);
  }, 600_000);
});

describeReal("II. Agent-call-agent — multi-agent mode", () => {
  let workspaceRoot: string;
  let storage: Storage;
  let workspaceId: string;
  let driver: ReturnType<typeof makeDriver>;
  let runId: string | null = null;

  const settings: AgentSettings = {
    ...DEFAULT_SETTINGS.agent,
    workspacePath: "",
    allowShellExecution: true,
    requireConfirmationBeforeCommand: false,
    sandboxEnabled: true,
    sandboxMode: "docker",
    maxAutoSteps: 32,
    budgetUsd: 3.0,
    readOnly: false,
    multiAgentEnabled: true, // <-- the switch
  };

  beforeAll(async () => {
    workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "coding-agent-multiagent-"));
    settings.workspacePath = workspaceRoot;
    // Empty workspace: planner sees a clean canvas. Add a README so list_files
    // returns something for the planner's discovery turn.
    await fsp.writeFile(
      path.join(workspaceRoot, "README.md"),
      "# multi-agent fixture\n\nUsed by the Phase-3 multi-agent debug harness.\n",
    );
    spawnSync("git", ["init", "-q"], { cwd: workspaceRoot, windowsHide: true });
    spawnSync("git", ["config", "user.email", "x@x"], { cwd: workspaceRoot, windowsHide: true });
    spawnSync("git", ["config", "user.name", "x"], { cwd: workspaceRoot, windowsHide: true });
    spawnSync("git", ["add", "."], { cwd: workspaceRoot, windowsHide: true });
    spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: workspaceRoot, windowsHide: true });

    storage = new Storage(":memory:");
    workspaceId = storage.upsertWorkspace(workspaceRoot).id;

    const llm: ChatLLMProvider = createLLMProvider({
      provider: "custom",
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
      temperature: 0,
      // Multi-agent needs more headroom: planner DAG payload + coder patch +
      // reviewer JSON verdict all spend output tokens. 4096 keeps each role safe.
      maxTokens: 4096,
      timeoutSeconds: 180,
    });

    driver = makeDriver({
      storage,
      resolveLLM: () => llm,
      getAgentSettings: () => settings,
      getLanguage: () => "en-US",
      emit: () => {},
    });
    console.log(`\n[II] workspace=${workspaceRoot}`);
  });

  afterAll(async () => {
    if (runId) {
      printRunTrace(storage, runId, "II.multi-agent");
      printMultiAgentExtras(storage, runId);
    }
    try { storage?.close(); } catch { /* ignore */ }
    if (workspaceRoot) await fsp.rm(workspaceRoot, { recursive: true, force: true });
  });

  it("Planner→Coder→Reviewer produces hello.py + verify_hello.py", async () => {
    const detail = await driver.runAndWait(workspaceId, HELLO_TASK_DESC);
    runId = detail.run.id;
    console.log(
      `[II] outcome status=${detail.run.status} exit=${detail.run.exitReason ?? "-"} ` +
        `toolCalls=${detail.run.toolCallCount} iters=${detail.run.iterationCount}`,
    );

    // Multi-agent specific artifacts: at least one task node and at least
    // one role message should have been persisted.
    const nodes = storage.listTaskNodes(detail.run.id);
    console.log(`[II] task_nodes (${nodes.length}):`);
    for (const n of nodes) {
      console.log(`    id=${n.id} status=${n.status} title=${n.title.slice(0, 80)}`);
    }
    expect(nodes.length).toBeGreaterThan(0);

    // Each node has its own role_messages stream. Sum them and report the
    // role transitions observed across the whole run.
    let totalMessages = 0;
    const transitions = new Set<string>();
    for (const n of nodes) {
      const msgs = storage.listRoleMessages(n.id);
      totalMessages += msgs.length;
      for (const m of msgs) transitions.add(`${m.fromRole}→${m.toRole}`);
    }
    console.log(`[II] role messages total: ${totalMessages}`);
    console.log(`[II] role transitions observed: ${[...transitions].join(", ")}`);
    expect(totalMessages).toBeGreaterThan(0);
    // We should at least see planner→orchestrator (the breakdown handoff).
    expect([...transitions].some((t) => t.startsWith("planner"))).toBe(true);

    // Soft check: hello.py and verify_hello.py should exist on disk if the
    // Coder phase produced the expected files. The reviewer might reject
    // (and the orchestrator default-cancels on escalation), so we don't make
    // this hard-fail — but we log it loudly so the trace shows the truth.
    const helloExists = fs.existsSync(path.join(workspaceRoot, "hello.py"));
    const verifyExists = fs.existsSync(path.join(workspaceRoot, "verify_hello.py"));
    console.log(`[II] hello.py exists: ${helloExists}`);
    console.log(`[II] verify_hello.py exists: ${verifyExists}`);
    if (helloExists) {
      const hello = await fsp.readFile(path.join(workspaceRoot, "hello.py"), "utf8");
      console.log(`[II] hello.py content:\n${hello}`);
    }
  }, 900_000);
});

describe("complex-multiagent (preflight)", () => {
  it("reports skip reason when LLM_API_KEY / LLM_BASE_URL unset", () => {
    if (!HAS_KEY) {
      console.log("[complex-multiagent] Skipped: set LLM_API_KEY and LLM_BASE_URL.");
    } else if (!DEBUG_ENABLED) {
      console.log(
        "[complex-multiagent] Skipped: set RUN_AGENT_DEBUG_TESTS=1 to run the real-LLM debug harness.",
      );
    }
    expect(true).toBe(true);
  });
});

// ---- shared trace printers ----

function printRunTrace(storage: Storage, runId: string, label: string): void {
  const run = storage.getRun(runId);
  if (!run) return;
  console.log(`\n=== TRACE [${label}] run=${runId.slice(0, 8)} status=${run.status} exit=${run.exitReason ?? "-"} ===`);
  console.log(`    task: ${run.userTask.slice(0, 140).replace(/\n/g, " ")}`);
  console.log(`    tokens in=${run.inputTokens} out=${run.outputTokens} cost=$${(run.costUsd ?? 0).toFixed(4)}`);
  console.log(`    toolCalls=${run.toolCallCount} iterations=${run.iterationCount}`);
  const steps = storage.listSteps(runId);
  console.log(`    steps (${steps.length}):`);
  for (const s of steps) {
    const c = s.content.replace(/\n/g, "\\n").slice(0, 160);
    console.log(`      [${s.type}] ${c}`);
  }
  const snaps = storage.listSnapshots(runId);
  if (snaps.length > 0) {
    console.log(`    snapshots (${snaps.length}):`);
    for (const s of snaps) {
      console.log(
        `      ${s.filePath} before=${s.beforeContent.length}B after=${s.afterContent?.length ?? 0}B iter=${s.iteration}`,
      );
    }
  }
}

function printMultiAgentExtras(storage: Storage, runId: string): void {
  const nodes = storage.listTaskNodes(runId);
  console.log(`\n=== MULTI-AGENT EXTRAS ===`);
  console.log(`task_nodes (${nodes.length}):`);
  for (const n of nodes) {
    console.log(
      `  ${n.id} status=${n.status} title=${n.title.replace(/\n/g, " ").slice(0, 80)}`,
    );
    if (n.filesScope && n.filesScope.length > 0) {
      console.log(`    filesScope: ${n.filesScope.join(", ")}`);
    }
    if (n.verifyCommand) console.log(`    verifyCommand: ${n.verifyCommand}`);
    const msgs = storage.listRoleMessages(n.id);
    console.log(`    role messages (${msgs.length}):`);
    for (const m of msgs) {
      const payload = JSON.stringify(m.payload).slice(0, 100);
      console.log(`      [${m.fromRole}→${m.toRole}] kind=${m.kind} payload=${payload}`);
    }
  }
  console.log("===========================\n");
}
