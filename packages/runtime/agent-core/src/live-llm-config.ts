import fs from "node:fs";
import path from "node:path";
import type { LLMConfig } from "@nlc/shared";

const MAX_CONFIG_BYTES = 64 * 1024;
const REQUIRED_KEYS = [
  "CUSTOM_API_KEY",
  "CUSTOM_BASE_URL",
  "CUSTOM_MODEL",
] as const;
type RequiredKey = (typeof REQUIRED_KEYS)[number];

/**
 * Parse the ignored repository-root custom.txt used only by the explicit live
 * smoke. Errors contain field names/line numbers, never configured values.
 */
export function parseLiveLLMConfig(raw: string): LLMConfig {
  if (Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) {
    throw new Error("custom.txt exceeds the 64 KiB live-config limit");
  }

  const values = new Map<RequiredKey, string>();
  const allowed = new Set<string>(REQUIRED_KEYS);
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const [index, sourceLine] of lines.entries()) {
    const line = sourceLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error(`custom.txt line ${index + 1} must use FIELD=value`);
    }
    const key = line.slice(0, separator).trim();
    if (!allowed.has(key)) {
      throw new Error(`custom.txt line ${index + 1} has unsupported field ${safeField(key)}`);
    }
    if (values.has(key as RequiredKey)) {
      throw new Error(`custom.txt contains duplicate field ${key}`);
    }
    values.set(key as RequiredKey, parseValue(line.slice(separator + 1), key, index + 1));
  }

  for (const key of REQUIRED_KEYS) {
    if (!values.has(key)) throw new Error(`custom.txt is missing required field ${key}`);
  }

  const baseUrl = values.get("CUSTOM_BASE_URL")!;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error("CUSTOM_BASE_URL must be a valid http(s) URL");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("CUSTOM_BASE_URL must be a valid http(s) URL");
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("CUSTOM_BASE_URL must not contain embedded credentials");
  }

  return {
    provider: "custom",
    apiKey: values.get("CUSTOM_API_KEY")!,
    baseUrl,
    model: values.get("CUSTOM_MODEL")!,
    temperature: 0,
    maxTokens: 2_048,
    timeoutSeconds: 120,
  };
}

export function loadLiveLLMConfig(filePath: string): LLMConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Missing ignored live LLM config: ${path.basename(filePath)}`);
    }
    throw new Error(`Unable to read ignored live LLM config: ${path.basename(filePath)}`);
  }
  return parseLiveLLMConfig(raw);
}

function parseValue(raw: string, key: string, lineNumber: number): string {
  const trimmed = raw.trim();
  let value = trimmed;
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    value = trimmed.slice(1, -1);
  } else if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    throw new Error(`custom.txt line ${lineNumber} has an unterminated quoted ${key}`);
  }
  if (value.length === 0) throw new Error(`custom.txt field ${key} must not be empty`);
  if (/[\r\n\0]/.test(value)) throw new Error(`custom.txt field ${key} contains invalid controls`);
  return value;
}

function safeField(field: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(field) ? field : "<invalid>";
}
