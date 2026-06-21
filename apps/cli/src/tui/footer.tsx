/**
 * Bottom hint strip — single row. Reminds the user of the local key
 * conventions instead of relying on a hidden help dialog.
 */
import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme-context.js";

export type FooterProps = {
  isRunning: boolean;
  awaitingApproval: boolean;
};

export function Footer({ isRunning, awaitingApproval }: FooterProps) {
  const { palette } = useTheme();
  const tag = (keys: string, label: string) => (
    <Box>
      <Text color={palette.accent} bold>
        {keys}
      </Text>
      <Text color={palette.textDim}>{` ${label}`}</Text>
    </Box>
  );
  const hints = awaitingApproval
    ? [tag("y", "apply"), tag("n", "reject")]
    : isRunning
      ? [tag("ctrl+c", "cancel")]
      : [tag("↵", "send"), tag("/", "commands"), tag("/exit", "quit")];
  return (
    <Box paddingX={1} justifyContent="flex-start">
      {hints.map((h, i) => (
        <Box key={i} marginRight={2}>
          {h}
        </Box>
      ))}
    </Box>
  );
}
