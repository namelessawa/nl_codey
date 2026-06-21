/**
 * Inline approval card for pending `apply_patch`. Top + bottom rails only
 * (single line), in the accent colour (or rainbow phase 4).
 */
import React, { memo } from "react";
import { Box, Text, useInput } from "ink";
import { useAnimatedBorder, useTheme } from "./theme-context.js";

export type ApprovalProps = {
  patch: string;
  onApprove: () => void;
  onReject: () => void;
};

export const Approval = memo(function Approval({ patch, onApprove, onReject }: ApprovalProps) {
  const { palette, box: glyph } = useTheme();
  const border = useAnimatedBorder(4);
  useInput((input) => {
    const k = input.toLowerCase();
    if (k === "y") onApprove();
    else if (k === "n" || k === "q") onReject();
  });
  const preview = patch.split("\n").slice(0, 6).join("\n");
  const overflow = patch.split("\n").length > 6;
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderLeft={false}
      borderRight={false}
      borderColor={border}
      paddingX={1}
    >
      <Text color={palette.accent} bold>
        [verify] pending patch
      </Text>
      <Text color={palette.textDim}>{glyph.singleH.repeat(40)}</Text>
      <Text color={palette.text}>{preview}</Text>
      {overflow ? <Text color={palette.textDim}>…</Text> : null}
      <Text color={palette.textDim}>{glyph.singleH.repeat(40)}</Text>
      <Text color={palette.primaryActive}>
        press{" "}
        <Text color={palette.success} bold>
          y
        </Text>{" "}
        to apply,{" "}
        <Text color={palette.danger} bold>
          n
        </Text>{" "}
        to reject
      </Text>
    </Box>
  );
});
