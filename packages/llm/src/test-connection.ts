import type { LLMConfig } from "@nlc/shared";
import { createLLMProvider } from "./provider.js";

export type TestConnectionResult = { ok: boolean; message: string };

/**
 * Send a minimal request with the given config to verify connectivity. Returns
 * a structured result; never throws and never leaks the API key (provider
 * errors are already redacted at the source).
 */
export async function testLLMConnection(config: LLMConfig): Promise<TestConnectionResult> {
  if (!config.apiKey) {
    return { ok: false, message: "API Key 未配置，请先填写 API Key" };
  }
  try {
    const provider = createLLMProvider(config);
    const out = await provider.complete({
      messages: [{ role: "user", content: "Reply with only: OK" }],
      temperature: 0,
      maxTokens: 16,
    });
    if (typeof out.text === "string") {
      return { ok: true, message: "连接成功" };
    }
    return { ok: false, message: "未收到模型返回内容" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}
