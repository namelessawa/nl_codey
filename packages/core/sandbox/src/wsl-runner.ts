import { spawn } from "node:child_process";
import {
  SANDBOX_DEFAULT_TIMEOUT_MS,
  type SandboxPolicy,
  type SandboxRunRequest,
  type SandboxRunResult,
} from "@nlc/shared";
import { assertNoSandboxEscape } from "./sandbox-policy.js";
import { truncateOutput, filteredEnv } from "./output.js";
import { terminateProcessTree } from "./process-tree.js";

const MAX_OUTPUT_BYTES = 100_000;
const DEFAULT_DISTRO = "Ubuntu";

/**
 * Runs a command inside a WSL distro. The workspace is referenced through WSL's
 * Windows-path interop (`--cd`), and network egress is left to the WSL network
 * stack unless the request opts in (a stricter per-distro firewall can be added
 * later). This runner validates the command with {@link assertNoSandboxEscape}
 * before spawning and never falls back to the host shell.
 */
export class WslRunner {
  async run(req: SandboxRunRequest, policy: SandboxPolicy): Promise<SandboxRunResult> {
    assertNoSandboxEscape(req);

    const distro = policy.wslDistro ?? DEFAULT_DISTRO;
    const timeoutMs = req.timeoutMs ?? SANDBOX_DEFAULT_TIMEOUT_MS;
    const allowNetwork = req.allowNetwork ?? policy.allowNetwork;
    const argv = this.buildArgv(req, distro, allowNetwork);

    return runChild("wsl.exe", argv, req.command, timeoutMs, "wsl", req.signal);
  }

  /**
   * `wsl.exe -d <distro> --cd <workspace> -- bash -lc <command>`.
   * When network is disallowed we prefix `unshare -n` so the command runs in a
   * fresh network namespace with no interfaces (best-effort; requires a distro
   * that permits unshare). The command itself is passed as a single argv slot,
   * never concatenated into a shell string on the host side.
   */
  private buildArgv(req: SandboxRunRequest, distro: string, allowNetwork: boolean): string[] {
    const bashCommand = allowNetwork
      ? req.command
      : `unshare -rn bash -lc ${shellQuote(req.command)}`;
    return [
      "-d",
      distro,
      "--cd",
      req.workspaceRoot,
      "--",
      "bash",
      "-lc",
      bashCommand,
    ];
  }
}

/** POSIX single-quote escaping for embedding inside a `bash -lc` string. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Spawn a child process, capture stdout/stderr (truncated), and enforce a
 * timeout. Returns a {@link SandboxRunResult} with `changedFiles: []` for this
 * pass. Never throws for non-zero exit — only for spawn failure.
 */
export async function runChild(
  bin: string,
  argv: string[],
  command: string,
  timeoutMs: number,
  mode: SandboxRunResult["mode"] = "wsl",
  signal?: AbortSignal,
): Promise<SandboxRunResult> {
  return new Promise<SandboxRunResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let terminationStarted = false;

    // Reject synchronously if the caller already aborted before spawn. We
    // never even start the child in that case.
    if (signal?.aborted) {
      const err = new Error("Sandbox command aborted before spawn") as Error & { name: string };
      err.name = "AbortError";
      reject(err);
      return;
    }

    // Whitelist the environment we pass downstream — strips OPENAI_API_KEY,
    // ANTHROPIC_API_KEY, GITHUB_TOKEN, etc. before they can leak to a tool's
    // stdout/stderr or be exfiltrated by a malicious script.
    const child = spawn(bin, argv, {
      windowsHide: true,
      env: filteredEnv(process.env),
      // A new POSIX process group lets cancellation reach descendants.
      // Windows uses taskkill's explicit /T process-tree traversal instead.
      detached: process.platform !== "win32",
    });

    const terminate = (): void => {
      if (terminationStarted) return;
      terminationStarted = true;
      terminateProcessTree(child);
    };

    const finish = (): void => {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    };

    // Abort listener: on user-initiated Stop, kill the child so the sandbox
    // process tree dies promptly instead of dragging out to the full 60s
    // timeout. The 'close' handler rejects with AbortError so routed command
    // writeback cannot inspect or apply a half-finished staging directory.
    const onAbort = (): void => {
      aborted = true;
      terminate();
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
      // Close the small race between the pre-spawn check and listener setup.
      if (signal.aborted) onAbort();
    }

    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
      if (aborted) {
        // Surface abort as a rejected promise rather than a normal result so
        // runCommandWithPolicy's writeback diff (which compares staging-to-
        // workspace) doesn't run against a half-finished mutation.
        const err = new Error("Sandbox command aborted") as Error & { name: string };
        err.name = "AbortError";
        reject(err);
        return;
      }
      resolve({
        command,
        mode,
        exitCode: code,
        stdout: truncateOutput(stdout, MAX_OUTPUT_BYTES).text,
        stderr: truncateOutput(stderr, MAX_OUTPUT_BYTES).text,
        timedOut,
        changedFiles: [],
      });
    });
  });
}
