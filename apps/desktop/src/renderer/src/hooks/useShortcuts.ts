import { useEffect, useRef } from "react";
import type { ShortcutBindings } from "@coding-agent/shared";

/**
 * Map of action id → handler. Any undefined handler means "currently disabled"
 * (e.g. reject-patch only applies while the run is waiting). The hook skips
 * dispatch if the matching handler is missing.
 */
export type ShortcutHandlers = Partial<{
  "new-run": () => void;
  "open-workspace": () => void;
  "send-message": () => void;
  "stop-run": () => void;
  "approve-patch": () => void;
  "reject-patch": () => void;
  "open-diff": () => void;
  rollback: () => void;
  "quick-prefs": () => void;
  "open-settings": () => void;
  "search-history": () => void;
  palette: () => void;
  "recall-last": () => void;
  "next-thread": () => void;
  "prev-thread": () => void;
}>;

function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  const k = e.key;
  if (k === "Control" || k === "Alt" || k === "Shift" || k === "Meta") return "";
  let key = k;
  if (k === " ") key = "Space";
  // ArrowUp/Down/Left/Right pass through verbatim; Enter/Backspace/Escape too.
  if (k.length === 1) key = k.toUpperCase();
  parts.push(key);
  return parts.join("+");
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT";
}

/**
 * Subscribe to global keydown and dispatch to the matching action handler
 * derived from the user's persisted bindings (settings.shortcuts).
 *
 * Conflict rule: if multiple actions share the same combo, the first one in
 * iteration order wins — same precedence the Settings UI warns about.
 *
 * Editable-target rule: while the user is typing in a textarea/input/select,
 * un-modified single-key shortcuts (e.g. ArrowUp, Esc) are suppressed so they
 * don't steal the keystroke. Combos with Ctrl/Alt/Meta/Shift always fire.
 *
 * defaultPrevented rule: if a React onKeyDown already consumed the event
 * (e.g. the composer's own Ctrl+Enter handler), this hook skips it to avoid
 * double-firing.
 */
export function useShortcuts(
  bindings: ShortcutBindings | null | undefined,
  handlers: ShortcutHandlers,
  enabled: boolean = true,
): void {
  // Keep latest handlers in a ref so we don't re-subscribe on every render.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled || !bindings) return;
    // Build reverse map: combo → first actionId that owns it.
    const reverse = new Map<string, string>();
    for (const [actionId, combo] of Object.entries(bindings)) {
      if (combo && !reverse.has(combo)) reverse.set(combo, actionId);
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      const actionId = reverse.get(combo);
      if (!actionId) return;
      const hasModifier = e.ctrlKey || e.altKey || e.metaKey;
      if (isEditableTarget(e.target) && !hasModifier) {
        // Don't intercept naked typing keys in inputs.
        return;
      }
      const handler = handlersRef.current[actionId as keyof ShortcutHandlers];
      if (!handler) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKey);
    return (): void => window.removeEventListener("keydown", onKey);
  }, [bindings, enabled]);
}
