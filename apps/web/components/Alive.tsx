"use client";
// Alive: makes taps and clicks feel physical everywhere (app, website, pay and invoice pages, admin).
// One delegated pointer listener, no per-component wiring, no dependencies. Styles: app/alive.css.
//   - press: adds .is-pressed to the touched control and keeps it for at least MIN_PRESS_MS, so a quick tap on a
//     phone still shows the press before the spring-back (CSS :active alone often lasts less than a frame).
//   - ripple: a soft circle grows from the touch point inside buttons, list rows and cards.
//   - haptics: a 6 ms tick on switches and segmented controls where the device supports it.
//   - navigation bar: starts the moment an in-site link is clicked and finishes when the new path renders.
// Nothing animates for people who asked for reduced motion or turned on low-data mode.
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const PRESSABLE = [
  ".oi-btn", ".oi-iconbtn", ".oi-chip", ".oi-potcard", ".oi-wcard", ".oi-share__btn", ".mk-press", ".oi-seg__btn", ".oi-key",
  ".oi-biller", ".oi-ra", ".oi-tab", ".oi-lr--interactive", ".oi-toggle",
].join(",");
const RIPPLE = [".oi-btn", ".oi-potcard", ".oi-wcard", ".oi-share__btn", ".mk-press", ".oi-lr--interactive", ".oi-biller", ".oi-key", ".oi-chip"].join(",");
const HAPTIC = ".oi-toggle, .oi-seg__btn, [role='switch']";
const MIN_PRESS_MS = 110;

function calm(): boolean {
  return document.documentElement.dataset.lowData === "1" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A static control can host a ripple only if making it `relative` can't move anything inside it. */
function canHost(el: HTMLElement): boolean {
  if (getComputedStyle(el).position !== "static") return true;
  for (const c of el.querySelectorAll<HTMLElement>("*")) {
    const pos = getComputedStyle(c).position;
    if (pos === "absolute" || pos === "fixed") return false;
  }
  el.style.position = "relative";
  el.dataset.aliveRel = "1";
  return true;
}

function ripple(el: HTMLElement, x: number, y: number): HTMLElement | null {
  if (!canHost(el)) return null; // never change a control's layout to host a ripple
  const r = el.getBoundingClientRect();
  const host = document.createElement("span");
  host.className = "alive-ripple-host";
  host.setAttribute("aria-hidden", "true");
  const dot = document.createElement("span");
  dot.className = "alive-ripple";
  const size = 2 * Math.hypot(Math.max(x - r.left, r.right - x), Math.max(y - r.top, r.bottom - y));
  Object.assign(dot.style, { width: `${size}px`, height: `${size}px`, left: `${x - r.left}px`, top: `${y - r.top}px` });
  host.appendChild(dot);
  el.prepend(host);
  return dot;
}

/** Internal navigation a click will cause, or null (new tab, download, other site, same page, hash link). */
function internalTarget(e: MouseEvent): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || a.target && a.target !== "_self" || a.hasAttribute("download")) return null;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return null;
  if (url.pathname === location.pathname && url.search === location.search) return null;
  return url.pathname;
}

export function Alive() {
  const pathname = usePathname();
  const bar = useRef<HTMLDivElement>(null);
  const done = useRef<number | null>(null);

  // Press, ripple and haptics: one listener for the whole page.
  useEffect(() => {
    let pressed: { el: HTMLElement; at: number; dot: HTMLElement | null } | null = null;
    const release = () => {
      const p = pressed;
      if (!p) return;
      pressed = null;
      const wait = Math.max(0, MIN_PRESS_MS - (performance.now() - p.at));
      window.setTimeout(() => {
        p.el.classList.remove("is-pressed");
        if (p.dot) {
          p.dot.classList.add("is-out");
          const host = p.dot.parentElement, el = p.el;
          window.setTimeout(() => {
            host?.remove();
            if (el.dataset.aliveRel && !el.querySelector(".alive-ripple-host")) { el.style.position = ""; delete el.dataset.aliveRel; }
          }, 600);
        }
      }, wait);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const el = (e.target as Element | null)?.closest?.(PRESSABLE) as HTMLElement | null;
      if (!el || (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return;
      release();
      el.classList.add("is-pressed");
      const quiet = calm();
      const dot = !quiet && el.matches(RIPPLE) ? ripple(el, e.clientX, e.clientY) : null;
      if (!quiet && el.matches(HAPTIC)) navigator.vibrate?.(6);
      pressed = { el, at: performance.now(), dot };
    };
    document.addEventListener("pointerdown", down, { passive: true });
    document.addEventListener("pointerup", release, { passive: true });
    document.addEventListener("pointercancel", release, { passive: true });
    window.addEventListener("blur", release);
    // Keyboard: Enter / Space on a focused control presses it too.
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const el = (e.target as Element | null)?.closest?.(PRESSABLE) as HTMLElement | null;
      if (!el) return;
      el.classList.add("is-pressed");
      window.setTimeout(() => el.classList.remove("is-pressed"), MIN_PRESS_MS);
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
      document.removeEventListener("keydown", key);
    };
  }, []);

  // Navigation bar: start on click (capture phase, before Next.js handles the link).
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (!internalTarget(e) || !bar.current) return;
      if (done.current) window.clearTimeout(done.current);
      const b = bar.current;
      b.style.transition = "none"; // jump back to empty without animating backwards
      b.classList.remove("is-done", "is-running");
      void b.offsetWidth;
      b.style.transition = "";
      b.classList.add("is-running");
      // Safety net: never leave the bar running (e.g. the page decided not to navigate).
      done.current = window.setTimeout(() => finish(b), 10_000);
    };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, []);

  // ...and finish it when the new path has rendered.
  useEffect(() => {
    if (bar.current?.classList.contains("is-running")) finish(bar.current);
  }, [pathname]);

  return <div ref={bar} className="alive-bar" role="presentation" aria-hidden="true" />;
}

function finish(b: HTMLElement) {
  b.classList.remove("is-running");
  b.classList.add("is-done");
}
