/* eslint-disable no-console */
/**
 * docker-mode agent loop debug harness.
 *
 * Drives the real autonomous tool loop against a real LLM (custom OpenAI-
 * compatible proxy by default) with the **docker** sandbox policy active and
 * `allowShellExecution: true`. The model is instructed to call `run_command`
 * 4× with concrete inspection commands (`pwd`, `whoami`, `ls -la`,
 * `cat package.json`); each command is dispatched through
 * `runCommandWithPolicy` → `routeCommand` → `DockerRunner`, exercising the
 * real Phase-3 docker path end-to-end:
 *
 *   workspace → WorkspaceSandbox.prepare (staging copy under os.tmpdir())
 *             → docker run --rm --network=none --user 1000:1000
 *                  -v <staging>:/work -w /work python:3.12-slim sh -lc <cmd>
 *             → WorkspaceSandbox.diff (staging vs workspace)
 *             → writeback approval (auto-approve here)
 *
 * Skipped cleanly when LLM_API_KEY / LLM_BASE_URL are not set (in env or .env),
 * so `pnpm test` keeps green for contributors who don't want to spend tokens.
 *
 * Run interactively (verbose stdout):
 *   pnpm exec vitest run packages/agent-core/src/docker-loop.debug.test.ts --reporter=verbose
 *
 * Image: defaults to `python:3.12-slim` because we want to avoid Docker Hub
 * rate-limited pulls; override via DOCKER_DEBUG_IMAGE if you have another
 * tiny image cached locally.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  ChatLLMProvider,
  FileSnapshot,
  LLMToolCall,
  SandboxPolicy,
  ToolContext,
} from "@nlc/shared";
import type { FileChange } from "@nlc/sandbox";
import { createLLMProvider } from "@nlc/llm";

import { BudgetController } from "./budget.js";
import { runToolLoop } from "./loop.js";
import { agentToolSchemas, createToolExecutor } from "./tools-registry.js";

// --- minimal .env loader so vitest picks up the local secret without dotenv dep ---

function loadDotenv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
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
const MODEL = process.env.LLM_MODEL ?? "gpt-4o-mini";
const DOCKER_IMAGE = process.env.DOCKER_DEBUG_IMAGE ?? "python:3.12-slim";
const HAS_KEY = API_KEY.length > 0 && BASE_URL.length > 0;

const describeReal = HAS_KEY ? describe : describe.skip;

/**
 * Minimal SnapshotStore for the debug run. We don't need persistence — only a
 * structural match so `runCommandWithPolicy`'s writeback path can snapshot
 * before/after content without throwing. The recorded entries are logged
 * at the end so we can see what would have been written.
 */
function makeSnapshotStore(): {
  store: { addSnapshot: (runId: string, p: string, before: string) => FileSnapshot; setSnapshotAfter: (id: string, after: string) => void };
  log: { id: string; path: string; before: string; after?: string }[];
} {
  const log: { id: string; path: string; before: string; after?: string }[] = [];
  let next = 0;
  return {
    log,
    store: {
      addSnapshot(runId, p, before) {
        const id = `snap-${++next}`;
        log.push({ id, path: p, before });
        const snap: FileSnapshot = {
          id,
          runId,
          filePath: p,
          beforeContent: before,
          createdAt: 0,
        };
        return snap;
      },
      setSnapshotAfter(id, after) {
        const entry = log.find((e) => e.id === id);
        if (entry) entry.after = after;
      },
    },
  };
}

describeReal("docker-mode agent loop debug (custom OpenAI-compat)", () => {
  let workspaceRoot: string;

  beforeAll(async () => {
    workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), "coding-agent-docker-debug-"),
    );
    // Tiny fixture so WorkspaceSandbox.prepare's copy is fast.
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify(
        {
          name: "docker-debug-fixture",
          version: "0.0.1",
          description: "ephemeral fixture for docker-mode agent loop debug",
        },
        null,
        2,
      ),
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "README.md"),
      "# docker debug fixture\n\nThis directory is a throwaway workspace.\n",
    );
  });

  afterAll(async () => {
    if (workspaceRoot) {
      await fsp.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("drives run_command through the docker sandbox", async () => {
    console.log("\n========================================");
    console.log(`[debug] workspace : ${workspaceRoot}`);
    console.log(`[debug] base URL  : ${BASE_URL}`);
    console.log(`[debug] model     : ${MODEL}`);
    console.log(`[debug] image     : ${DOCKER_IMAGE}`);
    console.log("========================================\n");

    const llm: ChatLLMProvider = createLLMProvider({
      provider: "custom",
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
      temperature: 0,
      maxTokens: 1024,
      timeoutSeconds: 120,
    });

    const policy: SandboxPolicy = {
      mode: "docker",
      allowNetwork: false,
      dockerImage: DOCKER_IMAGE,
    };

    const { store: snapshotStore, log: snapshotLog } = makeSnapshotStore();

    const ctx: ToolContext = {
      workspaceRoot,
      runId: "docker-debug",
      signal: new AbortController().signal,
    };

    const writebackLog: { command: string; changes: FileChange[]; approved: boolean }[] = [];
    const execute = createToolExecutor({
      ctx,
      // structural cast — minimal store satisfies the surface used here.
      storage: snapshotStore as unknown as Parameters<typeof createToolExecutor>[0]["storage"],
      allowShellExecution: true,
      readOnly: false,
      sandboxPolicy: policy,
      requestSandboxWriteApproval: async (call, changes) => {
        const command =
          typeof call.args === "object" && call.args !== null && "command" in call.args
            ? String((call.args as Record<string, unknown>).command)
            : "(unknown)";
        console.log(`\n[writeback] command=${command} produced ${changes.length} change(s); auto-approving`);
        for (const c of changes) {
          console.log(`    ${c.kind}: ${c.path}`);
        }
        writebackLog.push({ command, changes, approved: true });
        return true;
      },
    });

    const tools = agentToolSchemas({ readOnly: false, phase3Available: false });

    const systemPrompt = [
      "You are a debugging assistant connected to a coding agent's docker sandbox.",
      "Use the run_command tool to inspect the sandboxed environment exactly as the user requests.",
      "Always emit the literal commands the user names — do NOT substitute or combine them.",
      "After each command's result, write a single short sentence describing what you observed, then proceed.",
    ].join(" ");

    const userTask = [
      "Run these four shell commands one at a time via run_command, in this order, exactly as written:",
      "  (1) pwd",
      "  (2) whoami",
      "  (3) ls -la",
      "  (4) cat package.json",
      "",
      "Important context: although the run_command tool description mentions",
      "'whitelisted validation commands', the user has configured a docker",
      "sandbox and ANY shell command is allowed. Issue pwd/whoami/ls/cat",
      "literally; do not refuse and do not switch to alternative commands.",
      "",
      "After all four commands have returned, give a one-sentence summary of",
      "what kind of environment this is (OS, user, working directory, project).",
    ].join("\n");

    let chunkCount = 0;
    const calls: LLMToolCall[] = [];
    let liveText = "";

    const outcome = await runToolLoop(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userTask },
      ],
      {
        llm,
        tools,
        budget: new BudgetController({
          maxIterations: 12,
          maxCostUsd: 1,
          maxToolCalls: 16,
          maxWallTimeMs: 300_000,
        }),
        signal: ctx.signal,
        temperature: 0,
        onChunk: (chunk) => {
          chunkCount++;
          if (chunk.type === "text_delta") {
            liveText += chunk.text;
          } else if (chunk.type === "tool_call") {
            if (liveText.trim()) {
              console.log(`\n[stream] ${liveText.trim()}`);
              liveText = "";
            }
            console.log(
              `[chunk] tool_call name=${chunk.name} args=${JSON.stringify(chunk.args).slice(0, 400)}`,
            );
          } else if (chunk.type === "finish") {
            if (liveText.trim()) {
              console.log(`\n[stream] ${liveText.trim()}`);
              liveText = "";
            }
            console.log(`[chunk] finish reason=${chunk.reason}`);
          } else if (chunk.type === "error") {
            console.log(`[chunk] error: ${chunk.message}`);
          }
        },
        onAssistant: (text, toolCalls, usage) => {
          console.log(
            `\n[turn] assistantText.len=${text.length} toolCalls=${toolCalls.length} ` +
              `usage=${JSON.stringify(usage)}`,
          );
        },
        // Defensive: reject any apply_patch the model might try. The task doesn't
        // need file writes; if the model goes off-script we'd rather stop the run.
        requiresApproval: (call) => call.name === "apply_patch",
        waitForApproval: async (call) => {
          if (call.name === "apply_patch") {
            console.log("[debug] apply_patch requested — rejected (debug task should not write).");
            return false;
          }
          return true;
        },
        onToolCall: (call) => {
          calls.push(call);
          console.log(`\n>>> TOOL CALL #${calls.length}: ${call.name}`);
          console.log(`    args: ${JSON.stringify(call.args)}`);
        },
        executeTool: async (call) => {
          const t0 = Date.now();
          const res = await execute(call);
          const ms = Date.now() - t0;
          const status = res.isError ? "ERR" : "OK";
          console.log(`<<< RESULT (${status}, ${ms}ms): ${res.resultText.slice(0, 800)}`);
          return res.resultText;
        },
      },
    );

    console.log("\n========================================");
    console.log(`[debug] outcome.state: ${outcome.state}`);
    if (outcome.state === "done") {
      console.log(`[debug] final text:\n${outcome.finalText}`);
    } else if (outcome.state === "failed") {
      console.log(`[debug] failure reason: ${outcome.reason}`);
    } else if (outcome.state === "budget_exceeded") {
      console.log(`[debug] budget reason: ${outcome.reason}`);
    }
    console.log(`[debug] chunks total      : ${chunkCount}`);
    console.log(`[debug] tool calls        : ${calls.length}`);
    console.log(
      `[debug] tool-call breakdown:\n${calls
        .map((c, i) => `    ${i + 1}. ${c.name}  ${JSON.stringify(c.args).slice(0, 120)}`)
        .join("\n")}`,
    );
    console.log(`[debug] writebacks        : ${writebackLog.length}`);
    console.log(`[debug] snapshot entries  : ${snapshotLog.length}`);
    console.log("========================================\n");

    // Assertions: tolerant of model drift. We want to confirm the docker
    // dispatch path actually ran — not that any particular model output came
    // back. Model failures (refusal, schema confusion) are visible in the log
    // above; this assertion only flags hard wiring breaks.
    expect(["done", "failed", "budget_exceeded"]).toContain(outcome.state);
    const runCmdCalls = calls.filter((c) => c.name === "run_command");
    expect(runCmdCalls.length).toBeGreaterThan(0);
  }, 600_000);
});

describe("docker-loop debug (preflight)", () => {
  it("reports skip reason when LLM_API_KEY / LLM_BASE_URL unset", () => {
    if (!HAS_KEY) {
      console.log(
        "[docker-debug] Skipped: set LLM_API_KEY and LLM_BASE_URL in env or .env to enable.",
      );
    }
    expect(true).toBe(true);
  });
});
