/** Server-Sent-Events parsing for streaming chat responses. */

/**
 * Iterate raw lines from a fetch Response body (web ReadableStream of bytes),
 * splitting on LF and stripping a trailing CR. Honors an abort signal between
 * reads. Used to decode SSE streams from OpenAI/Anthropic.
 */
export async function* sseLines(
  res: Response,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const body = res.body as ReadableStream<Uint8Array> | null;
  if (!body) throw new Error("Streaming response has no body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        yield line;
        idx = buffer.indexOf("\n");
      }
    }
    const tail = buffer.replace(/\r$/, "");
    if (tail.length > 0) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Yield the JSON payload after each `data:` SSE line. The OpenAI sentinel
 * `[DONE]` is skipped; both OpenAI and Anthropic embed an event `type` inside
 * the data object, so callers parse the JSON to dispatch.
 */
export async function* sseData(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  for await (const line of sseLines(res, signal)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trimStart();
    if (!payload || payload === "[DONE]") continue;
    yield payload;
  }
}
