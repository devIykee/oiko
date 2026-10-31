"use client";
import type { ElementType, ReactNode } from "react";
import { Icon, type IconConcept } from "../icons";
import { cx } from "./primitives";

export interface NavItem { href: string; label: string; icon: IconConcept; match?: string[]; testId?: string }
const isActive = (path: string, it: NavItem) =>
  [it.href, ...(it.match ?? [])].some((h) => path === h || path.startsWith(h + "/"));

export function Sidebar({ items, pathname, brand, footer, linkAs, label }: { items: NavItem[]; pathname: string; brand: ReactNode; footer?: ReactNode; linkAs?: ElementType; label: string }) {
  const L: ElementType = linkAs ?? "a";
  return (
    <aside className="oi-sidebar oi-root">
      {brand}
      <nav aria-label={label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {items.map((it) => (
          <L key={it.href} href={it.href} className="oi-navlink" aria-current={isActive(pathname, it) ? "page" : undefined} data-testid={it.testId}>
            <Icon name={it.icon} size={20} />
            {it.label}
          </L>
        ))}
      </nav>
      {footer && <div className="oi-sidebar__foot">{footer}</div>}
    </aside>
  );
}

export function BottomTabBar({ items, pathname, linkAs, label }: { items: NavItem[]; pathname: string; linkAs?: ElementType; label: string }) {
  const L: ElementType = linkAs ?? "a";
  return (
    <nav className="oi-tabbar oi-root" aria-label={label}>
      {items.map((it) => (
        <L key={it.href} href={it.href} className="oi-tab" aria-current={isActive(pathname, it) ? "page" : undefined} data-testid={it.testId}>
          <Icon name={it.icon} size={24} />
          <span>{it.label}</span>
        </L>
      ))}
    </nav>
  );
}

/* ---------------- NetworkModeBadge (shows "Test mode" outside production) ---------------- */
export function NetworkModeBadge({ mode, labels, className }: { mode: "local" | "testnet" | "mainnet" | string; labels: { local: string; testnet: string }; className?: string }) {
  if (mode === "mainnet") return null;
  return (
    <span className={cx("oi-badge oi-badge--warning", className)} data-testid="mode-badge">
      <Icon name="warning" size={12} />
      {mode === "local" ? labels.local : labels.testnet}
    </span>
  );
}
