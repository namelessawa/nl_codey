/**
 * Shared, thread-safe budget across parallel workers. All charges are serialized
 * through a tiny promise-chain mutex so two concurrent workers can never both
 * read "remaining" and overspend.
 */

/** Minimal promise-chain mutex: runs critical sections one at a time. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  /** Run `fn` exclusively. Resolves/rejects with `fn`'s result. */
  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.tail.then(() => fn());
    // Keep the chain alive even if `fn` rejects, but don't swallow the error.
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/**
 * Tracks USD spend against a hard limit. `charge` is atomic: it either deducts
 * the full cost (returning true) or, if that would exceed the limit, deducts
 * nothing (returning false).
 */
export class BudgetController {
  private readonly mutex = new Mutex();
  private spentUsd = 0;
  private spentTokens = 0;

  constructor(private readonly limitUsd: number) {}

  /**
   * Attempt to charge `costUsd` (and record `tokens`). Returns false without
   * deducting if the charge would push total spend over the limit.
   */
  async charge(costUsd: number, tokens: number): Promise<boolean> {
    return this.mutex.runExclusive(() => {
      if (this.spentUsd + costUsd > this.limitUsd) return false;
      this.spentUsd += costUsd;
      this.spentTokens += tokens;
      return true;
    });
  }

  /** Total USD charged so far. */
  spent(): number {
    return this.spentUsd;
  }

  /** Total tokens charged so far. */
  tokensSpent(): number {
    return this.spentTokens;
  }

  /** USD left before the limit is hit (never negative). */
  remaining(): number {
    return Math.max(0, this.limitUsd - this.spentUsd);
  }
}
