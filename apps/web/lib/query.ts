"use client";
// Minimal SWR-style cache: dedupe, polling (paused when hidden, slowed in low-data mode), focus revalidation, mutate.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

interface Entry<T = unknown> { data?: T; error?: unknown; at: number; inflight?: Promise<T>; loading: boolean }
const cache = new Map<string, Entry>();
const subs = new Map<string, Set<() => void>>();
const fetchers = new Map<string, () => Promise<unknown>>();

function emit(key: string) { subs.get(key)?.forEach((f) => f()); }
function entry(key: string): Entry { let e = cache.get(key); if (!e) { e = { at: 0, loading: false }; cache.set(key, e); } return e; }

export async function revalidate(key: string): Promise<void> {
  const f = fetchers.get(key);
  if (!f) return;
  const e = entry(key);
  if (e.inflight) { await e.inflight.catch(() => undefined); return; }
  const p = f();
  cache.set(key, { ...e, inflight: p, loading: true });
  emit(key);
  try {
    const data = await p;
    cache.set(key, { data, error: undefined, at: Date.now(), loading: false });
  } catch (error) {
    cache.set(key, { ...entry(key), error, inflight: undefined, loading: false });
  }
  emit(key);
}

/** Revalidate every cached key that starts with `prefix` (e.g. "vault:"). */
export function invalidate(prefix: string) {
  for (const k of fetchers.keys()) if (k.startsWith(prefix)) void revalidate(k);
}
/** Locally replace cached data (non-money optimistic UI only). */
export function mutate<T>(key: string, fn: (d: T | undefined) => T | undefined) {
  const e = entry(key);
  cache.set(key, { ...e, data: fn(e.data as T | undefined) });
  emit(key);
}

const lowData = () => typeof document !== "undefined" && document.documentElement.dataset.lowData === "1";

export interface QueryResult<T> { data: T | undefined; error: unknown; loading: boolean; refresh: () => Promise<void> }

export function useQuery<T>(key: string | null, fetcher: () => Promise<T>, opts: { refreshMs?: number } = {}): QueryResult<T> {
  const fref = useRef(fetcher);
  fref.current = fetcher;
  const subscribe = useCallback((cb: () => void) => {
    if (!key) return () => {};
    let s = subs.get(key);
    if (!s) { s = new Set(); subs.set(key, s); }
    s.add(cb);
    return () => { s!.delete(cb); };
  }, [key]);
  const snap = useSyncExternalStore(subscribe, () => (key ? cache.get(key) : undefined), () => undefined);

  useEffect(() => {
    if (!key) return;
    fetchers.set(key, () => fref.current());
    const e = entry(key);
    if (!e.inflight && Date.now() - e.at > 2000) void revalidate(key);
    const onFocus = () => { if (document.visibilityState === "visible") void revalidate(key); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    let t: ReturnType<typeof setInterval> | undefined;
    if (opts.refreshMs) {
      t = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        if (lowData() && Date.now() - entry(key).at < opts.refreshMs! * 4) return;
        void revalidate(key);
      }, opts.refreshMs);
    }
    return () => { document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("focus", onFocus); if (t) clearInterval(t); };
  }, [key, opts.refreshMs]);

  return {
    data: snap?.data as T | undefined,
    error: snap?.error,
    loading: !snap || (snap.loading && snap.data === undefined),
    refresh: useCallback(() => (key ? revalidate(key) : Promise.resolve()), [key]),
  };
}
