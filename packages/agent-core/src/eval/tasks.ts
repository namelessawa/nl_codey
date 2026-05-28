import type { EvalTask } from "./eval.js";

/**
 * The Phase 2 evaluation suite: 10 small, self-contained coding tasks with
 * deterministic checks. Each seeds a tiny workspace, states a task, and asserts
 * the resulting files. They exercise add / edit / fix / refactor / multi-file
 * flows that the agent should handle end-to-end.
 */
export const EVAL_TASKS: EvalTask[] = [
  {
    id: "t01-add-function",
    name: "Add a utility function",
    prompt: "在 src/math.ts 中新增并导出一个函数 add(a: number, b: number): number，返回两数之和。",
    setup: [{ path: "src/math.ts", content: "export function sub(a: number, b: number): number {\n  return a - b;\n}\n" }],
    checks: [
      { kind: "file_contains", path: "src/math.ts", pattern: "export function add" },
      { kind: "file_contains", path: "src/math.ts", pattern: "a \\+ b" },
      { kind: "file_contains", path: "src/math.ts", pattern: "export function sub" },
    ],
  },
  {
    id: "t02-fix-bug",
    name: "Fix an off-by-one bug",
    prompt: "src/range.ts 中的 lastIndex 应返回数组最后一个元素的下标，但现在多减了 1。请修复。",
    setup: [{ path: "src/range.ts", content: "export function lastIndex(arr: unknown[]): number {\n  return arr.length - 2;\n}\n" }],
    checks: [
      { kind: "file_contains", path: "src/range.ts", pattern: "arr\\.length - 1" },
      { kind: "file_not_contains", path: "src/range.ts", pattern: "arr\\.length - 2" },
    ],
  },
  {
    id: "t03-rename-symbol",
    name: "Rename an exported symbol",
    prompt: "把 src/user.ts 中导出的 getName 重命名为 getDisplayName，保持实现不变。",
    setup: [{ path: "src/user.ts", content: "export function getName(u: { name: string }): string {\n  return u.name;\n}\n" }],
    checks: [
      { kind: "file_contains", path: "src/user.ts", pattern: "export function getDisplayName" },
      { kind: "file_not_contains", path: "src/user.ts", pattern: "getName" },
    ],
  },
  {
    id: "t04-add-file",
    name: "Create a new module",
    prompt: "新建 src/greet.ts，导出函数 greet(name: string): string，返回 `Hello, ${name}!`。",
    setup: [{ path: "src/index.ts", content: "// entry\n" }],
    checks: [
      { kind: "file_exists", path: "src/greet.ts" },
      { kind: "file_contains", path: "src/greet.ts", pattern: "export function greet" },
      { kind: "file_contains", path: "src/greet.ts", pattern: "Hello" },
    ],
  },
  {
    id: "t05-delete-dead-code",
    name: "Remove dead code",
    prompt: "src/util.ts 中的 unusedHelper 没有被任何地方使用，请删除它，保留 keep 函数。",
    setup: [{ path: "src/util.ts", content: "export function keep(): number {\n  return 1;\n}\nfunction unusedHelper(): void {}\n" }],
    checks: [
      { kind: "file_not_contains", path: "src/util.ts", pattern: "unusedHelper" },
      { kind: "file_contains", path: "src/util.ts", pattern: "export function keep" },
    ],
  },
  {
    id: "t06-add-type",
    name: "Add a type definition",
    prompt: "在 src/types.ts 中新增并导出一个类型别名 Status = 'open' | 'closed'。",
    setup: [{ path: "src/types.ts", content: "export type Id = string;\n" }],
    checks: [
      { kind: "file_contains", path: "src/types.ts", pattern: "export type Status" },
      { kind: "file_contains", path: "src/types.ts", pattern: "'open'" },
      { kind: "file_contains", path: "src/types.ts", pattern: "'closed'" },
    ],
  },
  {
    id: "t07-multi-file",
    name: "Wire a function across two files",
    prompt: "在 src/lib.ts 导出 double(n: number): number（返回 n*2），并在 src/main.ts 中 import 并使用它。",
    setup: [
      { path: "src/lib.ts", content: "// lib\n" },
      { path: "src/main.ts", content: "// main\n" },
    ],
    checks: [
      { kind: "file_contains", path: "src/lib.ts", pattern: "export function double" },
      { kind: "file_contains", path: "src/main.ts", pattern: "import" },
      { kind: "file_contains", path: "src/main.ts", pattern: "double" },
    ],
  },
  {
    id: "t08-update-config",
    name: "Update a JSON config value",
    prompt: "把 config.json 中的 \"version\" 从 1 改为 2，不要改动其他字段。",
    setup: [{ path: "config.json", content: '{\n  "name": "demo",\n  "version": 1\n}\n' }],
    checks: [
      { kind: "file_contains", path: "config.json", pattern: '"version": 2' },
      { kind: "file_contains", path: "config.json", pattern: '"name": "demo"' },
    ],
  },
  {
    id: "t09-implement-stub",
    name: "Implement a stubbed function",
    prompt: "src/parse.ts 中的 isEven 现在抛出未实现错误，请实现它：偶数返回 true，奇数返回 false。",
    setup: [{ path: "src/parse.ts", content: 'export function isEven(n: number): boolean {\n  throw new Error("not implemented");\n}\n' }],
    checks: [
      { kind: "file_not_contains", path: "src/parse.ts", pattern: "not implemented" },
      { kind: "file_contains", path: "src/parse.ts", pattern: "% 2" },
    ],
  },
  {
    id: "t10-add-guard",
    name: "Add an input guard",
    prompt: "src/divide.ts 的 divide 函数在除数为 0 时应抛出错误 'division by zero'。请在函数开头加上守卫。",
    setup: [{ path: "src/divide.ts", content: "export function divide(a: number, b: number): number {\n  return a / b;\n}\n" }],
    checks: [
      { kind: "file_contains", path: "src/divide.ts", pattern: "division by zero" },
      { kind: "file_contains", path: "src/divide.ts", pattern: "b === 0" },
    ],
  },
];
