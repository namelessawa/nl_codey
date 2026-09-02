/**
 * Terminal-size contract for the Ink live frame.
 *
 * The document's supported matrix bottoms out at 60x20. Below either
 * dimension the full header/body split is replaced by a compact warning while
 * the prompt and any blocking modal remain mounted by the parent.
 */
export const MIN_TERMINAL_COLUMNS = 60;
export const MIN_TERMINAL_ROWS = 20;
export const NARROW_TERMINAL_COLUMNS = 80;
export const DEFAULT_TERMINAL_COLUMNS = 100;
export const DEFAULT_TERMINAL_ROWS = 30;
export const LIVE_BODY_HEIGHT = 14;

export type TerminalLayout = {
  columns: number;
  rows: number;
  isNarrow: boolean;
  isTooSmall: boolean;
  liveBodyHeight: number;
};

export function deriveTerminalLayout(
  columns: number | undefined,
  rows: number | undefined,
): TerminalLayout {
  const normalizedColumns = normalizeDimension(
    columns,
    DEFAULT_TERMINAL_COLUMNS,
  );
  const normalizedRows = normalizeDimension(rows, DEFAULT_TERMINAL_ROWS);

  return {
    columns: normalizedColumns,
    rows: normalizedRows,
    isNarrow: normalizedColumns < NARROW_TERMINAL_COLUMNS,
    isTooSmall:
      normalizedColumns < MIN_TERMINAL_COLUMNS ||
      normalizedRows < MIN_TERMINAL_ROWS,
    liveBodyHeight: LIVE_BODY_HEIGHT,
  };
}

function normalizeDimension(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}
