"use client";
import { useState } from "react";
import { Glyph, checkmarkCircleFill, xmarkCircleFill, arrow2Circlepath } from "./f7";
import { cx } from "./ui";

const pairs = [
  ["Wait days for withdrawals", "Out in under a minute"],
  ["Move money by hand every payday", "Your plan runs on every payment"],
  ["Remember every bill", "Bills paid on time, by you or your agent"],
  ["Savings you can break on a bad day", "A lock only the date can open"],
] as const;

export function BeforeAfter() {
  const [flipped, setFlipped] = useState<boolean[]>([true, true, true, true]);
  const all = flipped.every(Boolean) ? "oiko" : flipped.every((f) => !f) ? "most" : null;

  return (
    <div>
      <div role="radiogroup" aria-label="Compare" className="mx-auto mb-8 flex w-full max-w-[360px] rounded-full bg-surface-2 p-1 text-[14px] font-semibold">
        {(["most", "oiko"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={all === k}
            onClick={() => setFlipped([k === "oiko", k === "oiko", k === "oiko", k === "oiko"])}
            className={cx("h-10 flex-1 rounded-full transition-colors", all === k ? "bg-surface text-ink shadow-[0_1px_2px_rgba(22,24,29,.08)]" : "text-ink-2 hover:text-ink")}
          >
            {k === "most" ? "Most money apps" : "Oiko"}
          </button>
        ))}
      </div>
      <ul className="mk-stagger grid gap-3 sm:grid-cols-2">
        {pairs.map(([before, after], i) => (
          <li key={before} className="mk-flip" data-flipped={flipped[i]} style={{ ["--i" as string]: i }}>
            <button
              type="button"
              aria-pressed={flipped[i]}
              aria-label={`${flipped[i] ? after : before}. Flip to compare.`}
              onClick={() => setFlipped((f) => f.map((v, j) => (j === i ? !v : v)))}
              className="mk-flip-inner w-full text-left"
            >
              <span className="flex min-h-[176px] flex-col justify-between rounded-card bg-surface-2 p-6 shadow-[inset_0_0_0_var(--hairline)_var(--line)] md:min-h-[200px] md:p-8">
                <span className="flex items-center justify-between text-[13px] font-semibold text-ink-2">
                  <span className="inline-flex items-center gap-1.5"><Glyph d={xmarkCircleFill} size={15} className="text-ink-3" />Most money apps</span>
                  <Glyph d={arrow2Circlepath} size={15} className="text-ink-3" />
                </span>
                <span className="mt-6 block text-[26px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink-3 line-through decoration-[1.5px] decoration-ink-3/60 font-display md:text-[30px]">{before}</span>
              </span>
              <span className="mk-flip-back flex min-h-[176px] flex-col justify-between rounded-card bg-surface p-6 text-ink md:min-h-[200px] md:p-8">
                <span className="flex items-center justify-between text-[13px] font-semibold text-accent">
                  <span className="inline-flex items-center gap-1.5"><Glyph d={checkmarkCircleFill} size={15} />With Oiko</span>
                  <Glyph d={arrow2Circlepath} size={15} />
                </span>
                <span className="mt-6 block">
                  <span className="block text-[26px] font-semibold leading-[1.1] tracking-[-0.025em] font-display md:text-[30px]">{after}</span>
                  <span className="mt-2 block text-[14px] text-ink-3"><span className="sr-only">Instead of: </span><span className="line-through">{before}</span></span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
