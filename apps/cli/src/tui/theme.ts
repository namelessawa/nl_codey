/**
 * NL_Codey TUI theme registry — multiple presets + a `rainbow` mode whose
 * borders cycle hue in a phase-offset wave.
 *
 * Static themes export a fixed {@link Theme} object. The `rainbow` theme
 * does not have a fixed border colour; consumers must use
 * `borderColor(phase)` from {@link ./theme-context.ts} which routes
 * through {@link rainbowColor} when the active theme is rainbow.
 *
 * The original `palette` and `box` named exports are preserved so older
 * components compile during migration; they always reflect the default
 * (teal) theme and are NOT the source of truth at runtime — components
 * should switch to the `useTheme()` hook for reactive behaviour.
 */

export type ThemeName = "teal" | "ocean" | "sunset" | "forest" | "mono" | "rainbow";

/** Colour bundle used by every component. */
export type Palette = {
  /** Primary brand / default border colour. */
  primary: string;
  /** Active/hover accent of the primary colour. */
  primaryActive: string;
  /** Secondary accent (used sparingly). */
  accent: string;
  /** Body text. */
  text: string;
  /** Muted/secondary text. */
  textDim: string;
  /** Tinted backdrop hint (Ink can't paint a real bg). */
  bgHint: string;
  /** Errors / refused / failed. */
  danger: string;
  /** Verifier OK / commits / approvals. */
  success: string;
  /** Warning. */
  warn: string;
};

export type Theme = {
  name: ThemeName;
  palette: Palette;
  /** Short tagline shown by `/theme list`. */
  label: string;
  /** True for themes whose borders animate over time (rainbow). */
  animated: boolean;
};

/** Built-in preset registry. */
export const THEMES: Record<ThemeName, Theme> = {
  teal: {
    name: "teal",
    label: "deep teal + soft magenta — the canonical NL_Codey look.",
    animated: false,
    palette: {
      primary: "#007a73",
      primaryActive: "#26a39c",
      accent: "#c25fbe",
      text: "#e8e6e3",
      textDim: "#7d8a89",
      bgHint: "#0d2624",
      danger: "#d24a4a",
      success: "#39b37a",
      warn: "#bfa84a",
    },
  },
  ocean: {
    name: "ocean",
    label: "deep blue with golden accents.",
    animated: false,
    palette: {
      primary: "#1e6091",
      primaryActive: "#3a8ec0",
      accent: "#f6b53d",
      text: "#e6ebf2",
      textDim: "#7e8a99",
      bgHint: "#0a1827",
      danger: "#e0656b",
      success: "#4cb083",
      warn: "#d6a854",
    },
  },
  sunset: {
    name: "sunset",
    label: "warm coral + dusky violet (the only theme that touches orange).",
    animated: false,
    palette: {
      primary: "#c1462f",
      primaryActive: "#e07a45",
      accent: "#5e4a8a",
      text: "#f2e8e2",
      textDim: "#8c7c75",
      bgHint: "#2a120a",
      danger: "#d24a4a",
      success: "#7aa86c",
      warn: "#dbb455",
    },
  },
  forest: {
    name: "forest",
    label: "deep green + amber, low-saturation woodland.",
    animated: false,
    palette: {
      primary: "#2e6f40",
      primaryActive: "#5fa775",
      accent: "#bf8b3d",
      text: "#ebe9df",
      textDim: "#7e857a",
      bgHint: "#13211a",
      danger: "#c8584a",
      success: "#6ea850",
      warn: "#d6a648",
    },
  },
  mono: {
    name: "mono",
    label: "monochrome — for screenshots and low-colour terminals.",
    animated: false,
    palette: {
      primary: "#a0a0a0",
      primaryActive: "#e0e0e0",
      accent: "#ffffff",
      text: "#dcdcdc",
      textDim: "#787878",
      bgHint: "#101010",
      danger: "#d24a4a",
      success: "#a0d68a",
      warn: "#dbc55b",
    },
  },
  rainbow: {
    name: "rainbow",
    label: "every border cycles hue in a slow phase-offset wave.",
    animated: true,
    // Non-border colours stay readable; only borders are animated.
    palette: {
      primary: "#9aa0a6",
      primaryActive: "#ffffff",
      accent: "#ffffff",
      text: "#f0eee8",
      textDim: "#7d8a89",
      bgHint: "#0d0d0d",
      danger: "#ff6b6b",
      success: "#6bdf8a",
      warn: "#f5d76a",
    },
  },
} as const;

/** Default theme. The `palette` named export is wired to this. */
export const DEFAULT_THEME: ThemeName = "teal";

/**
 * Compute one rainbow border colour for the given tick + phase.
 *
 * `tick` advances at the cadence chosen by the provider (~6-12 Hz).
 * `phase` is a small integer (0..n) so that several borders can be
 * placed along the hue wheel a few degrees apart — that's what makes
 * the wave look like a wave instead of every border flashing the same
 * colour at the same time.
 */
export function rainbowColor(tick: number, phase = 0): string {
  // 3 hue degrees per tick → full cycle in 120 ticks. With 150ms tick,
  // one cycle is ~18s, which feels "slow" rather than "epileptic".
  const hue = ((tick * 3 + phase * 24) % 360 + 360) % 360;
  return hslToHex(hue, 65, 55);
}

/** Convert HSL (0-360, 0-100, 0-100) to a `#rrggbb` string. */
export function hslToHex(h: number, s: number, l: number): string {
  const _h = h / 360;
  const _s = s / 100;
  const _l = l / 100;
  let r: number;
  let g: number;
  let b: number;
  if (_s === 0) {
    r = g = b = _l;
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      let _t = t;
      if (_t < 0) _t += 1;
      if (_t > 1) _t -= 1;
      if (_t < 1 / 6) return p + (q - p) * 6 * _t;
      if (_t < 1 / 2) return q;
      if (_t < 2 / 3) return p + (q - p) * (2 / 3 - _t) * 6;
      return p;
    };
    const q = _l < 0.5 ? _l * (1 + _s) : _l + _s - _l * _s;
    const p = 2 * _l - q;
    r = hue2rgb(p, q, _h + 1 / 3);
    g = hue2rgb(p, q, _h);
    b = hue2rgb(p, q, _h - 1 / 3);
  }
  const toHex = (n: number): string =>
    Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Legacy named export — kept so untouched code keeps compiling. */
export const palette: Palette = THEMES[DEFAULT_THEME].palette;

/**
 * Role colours, used by the `[role]` prefix renderer. Keyed off the
 * default theme; components should derive from `useTheme()` instead
 * once they migrate.
 */
export function roleColorMap(p: Palette): Record<RoleKey, string> {
  return {
    user: p.text,
    agent: p.primaryActive,
    tool: p.accent,
    verify: p.success,
    error: p.danger,
    system: p.textDim,
  };
}

export const roleColor: Record<RoleKey, string> = roleColorMap(palette);

export type RoleKey = "user" | "agent" | "tool" | "verify" | "error" | "system";

/**
 * Box-drawing characters. Same as before — themes do not change these.
 * Single-line is now the canonical NL_Codey style (top+bottom rails for
 * most panes, left+right rails for the trace panel).
 */
export const box = {
  singleH: "─",
  singleV: "│",
  doubleH: "═",
  doubleV: "║",
  logoMark: "◆◇◆",
} as const;

/**
 * One-line logo lockup. Used in the header.
 */
export function logo(): string {
  return `[ ${box.logoMark} NL_Codey ]`;
}
