import type { UISettings } from "@nlc/shared";

/**
 * Apply UI preferences to the document root via data attributes. CSS keys off
 * `data-theme`, `data-fontsize`, `data-density`, `data-pipeline`,
 * `data-motion`, and `data-transitions`. "system" theme resolves against
 * prefers-color-scheme.
 *
 * `data-transitions` is the cross-view smoothing toggle and is forced to "off"
 * whenever motion is off — accessibility wins over fluff.
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
  const transitionsOn = !ui.reduceMotion && ui.smoothTransitions;
  root.setAttribute("data-transitions", transitionsOn ? "on" : "off");
}
