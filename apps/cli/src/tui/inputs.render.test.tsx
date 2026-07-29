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
        <Prompt
          disabled={false}
          onSubmit={vi.fn()}
          onCommand={onCommand}
          onCancel={vi.fn()}
        />
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

  it("navigates command suggestions with Down and reverse Tab", async () => {
    const onCommand = vi.fn();
    const commandPrompt = () => (
      <ThemeProvider>
        <Prompt
          disabled={false}
          onSubmit={vi.fn()}
          onCommand={onCommand}
          onCancel={vi.fn()}
        />
      </ThemeProvider>
    );
    const down = render(commandPrompt());

    await inputReady();
    down.stdin.write("/");
    await inputReady();
    down.stdin.write("\u001B[B");
    await inputReady();
    down.stdin.write("\t");
    await vi.waitFor(() => {
      expect(plain(down.lastFrame())).toContain('q="/init"');
    });
    down.stdin.write("\r");
    await vi.waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith({ kind: "init", force: false });
    });
    down.unmount();

    const reverse = render(commandPrompt());
    await inputReady();
    reverse.stdin.write("/");
    await inputReady();
    reverse.stdin.write("\u001B[Z");
    await inputReady();
    reverse.stdin.write("\t");
    await inputReady();
    reverse.stdin.write("\r");
    await vi.waitFor(() => {
      expect(onCommand).toHaveBeenCalledWith({ kind: "exit" });
    });
  });

  it("handles Windows DEL input before submitting a plain task", async () => {
    const onSubmit = vi.fn();
    const view = render(
      <ThemeProvider>
        <Prompt
          disabled={false}
          onSubmit={onSubmit}
          onCommand={vi.fn()}
          onCancel={vi.fn()}
        />
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

  it("edits CJK text with Home, End, Left, Backspace and forward Delete", async () => {
    const onSubmit = vi.fn();
    const view = render(
      <ThemeProvider>
        <Prompt
          disabled={false}
          onSubmit={onSubmit}
          onCommand={vi.fn()}
          onCancel={vi.fn()}
        />
      </ThemeProvider>,
    );

    await inputReady();
    view.stdin.write("中🙂文");
    await inputReady();
    view.stdin.write("\u001B[H");
    await inputReady();
    view.stdin.write("\u001B[3~");
    await inputReady();
    view.stdin.write("\u001B[F");
    await inputReady();
    view.stdin.write("!");
    await inputReady();
    view.stdin.write("\u001B[D");
    await inputReady();
    view.stdin.write("\u007F");
    await inputReady();
    view.stdin.write("\r");

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("🙂!");
    });
  });

  it("recalls prompt history and prevents duplicate blank submission", async () => {
    const onSubmit = vi.fn();
    const view = render(
      <ThemeProvider>
        <Prompt
          disabled={false}
          onSubmit={onSubmit}
          onCommand={vi.fn()}
          onCancel={vi.fn()}
        />
      </ThemeProvider>,
    );

    await inputReady();
    view.stdin.write("remember me");
    await inputReady();
    view.stdin.write("\r");
    view.stdin.write("\r");
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    await inputReady();
    view.stdin.write("\u001B[A");
    await vi.waitFor(() => {
      expect(plain(view.lastFrame())).toContain("remember me");
    });
    await inputReady();
    view.stdin.write("\r");

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(2);
      expect(onSubmit).toHaveBeenLastCalledWith("remember me");
    });
  });

  it("handles Ctrl+W, Ctrl+U, Escape and two-stage idle Ctrl+C", async () => {
    const onCancel = vi.fn();
    const view = render(
      <ThemeProvider>
        <Prompt
          disabled={false}
          onSubmit={vi.fn()}
          onCommand={vi.fn()}
          onCancel={onCancel}
        />
      </ThemeProvider>,
    );

    await inputReady();
    view.stdin.write("alpha beta");
    await inputReady();
    view.stdin.write("\u0017");
    await vi.waitFor(() => {
      expect(plain(view.lastFrame())).toContain("alpha ");
      expect(plain(view.lastFrame())).not.toContain("beta");
    });
    view.stdin.write("\u0015");
    await inputReady();
    view.stdin.write("escape me");
    await inputReady();
    view.stdin.write("\u001B");
    await vi.waitFor(() => {
      expect(plain(view.lastFrame())).not.toContain("escape me");
    });

    view.stdin.write("draft");
    await inputReady();
    view.stdin.write("\u0003");
    await vi.waitFor(() => {
      expect(plain(view.lastFrame())).not.toContain("draft");
      expect(onCancel).not.toHaveBeenCalled();
    });
    await inputReady();
    view.stdin.write("\u0003");
    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  it("preserves input across hidden modal focus and submits multiline paste", async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const prompt = (hidden: boolean, disabled = hidden) => (
      <ThemeProvider>
        <Prompt
          disabled={disabled}
          hidden={hidden}
          onSubmit={onSubmit}
          onCommand={vi.fn()}
          onCancel={onCancel}
        />
      </ThemeProvider>
    );
    const view = render(prompt(false));

    await inputReady();
    view.stdin.write("draft");
    await inputReady();
    view.rerender(prompt(true));
    await inputReady();
    view.stdin.write(" leaked");
    await inputReady();
    view.rerender(prompt(false));
    await vi.waitFor(() => {
      expect(plain(view.lastFrame())).toContain("draft");
      expect(plain(view.lastFrame())).not.toContain("leaked");
    });

    view.rerender(prompt(false, true));
    await inputReady();
    view.stdin.write(" running leak");
    await inputReady();
    view.rerender(prompt(false));
    await vi.waitFor(() => {
      expect(plain(view.lastFrame())).toContain("draft");
      expect(plain(view.lastFrame())).not.toContain("running leak");
    });

    await inputReady();
    view.stdin.write("\u0015");
    await vi.waitFor(() => {
      expect(plain(view.lastFrame())).not.toContain("draft");
    });
    await inputReady();
    view.stdin.write("\u001B[200~第一行\r\n第二行\u001B[201~");
    await vi.waitFor(() => {
      expect(plain(view.lastFrame())).toContain("第一行↵第二行");
    });
    await inputReady();
    view.stdin.write("\r");

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("第一行\n第二行");
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
