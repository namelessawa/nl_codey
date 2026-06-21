import { describe, it, expect } from "vitest";

import { runPool } from "./worker-pool.js";

describe("runPool", () => {
  it("processes every item", async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n);
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    await runPool(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("caps concurrency at MAX_WORKERS even when a larger limit is passed", async () => {
    let active = 0;
    let peak = 0;
    await runPool(Array.from({ length: 12 }, (_, i) => i), 10, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("propagates the first worker error", async () => {
    await expect(
      runPool([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("returns immediately for an empty item list", async () => {
    await expect(runPool([], 3, async () => {})).resolves.toBeUndefined();
  });
});
