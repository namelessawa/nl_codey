import os from "node:os";
import path from "node:path";
import process from "node:process";
import type { DynamicToolBundleFn } from "@nlc/agent-core";
import { nlcRoot } from "@nlc/shared";
import { parseArgv } from "../lib/argv.js";
import {
  buildCliServices,
  type BuildCliServicesOpts,
} from "../lib/services.js";
import { runInkTui } from "./ink-tui.js";

const FORGED_TOKEN = "tui-dynamic-factory-token-123456789";

const failDynamicTools: DynamicToolBundleFn = () => {
  throw new Error(`Bearer ${FORGED_TOKEN}\n${os.homedir()}`);
};

const serviceFactory = (opts: BuildCliServicesOpts) =>
  buildCliServices({ ...opts, getDynamicTools: failDynamicTools });

const args = parseArgv(process.argv.slice(2));
const dataRoot = (args.flags.get("data-root") ?? nlcRoot()).toString();
const workspaceRoot = path.resolve(args.flags.get("workspace") ?? process.cwd());

await runInkTui({
  workspaceRoot,
  dataRoot,
  autoApprove: args.flags.has("yes") || args.flags.has("y"),
  serviceFactory,
});
