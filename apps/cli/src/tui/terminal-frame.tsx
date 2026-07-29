import React from "react";
import { Box, Text } from "ink";
import { Header } from "./header.js";
import { LiveAgent } from "./live-agent.js";
import { Trace } from "./trace.js";
import { useAnimatedBorder, useTheme } from "./theme-context.js";
import {
  MIN_TERMINAL_COLUMNS,
  MIN_TERMINAL_ROWS,
  type TerminalLayout,
} from "./terminal-layout.js";
import type { StreamItem, TraceItem } from "./use-loop.js";

export type TerminalFrameProps = {
  layout: TerminalLayout;
  workspaceRoot: string;
  dataRoot: string;
  status: string;
  isRunning: boolean;
  liveAgent: StreamItem | null;
  trace: readonly TraceItem[];
  showIdleHint: boolean;
};

/**
 * Render the height-aware live frame. The compact branch intentionally owns
 * only the chrome/body area: callers keep Prompt and blocking modals mounted
 * below it so resize cannot discard their state or input ownership.
 */
export function TerminalFrame({
  layout,
  workspaceRoot,
  dataRoot,
  status,
  isRunning,
  liveAgent,
  trace,
  showIdleHint,
}: TerminalFrameProps) {
  const { palette } = useTheme();
  const headerBorder = useAnimatedBorder(0);
  const liveBorder = useAnimatedBorder(1);

  if (layout.isTooSmall) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderLeft={false}
        borderRight={false}
        borderColor={headerBorder}
        paddingX={1}
      >
        <Box justifyContent="space-between">
          <Text color={palette.primary} bold>
            NL_Codey
          </Text>
          <Text color={isRunning ? palette.primaryActive : palette.textDim}>
            {status}
          </Text>
        </Box>
        <Text color={palette.warn} bold>
          {`Terminal ${layout.columns}x${layout.rows} is too small.`}
        </Text>
        <Text color={palette.textDim}>
          {`Resize to at least ${MIN_TERMINAL_COLUMNS}x${MIN_TERMINAL_ROWS}; input remains available.`}
        </Text>
      </Box>
    );
  }

  return (
    <>
      <Box
        borderStyle="single"
        borderLeft={false}
        borderRight={false}
        borderColor={headerBorder}
      >
        <Header
          workspaceRoot={workspaceRoot}
          dataRoot={dataRoot}
          status={status}
          isRunning={isRunning}
        />
      </Box>

      <Box
        flexDirection="row"
        height={layout.liveBodyHeight}
        borderStyle="single"
        borderLeft={false}
        borderRight={false}
        borderColor={liveBorder}
      >
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          {liveAgent ? (
            <LiveAgent item={liveAgent} />
          ) : showIdleHint ? (
            <Box paddingX={1} paddingY={1}>
              <Text color={palette.textDim}>
                (no messages yet - type a task below, or `/help` for commands)
              </Text>
            </Box>
          ) : null}
        </Box>
        <Trace items={trace} visible={!layout.isNarrow} />
      </Box>
    </>
  );
}
