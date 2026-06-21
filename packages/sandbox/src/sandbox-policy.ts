import type {
  SandboxMode,
  SandboxPolicy,
  SandboxRunRequest,
} from "@nlc/shared";
import { SANDBOX_CODES, SandboxError } from "./errors.js";

/**
 * Select the execution mode for a run from the active policy.
 *
 * Routing is intentionally trivial today (the policy carries the mode), but a
 * dedicated function keeps the decision in one place so future heuristics
 * (e.g. fall back to whitelist when Docker is unavailable) have a home.
 */
export function routeMode(policy: SandboxPolicy): SandboxMode {
  return policy.mode;
}

/** Human-readable description of a mode, for logs and the GUI. */
export function describeMode(mode: SandboxMode): string {
  switch (mode) {
    case "whitelist":
      return "Whitelist (host, exact-match allowlist)";
    case "wsl":
      return "WSL (Linux subsystem, workspace copy)";
    case "docker":
      return "Docker (ephemeral container, bind-mounted workspace)";
    default:
      return mode;
  }
}

/**
 * Conservative tokens that indicate network egress tooling. We only block when
 * such a tool appears AND an external destination (a host that is not localhost)
 * is referenced. This avoids false positives on, e.g., a script literally named
 * `curl-test` while still catching `curl https://evil.example`.
 */
const NETWORK_TOOLS: readonly RegExp[] = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bnc\b/i,
  /\bncat\b/i,
  /\bnetcat\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\bsftp\b/i,
  /\btelnet\b/i,
  /\bftp\b/i,
];

/** A URL or bare host:port that is not a loopback/local address. */
const EXTERNAL_HOST = /\b(?:https?:\/\/|ftp:\/\/|[\w.-]+:\d+|[\w-]+\.[\w.-]+)\b/i;

/** Loopback / local references that are allowed even when network is off. */
const LOCAL_HOST = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|::1)\b/i;

/**
 * Absolute paths that point at the host filesystem rather than the sandbox
 * working directory. We reject these to stop a sandboxed command from reaching
 * back out to read host files (e.g. `cat C:\Users\me\.ssh\id_rsa`,
 * `cat /etc/passwd`). The sandbox always executes with cwd at the workspace,
 * so legitimate commands use relative paths.
 */
const HOST_ABSOLUTE_PATH: readonly RegExp[] = [
  // Windows drive-letter paths: C:\... or C:/...
  /\b[a-zA-Z]:[\\/]/,
  // UNC / WSL host shares: \\server\share or \\wsl$\...
  /\\\\[^\s\\]/,
  // Unix absolute paths to sensitive/host locations.
  /(?:^|\s)\/(?:etc|root|home|proc|sys|dev|var|usr|bin|sbin|boot|mnt)\b/,
  // Explicit traversal out of the working directory.
  /(?:^|[\s"'=])\.\.[\\/]/,
];

/**
 * Defensive guard run BEFORE a command is handed to a strong-sandbox runner
 * (WSL/Docker). It rejects obvious host-escape attempts:
 *
 *  - Absolute host paths or `..` traversal embedded in the command. Sandboxed
 *    commands run with cwd at the workspace and must stay relative.
 *  - Network egress tools targeting an external host when `allowNetwork` is
 *    false (policy/request opt-out). Loopback references are permitted.
 *
 * These are conservative pattern checks (defense in depth), not a full shell
 * parser. The container/WSL layer provides the real isolation (`--network=none`,
 * a copied workspace); this catches misuse earlier and produces a clear error.
 *
 * Throws {@link SandboxError} on a violation.
 */
export function assertNoSandboxEscape(req: SandboxRunRequest): void {
  const command = req.command ?? "";
  if (command.trim().length === 0) {
    throw new SandboxError(
      SANDBOX_CODES.dangerousCommand,
      "Empty command rejected by sandbox guard",
    );
  }

  for (const pattern of HOST_ABSOLUTE_PATH) {
    if (pattern.test(command)) {
      throw new SandboxError(
        SANDBOX_CODES.pathEscape,
        `Command references a host path outside the workspace: ${command}`,
      );
    }
  }

  if (!req.allowNetwork) {
    const usesNetworkTool = NETWORK_TOOLS.some((re) => re.test(command));
    if (usesNetworkTool && !LOCAL_HOST.test(command) && EXTERNAL_HOST.test(command)) {
      throw new SandboxError(
        SANDBOX_CODES.networkDenied,
        `Network egress denied (allowNetwork=false): ${command}`,
      );
    }
  }
}
