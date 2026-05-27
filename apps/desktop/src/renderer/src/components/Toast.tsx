import { useEffect } from "react";

export type ToastKind = "success" | "error";
export type ToastMessage = { kind: ToastKind; text: string };

type ToastProps = {
  toast: ToastMessage | null;
  onDismiss: () => void;
  durationMs?: number;
};

/** Transient bottom-right notification. Auto-dismisses after `durationMs`. */
export function Toast({ toast, onDismiss, durationMs = 3000 }: ToastProps): JSX.Element | null {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [toast, durationMs, onDismiss]);

  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.kind}`} role="status" aria-live="polite">
      {toast.text}
    </div>
  );
}
