import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "ink-testing-library";
import stripAnsi from "strip-ansi";
import { Approval } from "./approval.js";
import { Prompt } from "./prompt.js";
import { ProviderPicker } from "./provider-picker.js";
import { SkillInstallPicker } from "./skill-install-picker.js";
import { ThemeProvider } from "./theme-context.js";

afterEach(() => {
  cleanup();
});

function plain(frame: string | undefined): string {
  return stripAnsi(frame ?? "").replaceAll("\r", "");
}

async function inputReady(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("[tui-render] interactive inputs", () => {
  it("renders command suggestions, completes with Tab and submits the effect", async () => {
    const onCommand = vi.fn();
    const view = render(
      <ThemeProvider>
        <Prompt disabled={false} onSubmit={vi.fn()} onCommand={onCommand} />
      </ThemeProvider>,
    );

    await inputReady();
    view.stdin.write("/he");
    await vi.waitFor(() => {
      expect(plain(view.lastFrame())).toContain("command palette");
    });
    expect(plain(view.lastFrame())).toContain("/help");

    await inputReady();
    view.stdin.write("\t");
    await vi.waitFor(() => {
      expect(plain(view.lastFrame())).toContain('q="/help"');
    });
    await inputReady();
    view.stdin.write("\r");

    await vi.waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith({ kind: "show-help" });
    });
  });

  it("handles Windows DEL input before submitting a plain task", async () => {
    const onSubmit = vi.fn();
    const view = render(
      <ThemeProvider>
        <Prompt disabled={false} onSubmit={onSubmit} onCommand={vi.fn()} />
      </ThemeProvider>,
    );

    await inputReady();
    view.stdin.write("task");
    await inputReady();
    view.stdin.write("\u007f");
    await vi.waitFor(() => {
      expect(plain(view.lastFrame())).toContain("tas");
    });
    await inputReady();
    view.stdin.write("\r");

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("tas");
    });
  });

  it("previews bounded patch content and routes approval keys", async () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const view = render(
      <ThemeProvider>
        <Approval
          patch={Array.from({ length: 8 }, (_, index) => `line-${index}`).join("\n")}
          onApprove={onApprove}
          onReject={onReject}
        />
      </ThemeProvider>,
    );

    const frame = plain(view.lastFrame());
    expect(frame).toContain("[verify] pending patch");
    expect(frame).toContain("line-0");
    expect(frame).toContain("line-5");
    expect(frame).not.toContain("line-6");

    await inputReady();
    view.stdin.write("y");
    view.stdin.write("n");
    await vi.waitFor(() => {
      expect(onApprove).toHaveBeenCalledTimes(1);
      expect(onReject).toHaveBeenCalledTimes(1);
    });
  });

  it("labels command confirmation without presenting it as a patch", () => {
    const view = render(
      <ThemeProvider>
        <Approval
          patch="$ tsc --noEmit"
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />
      </ThemeProvider>,
    );

    const frame = plain(view.lastFrame());
    expect(frame).toContain("[verify] pending command");
    expect(frame).toContain("$ tsc --noEmit");
    expect(frame).toContain("to run");
    expect(frame).not.toContain("pending patch");
  });

  it("navigates both directions in the skill picker", async () => {
    const onPick = vi.fn();
    const skillDown = render(
      <ThemeProvider>
        <SkillInstallPicker
          pending={{ description: "audit production logs" }}
          busy={false}
          onPick={onPick}
          onCancel={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(plain(skillDown.lastFrame())).toContain("install target");
    await inputReady();
    skillDown.stdin.write("\u001B[B");
    await inputReady();
    skillDown.stdin.write("\r");
    await vi.waitFor(() => {
      expect(onPick).toHaveBeenCalledWith("global");
    });
    skillDown.unmount();

    const skillUp = render(
      <ThemeProvider>
        <SkillInstallPicker
          pending={{ description: "audit production logs" }}
          busy={false}
          onPick={onPick}
          onCancel={vi.fn()}
        />
      </ThemeProvider>,
    );
    await inputReady();
    skillUp.stdin.write("\u001B[A");
    await inputReady();
    skillUp.stdin.write("\r");
    await vi.waitFor(() => {
      expect(onPick).toHaveBeenCalledWith("both");
    });
  });

  it("navigates, advances and cancels the provider picker", async () => {
    const onCancel = vi.fn();
    const provider = render(
      <ThemeProvider>
        <ProviderPicker
          stored={{}}
          activeKey={null}
          onSubmit={vi.fn()}
          onCancel={onCancel}
        />
      </ThemeProvider>,
    );
    expect(plain(provider.lastFrame())).toContain("select a provider");
    await inputReady();
    provider.stdin.write("\u001B[A");
    await inputReady();
    provider.stdin.write("\u001B[B");
    await inputReady();
    provider.stdin.write("\r");
    await vi.waitFor(() => {
      expect(plain(provider.lastFrame())).toContain("[provider] base URL");
    });
    await inputReady();
    provider.stdin.write("\u001B");
    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });
});
