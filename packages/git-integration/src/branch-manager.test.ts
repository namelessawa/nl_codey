import { describe, it, expect } from "vitest";
import { slugify, agentBranchName } from "./branch-manager.js";

describe("slugify", () => {
  it("converts a title to kebab-case ascii", () => {
    expect(slugify("Add User Login Flow")).toBe("add-user-login-flow");
  });

  it("strips diacritics and non-ascii characters", () => {
    expect(slugify("Café déjà vu")).toBe("cafe-deja-vu");
  });

  it("collapses runs of separators and trims edges", () => {
    expect(slugify("  fix:  the___bug!! ")).toBe("fix-the-bug");
  });

  it("caps the slug at 40 characters without a trailing dash", () => {
    const slug = slugify("a".repeat(60));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("falls back to 'task' when nothing usable remains", () => {
    expect(slugify("!!!")).toBe("task");
  });
});

describe("agentBranchName", () => {
  it("builds an agent/<slug>-<ts> name with a fixed timestamp", () => {
    expect(agentBranchName("my-feature", 1234)).toBe("agent/my-feature-1234");
  });

  it("re-slugifies a raw title fragment", () => {
    expect(agentBranchName("My Feature", 99)).toBe("agent/my-feature-99");
  });
});
