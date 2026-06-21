import type {
  SandboxPolicy,
  SandboxRunRequest,
  SandboxRunResult,
} from "@nlc/shared";
import type { WslRunner } from "./wsl-runner.js";
import type { DockerRunner } from "./docker-runner.js";
import { assertNoSandboxEscape, routeMode } from "./sandbox-policy.js";

/**
 * Injected set of runners. The `whitelist` runner is the existing Phase 2
 * `run_command` behavior (exact-match allowlist on the host), provided by the
 * caller so this package keeps no dependency on the tools layer.
 */
export type SandboxRunners = {
  whitelist: (req: SandboxRunRequest) => Promise<SandboxRunResult>;
  wsl: WslRunner;
  docker: DockerRunner;
};

/**
 * Dispatch a run request to the runner selected by {@link routeMode}.
 *
 * - `whitelist`: delegates to the injected host runner (its own allowlist +
 *   dangerous-pattern guards still apply).
 * - `wsl` / `docker`: runs {@link assertNoSandboxEscape} first, then hands the
 *   request to the strong-sandbox runner.
 */
export async function routeCommand(
  req: SandboxRunRequest,
  policy: SandboxPolicy,
  runners: SandboxRunners,
): Promise<SandboxRunResult> {
  const mode = routeMode(policy);
  switch (mode) {
    case "whitelist":
      return runners.whitelist(req);
    case "wsl":
      assertNoSandboxEscape(req);
      return runners.wsl.run(req, policy);
    case "docker":
      assertNoSandboxEscape(req);
      return runners.docker.run(req, policy);
    default: {
      const exhaustive: never = mode;
      throw new Error(`Unknown sandbox mode: ${String(exhaustive)}`);
    }
  }
}
