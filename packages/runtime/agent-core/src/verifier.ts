import type { RunCommandOutput } from "@nlc/shared";
import { parseTestFailure } from "@nlc/tools";

/** Outcome of an automatic post-patch verification run. */
export type VerificationResult = {
  passed: boolean;
  /** Feedback message appended to the conversation for the model. */
  message: string;
};

const MAX_LISTED_FAILURES = 10;

/**
 * Turn a verification command's output into pass/fail feedback for the model.
 * On failure the output is parsed into structured failures (via
 * {@link parseTestFailure}) so the repair turn gets file/line/message context
 * instead of raw logs. Pure — no shell or storage — so it is unit-testable.
 */
export function evaluateVerification(out: RunCommandOutput): VerificationResult {
  const passed = out.exitCode === 0 && !out.timedOut;
  if (passed) {
    return {
      passed: true,
      message: `✅ 自动验证通过：\`${out.command}\`（exit 0）。若任务已完成，请直接用纯文本回复用户并总结改动，不要再做无关修改。`,
    };
  }

  const report = parseTestFailure({
    command: out.command,
    stdout: out.stdout,
    stderr: out.stderr,
    exitCode: out.exitCode ?? 1,
  });
  const listed = report.failures.slice(0, MAX_LISTED_FAILURES).map((f) => {
    const loc = f.line !== undefined ? `:${f.line}` : "";
    const name = f.testName ? ` [${f.testName}]` : "";
    return `- ${f.file || "(unknown)"}${loc}${name}: ${f.message}`;
  });
  const more = report.failures.length > MAX_LISTED_FAILURES
    ? `\n…(还有 ${report.failures.length - MAX_LISTED_FAILURES} 个失败)`
    : "";
  const detail = listed.length ? `\n${listed.join("\n")}${more}` : "";
  const timeout = out.timedOut ? "（命令超时）" : "";
  const exit = out.exitCode === null ? "未知" : String(out.exitCode);

  return {
    passed: false,
    message:
      `❌ 自动验证失败：\`${out.command}\` exit ${exit}${timeout}。\n` +
      `失败摘要（${report.framework}）：${report.summary}${detail}\n` +
      `请分析失败原因并用 apply_patch 做最小修复；修复后会再次自动验证。`,
  };
}
