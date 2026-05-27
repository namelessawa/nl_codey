import { describe, it, expect } from "vitest";
import { isRunActive, isRunDisabled, runPreconditionError } from "./run-control.js";

describe("isRunActive", () => {
  it("is true for in-progress states", () => {
    expect(isRunActive("planning")).toBe(true);
    expect(isRunActive("searching")).toBe(true);
    expect(isRunActive("reading")).toBe(true);
    expect(isRunActive("editing")).toBe(true);
    expect(isRunActive("applying_patch")).toBe(true);
    expect(isRunActive("running_command")).toBe(true);
  });

  it("is false for terminal and idle states", () => {
    expect(isRunActive("idle")).toBe(false);
    expect(isRunActive("waiting_for_user_approval")).toBe(false);
    expect(isRunActive("done")).toBe(false);
    expect(isRunActive("failed")).toBe(false);
    expect(isRunActive("cancelled")).toBe(false);
  });
});

describe("isRunDisabled", () => {
  // Regression: the Run button used to be `disabled={isActive || !workspace}`.
  // With no workspace it was disabled, so onClick never fired and the user got
  // zero feedback. The Run button must stay clickable while idle regardless of
  // workspace, so the precondition guard can surface a visible error.
  it("does not disable Run when idle", () => {
    expect(isRunDisabled("idle")).toBe(false);
  });

  it("disables Run only while a run is active", () => {
    expect(isRunDisabled("planning")).toBe(true);
    expect(isRunDisabled("applying_patch")).toBe(true);
  });

  it("re-enables Run once the run reaches a non-active state", () => {
    expect(isRunDisabled("done")).toBe(false);
    expect(isRunDisabled("failed")).toBe(false);
    expect(isRunDisabled("waiting_for_user_approval")).toBe(false);
  });
});

describe("runPreconditionError", () => {
  it("returns 'Open a workspace first' when no workspace is open", () => {
    expect(runPreconditionError(false, "do something")).toBe("Open a workspace first");
  });

  it("returns 'Enter a task' when a workspace is open but the task is blank", () => {
    expect(runPreconditionError(true, "   ")).toBe("Enter a task");
  });

  it("returns null when a workspace is open and a task is provided", () => {
    expect(runPreconditionError(true, "fix the bug")).toBeNull();
  });

  it("treats workspace as the first failing precondition", () => {
    // No workspace AND blank task -> workspace message wins.
    expect(runPreconditionError(false, "")).toBe("Open a workspace first");
  });
});
