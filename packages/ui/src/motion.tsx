"use client";
// Motion tokens + provider. Only transform/opacity are animated. LazyMotion + domAnimation only.
import { LazyMotion, MotionConfig, domAnimation, useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

export const dur = { instant: 0.1, fast: 0.16, base: 0.24, slow: 0.32, reveal: 0.56 } as const;
export const ease = {
  out: [0.22, 1, 0.36, 1] as [number, number, number, number],
  in: [0.55, 0, 1, 0.45] as [number, number, number, number],
  inout: [0.65, 0, 0.35, 1] as [number, number, number, number],
};
export const spring = {
  ui: { type: "spring", duration: 0.32, bounce: 0.1 },
  sheet: { type: "spring", duration: 0.42, bounce: 0.14 },
} as const;

/** True when the user asked for less movement (OS setting) or turned on low-data mode. */
export function useCalm(): boolean {
  const reduced = useReducedMotion();
  const [low, setLow] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setLow(el.dataset.lowData === "1");
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ["data-low-data"] });
    return () => mo.disconnect();
  }, []);
  return Boolean(reduced) || low;
}

function CalmConfig({ children }: { children: ReactNode }) {
  const calm = useCalm();
  return <MotionConfig reducedMotion={calm ? "always" : "user"}>{children}</MotionConfig>;
}

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <CalmConfig>{children}</CalmConfig>
    </LazyMotion>
  );
}

/** App page transition: 12px slide + fade. Use only for sub-pages (not between top-level tabs). */
export const pageVariants = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0, transition: { duration: dur.base, ease: ease.out } },
};
