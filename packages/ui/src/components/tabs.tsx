"use client";
import { m } from "motion/react";
import { useId, useRef, type ElementType, type ReactNode } from "react";
import { spring, useCalm } from "../motion";

export interface SegItem<V extends string> { value: V; label: ReactNode; testId?: string }

/** Segmented control with a sliding indicator (radio semantics). */
export function SegmentedControl<V extends string>({ items, value, onChange, label }: { items: SegItem<V>[]; value: V; onChange: (v: V) => void; label: string }) {
  const id = useId();
  const calm = useCalm();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="oi-seg" role="radiogroup" aria-label={label} ref={ref}>
      {items.map((it, i) => {
        const sel = it.value === value;
        return (
          <button key={it.value} type="button" role="radio" aria-checked={sel} tabIndex={sel ? 0 : -1} className="oi-seg__btn" data-testid={it.testId}
            onClick={() => onChange(it.value)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const n = items[(i + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length]!;
              onChange(n.value);
              ref.current?.querySelectorAll<HTMLButtonElement>("button")[items.indexOf(n)]?.focus();
            }}>
            {sel && <m.span layoutId={`seg-${id}`} className="oi-seg__ind" transition={calm ? { duration: 0 } : spring.ui} />}
            <span style={{ position: "relative" }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface TabItem<V extends string> { value: V; label: ReactNode; href?: string; testId?: string }

/** Underline tabs with sliding indicator. With href items it renders navigation links (aria-current). */
export function Tabs<V extends string>({ items, value, onChange, label, linkAs }: { items: TabItem<V>[]; value: V; onChange?: (v: V) => void; label: string; linkAs?: ElementType }) {
  const id = useId();
  const calm = useCalm();
  const isNav = items.some((i) => i.href);
  if (isNav) {
    const L: ElementType = linkAs ?? "a";
    return (
      <nav aria-label={label} className="oi-tabs">
        {items.map((it) => {
          const sel = it.value === value;
          return (
            <L key={it.value} href={it.href} className="oi-tabs__btn" aria-current={sel ? "page" : undefined} data-testid={it.testId}>
              {it.label}
              {sel && <m.span layoutId={`tab-${id}`} className="oi-tabs__ind" transition={calm ? { duration: 0 } : spring.ui} />}
            </L>
          );
        })}
      </nav>
    );
  }
  return (
    <div role="tablist" aria-label={label} className="oi-tabs">
      {items.map((it) => {
        const sel = it.value === value;
        return (
          <button key={it.value} type="button" role="tab" aria-selected={sel} className="oi-tabs__btn" onClick={() => onChange?.(it.value)} data-testid={it.testId}>
            {it.label}
            {sel && <m.span layoutId={`tab-${id}`} className="oi-tabs__ind" transition={calm ? { duration: 0 } : spring.ui} />}
          </button>
        );
      })}
    </div>
  );
}
