import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  MAX_HOST_MESSAGE_BYTES,
  parseHostApproval,
  readHostApproval,
} from "./host-protocol.js";

describe("[cli] host approval protocol", () => {
  it("accepts explicit decisions only for the pending run", () => {
    expect(
      parseHostApproval(
        JSON.stringify({
          kind: "approval",
          runId: "run-1",
          decision: "approve",
        }),
        "run-1",
      ),
    ).toBe("approve");
    expect(
      parseHostApproval(
        JSON.stringify({
          kind: "approval",
          runId: "run-1",
          decision: "reject",
        }),
        "run-1",
      ),
    ).toBe("reject");
  });

  it.each([
    ["malformed JSON", "not json"],
    [
      "wrong run",
      JSON.stringify({
        kind: "approval",
        runId: "run-2",
        decision: "approve",
      }),
    ],
    [
      "unknown decision",
      JSON.stringify({
        kind: "approval",
        runId: "run-1",
        decision: "yes",
      }),
    ],
    [
      "wrong message kind",
      JSON.stringify({
        kind: "event",
        runId: "run-1",
        decision: "approve",
      }),
    ],
  ])("fails closed for %s", (_label, raw) => {
    expect(parseHostApproval(raw, "run-1")).toBeNull();
  });

  it("rejects oversized messages before parsing", () => {
    expect(
      parseHostApproval(" ".repeat(MAX_HOST_MESSAGE_BYTES + 1), "run-1"),
    ).toBeNull();
  });

  it("reads one approval line without using an interactive prompt", async () => {
    const input = new PassThrough();
    const decision = readHostApproval(input, "run-1");
    input.end(
      `${JSON.stringify({
        kind: "approval",
        runId: "run-1",
        decision: "approve",
      })}\n`,
    );

    await expect(decision).resolves.toBe(true);
  });

  it("treats rejection, invalid input, and EOF as denial", async () => {
    const rejected = new PassThrough();
    const rejectedDecision = readHostApproval(rejected, "run-1");
    rejected.end(
      `${JSON.stringify({
        kind: "approval",
        runId: "run-1",
        decision: "reject",
      })}\n`,
    );
    await expect(rejectedDecision).resolves.toBe(false);

    const invalid = new PassThrough();
    const invalidDecision = readHostApproval(invalid, "run-1");
    invalid.end('{"kind":"approval","runId":"other","decision":"approve"}\n');
    await expect(invalidDecision).resolves.toBe(false);

    const closed = new PassThrough();
    const closedDecision = readHostApproval(closed, "run-1");
    closed.end();
    await expect(closedDecision).resolves.toBe(false);
  });
});
