import { describe, it, expect } from "vitest";
import { parseChangedFiles, summarizeDiff } from "./diff-summarizer.js";

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index 111..222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
diff --git a/src/bar.ts b/src/bar.ts
new file mode 100644
--- /dev/null
+++ b/src/bar.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
`;

describe("parseChangedFiles", () => {
  it("extracts each changed file from +++ b/ lines", () => {
    expect(parseChangedFiles(SAMPLE_DIFF)).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("ignores /dev/null and deduplicates", () => {
    const diff = `--- /dev/null\n+++ b/a.ts\n+++ b/a.ts`;
    expect(parseChangedFiles(diff)).toEqual(["a.ts"]);
  });

  it("falls back to the diff --git header for deletions", () => {
    const diff = `diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null`;
    expect(parseChangedFiles(diff)).toEqual(["gone.ts"]);
  });

  it("returns an empty array for an empty diff", () => {
    expect(parseChangedFiles("")).toEqual([]);
  });
});

describe("summarizeDiff", () => {
  it("counts additions and deletions excluding file headers", () => {
    const summary = summarizeDiff(SAMPLE_DIFF);
    expect(summary.files).toEqual(["src/foo.ts", "src/bar.ts"]);
    expect(summary.additions).toBe(4);
    expect(summary.deletions).toBe(1);
  });
});
