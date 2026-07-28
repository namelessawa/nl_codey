import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "ink-testing-library";
import stripAnsi from "strip-ansi";
import { Footer } from "./footer.js";
import { Header } from "./header.js";
import { LiveAgent } from "./live-agent.js";
import { MessageStream } from "./message-stream.js";
import { ThemeProvider } from "./theme-context.js";
import { Trace } from "./trace.js";
import type { TraceItem } from "./use-loop.js";

afterEach(() => {
  cleanup();
});

function plain(frame: string | undefined): string {
  return stripAnsi(frame ?? "").replaceAll("\r", "");
}

describe("[tui-render] chrome and live state", () => {
  it("renders a semantic, ANSI-normalizable header and idle footer", () => {
    const view = render(
      <ThemeProvider initial="teal">
        <Header
          workspaceRoot="E:\\projects\\nl-codey"
          dataRoot="C:\\Users\\tester\\.nlc"
          status="idle"
          isRunning={false}
        />
        <Footer isRunning={false} awaitingApproval={false} />
      </ThemeProvider>,
    );

    const raw = view.lastFrame() ?? "";
    const frame = plain(raw);

    expect(raw).toContain("\u001B[");
    expect(frame).not.toContain("\u001B[");
    expect(frame).toContain("NL_Codey");
    expect(frame).toContain("projects");
    expect(frame).toContain("nl-codey");
    expect(frame).toContain("idle");
    expect(frame).toContain("commands");
    expect(frame).toContain("/exit");
  });

  it("switches footer affordances for running and approval states", () => {
    const view = render(
      <ThemeProvider>
        <Footer isRunning={true} awaitingApproval={false} />
      </ThemeProvider>,
    );

    expect(plain(view.lastFrame())).toContain("ctrl+c cancel");

    view.rerender(
      <ThemeProvider>
        <Footer isRunning={false} awaitingApproval />
      </ThemeProvider>,
    );

    const frame = plain(view.lastFrame());
    expect(frame).toContain("y apply");
    expect(frame).toContain("n reject");
  });

  it("keeps only the newest trace rows and renders the live agent cursor", () => {
    const trace: TraceItem[] = Array.from({ length: 8 }, (_, index) => ({
      id: `trace-${index}`,
      kind: index % 2 === 0 ? "tool_call" : "tool_result",
      label: `operation-${index}`,
      detail: `detail-${index}`,
      ts: index,
    }));
    const view = render(
      <ThemeProvider initial="mono">
        <Trace items={trace} visible />
        <LiveAgent
          item={{
            id: "live-1",
            role: "agent",
            label: "agent",
            text: "streaming answer",
          }}
        />
      </ThemeProvider>,
    );

    const frame = plain(view.lastFrame());
    expect(frame).toContain("trace");
    expect(frame).toContain("8");
    expect(frame).not.toContain("operation-0");
    expect(frame).toContain("operation-7");
    expect(frame).toContain("[agent] streaming answer");
  });

  it("redacts error rows at the final TUI render boundary", () => {
    const view = render(
      <ThemeProvider initial="mono">
        <MessageStream
          items={[
            {
              id: "error-1",
              role: "error",
              label: "error",
              text:
                "Authorization: Bearer tui-secret\nat " +
                "C:\\Users\\alice\\.ssh\\id_rsa",
            },
          ]}
        />
      </ThemeProvider>,
    );

    const frame = plain(view.lastFrame());
    expect(frame).toContain("[REDACTED]");
    expect(frame).toContain("[USER_HOME]");
    expect(frame).not.toMatch(/tui-secret|alice/);
  });
});
