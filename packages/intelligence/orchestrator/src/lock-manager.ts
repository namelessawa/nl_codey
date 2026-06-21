/**
 * Work-tree file locks for parallel workers. A holder acquires an exclusive lock
 * on a file path before editing it; other holders wait. If a lock cannot be
 * acquired within the timeout, acquire rejects with a clear error — which is how
 * a deadlock (two holders each waiting on the other's lock) is broken.
 */

type Waiter = {
  holder: string;
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type LockState = {
  holder: string;
  waiters: Waiter[];
};

const DEFAULT_TIMEOUT_MS = 30_000;

export class LockManager {
  private readonly locks = new Map<string, LockState>();

  /**
   * Acquire an exclusive lock on `filePath` for `holder`. Resolves once held.
   * Rejects after `timeoutMs` if still waiting (likely contention/deadlock).
   */
  acquire(filePath: string, holder: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> {
    const existing = this.locks.get(filePath);
    if (!existing) {
      this.locks.set(filePath, { holder, waiters: [] });
      return Promise.resolve();
    }

    if (existing.holder === holder) {
      // Re-entrant acquire by the same holder is a no-op.
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const state = this.locks.get(filePath);
        if (state) {
          state.waiters = state.waiters.filter((w) => w.timer !== timer);
        }
        reject(
          new Error(
            `Lock acquire timed out after ${timeoutMs}ms: "${holder}" waiting on "${filePath}" held by "${existing.holder}" (possible deadlock).`,
          ),
        );
      }, timeoutMs);

      existing.waiters.push({ holder, resolve, reject, timer });
    });
  }

  /** Release `holder`'s lock on `filePath`, handing it to the next waiter. */
  release(filePath: string, holder: string): void {
    const state = this.locks.get(filePath);
    if (!state || state.holder !== holder) return;

    const next = state.waiters.shift();
    if (!next) {
      this.locks.delete(filePath);
      return;
    }

    clearTimeout(next.timer);
    state.holder = next.holder;
    next.resolve();
  }

  /** Release every lock `holder` owns and drop it from all waiter queues. */
  releaseAll(holder: string): void {
    for (const [filePath, state] of [...this.locks.entries()]) {
      // Remove holder from any waiter queues it sits in.
      state.waiters = state.waiters.filter((w) => {
        if (w.holder === holder) {
          clearTimeout(w.timer);
          return false;
        }
        return true;
      });
      if (state.holder === holder) {
        this.release(filePath, holder);
      }
    }
  }
}
