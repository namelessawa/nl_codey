/**
 * Minimal ANSI color helpers — opt-out via NO_COLOR or --no-color, opt out
 * automatically when stdout isn't a TTY. No external dependency.
 */
const SUPPORTS_COLOR =
  typeof process !== "undefined" &&
  process.stdout &&
  typeof process.stdout.isTTY === "boolean" &&
  process.stdout.isTTY &&
  !process.env.NO_COLOR;

function wrap(code: number, close: number) {
  return (s: string): string => (SUPPORTS_COLOR ? `\x1b[${code}m${s}\x1b[${close}m` : s);
}

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

export function writeLine(s: string): void {
  process.stdout.write(s.endsWith("\n") ? s : `${s}\n`);
}

export function writeErrLine(s: string): void {
  process.stderr.write(s.endsWith("\n") ? s : `${s}\n`);
}
