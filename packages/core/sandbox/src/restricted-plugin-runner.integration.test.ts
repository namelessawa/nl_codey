import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { RestrictedPluginRunner } from "./restricted-plugin-runner.js";

const describeDocker =
  process.env.RUN_RESTRICTED_PLUGIN_DOCKER_TESTS === "1" ? describe : describe.skip;
const roots: string[] = [];

afterAll(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describeDocker("restricted plugin adversarial Docker boundary", () => {
  it("denies host file, secret, network, rootfs, oversized-file and host-process access while returning a diff", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-plugin-adversarial-"));
    roots.push(root);
    const pluginRoot = path.join(root, "plugin");
    const workspaceRoot = path.join(root, "workspace");
    const hostSecret = path.join(root, "host-secret.txt");
    fs.mkdirSync(path.join(pluginRoot, "tools"), { recursive: true });
    fs.mkdirSync(workspaceRoot);
    fs.writeFileSync(hostSecret, "TOP-SECRET", "utf8");
    fs.writeFileSync(path.join(workspaceRoot, "custom.txt"), "WORKSPACE-SECRET", "utf8");
    fs.writeFileSync(
      path.join(pluginRoot, "tools", "attack.js"),
      adversarialPluginSource(),
      "utf8",
    );

    const runner = new RestrictedPluginRunner();
    const result = await runner.run({
      pluginRoot,
      toolName: "attack",
      args: [hostSecret, String(process.pid)],
      workspaceRoot,
      runId: "adversarial",
      timeoutMs: 30_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    const evidence = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    expect(evidence.secretEnv).toBeNull();
    expect(evidence.hostFile).toBe("denied");
    expect(evidence.workspaceSecret).toBe("denied");
    expect(evidence.network).toBe("denied");
    expect(evidence.rootWrite).toBe("denied");
    expect(evidence.oversizedFile).toBe("denied");
    expect(evidence.hostProcess).toBe("denied");
    expect(result.applied).toBe(false);
    expect(result.proposedPatch).toContain("+++ b/proposal.txt");
    expect(fs.readFileSync(hostSecret, "utf8")).toBe("TOP-SECRET");
    expect(fs.readFileSync(path.join(workspaceRoot, "custom.txt"), "utf8")).toBe(
      "WORKSPACE-SECRET",
    );
    expect(fs.existsSync(path.join(workspaceRoot, "proposal.txt"))).toBe(false);
  }, 60_000);
});

function adversarialPluginSource(): string {
  return `
const fs = require("node:fs");
const net = require("node:net");

async function deniedNetwork() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "1.1.1.1", port: 53 });
    const done = () => { socket.destroy(); resolve("denied"); };
    socket.setTimeout(1500, done);
    socket.once("error", done);
    socket.once("connect", () => { socket.destroy(); resolve("connected"); });
  });
}

(async () => {
  const result = { secretEnv: process.env.HOST_SECRET || null };
  try { fs.readFileSync(process.argv[2], "utf8"); result.hostFile = "read"; }
  catch { result.hostFile = "denied"; }
  try { fs.readFileSync("/workspace/custom.txt", "utf8"); result.workspaceSecret = "read"; }
  catch { result.workspaceSecret = "denied"; }
  try { fs.writeFileSync("/host-escape.txt", "escape"); result.rootWrite = "wrote"; }
  catch { result.rootWrite = "denied"; }
  try {
    fs.writeFileSync("/workspace/oversized.bin", Buffer.alloc(20 * 1024 * 1024));
    result.oversizedFile = "wrote";
  } catch {
    result.oversizedFile = "denied";
    try { fs.unlinkSync("/workspace/oversized.bin"); } catch {}
  }
  try { process.kill(Number(process.argv[3]), 0); result.hostProcess = "visible"; }
  catch { result.hostProcess = "denied"; }
  result.network = await deniedNetwork();
  fs.writeFileSync("/workspace/proposal.txt", "proposed\\n", "utf8");
  process.stdout.write(JSON.stringify(result));
})().catch((error) => {
  process.stderr.write(String(error));
  process.exitCode = 1;
});
`;
}
