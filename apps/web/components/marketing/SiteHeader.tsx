"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { Glyph, lineHorizontal3, xmark } from "./f7";
import { cx, pillClass } from "./ui";

const links = [
  { href: "/#plan", label: "Plan" },
  { href: "/#bills", label: "Bills" },
  { href: "/#savings", label: "Savings" },
  { href: "/#agents", label: "Agents" },
  { href: "/security", label: "Security" },
  { href: "/#developers", label: "Developers" },
];

export function SiteHeader() {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const on = () => setSolid(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <header className={cx("sticky top-0 z-40 transition-colors duration-200", solid || open ? "bg-surface/95 backdrop-blur-md shadow-[0_var(--hairline)_0_var(--line)]" : "bg-transparent")}>
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-4 md:px-8">
          <Link href="/" aria-label="Oiko home" className="-m-2 rounded-lg p-2 text-ink">
            <Logo variant="wordmark" height={26} title="" />
          </Link>
          <ul className="hidden items-center gap-1 lg:flex">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="rounded-full px-3 py-2 text-[15px] font-medium text-ink-2 transition-colors hover:text-ink">{l.label}</Link>
              </li>
            ))}
          </ul>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/home" className={pillClass("black", "sm", "h-10 px-5")}>Open app</Link>
            <button type="button" className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-ink lg:hidden" aria-expanded={open} aria-controls="mk-menu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((o) => !o)}>
              <Glyph d={open ? xmark : lineHorizontal3} size={16} />
            </button>
          </div>
        </nav>
        {open ? (
          <div id="mk-menu" className="fixed inset-x-0 bottom-0 top-16 overflow-y-auto overscroll-contain bg-surface lg:hidden">
            <ul className="px-4 py-4">
              {links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} onClick={() => setOpen(false)} className="flex h-14 items-center border-b border-line text-[22px] font-semibold tracking-[-0.02em]">{l.label}</Link>
                </li>
              ))}
            </ul>
            <div className="px-4 pb-8">
              <Link href="/start" onClick={() => setOpen(false)} className={pillClass("accent", "lg", "w-full")}>Get your name</Link>
            </div>
          </div>
        ) : null}
      </header>
    </>
  );
}
