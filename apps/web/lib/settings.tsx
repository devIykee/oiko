"use client";
// Per-browser preferences: theme, low-data mode, hidden balance.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "auto" | "light" | "dark";
export interface Settings { theme: Theme; lowData: boolean; hideBalance: boolean }
const DEFAULTS: Settings = { theme: "auto", lowData: false, hideBalance: false };
const KEY = "oiko.settings";
/** Shared with the website's theme script (components/marketing/theme-script.ts), applied before first paint. */
const THEME_KEY = "oiko-theme";

const Ctx = createContext<{ settings: Settings; set: (p: Partial<Settings>) => void }>({ settings: DEFAULTS, set: () => {} });

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    const s = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
    const th = window.localStorage.getItem(THEME_KEY);
    s.theme = th === "light" || th === "dark" ? th : "auto";
    // Data Saver hint from the browser turns low-data on by default.
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (!raw && conn?.saveData) s.lowData = true;
    return s;
  } catch {
    return DEFAULTS;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  useEffect(() => { setSettings(load()); }, []);
  useEffect(() => {
    const el = document.documentElement;
    if (settings.theme === "auto") el.removeAttribute("data-theme"); else el.setAttribute("data-theme", settings.theme);
    if (settings.lowData) el.setAttribute("data-low-data", "1"); else el.removeAttribute("data-low-data");
  }, [settings]);
  const set = useCallback((p: Partial<Settings>) => {
    setSettings((s) => {
      const n = { ...s, ...p };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(n));
        window.localStorage.setItem(THEME_KEY, n.theme);
      } catch { /* private mode */ }
      return n;
    });
  }, []);
  const value = useMemo(() => ({ settings, set }), [settings, set]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useSettings = () => useContext(Ctx);
