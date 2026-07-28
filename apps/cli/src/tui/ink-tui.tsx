/**
 * Top-level Ink composition. Wraps the inner App in {@link ThemeProvider}
 * so every consumer (`useTheme()`) re-renders together when the theme
 * changes or the rainbow tick advances.
 *
 * Layout (wide ≥ 80 cols):
 *
 *   ── scrollback (printed once, owned by the OS terminal) ───────
 *    [user]   ...
 *    [agent]  ...
 *    [tool]   ...
 *    (mouse wheel scrolls the entire conversation history)
 *   ── live frame (Ink repaints this region) ────────────────────
 *    [ ◆◇◆ NL_Codey ]    cwd      ○ idle
 *   ──────────────────────────────────────────
 *    [agent] in-progress reply…   │ trace
 *                                 │ ▸ tool_call
 *                                 │   path/to/file
 *                                 │ ▸ patch
 *                                 │   …
 *   ──────────────────────────────────────────
 *    ❯ prompt input
 *   ──────────────────────────────────────────
 *    ↵ send    / commands   /exit quit
 *
 * Narrow (< 80 cols): the trace panel drops and the centre takes the
 * full width.
 *
 * The split into Static scrollback above the live frame is the heart of
 * the rewrite: the chat history flows naturally into the terminal's
 * own scrollback (mouse-wheel friendly), while the live frame keeps a
 * stable, rectangular shape — the trace pane has a fixed height so the
 * prompt row stays anchored even as new trace items arrive.
 */
import React from "react";
import { useEffect, useState } from "react";
import path from "node:path";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import { nlcRoot } from "@nlc/shared";
import { loadSkills } from "@nlc/agent-core";
import { ThemeProvider, useAnimatedBorder, useTheme } from "./theme-context.js";
import { THEMES, type ThemeName } from "./theme.js";
import { Header } from "./header.js";
import { MessageStream } from "./message-stream.js";
import { LiveAgent } from "./live-agent.js";
import { Trace } from "./trace.js";
import { Prompt } from "./prompt.js";
import { Approval } from "./approval.js";
import { Footer } from "./footer.js";
import { useLoop } from "./use-loop.js";
import { renderHelp, type CommandEffect } from "./commands.js";
import { loadCliSettings } from "../lib/settings.js";
import { initProjectSkeleton, renderInitOutcome } from "../lib/init-project.js";
import {
  generateSkill,
  installSkill,
  renderInstallOutcome,
  type SkillInstallLocation,
} from "../lib/skill-generator.js";
import { SkillInstallPicker, type PendingSkill } from "./skill-install-picker.js";
import { ProviderPicker, type ProviderDraft } from "./provider-picker.js";
import {
  loadProviderStore,
  upsertProvider,
  type StoredProvider,
} from "../lib/provider-store.js";

const NARROW_BREAKPOINT = 80;
/** Live-frame body height — keeps the prompt row anchored. */
const LIVE_BODY_HEIGHT = 14;

export type TuiOptions = {
  workspaceRoot?: string;
  dataRoot?: string;
  autoApprove?: boolean;
  /** Initial theme. Defaults to the registry's DEFAULT_THEME (teal). */
  theme?: ThemeName;
};

function InnerApp(opts: TuiOptions) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { setThemeName, themeName, palette } = useTheme();
  const headerBorder = useAnimatedBorder(0);
  const liveBorder = useAnimatedBorder(1);
  const loop = useLoop({
    ...(opts.workspaceRoot !== undefined ? { workspaceRoot: opts.workspaceRoot } : {}),
    ...(opts.dataRoot !== undefined ? { dataRoot: opts.dataRoot } : {}),
    ...(opts.autoApprove !== undefined ? { autoApprove: opts.autoApprove } : {}),
  });
  const [width, setWidth] = useState(stdout.columns ?? 100);
  const [pendingSkill, setPendingSkill] = useState<PendingSkill | null>(null);
  const [skillBusy, setSkillBusy] = useState(false);
  // Provider picker — `null` means closed; non-null means the modal is mounted
  // and owns input. Snapshot of the on-disk store is captured at open time.
  const [providerOpen, setProviderOpen] = useState<{
    stored: Record<string, StoredProvider>;
    activeKey: string | null;
  } | null>(null);

  useEffect(() => {
    const update = (): void => setWidth(stdout.columns ?? 100);
    stdout.on("resize", update);
    return () => {
      stdout.off("resize", update);
    };
  }, [stdout]);

  useInput((input, key) => {
    if (loop.pendingApproval || pendingSkill || providerOpen) return;
    if (key.ctrl && input === "c") {
      if (loop.isRunning) loop.cancel();
      else exit();
    }
  });

  const handleCommand = (effect: CommandEffect): void => {
    switch (effect.kind) {
      case "noop":
        return;
      case "exit":
        exit();
        return;
      case "clear":
        loop.clear();
        return;
      case "show-help":
        loop.appendSystem(`commands\n${renderHelp()}`, "help");
        return;
      case "list-workspaces":
        loop.appendSystem(
          "list-workspaces: storage backend not available in this dev tree (ABI mismatch).\n" +
            "Run `nlc workspaces` from a fresh shell instead, or rebuild better-sqlite3 for Node.",
          "system",
        );
        return;
      case "show-settings": {
        try {
          const s = loadCliSettings(loop.dataRoot);
          const lines = [
            `data root: ${loop.dataRoot}`,
            `theme:     ${themeName}`,
            `provider:  ${s.appSettings.llm.provider}`,
            `model:     ${s.appSettings.llm.model}`,
            `base url:  ${s.appSettings.llm.baseUrl || "(provider default)"}`,
            `api key:   ${s.apiKeyFromEnv ? "from environment" : "not set — export NLC_API_KEY"}`,
            `language:  ${s.appSettings.ui.language}`,
          ];
          loop.appendSystem(lines.join("\n"), "settings");
        } catch (err) {
          loop.appendSystem(
            `could not read settings: ${err instanceof Error ? err.message : String(err)}`,
            "system",
          );
        }
        return;
      }
      case "switch-workspace":
        loop.appendSystem(
          `/cd is queued (target: ${effect.path}) but workspace switch is not wired yet.`,
          "system",
        );
        return;
      case "init":
        try {
          const outcome = initProjectSkeleton(loop.workspaceRoot, { force: effect.force });
          loop.appendSystem(renderInitOutcome(outcome), "init");
        } catch (err) {
          loop.appendSystem(
            `/init failed: ${err instanceof Error ? err.message : String(err)}`,
            "system",
          );
        }
        return;
      case "list-skills": {
        try {
          const globalRoot = loop.dataRoot ?? nlcRoot();
          const globals = loadSkills(path.join(globalRoot, "skills"), "global");
          const projects = loadSkills(
            path.join(loop.workspaceRoot, ".nlc", "skills"),
            "project",
          );
          const seen = new Set(projects.map((s) => s.name));
          const dedupedGlobals = globals.filter((s) => !seen.has(s.name));
          const all = [...dedupedGlobals, ...projects].sort((a, b) =>
            a.name.localeCompare(b.name),
          );
          if (all.length === 0) {
            loop.appendSystem(
              "no skills found.\n" +
                `  global lookup: ${path.join(globalRoot, "skills")}\n` +
                `  project lookup: ${path.join(loop.workspaceRoot, ".nlc", "skills")}\n` +
                "tip: run /init to lay down a sample skill in this project.",
              "skills",
            );
            return;
          }
          const widest = all.reduce((n, s) => Math.max(n, s.name.length), 0);
          const lines: string[] = [
            `${all.length} skill${all.length === 1 ? "" : "s"} discovered`,
            "",
          ];
          for (const s of all) {
            const tag = `[${s.source}]`.padEnd(10);
            const name = s.name.padEnd(widest + 2);
            const desc = s.description || "(no description)";
            lines.push(`  ${tag} ${name} ${desc}`);
            if (s.whenToUse) lines.push(`             when: ${s.whenToUse}`);
          }
          loop.appendSystem(lines.join("\n"), "skills");
        } catch (err) {
          loop.appendSystem(
            `/skills failed: ${err instanceof Error ? err.message : String(err)}`,
            "system",
          );
        }
        return;
      }
      case "skills-generate":
        if (!effect.description) {
          loop.appendSystem(
            "/skills-generate needs a description, e.g. `/skills-generate audit logs for 5xx errors`",
            "system",
          );
          return;
        }
        setPendingSkill({ description: effect.description });
        setSkillBusy(false);
        return;
      case "theme": {
        if (!effect.name) {
          // `/theme` with no arg → list the registry.
          const widest = Object.keys(THEMES).reduce((n, k) => Math.max(n, k.length), 0);
          const lines: string[] = [
            `current theme: ${themeName}`,
            "",
            "available themes:",
          ];
          for (const t of Object.values(THEMES)) {
            const marker = t.name === themeName ? ">" : " ";
            lines.push(`  ${marker} ${t.name.padEnd(widest + 2)} ${t.label}`);
          }
          lines.push("", "switch with `/theme <name>` — try `/theme rainbow`.");
          loop.appendSystem(lines.join("\n"), "theme");
          return;
        }
        const requested = effect.name.toLowerCase();
        if (!(requested in THEMES)) {
          const valid = Object.keys(THEMES).join(", ");
          loop.appendSystem(
            `/theme: unknown name "${effect.name}". try one of: ${valid}.`,
            "system",
          );
          return;
        }
        const previous = themeName;
        setThemeName(requested as ThemeName);
        loop.recordStateChange("theme_change", previous, requested);
        loop.appendSystem(
          `theme switched to "${requested}". ${THEMES[requested as ThemeName].label}`,
          "theme",
        );
        return;
      }
      case "sessions": {
        try {
          const summaries = loop.listSessions();
          if (summaries.length === 0) {
            loop.appendSystem(
              "no sessions on disk yet — submit a task to open one.",
              "sessions",
            );
            return;
          }
          const widest = summaries.reduce((n, s) => Math.max(n, s.id.length), 0);
          const lines: string[] = [
            `${summaries.length} session${summaries.length === 1 ? "" : "s"} in this project`,
            "",
          ];
          const active = loop.currentSessionId();
          for (const s of summaries) {
            const marker = s.id === active ? ">" : " ";
            const branched = s.parent ? ` (← ${s.parent.sessionId.slice(0, 14)}…)` : "";
            lines.push(
              `  ${marker} ${s.id.padEnd(widest + 2)}${s.messageCount.toString().padStart(3)} msg  ` +
                `${s.title}${branched}`,
            );
          }
          loop.appendSystem(lines.join("\n"), "sessions");
        } catch (err) {
          loop.appendSystem(
            `/sessions failed: ${err instanceof Error ? err.message : String(err)}`,
            "system",
          );
        }
        return;
      }
      case "tree": {
        try {
          loop.appendSystem(loop.renderTree(), "tree");
        } catch (err) {
          loop.appendSystem(
            `/tree failed: ${err instanceof Error ? err.message : String(err)}`,
            "system",
          );
        }
        return;
      }
      case "branch": {
        try {
          let parentSessionId = effect.sessionId;
          if (!parentSessionId) {
            // Default: branch from the current session.
            parentSessionId = loop.currentSessionId();
            if (!parentSessionId) {
              loop.appendSystem(
                "/branch: no active session yet — submit a task first or pass /branch <msg> <session>.",
                "system",
              );
              return;
            }
          }
          const newId = loop.branchAt(parentSessionId, effect.messageId);
          loop.appendSystem(
            `branched from ${parentSessionId} · ${effect.messageId} → ${newId}\n` +
              "next user message will hang off the branch point.",
            "branch",
          );
        } catch (err) {
          loop.appendSystem(
            `/branch failed: ${err instanceof Error ? err.message : String(err)}`,
            "system",
          );
        }
        return;
      }
      case "resume": {
        try {
          const { id, filePath, messageCount } = loop.resumeSession(effect.target);
          loop.appendSystem(
            `resumed ${id}; replayed ${messageCount} messages without running tools.\n` +
              `  ${filePath}\nnew messages will append to this session.`,
            "resume",
          );
        } catch (err) {
          loop.appendSystem(
            `/resume failed: ${err instanceof Error ? err.message : String(err)}`,
            "system",
          );
        }
        return;
      }
      case "rollback": {
        try {
          const result = loop.rollback(effect.runId);
          loop.appendSystem(
            `rolled back ${result.id}\nworkspace snapshots restored; run status is ${result.status}.`,
            "rollback",
          );
        } catch (err) {
          loop.appendSystem(
            `/rollback failed: ${err instanceof Error ? err.message : String(err)}`,
            "system",
          );
        }
        return;
      }
      case "model": {
        try {
          const s = loadCliSettings(loop.dataRoot);
          const current = { provider: s.appSettings.llm.provider, model: s.appSettings.llm.model };
          if (!effect.spec) {
            loop.appendSystem(
              `current model: ${current.provider}/${current.model}\n` +
                "change with `/model <provider>/<model>` — change is logged to the session, but the GUI still owns settings.json.",
              "model",
            );
            return;
          }
          const slash = effect.spec.indexOf("/");
          if (slash <= 0 || slash === effect.spec.length - 1) {
            loop.appendSystem(
              `/model: expected "<provider>/<model>", got "${effect.spec}"`,
              "system",
            );
            return;
          }
          const next = {
            provider: effect.spec.slice(0, slash),
            model: effect.spec.slice(slash + 1),
          };
          loop.recordStateChange("model_change", current, next);
          loop.appendSystem(
            `model switch recorded: ${current.provider}/${current.model} → ${next.provider}/${next.model}\n` +
              "(open Settings in the GUI — or rerun nlc with NLC_API_KEY — to make the runtime catch up.)",
            "model",
          );
        } catch (err) {
          loop.appendSystem(
            `/model failed: ${err instanceof Error ? err.message : String(err)}`,
            "system",
          );
        }
        return;
      }
      case "think": {
        if (!effect.level) {
          loop.appendSystem(
            "thinking level is not surfaced in CLI runtime yet.\n" +
              "set with `/think <level>` to record the change as a session event.",
            "think",
          );
          return;
        }
        loop.recordStateChange("thinking_level_change", null, effect.level);
        loop.appendSystem(`thinking level recorded: ${effect.level}`, "think");
        return;
      }
      case "provider": {
        try {
          const store = loadProviderStore(loop.dataRoot);
          setProviderOpen({ stored: store.providers, activeKey: store.active });
        } catch (err) {
          loop.appendSystem(
            `/provider failed to open: ${err instanceof Error ? err.message : String(err)}`,
            "system",
          );
        }
        return;
      }
      case "unknown":
        loop.appendSystem(
          `unknown command "${effect.raw}". try /help`,
          "system",
        );
        return;
    }
  };

  const onSkillPick = async (location: SkillInstallLocation): Promise<void> => {
    const pending = pendingSkill;
    if (!pending) return;
    setSkillBusy(true);
    loop.appendSystem(
      `generating skill for "${pending.description}" → ${location}`,
      "skills",
    );
    try {
      const skill = await generateSkill(pending.description, loop.dataRoot);
      const result = installSkill(skill, location, loop.workspaceRoot, loop.dataRoot);
      loop.appendSystem(renderInstallOutcome(skill, result, location), "skills");
    } catch (err) {
      loop.appendSystem(
        `/skills-generate failed: ${err instanceof Error ? err.message : String(err)}`,
        "system",
      );
    } finally {
      setPendingSkill(null);
      setSkillBusy(false);
    }
  };

  const onSkillCancel = (): void => {
    if (skillBusy) return;
    setPendingSkill(null);
    loop.appendSystem("/skills-generate cancelled.", "skills");
  };

  const isNarrow = width < NARROW_BREAKPOINT;
  const showLiveAgent = !!loop.liveAgent;
  const showIdleHint = loop.stream.length === 0 && !loop.liveAgent && !loop.isRunning;

  return (
    <Box flexDirection="column" width="100%">
      {/* SCROLLBACK — Static items, owned by the OS terminal.
          Mouse wheel scrolls this region. Each finalised message lands
          here once and is never repainted. */}
      <MessageStream key={loop.streamVersion} items={loop.stream} />

      {/* LIVE FRAME — Ink repaints this region on every state change. */}
      <Box
        borderStyle="single"
        borderLeft={false}
        borderRight={false}
        borderColor={headerBorder}
      >
        <Header
          workspaceRoot={loop.workspaceRoot}
          dataRoot={loop.dataRoot}
          status={loop.status}
          isRunning={loop.isRunning}
        />
      </Box>

      <Box
        flexDirection="row"
        height={LIVE_BODY_HEIGHT}
        borderStyle="single"
        borderLeft={false}
        borderRight={false}
        borderColor={liveBorder}
      >
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          {showLiveAgent ? (
            <LiveAgent item={loop.liveAgent} />
          ) : showIdleHint ? (
            <Box paddingX={1} paddingY={1}>
              <Text color={palette.textDim}>
                (no messages yet — type a task below, or `/help` for commands)
              </Text>
            </Box>
          ) : null}
        </Box>
        <Trace items={loop.trace} visible={!isNarrow} />
      </Box>

      {loop.pendingApproval ? (
        <Approval
          patch={loop.pendingApproval.patch}
          onApprove={loop.approve}
          onReject={loop.reject}
        />
      ) : pendingSkill ? (
        <SkillInstallPicker
          pending={pendingSkill}
          busy={skillBusy}
          onPick={onSkillPick}
          onCancel={onSkillCancel}
        />
      ) : providerOpen ? (
        <ProviderPicker
          stored={providerOpen.stored}
          activeKey={providerOpen.activeKey}
          onCancel={() => {
            setProviderOpen(null);
            loop.appendSystem("/provider cancelled.", "provider");
          }}
          onSubmit={(draft: ProviderDraft) => {
            try {
              const before = loadCliSettings(loop.dataRoot);
              const beforeLLM = {
                provider: before.appSettings.llm.provider,
                model: before.appSettings.llm.model,
              };
              upsertProvider(loop.dataRoot, {
                key: draft.key,
                name: draft.name,
                baseUrl: draft.baseUrl,
                apiKey: draft.apiKey,
                model: draft.model,
                protocol: draft.protocol,
              });
              loop.recordStateChange("model_change", beforeLLM, {
                provider: draft.protocol,
                model: draft.model || beforeLLM.model,
              });
              loop.appendSystem(
                `provider saved: ${draft.name} (${draft.key})\n` +
                  `  baseUrl: ${draft.baseUrl}\n` +
                  `  model:   ${draft.model || "(empty — will fall through)"}\n` +
                  `  apiKey:  ${draft.apiKey ? "stored" : "not set — falls back to env"}\n` +
                  "next agent run will use this provider.",
                "provider",
              );
            } catch (err) {
              loop.appendSystem(
                `/provider failed to save: ${err instanceof Error ? err.message : String(err)}`,
                "system",
              );
            } finally {
              setProviderOpen(null);
            }
          }}
        />
      ) : (
        <Prompt
          disabled={loop.isRunning}
          onSubmit={loop.submit}
          onCommand={handleCommand}
        />
      )}
      <Footer isRunning={loop.isRunning} awaitingApproval={!!loop.pendingApproval} />
    </Box>
  );
}

/** Mount Ink. Returns a promise that resolves when the user exits. */
export async function runInkTui(opts: TuiOptions = {}): Promise<void> {
  const instance = render(
    <ThemeProvider initial={opts.theme}>
      <InnerApp {...opts} />
    </ThemeProvider>,
    { exitOnCtrlC: false },
  );
  await instance.waitUntilExit();
}
