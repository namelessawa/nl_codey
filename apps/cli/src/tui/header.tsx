/**
 * Top header bar — one row.
 *
 * `[ ◆◇◆ NL_Codey ]   <workspace>   read-only  status: tool_use  •  ~/.nlc`
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
  readOnly?: boolean;
};

/** Memoised: only re-renders when one of the five primitives changes. */
export const Header = memo(function Header({
  workspaceRoot,
  dataRoot,
  status,
  isRunning,
  readOnly = false,
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
        <Text color={palette.textDim}>
          {`  ${shortPath(workspaceRoot, readOnly ? 24 : 32)}`}
        </Text>
      </Box>
      <Box>
        {readOnly ? (
          <Text color={palette.warn} bold>
            read-only{"  "}
          </Text>
        ) : null}
        <Text color={statusColor}>{`${dot} ${status}`}</Text>
        <Text color={palette.textDim}>
          {`   ${shortPath(dataRoot, readOnly ? 24 : 32)}`}
        </Text>
      </Box>
    </Box>
  );
});

function shortPath(p: string, maxLength: number): string {
  if (p.length <= maxLength) return p;
  return `…${p.slice(p.length - (maxLength - 1))}`;
}
