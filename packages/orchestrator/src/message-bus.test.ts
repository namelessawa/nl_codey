import { describe, it, expect, vi } from "vitest";

import type { RoleMessageRow, ReviewResult } from "@coding-agent/shared";

import {
  MessageBus,
  validateRoleMessage,
  serializeRow,
  parseRow,
} from "./message-bus.js";

const validReview: ReviewResult = {
  correctness: "pass",
  scope_compliance: "pass",
  regression_risk: "low",
  style_consistency: "pass",
  comments: [],
  verdict: "approved",
};

describe("validateRoleMessage", () => {
  it("accepts a well-formed breakdown from planner to orchestrator", () => {
    const result = validateRoleMessage("breakdown", "planner", "orchestrator", {
      breakdown: { root: "t1", tasks: [{ id: "t1", title: "x" }] },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a legal kind sent with an illegal role pairing", () => {
    const result = validateRoleMessage("breakdown", "coder", "reviewer", {
      breakdown: { root: "t1", tasks: [{ id: "t1", title: "x" }] },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a review_request missing required string fields", () => {
    const result = validateRoleMessage("review_request", "coder", "reviewer", {
      taskNodeId: "t1",
      diff: 42,
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a full ReviewResult shape", () => {
    const result = validateRoleMessage("review_result", "reviewer", "coder", validReview);
    expect(result.ok).toBe(true);
  });

  it("rejects a ReviewResult with an invalid verdict enum", () => {
    const result = validateRoleMessage("review_result", "reviewer", "coder", {
      ...validReview,
      verdict: "maybe",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown message kind", () => {
    // @ts-expect-error testing runtime guard against bad kinds
    const result = validateRoleMessage("chitchat", "coder", "reviewer", {});
    expect(result.ok).toBe(false);
  });
});

describe("MessageBus.send", () => {
  it("assigns id + createdAt, persists, and emits a valid message", () => {
    const persist = vi.fn();
    const emit = vi.fn();
    const bus = new MessageBus({ persist, emit });

    const msg = bus.send({
      taskNodeId: "t1",
      fromRole: "orchestrator",
      toRole: "coder",
      kind: "handoff",
      payload: { taskNodeId: "t1" },
    });

    expect(msg.id).toBeTruthy();
    expect(typeof msg.createdAt).toBe("number");
    expect(persist).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(msg);
  });

  it("throws and logs on an invalid message without persisting", () => {
    const persist = vi.fn();
    const logError = vi.fn();
    const bus = new MessageBus({ persist, logError });

    expect(() =>
      bus.send({
        taskNodeId: "t1",
        fromRole: "coder",
        toRole: "reviewer",
        kind: "handoff",
        payload: { taskNodeId: "t1" },
      }),
    ).toThrow();
    expect(persist).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledOnce();
  });
});

describe("serializeRow / parseRow round trip", () => {
  it("preserves a review_result message through serialization", () => {
    const persist = vi.fn();
    const bus = new MessageBus({ persist });
    const msg = bus.send({
      taskNodeId: "t1",
      fromRole: "reviewer",
      toRole: "coder",
      kind: "review_result",
      payload: validReview,
    });

    const row: RoleMessageRow = serializeRow(msg);
    const parsed = parseRow(row);
    expect(parsed.payload).toEqual(validReview);
    expect(parsed.id).toBe(msg.id);
  });

  it("throws when parsing a row whose payload fails validation", () => {
    const badRow: RoleMessageRow = {
      id: "x",
      taskNodeId: "t1",
      fromRole: "reviewer",
      toRole: "coder",
      kind: "review_result",
      payload: JSON.stringify({ verdict: "nope" }),
      createdAt: 1,
    };
    expect(() => parseRow(badRow)).toThrow();
  });
});
