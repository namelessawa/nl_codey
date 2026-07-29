import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeImpactTool } from "./impact.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("analyzeImpactTool", () => {
  it("reports bounded declaration, import, test, and lexical-call edges", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-impact-"));
    roots.push(root);
    write(root, "src/dependency.ts", "export const dependency = 1;\n");
    write(
      root,
      "src/target.ts",
      [
        'import { dependency } from "./dependency.js";',
        "export function calculate(value: number) {",
        "  return value + dependency;",
        "}",
      ].join("\n"),
    );
    write(
      root,
      "src/consumer.ts",
      [
        'import { calculate } from "./target.js";',
        "export const answer = calculate(41);",
      ].join("\n"),
    );
    write(
      root,
      "src/target.test.ts",
      [
        'import { calculate } from "./target.js";',
        "expect(calculate(1)).toBe(2);",
      ].join("\n"),
    );

    const output = await analyzeImpactTool.run(
      { path: "src/target.ts", symbol: "calculate" },
      { workspaceRoot: root, runId: "run-impact" },
    );

    expect(output).toMatchObject({
      target: "src/target.ts",
      coverage: "typescript-javascript",
      impactedFiles: ["src/consumer.ts", "src/target.test.ts"],
      scannedFiles: 4,
      truncated: false,
    });
    expect(output.symbols).toEqual([
      expect.objectContaining({
        name: "calculate",
        file: "src/target.ts",
        line: 2,
        exported: true,
      }),
    ]);
    expect(output.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "declares",
          from: "src/target.ts",
          to: "src/target.ts#calculate",
          confidence: "exact",
        }),
        expect.objectContaining({
          kind: "imports",
          from: "src/target.ts",
          to: "src/dependency.ts",
          confidence: "exact",
        }),
        expect.objectContaining({
          kind: "imports",
          from: "src/consumer.ts",
          to: "src/target.ts",
          confidence: "exact",
        }),
        expect.objectContaining({
          kind: "tests",
          from: "src/target.test.ts",
          to: "src/target.ts",
          confidence: "exact",
        }),
        expect.objectContaining({
          kind: "calls",
          from: "src/consumer.ts",
          to: "src/target.ts#calculate",
          line: 2,
          confidence: "heuristic",
        }),
      ]),
    );
    expect(output.selectionReason).toContain("fresh bounded scan");
    expect(output.limitations.join(" ")).toContain("tsconfig path aliases");
  });

  it("rejects workspace escapes and reports edge-budget truncation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-impact-bounds-"));
    roots.push(root);
    write(root, "target.ts", "export function target() { return 1; }\n");
    write(
      root,
      "consumer.ts",
      'import { target } from "./target.js";\ntarget();\n',
    );

    await expect(
      analyzeImpactTool.run(
        { path: "../outside.ts" },
        { workspaceRoot: root, runId: "run-escape" },
      ),
    ).rejects.toThrow(/missing or unreadable/i);

    const output = await analyzeImpactTool.run(
      { path: "target.ts", maxResults: 1 },
      { workspaceRoot: root, runId: "run-truncated" },
    );
    expect(output.edges).toHaveLength(1);
    expect(output.truncated).toBe(true);
  });
});

function write(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
}
