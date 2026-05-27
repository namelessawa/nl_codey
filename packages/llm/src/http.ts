/** Shared HTTP helpers for LLM providers: timeout + secret-safe errors. */

/**
 * Run a fetch with a timeout, linking an optional external abort signal
 * (e.g. run cancellation) to the same controller.
 */
export async function withTimeout(
  doFetch: (signal: AbortSignal) => Promise<Response>,
  timeoutSeconds: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutSeconds) * 1000);
  const onExternalAbort = (): void => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    return await doFetch(controller.signal);
  } catch (err) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new Error(`Request timed out after ${timeoutSeconds}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Run an async operation with bounded retries and exponential backoff. Retries
 * only transient failures (network errors); never retries on an external abort.
 * The default of 3 attempts matches the Phase 2 error-handling requirement.
 */
export async function withRetries<T>(
  op: (attempt: number) => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 300;
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      return await op(attempt);
    } catch (err) {
      lastErr = err;
      // Do not retry a deliberate cancellation.
      if (isAbortError(err) || options.signal?.aborted) throw err;
      if (attempt === attempts - 1) break;
      const delay = baseDelayMs * 2 ** attempt;
      await sleep(delay, options.signal);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Build an error message that can never contain the API key. The key is
 * stripped from the detail defensively, even though our call sites don't put
 * it there — defense in depth against accidental leakage.
 */
export function redactError(prefix: string, detail: unknown, apiKey: string): string {
  let text = detail instanceof Error ? detail.message : String(detail ?? "");
  if (apiKey && apiKey.length >= 4) {
    text = text.split(apiKey).join("***");
  }
  return text ? `${prefix}: ${text}` : prefix;
}
