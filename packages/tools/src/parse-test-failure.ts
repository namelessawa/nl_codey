import type {
  ParseTestFailureInput,
  TestFailureItem,
  TestFailureReport,
  TestFramework,
} from "@coding-agent/shared";
import { MAX_FAILURE_SUMMARY_CHARS } from "@coding-agent/shared";

/**
 * Parse test/build command output into structured failures. Detects the
 * framework from the command and output, then extracts file/line/test/message
 * where possible. Falls back to `unknown` with truncated raw output, so the
 * caller always gets something actionable to feed back to the model.
 */
export function parseTestFailure(input: ParseTestFailureInput): TestFailureReport {
  const combined = `${input.stdout}\n${input.stderr}`;
  const framework = detectFramework(input.command, combined);
  const failures = extractFailures(framework, combined);
  const summary = buildSummary(framework, failures, combined);
  return { framework, failures, summary };
}

function detectFramework(command: string, output: string): TestFramework {
  const cmd = command.toLowerCase();
  if (cmd.includes("tsc")) return "tsc";
  if (cmd.includes("pytest")) return "pytest";
  if (cmd.includes("cargo test")) return "cargo-test";
  if (cmd.includes("go test")) return "go-test";
  if (cmd.includes("vitest")) return "vitest";
  if (cmd.includes("jest")) return "jest";

  // Fall back to output signatures (e.g. when run via `npm test`).
  if (/^\S.*\(\d+,\d+\): error TS\d+:/m.test(output)) return "tsc";
  if (/={3,}\s*FAILURES\s*={3,}/.test(output) || /^FAILED \S+::/m.test(output)) return "pytest";
  if (/^---- .+ stdout ----/m.test(output) || /^\s*test .+ \.\.\. FAILED/m.test(output)) {
    return "cargo-test";
  }
  if (/^--- FAIL: /m.test(output)) return "go-test";
  if (/^\s*●\s/m.test(output)) return "jest";
  if (/^\s*FAIL\s+\S+/m.test(output)) return "vitest";
  return "unknown";
}

function extractFailures(framework: TestFramework, output: string): TestFailureItem[] {
  switch (framework) {
    case "tsc":
      return parseTsc(output);
    case "vitest":
      return parseVitest(output);
    case "jest":
      return parseJest(output);
    case "pytest":
      return parsePytest(output);
    case "go-test":
      return parseGoTest(output);
    case "cargo-test":
      return parseCargoTest(output);
    default:
      return [];
  }
}

// File path token is bounded by `(`; whitespace runs are single literal spaces.
// Avoids the `\(.+?)\(...\s+...\s+...$/` lazy/greedy mix that backtracks
// polynomially on padded input (CodeQL js/polynomial-redos).
const TSC_LINE = /^([^()]+)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

function parseTsc(output: string): TestFailureItem[] {
  const failures: TestFailureItem[] = [];
  for (const line of output.split("\n")) {
    const m = TSC_LINE.exec(line.trim());
    if (!m) continue;
    failures.push({
      file: m[1] ?? "",
      line: toInt(m[2]),
      column: toInt(m[3]),
      message: `${m[4]}: ${m[5]}`,
    });
  }
  return failures;
}

// `\S+` is bounded by whitespace and `>`; literal spaces replace `\s+`/`\s*`
// to remove the lazy/variable-whitespace backtracking CodeQL flagged.
const VITEST_FAIL = /^[ \t]*(?:×|✗|FAIL) +(\S+) +> +(.+)$/i;
// Path captured with `[^:\s]+` so the engine has a single deterministic
// stopping point at the colon (no `(.+?):` lazy backtracking).
const LOCATION = /❯ +([^:\s]+):(\d+):(\d+)/;

function parseVitest(output: string): TestFailureItem[] {
  const lines = output.split("\n");
  const failures: TestFailureItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = VITEST_FAIL.exec(lines[i] ?? "");
    if (!head) continue;
    const file = head[1] ?? "";
    const testName = (head[2] ?? "").trim();
    let message = "";
    let line: number | undefined;
    let column: number | undefined;
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      const text = lines[j] ?? "";
      if (!message && /(?:Assertion)?Error[:\s]|Expected|expected /.test(text)) {
        message = text.trim();
      }
      const loc = LOCATION.exec(text);
      if (loc && loc[1] === file) {
        line = toInt(loc[2]);
        column = toInt(loc[3]);
      }
    }
    failures.push({
      file,
      testName,
      message: message || "Test failed",
      ...(line !== undefined ? { line } : {}),
      ...(column !== undefined ? { column } : {}),
    });
  }
  return failures;
}

// Literal spaces and `[ \t]*` are linear-time, unlike `\s*` followed by
// another `\s+` which CodeQL flags as polynomial on whitespace-only input.
const JEST_TEST = /^[ \t]*● +(.+)$/;
// File path token uses `[^():\s]+` so the trailing `:NN:NN)?` has a single
// deterministic anchor (no `.+?` lazy + greedy mix).
const JEST_AT = /\bat (?:[^()]*\()?([^():\s]+):(\d+):(\d+)\)?$/;

function parseJest(output: string): TestFailureItem[] {
  const lines = output.split("\n");
  const failures: TestFailureItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = JEST_TEST.exec(lines[i] ?? "");
    if (!head) continue;
    const testName = (head[1] ?? "").replace(/›/g, ">").trim();
    let message = "";
    let file = "";
    let line: number | undefined;
    let column: number | undefined;
    for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
      const text = lines[j] ?? "";
      if (JEST_TEST.test(text)) break;
      if (!message && text.trim()) message = text.trim();
      const at = JEST_AT.exec(text.trim());
      if (at && !file) {
        file = at[1] ?? "";
        line = toInt(at[2]);
        column = toInt(at[3]);
      }
    }
    failures.push({
      file,
      testName,
      message: message || "Test failed",
      ...(line !== undefined ? { line } : {}),
      ...(column !== undefined ? { column } : {}),
    });
  }
  return failures;
}

// `[^\s:]+` stops cleanly at `:` or whitespace, so the optional `::test` and
// ` - message` parts have a single anchor and never backtrack.
const PYTEST_SUMMARY = /^FAILED ([^\s:]+)(?:::(\S+))? - (.+)$/;
const PYTEST_LOC = /^([^:\n]+\.py):(\d+):/;

function parsePytest(output: string): TestFailureItem[] {
  const lines = output.split("\n");
  const failures: TestFailureItem[] = [];
  const locByFile = new Map<string, number>();
  for (const line of lines) {
    const loc = PYTEST_LOC.exec(line.trim());
    if (loc && loc[1] && !locByFile.has(loc[1])) locByFile.set(loc[1], toInt(loc[2]) ?? 0);
  }
  for (const line of lines) {
    const m = PYTEST_SUMMARY.exec(line.trim());
    if (!m) continue;
    const file = m[1] ?? "";
    const lineNo = locByFile.get(file);
    failures.push({
      file,
      ...(m[2] ? { testName: m[2] } : {}),
      message: m[3] ?? "Test failed",
      ...(lineNo ? { line: lineNo } : {}),
    });
  }
  return failures;
}

const GO_FAIL = /^--- FAIL: +(\S+)/;
// Replace `\s*`/`\s*` with `[ \t]*` so leading and trailing horizontal
// whitespace match linearly (CodeQL js/polynomial-redos).
const GO_LOC = /^[ \t]*(\S+\.go):(\d+):[ \t]*(.*)$/;

function parseGoTest(output: string): TestFailureItem[] {
  const lines = output.split("\n");
  const failures: TestFailureItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = GO_FAIL.exec(lines[i] ?? "");
    if (!head) continue;
    const testName = head[1] ?? "";
    // The detail line typically precedes the "--- FAIL" marker.
    let file = "";
    let line: number | undefined;
    let message = "";
    for (let j = Math.max(0, i - 6); j < i; j++) {
      const loc = GO_LOC.exec(lines[j] ?? "");
      if (loc) {
        file = loc[1] ?? "";
        line = toInt(loc[2]);
        message = (loc[3] ?? "").trim();
      }
    }
    failures.push({
      file,
      testName,
      message: message || "Test failed",
      ...(line !== undefined ? { line } : {}),
    });
  }
  return failures;
}

const CARGO_FAIL = /^[ \t]*test +(\S+) +\.\.\. +FAILED/;
// `[^,\n]*` is equivalent to the original `.*?,` (stops at first `,`) but
// non-backtracking; path and digits use single-class tokens.
const CARGO_PANIC = /panicked at [^,\n]*, ([^:\s]+):(\d+):(\d+)/;

function parseCargoTest(output: string): TestFailureItem[] {
  const lines = output.split("\n");
  const failures: TestFailureItem[] = [];
  const names: string[] = [];
  for (const line of lines) {
    const m = CARGO_FAIL.exec(line);
    if (m && m[1]) names.push(m[1]);
  }
  // Match each panic location to a failing test in order.
  let idx = 0;
  for (let i = 0; i < lines.length; i++) {
    const panic = CARGO_PANIC.exec(lines[i] ?? "");
    if (!panic) continue;
    const messageLine = (lines[i] ?? "").split("panicked at")[1] ?? "";
    failures.push({
      file: panic[1] ?? "",
      line: toInt(panic[2]),
      column: toInt(panic[3]),
      ...(names[idx] ? { testName: names[idx] } : {}),
      message: `panicked at${messageLine}`.trim(),
    });
    idx++;
  }
  // If no panic lines were found but tests reported FAILED, record names.
  if (failures.length === 0) {
    for (const name of names) failures.push({ file: "", testName: name, message: "Test failed" });
  }
  return failures;
}

function buildSummary(
  framework: TestFramework,
  failures: TestFailureItem[],
  output: string,
): string {
  if (framework === "unknown") {
    const trimmed = output.trim();
    return trimmed.length > MAX_FAILURE_SUMMARY_CHARS
      ? `${trimmed.slice(0, MAX_FAILURE_SUMMARY_CHARS)}…(truncated)`
      : trimmed || "Command failed with no output";
  }
  if (failures.length === 0) {
    return `${framework}: command failed but no individual failures were parsed`;
  }
  const count = failures.length;
  const files = [...new Set(failures.map((f) => f.file).filter(Boolean))];
  return `${framework}: ${count} failure${count === 1 ? "" : "s"}${
    files.length ? ` in ${files.join(", ")}` : ""
  }`;
}

function toInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}
