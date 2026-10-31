"use client";
// The one sticky scroll story (agents section). Desktop: pinned phone changes state per step, driven by CSS
// scroll-driven animations where supported, IntersectionObserver otherwise. Mobile: plain stacked steps.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Phone } from "./phone";

export interface StoryStep { kicker: string; title: string; body: string; screen: ReactNode }

export function AgentStory({ steps }: { steps: StoryStep[] }) {
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [css, setCss] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const supports = typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()");
    if (supports && !reduce) { setCss(true); return; }
    const els = root.current?.querySelectorAll<HTMLElement>(".mk-story-step");
    if (!els?.length) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setStep(Number(e.target.getAttribute("data-s")))),
      { rootMargin: "-45% 0px -45% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <>
      {/* desktop: sticky story */}
      <div ref={root} className="mk-story relative hidden lg:grid lg:grid-cols-2 lg:gap-16" data-step={step} data-css={css ? "true" : undefined}>
        <ol className="py-[10vh]">
          {steps.map((s, i) => (
            <li key={s.title} data-s={i} className="mk-story-step flex min-h-[64vh] flex-col justify-center">
              <p className="text-[14px] font-semibold text-accent">{s.kicker}</p>
              <h3 className="mt-3 max-w-[460px] text-[40px] font-bold leading-[1.05] tracking-[-0.03em] mk-display">{s.title}</h3>
              <p className="mt-4 max-w-[440px] text-[18px] text-ink-2">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="relative">
          <div className="sticky top-[calc(50vh-310px)]">
            <div className="mk-story-phone">
              <Phone label="Oiko agent screens: consent, limits, a proposal, and the activity log">
                <div className="relative h-[556px]">
                  {steps.map((s, i) => (
                    <div key={s.title} data-s={i} className="mk-story-screen absolute inset-0">{s.screen}</div>
                  ))}
                </div>
              </Phone>
            </div>
          </div>
        </div>
      </div>
      {/* mobile and tablet: stacked */}
      <ol className="space-y-16 lg:hidden">
        {steps.map((s) => (
          <li key={s.title} className="mk-reveal">
            <p className="text-[14px] font-semibold text-accent">{s.kicker}</p>
            <h3 className="mt-2 text-[30px] font-bold leading-[1.08] tracking-[-0.03em] mk-display">{s.title}</h3>
            <p className="mt-3 text-[17px] text-ink-2">{s.body}</p>
            <div className="mt-8 h-[440px] overflow-hidden">
              <Phone>{s.screen}</Phone>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
