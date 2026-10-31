"use client";
import { forwardRef, useEffect, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { m } from "motion/react";
import { Icon, type IconConcept, type TileColor } from "../icons";
import { dur, ease, useCalm } from "../motion";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");
export { cx };

/* ---------------- Button ---------------- */
export type ButtonVariant = "black" | "accent" | "secondary" | "ghost" | "danger" | "danger-soft";
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  block?: boolean;
  loading?: boolean;
  icon?: IconConcept;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "black", size = "md", block, loading, icon, className, children, disabled, type = "button", ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("oi-btn", variant !== "black" && `oi-btn--${variant}`, size !== "md" && `oi-btn--${size}`, block && "oi-btn--block", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading ? "true" : undefined}
      {...rest}
    >
      {loading && <span className="oi-btn__spinner" aria-hidden />}
      <span className="oi-btn__label" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {icon && <Icon name={icon} size={18} />}
        {children}
      </span>
    </button>
  );
});

/** Link styled as a button (for navigation CTAs). */
export function ButtonLink({ variant = "black", size = "md", block, className, icon, children, ...rest }:
  AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; block?: boolean; icon?: IconConcept }) {
  return (
    <a className={cx("oi-btn", variant !== "black" && `oi-btn--${variant}`, size !== "md" && `oi-btn--${size}`, block && "oi-btn--block", className)} {...rest}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </a>
  );
}

/* ---------------- IconButton ---------------- */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconConcept;
  label: string;
  plain?: boolean;
  small?: boolean;
}
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, plain, small, className, type = "button", ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label}
      className={cx("oi-iconbtn", plain && "oi-iconbtn--plain", small && "oi-iconbtn--sm", className)} {...rest}>
      <Icon name={icon} size={small ? 16 : 18} />
    </button>
  );
});

/* ---------------- RoundAction ---------------- */
export interface RoundActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconConcept;
  label: string;
  primary?: boolean;
  href?: string;
  /** Render as a custom link component (e.g. next/link). */
  as?: React.ElementType;
}
export function RoundAction({ icon, label, primary, href, as, className, ...rest }: RoundActionProps) {
  const inner = (
    <>
      <span className="oi-ra__circle"><Icon name={icon} size={22} /></span>
      <span>{label}</span>
    </>
  );
  const cls = cx("oi-ra", primary && "oi-ra--primary", className);
  if (href) {
    const C = as ?? "a";
    return <C href={href} className={cls} {...(rest as object)}>{inner}</C>;
  }
  return <button type="button" className={cls} {...rest}>{inner}</button>;
}

/* ---------------- Tile ---------------- */
export function Tile({ icon, color = "blue", size = "md", solid, label }: { icon: IconConcept; color?: TileColor; size?: "md" | "lg"; solid?: boolean; label?: string }) {
  return (
    <span className={cx("oi-tile", size === "lg" && "oi-tile--lg", solid && "oi-tile--solid")} data-tile={color}>
      <Icon name={icon} size={size === "lg" ? 22 : 18} label={label} />
    </span>
  );
}

/* ---------------- SectionTitle ---------------- */
export function SectionTitle({ children, action, as: H = "h2", id }: { children: ReactNode; action?: ReactNode; as?: "h2" | "h3"; id?: string }) {
  return (
    <div className="oi-section-title">
      <H id={id}>{children}</H>
      {action}
    </div>
  );
}

/* ---------------- Badge ---------------- */
export function Badge({ tone = "neutral", children, icon, className, ...rest }: { tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "solid"; children: ReactNode; icon?: IconConcept; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx("oi-badge", tone !== "neutral" && `oi-badge--${tone}`, className)} {...rest}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

/* ---------------- Avatar ---------------- */
const avatarColors: TileColor[] = ["blue", "violet", "mint", "sun", "rose"];
export function Avatar({ name, src, size = 40, color }: { name: string; src?: string | null; size?: number; color?: TileColor }) {
  const initials = name.replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = color ?? avatarColors[h % avatarColors.length]!;
  return (
    <span className="oi-avatar" data-tile={c} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden>
      {src ? <img src={src} alt="" /> : initials}
    </span>
  );
}

/* ---------------- Skeleton (appears after 300ms) ---------------- */
export function Skeleton({ width = "100%", height = 16, radius, style, className }: { width?: number | string; height?: number | string; radius?: number; style?: CSSProperties; className?: string }) {
  return <span aria-hidden className={cx("oi-skel", className)} style={{ display: "block", width, height, borderRadius: radius, ...style }} />;
}
/** Accessible loading region: renders nothing visible for 300 ms, then the skeleton layout. */
export function Loading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="oi-sr">{label}</span>
      {children}
    </div>
  );
}

/* ---------------- EmptyState ---------------- */
export function EmptyState({ icon, title, body, action, color = "stone" }: { icon: IconConcept; title: string; body?: ReactNode; action?: ReactNode; color?: TileColor }) {
  return (
    <div className="oi-empty">
      <Tile icon={icon} color={color} size="lg" />
      <div className="oi-empty__title">{title}</div>
      {body && <div className="oi-empty__body">{body}</div>}
      {action}
    </div>
  );
}

/* ---------------- ProgressBar ---------------- */
export function ProgressBar({ value, max = 1, label, thin, tone, warnAt = 0.8, color }: {
  value: number; max?: number; label: string; thin?: boolean; tone?: "accent" | "success" | "warning" | "danger"; warnAt?: number; color?: TileColor;
}) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const autoTone = tone ?? (ratio >= 1 ? "danger" : ratio >= warnAt ? "warning" : "accent");
  return (
    <div className={cx("oi-progress", thin && "oi-progress--thin")} role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} data-tone={autoTone} data-tile={color}
      style={color ? ({ "--bar": "var(--tile-deep)" } as CSSProperties) : undefined}>
      <span className="oi-progress__bar" style={{ transform: `scaleX(${ratio})` }} />
    </div>
  );
}

/* ---------------- Toggle ---------------- */
export function Toggle({ checked, onChange, label, disabled, id, ...rest }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange">) {
  return (
    <button type="button" role="switch" id={id} aria-checked={checked} aria-label={label} disabled={disabled}
      className="oi-toggle" onClick={() => onChange(!checked)} {...rest}>
      <span className="oi-toggle__thumb" />
    </button>
  );
}

/* ---------------- Note / RiskNote ---------------- */
export function Note({ tone = "neutral", title, children, icon }: { tone?: "neutral" | "info" | "warning" | "danger" | "success"; title?: string; children: ReactNode; icon?: IconConcept }) {
  const ic: IconConcept = icon ?? (tone === "warning" || tone === "danger" ? "warning" : tone === "success" ? "success" : "info");
  return (
    <div className={cx("oi-note", tone !== "neutral" && `oi-note--${tone}`)}>
      <span className="oi-note__icon"><Icon name={ic} size={18} /></span>
      <div>
        {title && <div className="oi-note__title">{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
}
/** Plain-words risk note shown before risky toggles (Earn, invest). */
export function RiskNote({ title, points, tone = "warning" }: { title: string; points: string[]; tone?: "warning" | "neutral" | "info" }) {
  return (
    <Note tone={tone} title={title}>
      <ul style={{ margin: "4px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
        {points.map((p) => <li key={p} className="oi-pretty">{p}</li>)}
      </ul>
    </Note>
  );
}

/* ---------------- Success check (300ms stroke) ---------------- */
export function SuccessCheck({ size = 64 }: { size?: number }) {
  return (
    <span className="oi-tile" data-tile="mint" style={{ width: size, height: size }}>
      <svg className="oi-check-anim" width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

/* ---------------- Appear (fade/slide for sub-pages) ---------------- */
export function Appear({ children, delay = 0, y = 0, x = 12 }: { children: ReactNode; delay?: number; y?: number; x?: number }) {
  const calm = useCalm();
  if (calm) return <>{children}</>;
  return (
    <m.div initial={{ opacity: 0, x, y }} animate={{ opacity: 1, x: 0, y: 0 }} transition={{ duration: dur.base, ease: ease.out, delay }}>
      {children}
    </m.div>
  );
}

/* ---------------- useDelayed: true after ms (skeleton gate) ---------------- */
export function useDelayed(ms = 300) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), ms); return () => clearTimeout(t); }, [ms]);
  return on;
}
