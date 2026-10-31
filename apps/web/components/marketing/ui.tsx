// Website primitives. No hooks here, so they work in server and client components alike.
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Glyph } from "./f7";

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("mx-auto w-full max-w-[1200px] px-4 md:px-8", className)}>{children}</div>;
}

type Tone = "white" | "grey" | "ink";
const tones: Record<Tone, string> = {
  white: "bg-surface text-ink",
  grey: "bg-bg text-ink",
  ink: "bg-[var(--mk-ink-bg)] text-[var(--mk-ink-text)]",
};
export function Section({ tone = "white", id, className, children, labelledBy }: { tone?: Tone; id?: string; className?: string; children: ReactNode; labelledBy?: string }) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={cx(tones[tone], "py-24 md:py-36 scroll-mt-16", className)}>
      <Container>{children}</Container>
    </section>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-[14px] font-semibold tracking-[-0.005em] text-accent", className)}>{children}</p>;
}

export function SectionHeading({ id, eyebrow, title, lead, center, className }: { id?: string; eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; center?: boolean; className?: string }) {
  return (
    <div className={cx("mk-reveal max-w-[820px]", center && "mx-auto text-center", className)}>
      {eyebrow ? <Eyebrow className="mb-4">{eyebrow}</Eyebrow> : null}
      <h2 id={id} className="mk-display mk-section-title">{title}</h2>
      {lead ? <p className={cx("mt-5 text-[18px] leading-[1.55] md:text-[20px] opacity-80", center && "mx-auto max-w-[640px]")}>{lead}</p> : null}
    </div>
  );
}

type PillVariant = "black" | "accent" | "secondary" | "ghost" | "light";
const pill: Record<PillVariant, string> = {
  black: "bg-pill text-pill-ink hover:opacity-90",
  accent: "bg-accent text-accent-ink hover:opacity-90",
  secondary: "bg-surface-2 text-ink hover:bg-line",
  ghost: "text-ink hover:bg-surface-2",
  light: "bg-white text-[#16181D] hover:bg-[#E3E5E9]",
};
const pillSize = { sm: "h-9 px-4 text-[14px]", md: "h-11 px-5 text-[15px]", lg: "h-13 px-6 text-[16px]" } as const;
export function PillLink({ variant = "black", size = "md", className, children, ...p }: ComponentProps<typeof Link> & { variant?: PillVariant; size?: keyof typeof pillSize }) {
  return (
    <Link {...p} className={cx("mk-press inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors", pill[variant], pillSize[size], className)}>
      {children}
    </Link>
  );
}
export function pillClass(variant: PillVariant = "black", size: keyof typeof pillSize = "md", className?: string) {
  return cx("mk-press inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors disabled:opacity-40 disabled:pointer-events-none", pill[variant], pillSize[size], className);
}

export type TileColor = "blue" | "violet" | "mint" | "sun" | "rose" | "stone";
const tileBg: Record<TileColor, string> = {
  blue: "bg-tile-blue-soft text-tile-blue",
  violet: "bg-tile-violet-soft text-tile-violet",
  mint: "bg-tile-mint-soft text-tile-mint",
  sun: "bg-tile-sun-soft text-tile-sun",
  rose: "bg-tile-rose-soft text-tile-rose",
  stone: "bg-tile-stone-soft text-tile-stone",
};
const tileSolid: Record<TileColor, string> = {
  blue: "bg-tile-blue text-white dark:text-[#0B0C0E]",
  violet: "bg-tile-violet text-white dark:text-[#0B0C0E]",
  mint: "bg-tile-mint text-white dark:text-[#0B0C0E]",
  sun: "bg-tile-sun text-white dark:text-[#0B0C0E]",
  rose: "bg-tile-rose text-white dark:text-[#0B0C0E]",
  stone: "bg-tile-stone text-surface",
};
/** Filled icon on a solid tile colour. Pass `d` (framework7 path) or `children` (custom glyph). */
export function IconTile({ color = "blue", d, size = 36, solid, round, children, className }: { color?: TileColor; d?: string; size?: number; solid?: boolean; round?: boolean; children?: ReactNode; className?: string }) {
  const glyph = Math.round(size * 0.5);
  return (
    <span aria-hidden className={cx("inline-flex shrink-0 items-center justify-center", round ? "rounded-full" : "rounded-[30%]", solid ? tileSolid[color] : tileBg[color], className)} style={{ width: size, height: size }}>
      {d ? <Glyph d={d} size={glyph} /> : children}
    </span>
  );
}

/** "Simulation, no real money" label for the demo tools. */
export function SimLabel() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-[12px] font-semibold text-warning-ink">
      <span className="size-1.5 rounded-full bg-warning" aria-hidden />
      Simulation, no real money
    </span>
  );
}

/** Designed range slider: div track and fill, transparent native input on top (keyboard + a11y from the input). */
export function Slider({ value, min, max, step = 1, onChange, label, valueText, id }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; valueText?: string; id: string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="relative h-7">
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-2" aria-hidden />
      <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent" style={{ width: `${pct}%` }} aria-hidden />
      <input id={id} type="range" className="mk-range" min={min} max={max} step={step} value={value} aria-label={label} aria-valuetext={valueText} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

/** Generic white card used across the landing page. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-card bg-surface p-6 md:p-8", className)}>{children}</div>;
}
