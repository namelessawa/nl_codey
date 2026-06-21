/**
 * Top header bar — one row.
 *
 * `[ ◆◇◆ NL_Codey ]   <workspace>          status: tool_use  •  ~/.nlc`
 *
 * Top + bottom rails only (single line) so the chrome stays light. In
 * rainbow theme the top/bottom rails cycle hue at phase 0.
 */
import React, { memo } from "react";
import { Box, Text } from "ink";
import { logo } from "./theme.js";
import { useTheme } from "./theme-context.js";

export type HeaderProps = {
  workspaceRoot: string;
  dataRoot: string;
  status: string;
  isRunning: boolean;
};

/** Memoised: only re-renders when one of the four primitives changes. */
export const Header = memo(function Header({
  workspaceRoot,
  dataRoot,
  status,
  isRunning,
}: HeaderProps) {
  const { palette } = useTheme();
  const dot = isRunning ? "●" : "○";
  const statusColor = isRunning ? palette.primaryActive : palette.textDim;
  return (
    <Box paddingX={1} justifyContent="space-between" width="100%">
      <Box>
        <Text color={palette.primary} bold>
          {logo()}
        </Text>
        <Text color={palette.textDim}>{`  ${shortPath(workspaceRoot)}`}</Text>
      </Box>
      <Box>
        <Text color={statusColor}>{`${dot} ${status}`}</Text>
        <Text color={palette.textDim}>{`   ${shortPath(dataRoot)}`}</Text>
      </Box>
    </Box>
  );
});

function shortPath(p: string): string {
  if (p.length <= 32) return p;
  return `…${p.slice(p.length - 31)}`;
}
