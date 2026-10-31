"use client";
import { Children, type ElementType, type ReactNode } from "react";
import { Icon, type IconConcept, type TileColor } from "../icons";
import { Tile, cx } from "./primitives";

/* ---------------- GroupedList ---------------- */
export function GroupedList({ children, label, className, ...rest }: { children: ReactNode; label?: string; className?: string } & React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className={cx("oi-list", className)} aria-label={label} {...rest}>
      {Children.toArray(children).filter(Boolean).map((c, i) => <li key={i}>{c}</li>)}
    </ul>
  );
}

/* ---------------- ListRow ---------------- */
export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: IconConcept;
  color?: TileColor;
  leading?: ReactNode;
  amount?: ReactNode;
  amountTone?: "in" | "default";
  meta?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  href?: string;
  onClick?: () => void;
  as?: ElementType;
  selected?: boolean;
  flash?: boolean;
  className?: string;
  role?: string;
  "aria-checked"?: boolean;
  "data-testid"?: string;
}
export function ListRow({ title, subtitle, icon, color = "blue", leading, amount, amountTone, meta, trailing, chevron, href, onClick, as, selected, flash, className, ...rest }: ListRowProps) {
  const interactive = Boolean(href || onClick);
  const C: ElementType = href ? as ?? "a" : onClick ? "button" : "div";
  return (
    <C
      href={href}
      onClick={onClick}
      type={C === "button" ? "button" : undefined}
      className={cx("oi-lr", interactive && "oi-lr--interactive", flash && "oi-flash", className)}
      data-selected={selected ? "true" : undefined}
      {...rest}
    >
      {leading ?? (icon && <Tile icon={icon} color={color} />)}
      <span className="oi-lr__body">
        <span className="oi-lr__title" style={{ display: "block" }}>{title}</span>
        {subtitle && <span className="oi-lr__sub" style={{ display: "block" }}>{subtitle}</span>}
      </span>
      {(amount || meta) && (
        <span className="oi-lr__end">
          {amount && <span className={cx("oi-lr__amount", amountTone === "in" && "oi-lr__amount--in")}>{amount}</span>}
          {meta && <span className="oi-lr__sub">{meta}</span>}
        </span>
      )}
      {trailing}
      {chevron && <span className="oi-lr__chev"><Icon name="chevronRight" size={14} /></span>}
    </C>
  );
}

/* ---------------- SelectList (select-as-list, radio semantics) ---------------- */
export interface SelectOption<V extends string | number> {
  value: V;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: IconConcept;
  color?: TileColor;
  leading?: ReactNode;
  meta?: ReactNode;
  disabled?: boolean;
  testId?: string;
}
export function SelectList<V extends string | number>({ options, value, onChange, label }: { options: SelectOption<V>[]; value: V | null | undefined; onChange: (v: V) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="oi-list" style={{ padding: "4px 0" }}>
      {options.map((o, i) => {
        const sel = o.value === value;
        return (
          <div key={String(o.value)} style={{ position: "relative" }}>
            {i > 0 && <span aria-hidden style={{ position: "absolute", top: 0, left: 64, right: 16, borderTop: "var(--hairline) solid var(--line)" }} />}
            <button
              type="button"
              role="radio"
              aria-checked={sel}
              disabled={o.disabled}
              data-selected={sel ? "true" : undefined}
              data-testid={o.testId}
              className="oi-lr oi-lr--interactive"
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                e.preventDefault();
                const next = options[(i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length];
                if (next) {
                  onChange(next.value);
                  const btns = (e.currentTarget.closest("[role=radiogroup]") as HTMLElement | null)?.querySelectorAll<HTMLButtonElement>("[role=radio]");
                  btns?.[options.indexOf(next)]?.focus();
                }
              }}
              tabIndex={sel || (value == null && i === 0) ? 0 : -1}
            >
              {o.leading ?? (o.icon && <Tile icon={o.icon} color={o.color ?? "stone"} />)}
              <span className="oi-lr__body">
                <span className="oi-lr__title" style={{ display: "block" }}>{o.title}</span>
                {o.subtitle && <span className="oi-lr__sub" style={{ display: "block" }}>{o.subtitle}</span>}
              </span>
              {o.meta && <span className="oi-lr__end"><span className="oi-lr__sub">{o.meta}</span></span>}
              <span className="oi-radio-mark">{sel && <Icon name="check" size={12} />}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- ActivityRow ---------------- */
export function ActivityRow({ title, subtitle, amount, direction, icon, color, by, href, flash, testId }: {
  title: ReactNode; subtitle?: ReactNode; amount?: string; direction?: "in" | "out" | "internal"; icon: IconConcept; color?: TileColor;
  by?: ReactNode; href?: string; flash?: boolean; testId?: string;
}) {
  return (
    <ListRow
      icon={icon}
      color={color ?? (direction === "in" ? "mint" : direction === "out" ? "stone" : "blue")}
      title={title}
      subtitle={subtitle}
      amount={amount ? `${direction === "in" ? "+" : direction === "out" ? "−" : ""}${amount}` : undefined}
      amountTone={direction === "in" ? "in" : "default"}
      meta={by}
      href={href}
      flash={flash}
      data-testid={testId}
    />
  );
}
