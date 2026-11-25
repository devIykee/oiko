"use client";
// Wraps each page (via template.tsx, which remounts on every navigation) so a new screen fades up into place.
// Never on the first load of the site: the server-rendered page appears at once (no delayed first paint),
// and only later in-site navigations animate. CSS: .alive-enter in app/alive.css (off with reduced motion).
import { useEffect, useState, type ReactNode } from "react";

let firstPageShown = false;

export function Enter({ children }: { children: ReactNode }) {
  const [animate] = useState(() => firstPageShown);
  useEffect(() => { firstPageShown = true; }, []);
  return <div className={animate ? "alive-enter" : undefined}>{children}</div>;
}
