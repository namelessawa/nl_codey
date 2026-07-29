import { describe, expect, it } from "vitest";
import {
  appendBounded,
  MAX_STREAM_ITEMS,
  MAX_TRACE_ITEMS,
} from "./use-loop.js";

describe("[tui] stream and trace bounds", () => {
  it("retains only the newest 500 message items without mutating the input", () => {
    const original = Array.from(
      { length: MAX_STREAM_ITEMS },
      (_, index) => `message-${index}`,
    );
    const bounded = appendBounded(original, "message-500", MAX_STREAM_ITEMS);

    expect(original).toHaveLength(MAX_STREAM_ITEMS);
    expect(original[0]).toBe("message-0");
    expect(bounded).toHaveLength(MAX_STREAM_ITEMS);
    expect(bounded[0]).toBe("message-1");
    expect(bounded.at(-1)).toBe("message-500");
  });

  it("retains only the newest 200 trace items", () => {
    let trace: number[] = [];
    for (let index = 0; index < MAX_TRACE_ITEMS + 25; index += 1) {
      trace = appendBounded(trace, index, MAX_TRACE_ITEMS);
    }

    expect(trace).toHaveLength(MAX_TRACE_ITEMS);
    expect(trace[0]).toBe(25);
    expect(trace.at(-1)).toBe(224);
  });
});
