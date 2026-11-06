"use client";
import { forwardRef, useEffect, useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon } from "../icons";
import { cx } from "./primitives";

/* ---------------- Input ---------------- */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  success?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  hideLabel?: boolean;
  multiline?: boolean;
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, success, prefix, suffix, hideLabel, id, className, ...rest }, ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = `${fid}-hint`;
  return (
    <div className={cx("oi-field", className)}>
      <label htmlFor={fid} className={hideLabel ? "oi-sr" : "oi-label"}>{label}</label>
      <div className="oi-input-wrap" data-invalid={error ? "true" : undefined}>
        {prefix && <span className="oi-input-affix">{prefix}</span>}
        <input ref={ref} id={fid} className="oi-input" aria-invalid={error ? true : undefined}
          aria-describedby={hint || error || success ? hintId : undefined} {...rest} />
        {suffix && <span className="oi-input-affix">{suffix}</span>}
      </div>
      <div id={hintId} aria-live="polite">
        {error ? <div className="oi-error-text">{error}</div> : success ? <div className="oi-success-text">{success}</div> : hint ? <div className="oi-hint">{hint}</div> : null}
      </div>
    </div>
  );
});

/* ---------------- AmountInput ---------------- */
export function sanitizeAmount(raw: string, decimals = 6): string {
  let s = raw.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const i = s.indexOf(".");
  if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "").slice(0, decimals);
  if (/^0[0-9]/.test(s)) s = s.replace(/^0+(?=\d)/, "");
  if (s.startsWith(".")) s = "0" + s;
  return s.slice(0, 15);
}

export interface AmountInputProps {
  value: string;
  onChange: (v: string) => void;
  ticker: string;
  label: string;
  sub?: ReactNode;
  error?: ReactNode;
  /** Quick-fill chips, e.g. [{label: "Max", value: "120.5"}]. */
  chips?: Array<{ label: string; value: string }>;
  keypad?: "auto" | "always" | "never";
  autoFocus?: boolean;
  deleteLabel?: string;
  testId?: string;
}
export function AmountInput({ value, onChange, ticker, label, sub, error, chips, keypad = "auto", autoFocus, deleteLabel = "Delete", testId }: AmountInputProps) {
  const id = useId();
  const [coarse, setCoarse] = useState(false);
  useEffect(() => { setCoarse(window.matchMedia("(pointer: coarse)").matches); }, []);
  const showPad = keypad === "always" || (keypad === "auto" && coarse);
  const press = (k: string) => {
    if (k === "del") onChange(value.slice(0, -1));
    else onChange(sanitizeAmount(value + k));
  };
  const width = Math.max(1, (value || "0").length) + "ch";
  return (
    <div className="oi-amount-input">
      <label htmlFor={id} className="oi-sr">{label}</label>
      <div className="oi-amount-display">
        <input
          id={id}
          data-testid={testId}
          value={value}
          placeholder="0"
          inputMode={showPad ? "none" : "decimal"}
          autoComplete="off"
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-sub`}
          onChange={(e) => onChange(sanitizeAmount(e.target.value))}
          style={{ width: `calc(${width} + 4px)` }}
        />
        <span className="oi-amount-ticker">{ticker}</span>
      </div>
      <div id={`${id}-sub`} className="oi-amount-sub" aria-live="polite">
        {error ? <span className="oi-error-text" style={{ fontSize: 14 }}>{error}</span> : sub}
      </div>
      {chips && chips.length > 0 && (
        <div className="oi-chips" style={{ marginTop: 6 }}>
          {chips.map((c) => (
            <button key={c.label} type="button" className="oi-chip" aria-pressed={value === c.value} onClick={() => onChange(c.value)}>{c.label}</button>
          ))}
        </div>
      )}
      {showPad && (
        <div className="oi-keypad" role="group" aria-label={label}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"].map((k) => (
            <button key={k} type="button" className="oi-key" onClick={() => press(k)} aria-label={k === "." ? "decimal point" : k}>{k}</button>
          ))}
          <button type="button" className="oi-key" onClick={() => press("del")} aria-label={deleteLabel}>
            <Icon name="keypadDelete" size={24} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- CopyField ---------------- */
export function CopyField({ label, value, display, mono = true, copyLabel = "Copy", copiedLabel = "Copied", onCopied, testId }: {
  label: string; value: string; display?: ReactNode; mono?: boolean; copyLabel?: string; copiedLabel?: string; onCopied?: () => void; testId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no async clipboard");
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback (insecure origins, older WebViews, iOS): an off-screen read-only textarea + execCommand.
      const ta = document.createElement("textarea");
      ta.value = value; ta.readOnly = true;
      Object.assign(ta.style, { position: "fixed", top: "0", left: "-9999px", opacity: "0" });
      document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, value.length);
      try { document.execCommand("copy"); } finally { ta.remove(); }
    }
    setCopied(true);
    onCopied?.();
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="oi-copy" data-testid={testId}>
      <div className="oi-copy__body">
        <div className="oi-copy__label">{label}</div>
        <div className={mono ? "oi-copy__value" : "oi-copy__value oi-copy__value--text"}>{display ?? value}</div>
      </div>
      <button type="button" className="oi-btn oi-btn--sm oi-btn--secondary" onClick={copy} aria-label={`${copyLabel}: ${label}`} style={{ background: "var(--surface)" }}>
        <Icon name={copied ? "check" : "copy"} size={15} />
        <span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
      </button>
    </div>
  );
}
