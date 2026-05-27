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
