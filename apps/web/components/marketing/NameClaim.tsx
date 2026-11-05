"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Glyph, checkmarkCircleFill, xmarkCircleFill } from "./f7";
import { displayAccount, displayRoot, getJson, useSiteConfig } from "./live";
import { pillClass } from "./ui";

const NAME_RE = /^[a-z0-9_-]{2,32}$/;
type Status = { kind: "idle" } | { kind: "checking" } | { kind: "invalid" } | { kind: "available"; id: string } | { kind: "taken"; id: string; suggestions: string[] } | { kind: "unknown" };

export function NameClaim() {
  const router = useRouter();
  const { config } = useSiteConfig();
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const inputId = useId();
  const hintId = useId();

  useEffect(() => {
    if (!name) return setStatus({ kind: "idle" });
    if (!NAME_RE.test(name)) return setStatus({ kind: "invalid" });
    setStatus({ kind: "checking" });
    const t = setTimeout(async () => {
      const r = await getJson<{ available: boolean; accountId: string; suggestions?: string[] }>(`/api/names/${encodeURIComponent(name)}`);
      if (!r || typeof r.available !== "boolean") return setStatus({ kind: "unknown" });
      setStatus(r.available ? { kind: "available", id: r.accountId } : { kind: "taken", id: r.accountId, suggestions: r.suggestions ?? [] });
    }, 300);
    return () => clearTimeout(t);
  }, [name]);

  const go = (n = name) => router.push(n ? `/start?name=${encodeURIComponent(n)}` : "/start");
  const full = `${name || "yourname"}.${displayRoot(config)}`;

  return (
    <form
      className="mx-auto w-full max-w-[560px]"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <label htmlFor={inputId} className="sr-only">Choose your name</label>
      <div className="flex items-center gap-2 rounded-full bg-surface p-1.5 pl-5 shadow-[0_0_0_1px_var(--line)] focus-within:shadow-[0_0_0_2px_var(--focus)]">
        <div className="flex min-w-0 flex-1 items-baseline text-[17px] md:text-[19px]">
          <input
            id={inputId}
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s/g, ""))}
            placeholder="ada"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={32}
            aria-describedby={hintId}
            className="w-0 min-w-[2ch] flex-1 bg-transparent font-semibold outline-none placeholder:text-ink-3"
            style={{ maxWidth: `${Math.max(3, name.length + 1)}ch` }}
          />
          <span className="truncate text-ink-3">.{displayRoot(config)}</span>
        </div>
        <button type="submit" className={pillClass("black", "md", "h-12 shrink-0 px-5 md:px-6")}>
          Get your name
        </button>
      </div>
      <p id={hintId} aria-live="polite" className="mt-3 flex min-h-6 items-center justify-center gap-1.5 text-[14px]">
        {status.kind === "available" ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-success-ink"><Glyph d={checkmarkCircleFill} size={16} />{displayAccount(config, status.id)} is available</span>
        ) : status.kind === "taken" ? (
          <span className="inline-flex flex-wrap items-center justify-center gap-1.5 text-ink-2">
            <Glyph d={xmarkCircleFill} size={16} className="text-danger" />{displayAccount(config, status.id)} is taken.
            {status.suggestions.slice(0, 3).map((s) => (
              <button key={s} type="button" onClick={() => setName(s)} className="rounded-full bg-surface-2 px-2.5 py-0.5 font-medium text-ink hover:bg-line">{s}</button>
            ))}
          </span>
        ) : status.kind === "invalid" ? (
          <span className="text-ink-2">Use 2 to 32 lowercase letters, numbers, - or _.</span>
        ) : status.kind === "checking" ? (
          <span className="text-ink-3">Checking {full}…</span>
        ) : status.kind === "unknown" ? (
          <span className="text-ink-2">We will check {full} when you start.</span>
        ) : (
          <span className="text-ink-2">Your name becomes your pay link.</span>
        )}
      </p>
    </form>
  );
}

