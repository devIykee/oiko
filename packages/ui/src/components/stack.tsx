"use client";
// Wallet-style stacked cards (Home pots). Each column is a stack: cards overlap so every card's header strip
// (icon, name, balance) shows, and the front card (bottom) is fully visible. Tap the stack, or tab into it, to fan
// it out; tap a card to open it. Wide containers get up to 3 columns (extra cards stack behind); narrow ones get
// one stack. Every card is a real link in reading order, so keyboard and screen readers see a plain list of pots.
import { m } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { Icon, type IconConcept, type TileColor } from "../icons";
import { spring, useCalm } from "../motion";
import { ProgressBar, cx } from "./primitives";

export interface StackItem {
  id: string | number;
  href: string;
  name: string;
  icon: IconConcept;
  color: TileColor;
  amount: string;
  ticker?: string;
  badge?: ReactNode;
  meta?: ReactNode;
  progress?: { value: number; max: number; label: string };
  testId?: string;
}

const CARD_H = 124; // full card
const STRIP = 58; // visible header of a card behind
const GAP = 10; // between fanned-out cards
const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

function columnsFor(width: number, n: number) {
  const max = width >= 600 ? 3 : 1;
  return Math.max(1, Math.min(max, n));
}

export function WalletStack({ items, linkAs, label, expandLabel, collapseLabel, testId }: {
  items: StackItem[]; linkAs?: ElementType; label: string; expandLabel: string; collapseLabel: string; testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);
  const [open, setOpen] = useState(false);
  const calm = useCalm();
  const L: ElementType = linkAs ?? "a";

  useIso(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setCols(columnsFor(el.clientWidth, items.length));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);

  // Column c holds items c, c+cols, c+2cols...; its first item is the front card (drawn last, fully visible).
  const columns: StackItem[][] = Array.from({ length: cols }, (_, c) => items.filter((_, i) => i % cols === c));
  const deepest = Math.max(...columns.map((c) => c.length));
  const stacked = deepest > 1;
  const heightFor = (n: number) => (open ? n * CARD_H + (n - 1) * GAP : (n - 1) * STRIP + CARD_H);
  const transition = calm ? { duration: 0 } : spring.sheet;

  // Collapse when focus leaves the whole stack.
  const onBlur = (e: React.FocusEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); };

  return (
    <div className="oi-wstack-wrap" data-testid={testId}>
      <div ref={ref} className="oi-wstack" role="list" aria-label={label} onBlur={onBlur}
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {columns.map((col, c) => {
          // Visual order top -> bottom: behind cards first, front card last.
          const visual = [...col.slice(1), col[0]!];
          return (
            <m.div key={c} className="oi-wstack__col" initial={false} animate={{ height: heightFor(col.length) }} transition={transition}>
              {col.map((it) => {
                const v = visual.indexOf(it);
                const front = v === col.length - 1;
                const y = open ? v * (CARD_H + GAP) : v * STRIP;
                return (
                  <m.div key={it.id} role="listitem" className="oi-wstack__slot" style={{ zIndex: v + 1 }}
                    initial={false} animate={{ y }} transition={transition}>
                    <L href={it.href} data-testid={it.testId} data-tile={it.color}
                      className={cx("oi-wcard", !front && !open && "oi-wcard--behind")}
                      aria-label={`${it.name}, ${it.amount}${it.ticker ? ` ${it.ticker}` : ""}`}
                      onClick={(e: React.MouseEvent) => { if (stacked && !open && !front) { e.preventDefault(); setOpen(true); } }}
                      onFocus={(e: React.FocusEvent<HTMLElement>) => { if (stacked && !open && !front && e.target.matches(":focus-visible")) setOpen(true); }}>
                      <span className="oi-wcard__head">
                        <span className="oi-wcard__icon"><Icon name={it.icon} size={18} /></span>
                        <span className="oi-wcard__name">{it.name}</span>
                        <span className="oi-wcard__amtwrap">
                          <span className="oi-wcard__amt">{it.amount}</span>
                          {it.ticker && <span className="oi-wcard__ticker">{it.ticker}</span>}
                        </span>
                      </span>
                      <span className="oi-wcard__body">
                        {it.progress && <ProgressBar thin value={it.progress.value} max={it.progress.max} label={it.progress.label} tone="accent" />}
                        <span className="oi-wcard__row">
                          <span className="oi-wcard__meta">{it.meta}</span>
                          {it.badge}
                        </span>
                      </span>
                    </L>
                  </m.div>
                );
              })}
            </m.div>
          );
        })}
      </div>
      {stacked && (
        <button type="button" className="oi-wstack__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? "chevronUp" : "chevronDown"} size={14} />
          {open ? collapseLabel : expandLabel}
        </button>
      )}
    </div>
  );
}
