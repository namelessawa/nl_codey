import type { ReactNode } from "react";

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
};

/** Label + optional help text + optional validation error around a control. */
export function Field({ label, hint, error, htmlFor, children }: FieldProps): JSX.Element {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error ? <div className="field-hint">{hint}</div> : null}
      {error ? <div className="field-error">{error}</div> : null}
    </div>
  );
}

type ToggleProps = {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

/** Checkbox-backed switch row. */
export function Toggle({ id, label, checked, onChange }: ToggleProps): JSX.Element {
  return (
    <label className="toggle" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
