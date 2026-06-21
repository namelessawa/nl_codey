/**
 * Theme context — provides the *static* part of the active theme to every
 * component via {@link useTheme}. The animated rainbow border lives on a
 * separate subscription channel ({@link useAnimatedBorder}) so it does
 * NOT re-render the whole tree every tick.
 *
 * Why two channels:
 *
 *   - `useTheme()` returns `{ palette, box, themeName, setThemeName,
 *      animated }`. The value object only changes when the user runs
 *      `/theme <name>`. That means MessageStream / Trace / Header etc.
 *      do NOT re-render on every rainbow tick — they only re-render
 *      when their own props change.
 *
 *   - `useAnimatedBorder(phase)` returns a single colour string. It
 *      subscribes to a module-level {@link TickEmitter} that broadcasts
 *      ~6.7 Hz only while the active theme is animated. The hook uses
 *      its own local "forceUpdate" reducer, so only the box-border
 *      consumer that calls it re-renders on each tick — typically the
 *      six bordered panes (header / stream / trace / prompt / popup /
 *      approval-or-picker).
 *
 * This is the React-on-Ink equivalent of opencode's Solid.js fine-grained
 * reactivity: each signal touches only its subscribers.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import {
  DEFAULT_THEME,
  rainbowColor,
  THEMES,
  box as boxGlyphs,
  type Palette,
  type Theme,
  type ThemeName,
} from "./theme.js";

/** Rainbow tick interval (ms). 150ms ≈ 6.7 Hz — slow wave, low CPU. */
const RAINBOW_TICK_MS = 150;

/**
 * Module-level event source for the rainbow tick. Lives outside React so
 * that subscribers can opt in piecemeal without forcing the whole tree
 * to re-render through context. Only the {@link ThemeProvider} starts
 * and stops the timer; everyone else just subscribes.
 */
class TickEmitter {
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;
  /** Reference count — the timer runs while at least one provider asks. */
  private starters = 0;

  start(): void {
    this.starters += 1;
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick = (this.tick + 1) % 1_000_000;
      for (const l of this.listeners) l();
    }, RAINBOW_TICK_MS);
  }

  stop(): void {
    this.starters = Math.max(0, this.starters - 1);
    if (this.starters > 0) return;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getTick(): number {
    return this.tick;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

const tickEmitter = new TickEmitter();

export type ThemeContextValue = {
  themeName: ThemeName;
  setThemeName: (name: ThemeName) => void;
  /** Current theme's palette. Stable across rainbow ticks. */
  palette: Palette;
  /** Box-drawing glyphs (do not change across themes). */
  box: typeof boxGlyphs;
  /** True iff the active theme animates over time. */
  animated: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export type ThemeProviderProps = {
  initial?: ThemeName;
  children: React.ReactNode;
};

export function ThemeProvider({ initial, children }: ThemeProviderProps) {
  const [themeName, setThemeName] = useState<ThemeName>(initial ?? DEFAULT_THEME);
  const theme: Theme = THEMES[themeName];

  // Start/stop the rainbow ticker based on the current theme. The
  // emitter is ref-counted so nested providers (only one in practice)
  // don't fight each other.
  useEffect(() => {
    if (!theme.animated) return;
    tickEmitter.start();
    return () => {
      tickEmitter.stop();
    };
  }, [theme.animated]);

  // The context value is memoised against themeName, so it changes only
  // when the user explicitly switches themes — not on every tick.
  const value = useMemo<ThemeContextValue>(
    () => ({
      themeName,
      setThemeName,
      palette: theme.palette,
      box: boxGlyphs,
      animated: theme.animated,
    }),
    [themeName, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Read the active theme. Throws when used outside a {@link ThemeProvider}. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme() must be used inside a <ThemeProvider>");
  }
  return ctx;
}

/**
 * Resolve the border colour for a pane.
 *
 * - When the active theme is static, returns `palette.primary` and never
 *   subscribes to anything — zero overhead.
 *
 * - When the active theme is animated (rainbow), subscribes the calling
 *   component to {@link tickEmitter}. On each tick the hook calls a local
 *   `forceUpdate` so only this caller re-renders. The colour is computed
 *   by {@link rainbowColor} with a phase offset, giving each pane its
 *   own hue lag (this is the "wave").
 */
export function useAnimatedBorder(phase = 0): string {
  const { animated, palette } = useTheme();
  const [, force] = useReducer((x: number) => (x + 1) % 1_000_000, 0);

  useEffect(() => {
    if (!animated) return;
    const unsub = tickEmitter.subscribe(() => force());
    return unsub;
  }, [animated]);

  if (!animated) return palette.primary;
  return rainbowColor(tickEmitter.getTick(), phase);
}
