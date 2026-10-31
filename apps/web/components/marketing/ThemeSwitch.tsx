"use client";
import { useEffect, useState } from "react";
import { Glyph, sunMaxFill, moonFill, circleLefthalfFill } from "./f7";
import { THEME_KEY } from "./theme-script";
import { cx } from "./ui";

type Mode = "light" | "dark" | "auto";
const opts: Array<{ v: Mode; label: string; d: string }> = [
  { v: "light", label: "Light", d: sunMaxFill },
  { v: "dark", label: "Dark", d: moonFill },
  { v: "auto", label: "Auto", d: circleLefthalfFill },
];

export function ThemeSwitch({ className }: { className?: string }) {
  const [mode, setMode] = useState<Mode>("auto");
  useEffect(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      if (t === "light" || t === "dark") setMode(t);
    } catch {}
  }, []);
  const pick = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem(THEME_KEY, m); } catch {}
    const d = document.documentElement;
    if (m === "auto") d.removeAttribute("data-theme");
    else d.setAttribute("data-theme", m);
  };
  return (
    <div role="radiogroup" aria-label="Theme" className={cx("inline-flex rounded-full bg-surface-2 p-1", className)}>
      {opts.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={mode === o.v} onClick={() => pick(o.v)}
          className={cx("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors", mode === o.v ? "bg-surface text-ink shadow-[0_1px_2px_rgba(22,24,29,.08)]" : "text-ink-2 hover:text-ink")}>
          <Glyph d={o.d} size={13} />{o.label}
        </button>
      ))}
    </div>
  );
}
