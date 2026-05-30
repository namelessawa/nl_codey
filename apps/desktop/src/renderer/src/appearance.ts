import type { UISettings } from "@coding-agent/shared";

/**
 * Apply UI preferences to the document root via data attributes. CSS keys off
 * `data-theme`, `data-fontsize`, `data-density`, `data-pipeline`, and
 * `data-motion`. "system" theme resolves against prefers-color-scheme.
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
  root.setAttribute("data-density", ui.density);
  root.setAttribute("data-pipeline", ui.showPipeline ? "on" : "off");
  root.setAttribute("data-motion", ui.reduceMotion ? "off" : "on");
}
