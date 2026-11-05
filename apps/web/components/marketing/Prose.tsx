import type { ReactNode } from "react";
import { Container } from "./ui";

export function PageHero({ eyebrow, title, lead }: { eyebrow: string; title: ReactNode; lead: ReactNode }) {
  return (
    <section className="-mt-16 bg-bg oi-sky pb-16 pt-32 md:pb-24 md:pt-40">
      <Container>
        <p className="text-[14px] font-semibold text-accent">{eyebrow}</p>
        <h1 className="mk-display mk-section-title mt-4 max-w-[900px] md:text-[80px]">{title}</h1>
        <p className="mt-6 max-w-[680px] text-[18px] leading-[1.55] text-ink-2 md:text-[20px]">{lead}</p>
      </Container>
    </section>
  );
}

export function Block({ id, title, children, tone = "white" }: { id?: string; title: string; children: ReactNode; tone?: "white" | "grey" }) {
  return (
    <section id={id} className={`scroll-mt-20 py-16 md:py-24 ${tone === "grey" ? "bg-bg oi-sky" : "bg-surface"}`}>
      <Container className="grid gap-8 lg:grid-cols-[1fr_1.7fr] lg:gap-16">
        <h2 className="text-[30px] font-bold leading-[1.1] tracking-[-0.03em] md:text-[40px] mk-display">{title}</h2>
        <div className="space-y-5 text-[17px] leading-[1.65] text-ink-2 [&_strong]:text-ink">{children}</div>
      </Container>
    </section>
  );
}
