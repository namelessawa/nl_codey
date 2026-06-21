/**
 * Live-frame view for the currently-streaming agent message. Mounts only
 * while `item` is non-null (i.e. between `delta` events and the next
 * non-delta event that finalises the message). When finalised, the
 * parent moves the row into the `<Static>` stream so it falls into
 * native terminal scrollback.
 *
 * Why this lives outside `MessageStream`: `<Static>` deliberately
 * doesn't repaint already-rendered items. Mutating a stream row's text
 * (which is what happens as token-by-token deltas arrive) would not
 * reach the user. The streaming row must therefore stay in the live
 * region — the part of the UI that Ink does repaint every frame.
 */
import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme-context.js";
import type { StreamItem } from "./use-loop.js";

export type LiveAgentProps = {
  item: StreamItem | null;
};

export function LiveAgent({ item }: LiveAgentProps) {
  const { palette } = useTheme();
  if (!item) return null;
  return (
    <Box paddingX={1} flexDirection="row" flexShrink={1} minWidth={0}>
      <Text color={palette.primaryActive} bold>
        {`[${item.label}]`}
      </Text>
      <Text color={palette.text}>{` ${item.text}`}</Text>
      <Text color={palette.accent}>▍</Text>
    </Box>
  );
}
