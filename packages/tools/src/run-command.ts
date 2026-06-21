import { spawn } from "node:child_process";
import { assertCommandAllowed, filteredEnv, truncateOutput } from "@nlc/sandbox";
import {
  type AgentTool,
  type RunCommandInput,
  type RunCommandOutput,
  TOOL_LIMITS,
} from "@nlc/shared";

/**
 * Run a whitelisted validation command in the workspace root. The command is
 * exact-matched against the sandbox whitelist before spawning, so running with
 * a shell carries no injection surface. Enforces timeout + output truncation.
 */
export const runCommandTool: AgentTool<RunCommandInput, RunCommandOutput> = {
  name: "run_command",
  description: "Run a whitelisted test/build command in the workspace root.",
  async run(input, ctx) {
    const command = assertCommandAllowed(input.command);
    const timeoutMs = input.timeoutMs ?? TOOL_LIMITS.commandTimeoutMs;

    return await new Promise<RunCommandOutput>((resolve) => {
      const child = spawn(command, {
        cwd: ctx.workspaceRoot,
        shell: true,
        env: filteredEnv(process.env),
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const cap = TOOL_LIMITS.maxCommandOutputBytes;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      const onAbort = (): void => {
        child.kill();
      };
      ctx.signal?.addEventListener("abort", onAbort);

      child.stdout?.on("data", (c: Buffer) => {
        if (Buffer.byteLength(stdout) < cap) stdout += c.toString("utf8");
      });
      child.stderr?.on("data", (c: Buffer) => {
        if (Buffer.byteLength(stderr) < cap) stderr += c.toString("utf8");
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        ctx.signal?.removeEventListener("abort", onAbort);
        resolve({
          command,
          exitCode: code,
          stdout: truncateOutput(stdout, cap).text,
          stderr: truncateOutput(stderr, cap).text,
          timedOut,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        ctx.signal?.removeEventListener("abort", onAbort);
        resolve({
          command,
          exitCode: null,
          stdout: truncateOutput(stdout, cap).text,
          stderr: `${stderr}\n${err.message}`,
          timedOut,
        });
      });
    });
  },
};
