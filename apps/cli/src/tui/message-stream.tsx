/**
 * Central scrollback — routed through Ink's `<Static>`.
 *
 * Why `<Static>`: Ink normally repaints its entire output tree on every
 * state change. That makes the terminal lose history once a row scrolls
 * past the live frame, and prevents the user from using their mouse
 * wheel to look back. `<Static>` only paints items appended since the
 * last frame and writes them as standalone rows above the live region,
 * which means the OS's own scrollback owns the history. Mouse wheel
 * "just works" again.
 *
 * Critical invariant: `items` must be append-only. Mutating an existing
 * row (e.g. accumulating a streaming agent reply) DOES NOT repaint that
 * row — `<Static>` is intentionally fire-and-forget. The hook lifts
 * the still-mutating agent message into a separate `liveAgent` slot
 * that the parent renders in the live frame; only when the message is
 * finalised does it land here.
 *
 * Each row renders as `[label] text…` where `label` carries the
 * role colour. Long bodies wrap inside the row.
 */
import React from "react";
import { Box, Static, Text } from "ink";
import { redactSensitiveText } from "@nlc/shared";
import { roleColorMap, type RoleKey } from "./theme.js";
import { useTheme } from "./theme-context.js";
import type { StreamItem } from "./use-loop.js";

export type MessageStreamProps = {
  items: readonly StreamItem[];
};

export function MessageStream({ items }: MessageStreamProps) {
  const { palette } = useTheme();
  const roleColor = roleColorMap(palette);
  if (items.length === 0) {
    // Don't render Static with no items — it would still take a line.
    return null;
  }
  // Static accepts only a mutable array, so materialise the readonly view.
  const list = items as StreamItem[];
  return (
    <Static items={list}>
      {(item) => (
        <Box
          key={item.id}
          paddingX={1}
          marginTop={item.role === "user" ? 1 : 0}
        >
          <Text color={roleColor[item.role as RoleKey] ?? palette.text} bold>
            {`[${item.label}]`}
          </Text>
          <Text color={palette.text}>
            {` ${
              item.role === "error"
                ? redactSensitiveText(item.text, {
                    maxLength: 4_000,
                    fallback: "Unknown error",
                  })
                : item.text
            }`}
          </Text>
        </Box>
      )}
    </Static>
  );
}
