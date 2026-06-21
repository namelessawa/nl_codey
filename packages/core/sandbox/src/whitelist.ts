import { SANDBOX_CODES, SandboxError } from "./errors.js";

/**
 * Exact-match whitelist of validation commands allowed in Phase 1.
 * Only these literal strings may ever reach the command runner.
 */
export const ALLOWED_COMMANDS: readonly string[] = [
  "npm test",
  "npm run test",
  "npm run build",
  "pnpm test",
  "pnpm build",
  "yarn test",
  "yarn build",
  "pytest",
  "pytest .",
  "go test ./...",
  "cargo test",
  "tsc --noEmit",
  "npx tsc --noEmit",
];

const ALLOWED_SET = new Set(ALLOWED_COMMANDS);

/**
 * Patterns that must never appear in a command, even if it somehow passed the
 * exact-match check. Defense in depth against injection / destructive ops.
 */
const DANGEROUS_PATTERNS: readonly RegExp[] = [
  /[;&|`]/, // command chaining / piping / backticks
  /\$\(/, // command substitution
  /<|>/, // redirection
  /\brm\s+-rf\b/i,
  /\bdel\s+\/s\b/i,
  /\bformat\b/i,
  /\bcurl\b[\s\S]*\|/i, // curl | sh
  /\bwget\b[\s\S]*\|/i,
  /invoke-webrequest/i,
  /invoke-expression/i,
  /\biex\b/i,
  /\bpowershell\b/i,
];

/** Normalize whitespace so "npm   test " matches "npm test". */
export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

export function isCommandAllowed(command: string): boolean {
  const normalized = normalizeCommand(command);
  if (!ALLOWED_SET.has(normalized)) return false;
  return !DANGEROUS_PATTERNS.some((re) => re.test(normalized));
}

/**
 * Assert a command is safe to run. Returns the normalized command on success,
 * throws SandboxError otherwise.
 */
export function assertCommandAllowed(command: string): string {
  const normalized = normalizeCommand(command);
  if (DANGEROUS_PATTERNS.some((re) => re.test(normalized))) {
    throw new SandboxError(
      SANDBOX_CODES.dangerousCommand,
      `Command rejected as dangerous: ${command}`,
    );
  }
  if (!ALLOWED_SET.has(normalized)) {
    throw new SandboxError(
      SANDBOX_CODES.commandNotAllowed,
      `Command not in whitelist: ${command}`,
    );
  }
  return normalized;
}
