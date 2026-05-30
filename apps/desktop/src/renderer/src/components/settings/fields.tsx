import type { ReactNode } from "react";

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
};

/** Label (with optional inline hint) + control + optional error. */
export function Field({ label, hint, error, htmlFor, children }: FieldProps): JSX.Element {
  return (
    <div className="fld">
      <label className="fld-label" htmlFor={htmlFor}>
        <span>{label}</span>
        {hint ? <span className="fld-hint">{hint}</span> : null}
      </label>
      <div className="fld-control">
        {children}
        {error ? <div className="fld-err">{error}</div> : null}
      </div>
    </div>
  );
}

type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
};

type SegmentedProps<T extends string> = {
  value: T;
  onChange: (next: T) => void;
  options: SegmentedOption<T>[];
};

/** Segmented radio-group. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: SegmentedProps<T>): JSX.Element {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`seg-item${value === o.value ? " active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.icon ? <span className="seg-icon">{o.icon}</span> : null}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

type NumInputProps = {
  id?: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
};

/** Number input with optional unit suffix on the right. */
export function NumInput({
  id,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: NumInputProps): JSX.Element {
  return (
    <div className="num-input">
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {suffix ? <span className="num-suffix">{suffix}</span> : null}
    </div>
  );
}

type ToggleRowProps = {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
};

/** Notebook-style toggle row: label + hint on the left, switch on the right. */
export function ToggleRow({
  id,
  checked,
  onChange,
  label,
  hint,
}: ToggleRowProps): JSX.Element {
  return (
    <label htmlFor={id} className="toggle-row">
      <span className="toggle-text">
        <span className="toggle-label-text">{label}</span>
        {hint ? <span className="toggle-hint">{hint}</span> : null}
      </span>
      <span className={`tgl${checked ? " on" : ""}`} role="switch" aria-checked={checked}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="tgl-track"><span className="tgl-thumb" /></span>
      </span>
    </label>
  );
}
