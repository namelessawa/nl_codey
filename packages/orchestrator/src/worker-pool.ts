/**
 * Bounded parallel execution. Each unit of work conceptually maps to a Worker
 * Thread, but for the controlled multi-agent loop what matters is the
 * concurrency cap (default 3): at most `limit` workers run at once.
 */

/** Hard cap on concurrent workers in a wave. */
export const MAX_WORKERS = 3;

/**
 * Run `worker` over every item with at most `limit` running concurrently.
 * Resolves once all items finish; rejects on the first worker error (after
 * in-flight workers settle).
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const effectiveLimit = Math.max(1, Math.min(limit, MAX_WORKERS));
  if (items.length === 0) return;

  let cursor = 0;
  let firstError: unknown = null;

  const runOne = async (): Promise<void> => {
    while (cursor < items.length && firstError == null) {
      const index = cursor++;
      const item = items[index] as T;
      try {
        await worker(item);
      } catch (err) {
        if (firstError == null) firstError = err;
      }
    }
  };

  const runners: Promise<void>[] = [];
  const count = Math.min(effectiveLimit, items.length);
  for (let i = 0; i < count; i++) {
    runners.push(runOne());
  }

  await Promise.all(runners);
  if (firstError != null) throw firstError;
}
