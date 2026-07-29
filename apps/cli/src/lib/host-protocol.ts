import readline from "node:readline";
import type { Readable } from "node:stream";

export const MAX_HOST_MESSAGE_BYTES = 4_096;

export type HostApprovalDecision = "approve" | "reject";

type HostApprovalMessage = {
  kind: "approval";
  runId: string;
  decision: HostApprovalDecision;
};

/**
 * Parse one host approval message. Any malformed, oversized, stale, or
 * cross-run message fails closed instead of authorizing a mutation.
 */
export function parseHostApproval(
  raw: string,
  expectedRunId: string,
): HostApprovalDecision | null {
  if (
    expectedRunId.length === 0 ||
    Buffer.byteLength(raw, "utf8") > MAX_HOST_MESSAGE_BYTES
  ) {
    return null;
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(candidate)) return null;

  const message = candidate as Partial<HostApprovalMessage>;
  if (
    message.kind !== "approval" ||
    message.runId !== expectedRunId ||
    (message.decision !== "approve" && message.decision !== "reject")
  ) {
    return null;
  }
  return message.decision;
}

/**
 * Read exactly one line from the private host channel. EOF and invalid input
 * are rejection outcomes; the normal interactive prompt is never used.
 */
export function readHostApproval(
  input: Readable,
  expectedRunId: string,
): Promise<boolean> {
  const reader = readline.createInterface({ input, terminal: false });
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (approved: boolean): void => {
      if (settled) return;
      settled = true;
      reader.close();
      resolve(approved);
    };

    reader.once("line", (line) => {
      finish(parseHostApproval(line, expectedRunId) === "approve");
    });
    reader.once("close", () => finish(false));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
