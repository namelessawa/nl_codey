import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "ink-testing-library";
import stripAnsi from "strip-ansi";
import { Footer } from "./footer.js";
import { Header } from "./header.js";
import { LiveAgent } from "./live-agent.js";
import { MessageStream } from "./message-stream.js";
import { TerminalFrame } from "./terminal-frame.js";
import {
  deriveTerminalLayout,
  MIN_TERMINAL_COLUMNS,
  MIN_TERMINAL_ROWS,
} from "./terminal-layout.js";
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
          workspaceRoot="E:\\Users\\tester\\very-long-parent\\projects\\nl-codey"
          dataRoot="C:\\Users\\tester\\AppData\\Roaming\\nl-codey\\data"
          status="idle"
          isRunning={false}
          readOnly
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
    expect(frame).toContain("read-only");
    expect(
      frame.split("\n").find((line) => line.includes("NL_Codey")),
    ).toMatch(/nl-codey\s+read-only/);
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

  it("renders the documented 120x40 through 60x20 size matrix", () => {
    const sizes = [
      [120, 40, true],
      [100, 30, true],
      [80, 24, true],
      [60, 20, false],
    ] as const;
    const renderFrame = (columns: number, rows: number) => (
      <ThemeProvider initial="mono">
        <TerminalFrame
          layout={deriveTerminalLayout(columns, rows)}
          workspaceRoot="E:\\projects\\nl-codey"
          dataRoot="C:\\Users\\tester\\.nlc"
          status="idle"
          isRunning={false}
          readOnly={false}
          liveAgent={null}
          trace={[]}
          showIdleHint
        />
      </ThemeProvider>
    );
    const view = render(renderFrame(sizes[0][0], sizes[0][1]));

    for (const [columns, rows, traceVisible] of sizes) {
      view.rerender(renderFrame(columns, rows));
      const frame = plain(view.lastFrame());
      expect(frame).toContain("NL_Codey");
      expect(frame).toContain("(no messages yet");
      expect(frame).not.toContain("is too small");
      expect(frame.includes("trace")).toBe(traceVisible);
    }
  });

  it("uses a height-aware fallback below 60x20 and recovers at the boundary", () => {
    const renderFrame = (columns: number, rows: number) => (
      <ThemeProvider initial="mono">
        <TerminalFrame
          layout={deriveTerminalLayout(columns, rows)}
          workspaceRoot="E:\\projects\\nl-codey"
          dataRoot="C:\\Users\\tester\\.nlc"
          status="tool_use"
          isRunning
          readOnly
          liveAgent={null}
          trace={[]}
          showIdleHint={false}
        />
      </ThemeProvider>
    );
    const view = render(renderFrame(MIN_TERMINAL_COLUMNS - 1, MIN_TERMINAL_ROWS));

    let frame = plain(view.lastFrame());
    expect(frame).toContain("Terminal 59x20 is too small.");
    expect(frame).toContain("read-only");
    expect(frame).toContain("tool_use");
    expect(frame).toContain("Resize to at least 60x20");
    expect(frame).not.toContain("trace");

    view.rerender(renderFrame(MIN_TERMINAL_COLUMNS, MIN_TERMINAL_ROWS - 1));
    frame = plain(view.lastFrame());
    expect(frame).toContain("Terminal 60x19 is too small.");

    view.rerender(renderFrame(MIN_TERMINAL_COLUMNS, MIN_TERMINAL_ROWS));
    frame = plain(view.lastFrame());
    expect(frame).not.toContain("is too small");
    expect(frame).toContain("NL_Codey");
  });
});
