/**
 * Right-side trace panel — opencode's left sidebar holds session history;
 * ours holds the LIVE tool-call timeline of the current run instead, on
 * the right.
 *
 * Border discipline: this is the ONE pane that keeps vertical rails (left
 * + right). Every other pane uses top + bottom rails. The asymmetry helps
 * the eye distinguish "scratch space" from "task progress".
 *
 * Layout discipline: the trace pane has a FIXED height. The previous
 * version let `flexGrow` size the pane against the chat stream, which
 * meant every new trace row pushed the prompt down by one line and
 * misaligned the input with the trace's bottom rail. With a fixed
 * height the live frame is rectangular, the prompt row is stable, and
 * extra trace items roll off the top while the most recent ones stay
 * visible.
 */
import React, { memo } from "react";
import { Box, Text } from "ink";
import { useAnimatedBorder, useTheme } from "./theme-context.js";
import type { TraceItem } from "./use-loop.js";

const PANEL_WIDTH = 30;
/** Visible body rows — header + rule together take 2 rows. */
const VISIBLE_ROWS = 12;

export type TraceProps = {
  items: readonly TraceItem[];
  visible: boolean;
};

/**
 * Memoised — only re-renders when `items` or `visible` change. Its border
 * animation comes through {@link useAnimatedBorder}, which has its own
 * local subscription so tick changes do not propagate into the row tree.
 */
export const Trace = memo(function Trace({ items, visible }: TraceProps) {
  const { palette, box: glyph } = useTheme();
  const border = useAnimatedBorder(2);
  if (!visible) return null;
  // Slice to the last VISIBLE_ROWS — older entries roll off the top.
  // Each item renders as two rows (label + detail), so divide by two
  // to keep the panel within its fixed height.
  const slice = items.slice(-Math.floor(VISIBLE_ROWS / 2));
  return (
    <Box
      flexDirection="column"
      width={PANEL_WIDTH}
      height={VISIBLE_ROWS + 2}
      flexShrink={0}
      borderStyle="single"
      borderTop={false}
      borderBottom={false}
      borderColor={border}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text color={palette.primaryActive} bold>
          trace
        </Text>
        <Text color={palette.textDim}>{`${items.length}`}</Text>
      </Box>
      <Text color={palette.textDim}>{glyph.singleH.repeat(PANEL_WIDTH - 4)}</Text>
      {slice.length === 0 ? (
        <Text color={palette.textDim}>(idle)</Text>
      ) : (
        slice.map((item) => <Row key={item.id} item={item} />)
      )}
    </Box>
  );
});

function Row({ item }: { item: TraceItem }) {
  const { palette } = useTheme();
  const color = colorFor(item.kind, palette);
  return (
    <Box flexDirection="column">
      <Text color={color} bold>
        {`▸ ${truncate(item.label, PANEL_WIDTH - 4)}`}
      </Text>
      {item.detail ? (
        <Text color={palette.textDim}>{` ${truncate(item.detail, PANEL_WIDTH - 5)}`}</Text>
      ) : null}
    </Box>
  );
}

function colorFor(
  kind: TraceItem["kind"],
  palette: { accent: string; primaryActive: string; warn: string; textDim: string },
): string {
  if (kind === "patch") return palette.accent;
  if (kind === "tool_result") return palette.textDim;
  if (kind === "status") return palette.warn;
  return palette.primaryActive;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(1, max - 1))}…`;
}
