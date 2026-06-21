import {
  SANDBOX_DEFAULT_TIMEOUT_MS,
  type SandboxPolicy,
  type SandboxRunRequest,
  type SandboxRunResult,
} from "@nlc/shared";
import { assertNoSandboxEscape } from "./sandbox-policy.js";
import { runChild } from "./wsl-runner.js";

const DEFAULT_IMAGE = "node:22-slim";
const WORKDIR = "/work";
/** Non-root UID:GID so container processes cannot write as root on the mount. */
const NON_ROOT_USER = "1000:1000";

/**
 * Runs a command inside an ephemeral Docker container with the workspace
 * bind-mounted at {@link WORKDIR}. Containers are `--rm` (removed on exit),
 * run as a non-root user, and have `--network=none` unless network egress is
 * explicitly allowed. The command is validated with {@link assertNoSandboxEscape}
 * before the container is created.
 */
export class DockerRunner {
  async run(req: SandboxRunRequest, policy: SandboxPolicy): Promise<SandboxRunResult> {
    assertNoSandboxEscape(req);

    const image = policy.dockerImage ?? DEFAULT_IMAGE;
    const timeoutMs = req.timeoutMs ?? SANDBOX_DEFAULT_TIMEOUT_MS;
    const allowNetwork = req.allowNetwork ?? policy.allowNetwork;
    const argv = this.buildArgv(req, image, allowNetwork);

    return runChild("docker", argv, req.command, timeoutMs, "docker", req.signal);
  }

  /**
   * `docker run --rm [--network=none] --user 1000:1000 -v <ws>:/work -w /work
   * <image> sh -lc <command>`. The host path is passed to `-v` as a single
   * argv slot (no shell interpolation), and the user command is the final
   * argument to `sh -lc`.
   */
  private buildArgv(req: SandboxRunRequest, image: string, allowNetwork: boolean): string[] {
    const argv = ["run", "--rm"];
    if (!allowNetwork) argv.push("--network=none");
    argv.push("--user", NON_ROOT_USER);
    argv.push("-v", `${req.workspaceRoot}:${WORKDIR}`);
    argv.push("-w", WORKDIR);
    argv.push(image);
    argv.push("sh", "-lc", req.command);
    return argv;
  }
}
