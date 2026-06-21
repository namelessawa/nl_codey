import { describe, expect, it, vi } from "vitest";
import { isRetryableStatus, postWithRetries, withRetries } from "./http.js";

function response(status: number): Response {
  return new Response(status === 200 ? "ok" : `error ${status}`, { status });
}

describe("isRetryableStatus", () => {
  it("retries timeouts, rate limits, and transient 5xx", () => {
    for (const s of [408, 429, 500, 502, 503, 504]) expect(isRetryableStatus(s)).toBe(true);
  });

  it("does not retry client errors or success", () => {
    for (const s of [200, 201, 400, 401, 403, 404, 422]) expect(isRetryableStatus(s)).toBe(false);
  });
});

describe("withRetries", () => {
  it("returns the first successful result without retrying", async () => {
    const op = vi.fn(async () => "ok");
    expect(await withRetries(op, { attempts: 3, baseDelayMs: 1 })).toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures up to the attempt limit then throws", async () => {
    const op = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(withRetries(op, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow("network down");
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("never retries an aborted operation", async () => {
    const op = vi.fn(async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    await expect(withRetries(op, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow();
    expect(op).toHaveBeenCalledTimes(1);
  });
});

describe("postWithRetries", () => {
  it("returns immediately on a successful response", async () => {
    const doFetch = vi.fn(async () => response(200));
    const res = await postWithRetries(doFetch, { timeoutSeconds: 5, baseDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable status then succeeds", async () => {
    const statuses = [503, 200];
    let i = 0;
    const doFetch = vi.fn(async () => response(statuses[i++] ?? 200));
    const res = await postWithRetries(doFetch, { timeoutSeconds: 5, baseDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("returns the last response (with detail) after exhausting retries", async () => {
    const doFetch = vi.fn(async () => response(503));
    const res = await postWithRetries(doFetch, { timeoutSeconds: 5, attempts: 3, baseDelayMs: 1 });
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("503"); // final body is preserved for the caller
    expect(doFetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable status", async () => {
    const doFetch = vi.fn(async () => response(400));
    const res = await postWithRetries(doFetch, { timeoutSeconds: 5, baseDelayMs: 1 });
    expect(res.status).toBe(400);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });
});
