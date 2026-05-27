import type { UISettings } from "@coding-agent/shared";

/**
 * Apply theme + font size to the document root via data attributes that CSS
 * keys off of. "system" theme resolves against the OS color-scheme preference.
 */
export function applyAppearance(ui: UISettings): void {
  const root = document.documentElement;
  const theme =
    ui.theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : ui.theme;
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-fontsize", ui.fontSize);
}
