"use client";
import { useState } from "react";
import { Glyph, checkmarkAlt, docOnDoc } from "./f7";

export function CopyLine({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-3 rounded-full bg-[var(--mk-ink-surface)] py-1.5 pl-5 pr-1.5 font-mono text-[14px] md:text-[15px]">
      <span className="select-all truncate"><span className="text-[var(--mk-ink-text-2)]">$ </span>{text}</span>
      <button
        type="button"
        onClick={async () => {
          try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); } catch {}
        }}
        className="ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white px-4 font-sans text-[13px] font-semibold text-[#16181D] hover:bg-[#E3E5E9]"
        aria-label={done ? "Copied" : `${label}: ${text}`}
      >
        <Glyph d={done ? checkmarkAlt : docOnDoc} size={13} />
        <span aria-live="polite">{done ? "Copied" : label}</span>
      </button>
    </div>
  );
}
