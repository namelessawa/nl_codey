import { describe, expect, it } from "vitest";
import * as browserShared from "./browser.js";
import * as nodeShared from "./index.js";

describe("shared browser export boundary", () => {
  it("keeps Node path helpers off the browser surface without removing them from Node", () => {
    expect("nlcRoot" in browserShared).toBe(false);
    expect("nlcSubdir" in browserShared).toBe(false);
    expect(nodeShared.nlcRoot).toBeTypeOf("function");
    expect(nodeShared.nlcSubdir).toBeTypeOf("function");
  });

  it("retains representative runtime and IPC exports for renderer consumers", () => {
    expect(browserShared.DEFAULT_BUDGET_LIMITS).toBeDefined();
    expect(browserShared.IPC.openWorkspace).toBe("agent:openWorkspace");
    expect(browserShared.isRunActive).toBeTypeOf("function");
  });
});
