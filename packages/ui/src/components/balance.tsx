"use client";
import type { ReactNode } from "react";

/** Per-digit odometer: each digit rolls 320ms (transform only). Non-digits are static. */
export function Odometer({ value, className }: { value: string; className?: string }) {
  const chars = value.split("");
  return (
    <span className={className} aria-hidden style={{ display: "inline-flex" }}>
      {chars.map((ch, i) => {
        const key = chars.length - i; // key from the right so columns stay put as length changes
        if (!/\d/.test(ch)) return <span key={`s${key}`} className="oi-odo__sep">{ch}</span>;
        const d = Number(ch);
        return (
          <span key={`d${key}`} className="oi-odo__digit">
            <span className="oi-odo__col" style={{ transform: `translateY(${-d * 1.1}em)`, transition: "transform var(--dur-slow) var(--ease-out)" }}>
              {"0123456789".split("").map((n) => <span key={n}>{n}</span>)}
            </span>
          </span>
        );
      })}
    </span>
  );
}

export interface BalanceHeaderProps {
  /** Formatted amount, e.g. "1,240.50". */
  value: string;
  label: ReactNode;
  sub?: ReactNode;
  breakdown?: ReactNode;
  hidden?: boolean;
  hiddenText?: string;
  testId?: string;
}
/** One huge centred balance with small label above; decimals at 60% size in --ink-3. */
export function BalanceHeader({ value, label, sub, breakdown, hidden, hiddenText = "••••", testId }: BalanceHeaderProps) {
  const [int, dec] = value.split(".");
  return (
    <section className="oi-balance" aria-label={typeof label === "string" ? label : undefined}>
      <div className="oi-balance__label">{label}</div>
      <div className="oi-balance__value" data-testid={testId}>
        <span className="oi-sr">{hidden ? hiddenText : value}</span>
        {hidden ? (
          <span aria-hidden>{hiddenText}</span>
        ) : (
          <>
            <Odometer value={int ?? "0"} className="oi-odo" />
            {dec !== undefined && (
              <span className="oi-balance__dec" aria-hidden style={{ display: "inline-flex" }}>
                .<Odometer value={dec} className="oi-odo" />
              </span>
            )}
          </>
        )}
      </div>
      {sub && <div className="oi-balance__sub">{sub}</div>}
      {breakdown && <div className="oi-breakdown">{breakdown}</div>}
    </section>
  );
}
