"use client";
import type { CSSProperties, ElementType, ReactNode } from "react";
import { Icon, type IconConcept, type TileColor } from "../icons";
import { Avatar, Badge, Button, ProgressBar, Tile } from "./primitives";

/* ---------------- VaultCard (pot card) ---------------- */
export interface VaultCardProps {
  id: number | string;
  name: string;
  icon: IconConcept;
  color: TileColor;
  amount: string;
  ticker?: string;
  meta?: ReactNode;
  badge?: ReactNode;
  progress?: { value: number; max: number; label: string };
  href?: string;
  onClick?: () => void;
  as?: ElementType;
  testId?: string;
}
export function VaultCard({ id, name, icon, color, amount, ticker, meta, badge, progress, href, onClick, as, testId }: VaultCardProps) {
  const C: ElementType = href ? as ?? "a" : "button";
  return (
    <C href={href} onClick={onClick} type={href ? undefined : "button"} className="oi-potcard" data-testid={testId}>
      <div className="oi-potcard__top">
        <span style={{ viewTransitionName: `pot-tile-${id}` } as CSSProperties}><Tile icon={icon} color={color} /></span>
        {badge}
      </div>
      <div className="oi-potcard__name">{name}</div>
      <div className="oi-potcard__bal">{amount}{ticker && <small>{ticker}</small>}</div>
      {progress && <ProgressBar thin value={progress.value} max={progress.max} label={progress.label} tone="accent" />}
      <div className="oi-potcard__meta">{meta}</div>
    </C>
  );
}

/* ---------------- ProposalCard ---------------- */
export function ProposalCard({ agentName, sentence, reason, onApprove, onReject, approveLabel, rejectLabel, busy, agentLabel, testId }: {
  agentName: string; sentence: ReactNode; reason: string; onApprove: () => void; onReject: () => void;
  approveLabel: string; rejectLabel: string; busy?: "approve" | "reject" | null; agentLabel?: ReactNode; testId?: string;
}) {
  return (
    <article className="oi-proposal" data-testid={testId}>
      <div className="oi-row">
        <Tile icon="agents" color="violet" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{agentName}</div>
          {agentLabel && <div className="oi-small oi-muted">{agentLabel}</div>}
        </div>
        <span className="oi-tile" data-tile="sun" style={{ width: 28, height: 28 }}><Icon name="proposal" size={14} /></span>
      </div>
      <p style={{ margin: 0, fontWeight: 500 }} className="oi-pretty">{sentence}</p>
      {reason && <blockquote className="oi-proposal__reason">“{reason}”</blockquote>}
      <div className="oi-proposal__actions">
        <Button variant="secondary" onClick={onReject} loading={busy === "reject"} disabled={!!busy} data-testid={testId ? `${testId}-reject` : undefined}>{rejectLabel}</Button>
        <Button onClick={onApprove} loading={busy === "approve"} disabled={!!busy} data-testid={testId ? `${testId}-approve` : undefined}>{approveLabel}</Button>
      </div>
    </article>
  );
}

/* ---------------- ScopeList ---------------- */
export function ScopeList({ items, label }: { items: Array<{ allowed: boolean; text: ReactNode }>; label: string }) {
  return (
    <ul className="oi-scopes" aria-label={label}>
      {items.map((it, i) => (
        <li key={i}>
          <span className={it.allowed ? "oi-scopes__yes" : "oi-scopes__no"}>
            <Icon name={it.allowed ? "success" : "error"} size={17} />
          </span>
          <span className="oi-pretty">{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- AgentAccessLog ---------------- */
export function AgentAccessLog({ rows, label, empty }: { rows: Array<{ at: string; atLabel: string; text: ReactNode; detail?: string }>; label: string; empty: ReactNode }) {
  if (!rows.length) return <p className="oi-small oi-muted" style={{ margin: 0 }}>{empty}</p>;
  return (
    <ul className="oi-log" aria-label={label}>
      {rows.map((r, i) => (
        <li key={i}>
          <time dateTime={r.at}>{r.atLabel}</time>
          <span>{r.text}</span>
          {r.detail ? <code>{r.detail}</code> : <span />}
        </li>
      ))}
    </ul>
  );
}

/* ---------------- AgentCard with cap bars ---------------- */
export interface CapBar { label: string; used: number; cap: number; text: string }
export function AgentCard({ name, subtitle, status, caps, children, onDisconnect, disconnectLabel, disconnecting, testId }: {
  name: string; subtitle?: ReactNode; status?: ReactNode; caps: CapBar[]; children?: ReactNode;
  onDisconnect?: () => void; disconnectLabel: string; disconnecting?: boolean; testId?: string;
}) {
  return (
    <article className="oi-agent" data-testid={testId}>
      <div className="oi-row">
        <Avatar name={name} size={44} color="violet" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 17 }}>{name}</div>
          {subtitle && <div className="oi-small oi-muted">{subtitle}</div>}
        </div>
        {status}
      </div>
      {caps.length > 0 && (
        <div className="oi-stack-sm">
          {caps.map((c) => (
            <div className="oi-cap" key={c.label}>
              <div className="oi-cap__row"><span>{c.label}</span><span>{c.text}</span></div>
              <ProgressBar value={c.used} max={c.cap} label={c.label} />
            </div>
          ))}
        </div>
      )}
      {children}
      {onDisconnect && (
        <Button variant="danger" block size="lg" onClick={onDisconnect} loading={disconnecting} icon="disconnect" data-testid={testId ? `${testId}-disconnect` : undefined}>
          {disconnectLabel}
        </Button>
      )}
    </article>
  );
}
