import { beforeEach, describe, expect, it, vi } from "vitest";

const { ipcHandle } = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: ipcHandle },
}));

import { handle, redactCommandErrorOutput } from "./ipc-handle.js";

describe("Desktop IPC error boundary", () => {
  beforeEach(() => {
    ipcHandle.mockReset();
  });

  it("returns only bounded redacted errors to the renderer", async () => {
    handle("test:redaction", () => {
      throw new Error(
        "Authorization: Bearer ipc-secret\n" +
          "C:\\Users\\alice\\.config?token=query-secret " +
          "x".repeat(5_000),
      );
    });
    const registered = ipcHandle.mock.calls[0]?.[1] as
      | ((event: unknown) => Promise<{ ok: false; error: string }>)
      | undefined;

    expect(registered).toBeTypeOf("function");
    const result = await registered!({});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("[REDACTED]");
    expect(result.error).toContain("[USER_HOME]");
    expect(result.error).not.toMatch(/ipc-secret|query-secret|alice/);
    expect(result.error.length).toBeLessThanOrEqual(4_000);
  });

  it("redacts failed direct-command output without rewriting successful data", () => {
    const failed = redactCommandErrorOutput({
      command: "pnpm test?token=command-secret",
      stdout: "Authorization: Bearer stdout-secret",
      stderr: "C:\\Users\\alice\\.npmrc?token=stderr-secret",
      exitCode: 1,
      timedOut: false,
    });
    const successful = {
      command: "pnpm test",
      stdout: "token=example in successful user data",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    };

    expect(JSON.stringify(failed)).not.toMatch(
      /command-secret|stdout-secret|stderr-secret|alice/,
    );
    expect(failed.stderr).toContain("[USER_HOME]");
    expect(redactCommandErrorOutput(successful)).toBe(successful);
  });
});
