import fsp from "node:fs/promises";
import path from "node:path";
import type { SandboxRunResult } from "@nlc/shared";
import { isInside } from "./paths.js";
import { WorkspaceSandbox, type BinaryChange, type FileChange } from "./workspace-sandbox.js";
import { runChild } from "./wsl-runner.js";

const PLUGIN_IMAGE =
  "node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293";
const PLUGIN_ROOT = "/plugin";
const WORKSPACE_ROOT = "/workspace";
const MAX_TIMEOUT_MS = 60_000;

export type RestrictedPluginRunRequest = {
  pluginRoot: string;
  toolName: string;
  args: readonly string[];
  workspaceRoot: string;
  runId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type RestrictedPluginRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  changes: FileChange[];
  binaryConflicts: BinaryChange[];
  proposedPatch: string;
  applied: false;
};

type DockerExecutor = (
  executable: string,
  argv: string[],
  displayCommand: string,
  timeoutMs: number,
  mode: "docker",
  signal?: AbortSignal,
) => Promise<SandboxRunResult>;

/**
 * Docker-confined plugin execution. The real workspace is never mounted:
 * plugins receive a bounded copy-on-write staging tree and return its diff.
 * Applying that diff is intentionally outside this runner and must go through
 * the normal `apply_patch` approval path.
 */
export class RestrictedPluginRunner {
  constructor(private readonly executeDocker: DockerExecutor = runChild) {}

  async run(req: RestrictedPluginRunRequest): Promise<RestrictedPluginRunResult> {
    if (!/^[a-z][a-z0-9_]*$/.test(req.toolName)) {
      throw new Error(`restricted plugin runner: invalid tool name "${req.toolName}"`);
    }
    const pluginRoot = await fsp.realpath(path.resolve(req.pluginRoot));
    const scriptPath = await fsp.realpath(
      path.join(pluginRoot, "tools", `${req.toolName}.js`),
    );
    if (!isInside(pluginRoot, scriptPath)) {
      throw new Error("restricted plugin runner: tool script escapes plugin root");
    }

    const stagingRoot = await WorkspaceSandbox.prepare(req.workspaceRoot, req.runId);
    const secretBackupRoot = `${stagingRoot}-restricted-secrets`;
    try {
      const hiddenSecrets = await hideSensitiveWorkspaceFiles(
        stagingRoot,
        secretBackupRoot,
      );
      const timeoutMs = Math.min(
        Math.max(req.timeoutMs ?? MAX_TIMEOUT_MS, 1),
        MAX_TIMEOUT_MS,
      );
      const argv = buildRestrictedPluginDockerArgv({
        pluginRoot,
        stagingRoot,
        toolName: req.toolName,
        args: req.args,
      });
      const output = await this.executeDocker(
        "docker",
        argv,
        `plugin:${req.toolName}`,
        timeoutMs,
        "docker",
        req.signal,
      );
      await restoreSensitiveWorkspaceFiles(
        stagingRoot,
        secretBackupRoot,
        hiddenSecrets,
      );
      const diff = await WorkspaceSandbox.diff(req.workspaceRoot, stagingRoot);
      return {
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode: output.exitCode ?? 1,
        timedOut: output.timedOut,
        changes: diff.changes,
        binaryConflicts: diff.binaryConflicts,
        proposedPatch: synthesizePluginPatch(diff.changes),
        applied: false,
      };
    } finally {
      await WorkspaceSandbox.cleanup(stagingRoot);
      await WorkspaceSandbox.cleanup(secretBackupRoot);
    }
  }
}

export function buildRestrictedPluginDockerArgv(input: {
  pluginRoot: string;
  stagingRoot: string;
  toolName: string;
  args: readonly string[];
}): string[] {
  return [
    "run",
    "--rm",
    "--pull=never",
    "--network=none",
    "--ipc=private",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user",
    "1000:1000",
    "--pids-limit",
    "16",
    "--ulimit",
    "nofile=128:128",
    "--ulimit",
    "fsize=16777216:16777216",
    "--memory",
    "256m",
    "--cpus",
    "0.5",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=16m",
    "--mount",
    `type=bind,source=${input.pluginRoot},target=${PLUGIN_ROOT},readonly`,
    "--mount",
    `type=bind,source=${input.stagingRoot},target=${WORKSPACE_ROOT}`,
    "--workdir",
    WORKSPACE_ROOT,
    "--env",
    `NLC_WORKSPACE=${WORKSPACE_ROOT}`,
    PLUGIN_IMAGE,
    "node",
    `${PLUGIN_ROOT}/tools/${input.toolName}.js`,
    ...input.args,
  ];
}

export function synthesizePluginPatch(changes: readonly FileChange[]): string {
  return changes
    .map((change) => {
      assertSafePatchPath(change.path);
      if (change.kind === "added") {
        return renderHunk("/dev/null", `b/${change.path}`, "", change.content);
      }
      if (change.kind === "deleted") {
        return renderHunk(`a/${change.path}`, "/dev/null", change.before, "");
      }
      return renderHunk(`a/${change.path}`, `b/${change.path}`, change.before, change.after);
    })
    .join("\n");
}

function renderHunk(beforePath: string, afterPath: string, before: string, after: string): string {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const beforeStart = beforeLines.length === 0 ? 0 : 1;
  const afterStart = afterLines.length === 0 ? 0 : 1;
  return (
    `--- ${beforePath}\n` +
    `+++ ${afterPath}\n` +
    `@@ -${beforeStart},${beforeLines.length} +${afterStart},${afterLines.length} @@\n` +
    beforeLines.map((line) => `-${line}`).join("\n") +
    (beforeLines.length > 0 ? "\n" : "") +
    afterLines.map((line) => `+${line}`).join("\n") +
    (afterLines.length > 0 ? "\n" : "")
  );
}

function assertSafePatchPath(filePath: string): void {
  if (/[\u0000-\u001f\u007f]/.test(filePath)) {
    throw new Error("restricted plugin runner: proposed path contains control characters");
  }
}

function splitLines(content: string): string[] {
  if (!content) return [];
  const lines = content.split("\n");
  return content.endsWith("\n") ? lines.slice(0, -1) : lines;
}

async function hideSensitiveWorkspaceFiles(
  stagingRoot: string,
  backupRoot: string,
): Promise<string[]> {
  const hidden: string[] = [];
  await walk(stagingRoot);
  return hidden;

  async function walk(current: string): Promise<void> {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(stagingRoot, absolute);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile() || !isSensitiveWorkspacePath(relative)) continue;
      const backup = path.join(backupRoot, relative);
      await fsp.mkdir(path.dirname(backup), { recursive: true });
      await fsp.rename(absolute, backup);
      hidden.push(relative);
    }
  }
}

async function restoreSensitiveWorkspaceFiles(
  stagingRoot: string,
  backupRoot: string,
  hidden: readonly string[],
): Promise<void> {
  for (const relative of hidden) {
    const source = path.join(backupRoot, relative);
    const destination = path.join(stagingRoot, relative);
    await ensureSafeParent(stagingRoot, relative);
    await fsp.rm(destination, { recursive: true, force: true });
    await fsp.rename(source, destination);
  }
}

async function ensureSafeParent(root: string, relative: string): Promise<void> {
  let current = root;
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, segment);
    try {
      const stat = await fsp.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        await fsp.rm(current, { recursive: true, force: true });
        await fsp.mkdir(current);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await fsp.mkdir(current);
    }
  }
}

function isSensitiveWorkspacePath(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join("/").toLowerCase();
  const parts = normalized.split("/");
  const basename = parts.at(-1) ?? "";
  if (normalized === "custom.txt") return true;
  if (parts.includes(".ssh") || parts.includes(".aws") || parts.includes(".azure")) {
    return true;
  }
  if (
    normalized.startsWith(".config/gcloud/") ||
    normalized.includes("/.config/gcloud/")
  ) {
    return true;
  }
  if (
    [
      ".npmrc",
      ".yarnrc",
      ".pypirc",
      ".netrc",
      ".gitconfig",
      ".git-credentials",
    ].includes(basename)
  ) {
    return true;
  }
  if (["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"].includes(basename)) {
    return true;
  }
  if (basename === ".env") return true;
  return (
    basename.startsWith(".env.") &&
    ![".env.example", ".env.sample", ".env.template"].includes(basename)
  );
}
