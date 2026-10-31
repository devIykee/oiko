"use client";
import { m } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { spring, useCalm } from "../motion";

/**
 * Press and hold for 1.2 s to confirm (ring fills linearly; release cancels).
 * Works with pointer, Space and Enter. The shackle springs shut on completion.
 */
export function HoldToConfirm({ label, doneLabel, onConfirm, disabled, durationMs = 1200, icon = "lock", testId }: {
  label: string; doneLabel: string; onConfirm: () => void; disabled?: boolean; durationMs?: number; icon?: "lock" | "check"; testId?: string;
}) {
  const [p, setP] = useState(0);
  const [done, setDone] = useState(false);
  const raf = useRef<number | null>(null);
  const start = useRef(0);
  const calm = useCalm();
  const R = 18;
  const C = 2 * Math.PI * R;

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (!done) setP(0);
  };
  const begin = () => {
    if (disabled || done || raf.current) return;
    start.current = performance.now();
    const tick = (now: number) => {
      const v = Math.min(1, (now - start.current) / durationMs);
      setP(v);
      if (v >= 1) {
        raf.current = null;
        setDone(true);
        if (navigator.vibrate) navigator.vibrate(20);
        onConfirm();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  return (
    <button
      type="button"
      className="oi-hold"
      data-done={done ? "true" : undefined}
      data-testid={testId}
      disabled={disabled}
      aria-label={done ? doneLabel : label}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); begin(); }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); begin(); } }}
      onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") stop(); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="oi-hold__ring" aria-hidden>
        <svg width="44" height="44" viewBox="0 0 44 44">
          <circle className="oi-hold__track" cx="22" cy="22" r={R} fill="none" strokeWidth="3" />
          <circle className="oi-hold__fill" cx="22" cy="22" r={R} fill="none" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - p)} />
        </svg>
        <m.span animate={done && !calm ? { scale: [1, 1.25, 1], y: [0, 2, 0] } : { scale: 1 }} transition={spring.ui} style={{ display: "grid" }}>
          <Icon name={done ? (icon === "lock" ? "lock" : "check") : icon === "lock" ? "unlock" : "check"} size={18} />
        </m.span>
      </span>
      <span aria-live="polite">{done ? doneLabel : label}</span>
    </button>
  );
}
