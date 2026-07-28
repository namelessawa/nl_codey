import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT = path.join(ROOT, "docs", "security", "mutation-inventory.json");
const CONTRACT_TEST =
  "packages/runtime/agent-core/src/tools-registry.test.ts#unified mutation authorization";

const entry = (
  id,
  surface,
  operations,
  capability,
  control,
  source,
  audit,
  evidence = {},
) => ({
  id,
  surface,
  operations,
  capability,
  control,
  source,
  audit,
  denialEvidence: evidence.denial ?? CONTRACT_TEST,
  approvalEvidence: Object.hasOwn(evidence, "approval")
    ? evidence.approval
    : CONTRACT_TEST,
});

const entries = [
  entry(
    "agent.apply_patch",
    "agent_tool",
    ["apply_patch"],
    "workspace.write",
    "per_call_approval",
    ["packages/runtime/agent-core/src/service.ts", "packages/runtime/agent-core/src/tools-registry.ts"],
    "run tool_call/diff/approval steps plus before/after snapshot",
    {
      denial: "packages/runtime/agent-core/src/acceptance.test.ts#user rejects the patch",
      approval: "apps/cli/src/tui/core-workflows.e2e.pty.test.ts#approve and rollback",
    },
  ),
  entry(
    "agent.run_command.confirmed",
    "agent_tool",
    ["run_command when requireConfirmationBeforeCommand=true"],
    "process.execute",
    "per_call_approval",
    ["packages/runtime/agent-core/src/service.ts", "packages/runtime/agent-core/src/tools-registry.ts"],
    "run tool_call/command/approval steps",
  ),
  entry(
    "agent.run_command.delegated",
    "agent_tool",
    ["run_command when requireConfirmationBeforeCommand=false"],
    "process.execute",
    "capability_grant",
    ["packages/runtime/agent-core/src/mutation-policy.ts", "packages/core/shared/src/settings.ts"],
    "shell setting plus run tool_call/command steps",
  ),
  entry(
    "agent.write_memory",
    "agent_tool",
    ["write_memory"],
    "memory.write",
    "per_call_approval",
    ["packages/runtime/agent-core/src/service.ts", "packages/runtime/agent-core/src/extended-tools.ts"],
    "run tool_call/approval/tool_result steps plus memory row",
  ),
  entry(
    "dynamic.plugin.mutator",
    "dynamic_tool",
    ["plugin tool declaring run_command or write_workspace"],
    "dynamic.mutate",
    "per_call_approval",
    ["apps/desktop/src/main/plugin-runtime.ts", "packages/runtime/agent-core/src/service.ts"],
    "qualified tool_call plus approval and result steps",
    {
      denial:
        "packages/runtime/agent-core/src/dynamic-tools-security.test.ts#denies a mutating dynamic tool",
      approval:
        "packages/runtime/agent-core/src/dynamic-tools-security.test.ts#executes a mutating dynamic tool once",
    },
  ),
  entry(
    "dynamic.mcp.mutator",
    "dynamic_tool",
    ["future MCP tool declaring mutation"],
    "dynamic.mutate",
    "default_off",
    ["packages/runtime/agent-core/src/service.ts"],
    "no adapter is installed; validated bundles must classify every mutator",
    { approval: null },
  ),
  entry(
    "sandbox.command.writeback",
    "sandbox",
    ["docker/wsl staged file add", "modify", "delete"],
    "workspace.write",
    "sandbox_writeback_approval",
    ["packages/runtime/agent-core/src/service.ts", "packages/runtime/tools/src/run-command-routed.ts"],
    "synthesized diff, approval step, and snapshots",
    {
      denial: "packages/runtime/tools/src/e2e-docker.test.ts#writeback=approve(false)",
      approval: "packages/runtime/tools/src/e2e-docker.test.ts#writeback=auto",
    },
  ),
  entry(
    "multiagent.plan.persist",
    "multi_agent",
    ["persist planner DAG", "advance task-node state"],
    "task_state.write",
    "explicit_modal_confirmation",
    ["packages/runtime/agent-core/src/service.ts", "packages/runtime/agent-core/src/multi-agent.ts"],
    "task_updated events and planner approval run step",
    {
      denial: "packages/runtime/agent-core/src/service-race.test.ts#plan-approval gate",
      approval: "packages/runtime/agent-core/src/service-race.test.ts#plan-approval gate",
    },
  ),
  entry(
    "multiagent.coder.mutation",
    "multi_agent",
    ["coder apply_patch", "coder run_command"],
    "workspace.write",
    "per_call_approval",
    ["packages/runtime/agent-core/src/multi-agent.ts", "packages/runtime/agent-core/src/service.ts"],
    "role message plus shared tool/approval steps",
  ),
  entry(
    "multiagent.planner.workspace",
    "multi_agent",
    ["planner forged workspace mutation"],
    "workspace.write",
    "role_denied",
    ["packages/runtime/agent-core/src/multi-agent.ts"],
    "role_tool_denied structured tool result",
    {
      denial:
        "packages/runtime/agent-core/src/dynamic-tools-security.test.ts#Planner-forged dynamic mutating tool",
      approval: null,
    },
  ),
  entry(
    "multiagent.reviewer.mutation",
    "multi_agent",
    ["reviewer forged mutation", "reviewer run_command"],
    "process.execute",
    "per_call_approval",
    ["packages/runtime/agent-core/src/multi-agent.ts", "packages/runtime/agent-core/src/service.ts"],
    "role deny or shared command approval/tool steps",
  ),
  entry(
    "cli.agent.patch.prompt",
    "cli",
    ["interactive patch approval", "interactive command confirmation"],
    "workspace.write",
    "per_call_approval",
    ["apps/cli/src/commands/run.ts"],
    "AgentService run and step log plus terminal decision",
  ),
  entry(
    "cli.agent.yes",
    "cli",
    ["--yes blanket approval for one invoked run"],
    "workspace.write",
    "capability_grant",
    ["apps/cli/src/commands/run.ts"],
    "explicit argv grant plus AgentService run and step log",
  ),
  entry(
    "tui.init",
    "tui",
    ["/init", "/init --force"],
    "workspace.write",
    "explicit_user_action",
    ["apps/cli/src/tui/commands.ts", "apps/cli/src/tui/ink-tui.tsx"],
    "TUI system message and created .nlc files",
  ),
  entry(
    "tui.skill.install",
    "tui",
    ["/skills-generate followed by install target"],
    "workspace.write",
    "explicit_modal_confirmation",
    ["apps/cli/src/tui/ink-tui.tsx", "apps/cli/src/tui/skill-install-picker.tsx"],
    "TUI generation/install outcome",
  ),
  entry(
    "tui.rollback",
    "tui",
    ["/rollback", "/undo"],
    "workspace.write",
    "explicit_user_action",
    ["apps/cli/src/tui/ink-tui.tsx", "apps/cli/src/tui/use-loop.ts"],
    "rollback run step and terminal system message",
    {
      approval: "apps/cli/src/tui/core-workflows.e2e.pty.test.ts#approve and rollback",
    },
  ),
  entry(
    "tui.session.mutation",
    "tui",
    ["/branch", "/resume", "appended JSONL messages"],
    "session.write",
    "explicit_user_action",
    ["apps/cli/src/tui/ink-tui.tsx", "apps/cli/src/tui/session-bridge.ts"],
    "append-only JSONL event with lineage",
  ),
  entry(
    "tui.preferences",
    "tui",
    ["/provider save", "/theme", "/model", "/think"],
    "settings.write",
    "explicit_modal_confirmation",
    ["apps/cli/src/tui/ink-tui.tsx", "apps/cli/src/tui/provider-picker.tsx"],
    "provider store or session state-change event",
  ),
  entry(
    "desktop.agent.approval",
    "desktop_ipc",
    ["agent:applyPatch", "agent:rejectPatch", "task:approveTree"],
    "workspace.write",
    "explicit_modal_confirmation",
    ["apps/desktop/src/main/ipc.ts", "apps/desktop/src/main/ipc/task-ipc.ts"],
    "AgentService approval/plan step",
  ),
  entry(
    "desktop.run.command",
    "desktop_ipc",
    ["agent:runCommand"],
    "process.execute",
    "explicit_user_action",
    ["apps/desktop/src/main/ipc.ts", "packages/runtime/agent-core/src/service.ts"],
    "direct typed command result and sandbox snapshots",
  ),
  entry(
    "desktop.run.maintenance",
    "desktop_ipc",
    ["agent:rollbackRun", "agent:clearRuns", "agent:stopRun"],
    "workspace.write",
    "explicit_user_action",
    ["apps/desktop/src/main/ipc.ts"],
    "run status/rollback step or deleted run count",
  ),
  entry(
    "desktop.settings",
    "desktop_ipc",
    ["settings:update", "settings:reset", "sandbox:setMode", "phase4:updateSettings"],
    "settings.write",
    "explicit_user_action",
    ["apps/desktop/src/main/ipc.ts", "apps/desktop/src/main/ipc/advanced-settings-ipc.ts"],
    "validated settings store write",
  ),
  entry(
    "desktop.memory",
    "desktop_ipc",
    ["memory:create", "memory:update", "memory:delete", "memory:import"],
    "memory.write",
    "explicit_user_action",
    ["apps/desktop/src/main/ipc/memory-ipc.ts"],
    "validated memory row mutation",
  ),
  entry(
    "desktop.index.task.git",
    "desktop_ipc",
    ["semantic:rebuild", "task:editNode", "task:cancelNode", "git:discardBranch"],
    "project_state.write",
    "explicit_user_action",
    [
      "apps/desktop/src/main/ipc/semantic-ipc.ts",
      "apps/desktop/src/main/ipc/task-ipc.ts",
      "apps/desktop/src/main/ipc/git-ipc.ts",
    ],
    "index status, task event, or Git operation result",
  ),
  entry(
    "desktop.intelligence",
    "desktop_ipc",
    [
      "global-memory contribute/retract/delete/mode",
      "style upsert/extract",
      "learning record/build dataset",
    ],
    "intelligence_state.write",
    "explicit_user_action",
    [
      "apps/desktop/src/main/ipc/memory-ipc.ts",
      "apps/desktop/src/main/ipc/style-ipc.ts",
      "apps/desktop/src/main/ipc/learning-ipc.ts",
    ],
    "validated SQLite mutation",
  ),
  entry(
    "desktop.finetune",
    "desktop_ipc",
    ["finetune:createJob", "finetune:promoteModel", "finetune:rollbackToBase"],
    "model_state.write",
    "explicit_user_action",
    ["apps/desktop/src/main/ipc/finetune-ipc.ts"],
    "fine-tune job/model registry row",
  ),
  entry(
    "desktop.proactive",
    "desktop_ipc",
    ["proposal:snooze", "proposal:dismiss", "proposal:convert", "proposal:scanNow"],
    "proposal_state.write",
    "explicit_user_action",
    ["apps/desktop/src/main/ipc/proposals-ipc.ts"],
    "proposal row/task conversion result",
  ),
  entry(
    "proactive.scheduler",
    "background",
    ["scheduled debt scan and proposal persistence"],
    "proposal_state.write",
    "feature_flag",
    ["packages/advanced/proactive/src", "apps/desktop/src/main/services.ts"],
    "advanced setting plus proposal timestamps",
  ),
  entry(
    "desktop.cluster",
    "desktop_ipc",
    ["cluster:registerWorker"],
    "cluster_state.write",
    "explicit_user_action",
    ["apps/desktop/src/main/ipc/cluster-ipc.ts"],
    "validated worker registry row",
  ),
  entry(
    "desktop.plugin.lifecycle",
    "desktop_ipc",
    ["plugin:install", "plugin:setEnabled", "plugin:uninstall"],
    "plugin_state.write",
    "explicit_modal_confirmation",
    ["apps/desktop/src/main/ipc/plugin-ipc.ts", "packages/advanced/plugin-sdk/src/plugin-loader.ts"],
    "approved permission set and installation row",
  ),
  entry(
    "storage.startup.recovery",
    "startup",
    ["reconcile interrupted non-terminal runs"],
    "run_state.write",
    "trusted_recovery",
    ["packages/core/storage/src/index.ts"],
    "single interrupted_restart error step and idempotency marker",
    {
      denial: "packages/core/storage/src/storage.test.ts#recovery",
      approval: "packages/core/storage/src/storage.test.ts#recovery",
    },
  ),
];

const ids = new Set();
for (const item of entries) {
  if (ids.has(item.id)) throw new Error(`duplicate mutation id: ${item.id}`);
  ids.add(item.id);
  for (const source of item.source) {
    if (!fs.existsSync(path.join(ROOT, source))) {
      throw new Error(`${item.id}: missing source ${source}`);
    }
  }
}

const inventory = {
  schemaVersion: 1,
  goal: "SEC-APPROVAL-001",
  generatedBy: "scripts/generate-mutation-inventory.mjs",
  policySource: "packages/runtime/agent-core/src/mutation-policy.ts",
  entries,
};
const rendered = `${JSON.stringify(inventory, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8") : "";
  if (current !== rendered) {
    process.stderr.write("mutation inventory is stale; run pnpm docs:mutations\n");
    process.exitCode = 1;
  }
} else {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, rendered);
  process.stdout.write(`wrote ${path.relative(ROOT, OUTPUT)} (${entries.length} entries)\n`);
}
