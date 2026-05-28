import { spawn } from "node:child_process";
import {
  SANDBOX_DEFAULT_TIMEOUT_MS,
  type SandboxPolicy,
  type SandboxRunRequest,
  type SandboxRunResult,
} from "@coding-agent/shared";
import { assertNoSandboxEscape } from "./sandbox-policy.js";
import { truncateOutput } from "./output.js";

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

    return runChild("wsl.exe", argv, req.command, timeoutMs);
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
): Promise<SandboxRunResult> {
  return new Promise<SandboxRunResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(bin, argv, { windowsHide: true });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
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
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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
