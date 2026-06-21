import { describe, it, expect } from "vitest";

import { LockManager } from "./lock-manager.js";

describe("LockManager", () => {
  it("grants an uncontended lock immediately", async () => {
    const locks = new LockManager();
    await expect(locks.acquire("a.ts", "w1")).resolves.toBeUndefined();
  });

  it("hands a contended lock to the waiter once released", async () => {
    const locks = new LockManager();
    await locks.acquire("a.ts", "w1");

    let acquired = false;
    const waiting = locks.acquire("a.ts", "w2", 1000).then(() => {
      acquired = true;
    });

    expect(acquired).toBe(false);
    locks.release("a.ts", "w1");
    await waiting;
    expect(acquired).toBe(true);
  });

  it("detects deadlock: two holders waiting on each other's lock time out", async () => {
    // Arrange: w1 holds a, w2 holds b.
    const locks = new LockManager();
    await locks.acquire("a.ts", "w1");
    await locks.acquire("b.ts", "w2");

    // Act: w1 waits on b (held by w2), w2 waits on a (held by w1). Neither
    // releases, so with a short timeout at least one acquire must reject.
    const results = await Promise.allSettled([
      locks.acquire("b.ts", "w1", 50),
      locks.acquire("a.ts", "w2", 50),
    ]);

    // Assert: the cycle is broken — at least one acquire rejected.
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/deadlock|timed out/i);
  });

  it("releaseAll frees every lock held by a holder", async () => {
    const locks = new LockManager();
    await locks.acquire("a.ts", "w1");
    await locks.acquire("b.ts", "w1");

    locks.releaseAll("w1");

    await expect(locks.acquire("a.ts", "w2")).resolves.toBeUndefined();
    await expect(locks.acquire("b.ts", "w2")).resolves.toBeUndefined();
  });
});
