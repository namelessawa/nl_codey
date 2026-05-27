import { describe, expect, it } from "vitest";
import { parsePlan, stripDiffFences } from "./prompts.js";
import { MockLLMProvider } from "./mock.js";
import { CODING_AGENT_PLAN_PROMPT, PATCH_GENERATION_PROMPT } from "./prompts.js";

describe("parsePlan", () => {
  it("parses clean JSON", () => {
    const plan = parsePlan('{"summary":"x","searchQueries":["a"],"likelyFiles":[],"suggestedCommands":["npm test"]}');
    expect(plan.summary).toBe("x");
    expect(plan.searchQueries).toEqual(["a"]);
    expect(plan.suggestedCommands).toEqual(["npm test"]);
  });

  it("tolerates surrounding prose / code fences", () => {
    const plan = parsePlan('Here is the plan:\n```json\n{"summary":"y"}\n```\nthanks');
    expect(plan.summary).toBe("y");
    expect(plan.searchQueries).toEqual([]);
  });

  it("throws on non-JSON", () => {
    expect(() => parsePlan("no json here")).toThrow();
  });
});

describe("stripDiffFences", () => {
  it("removes diff code fences", () => {
    expect(stripDiffFences("```diff\n--- a\n+++ b\n```")).toBe("--- a\n+++ b");
  });
});

describe("MockLLMProvider", () => {
  it("returns plan JSON for plan prompts", async () => {
    const provider = new MockLLMProvider();
    const out = await provider.complete({
      messages: [
        { role: "system", content: CODING_AGENT_PLAN_PROMPT },
        { role: "user", content: "add tests for parseConfig" },
      ],
    });
    const plan = parsePlan(out.text);
    expect(plan.searchQueries).toContain("parseConfig");
  });

  it("returns a unified diff for patch prompts", async () => {
    const provider = new MockLLMProvider();
    const out = await provider.complete({
      messages: [
        { role: "system", content: PATCH_GENERATION_PROMPT },
        { role: "user", content: "do the thing" },
      ],
    });
    expect(out.text).toContain("+++ b/AGENT_NOTES.md");
    expect(out.text).toContain("--- /dev/null");
  });
});
