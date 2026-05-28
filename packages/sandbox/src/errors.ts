/** Errors thrown by sandbox guards. Carry a stable `code` for UI/logging. */
export class SandboxError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
  }
}

export const SANDBOX_CODES = {
  pathEscape: "PATH_ESCAPE",
  commandNotAllowed: "COMMAND_NOT_ALLOWED",
  dangerousCommand: "DANGEROUS_COMMAND",
  networkDenied: "NETWORK_DENIED",
  spawnFailed: "SPAWN_FAILED",
} as const;
