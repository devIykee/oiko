"use client";
import QRCode from "qrcode";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "../icons";
import { Avatar, Skeleton } from "./primitives";

/* ---------------- StatusTimeline ---------------- */
export interface TimelineStep { key: string; title: ReactNode; sub?: ReactNode }
export function StatusTimeline({ steps, current, error, label, liveText, testId }: {
  steps: TimelineStep[];
  /** index of the active step; steps before it are done. steps.length = all done. */
  current: number;
  error?: boolean;
  label: string;
  /** Text announced politely when the step changes. */
  liveText?: string;
  testId?: string;
}) {
  return (
    <div data-testid={testId}>
      <ol className="oi-timeline" aria-label={label}>
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === current ? (error ? "error" : "active") : "todo";
          return (
            <li key={s.key} className="oi-tl-step" data-state={state} data-testid={testId ? `${testId}-${s.key}` : undefined} aria-current={state === "active" ? "step" : undefined}>
              <span className="oi-tl-dot">
                {state === "done" ? <Icon name="check" size={14} /> : state === "error" ? <Icon name="close" size={14} /> : state === "active" ? <span className="oi-tl-pulse" /> : null}
              </span>
              <div>
                <div className="oi-tl-title">{s.title}</div>
                {s.sub && state !== "todo" && <div className="oi-tl-sub">{s.sub}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="oi-sr" aria-live="polite" role="status">{liveText}</p>
    </div>
  );
}

/* ---------------- CircleTimeline (ajo rotation order) ---------------- */
export interface CircleSlot { name: string; round: number; state: "paid" | "current" | "upcoming" | "default"; caption?: ReactNode }
export function CircleTimeline({ slots, label }: { slots: CircleSlot[]; label: string }) {
  return (
    <ol className="oi-ctl" aria-label={label} style={{ listStyle: "none", margin: 0 }}>
      {slots.map((s) => (
        <li key={`${s.round}-${s.name}`} className="oi-ctl__item" data-state={s.state}>
          <Avatar name={s.name} size={40} color={s.state === "paid" ? "mint" : s.state === "current" ? "blue" : s.state === "default" ? "rose" : "stone"} />
          <span className="oi-ctl__name">{s.name}</span>
          <span className="oi-ctl__round">{s.caption}</span>
        </li>
      ))}
    </ol>
  );
}

/* ---------------- QRCodeCard ---------------- */
export function QRCode_({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#16181d", light: "#ffffff" } })
      .then((s) => { if (alive) setSvg(s); })
      .catch(() => setSvg(null));
    return () => { alive = false; };
  }, [value]);
  return (
    <div className="oi-qr" style={{ width: size }} role="img" aria-label={label}>
      {svg ? <span style={{ display: "block", width: "100%" }} dangerouslySetInnerHTML={{ __html: svg }} /> : <Skeleton width="100%" height={size - 24} />}
    </div>
  );
}
export { QRCode_ as QRCodeImage };

export function QRCodeCard({ value, label, caption, size = 220, children }: { value: string; label: string; caption?: ReactNode; size?: number; children?: ReactNode }) {
  return (
    <div className="oi-qrcard">
      <QRCode_ value={value} size={size} label={label} />
      {caption && <div className="oi-small oi-muted" style={{ maxWidth: 300 }}>{caption}</div>}
      {children}
    </div>
  );
}
