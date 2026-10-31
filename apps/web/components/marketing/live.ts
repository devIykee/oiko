"use client";
// Live data for the website. Everything degrades to "nothing shown" or "n/a"; we never invent figures.
import { useEffect, useState } from "react";

export interface SiteConfig {
  network: string | null;
  root: string;
  contracts: { registry: string | null; usdc: string | null; usdt: string | null; lending: string | null; ajo: string | null; mpcSigner: string | null };
  vaultCodeHash: string | null;
  explorer: string | null;
  features: Partial<Record<"earn" | "ajo" | "mcp" | "rescue" | "invest" | "ajoDao", boolean>>;
  source: "api" | "env";
}

const env = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
/** Build-time fallback from NEXT_PUBLIC_OIKO_* (null when unset). */
export function envConfig(): SiteConfig {
  const root = env(process.env.NEXT_PUBLIC_OIKO_ROOT_ACCOUNT) ?? "oiko.near";
  return {
    network: env(process.env.NEXT_PUBLIC_OIKO_NETWORK),
    root,
    contracts: {
      registry: env(process.env.NEXT_PUBLIC_OIKO_REGISTRY) ?? env(process.env.NEXT_PUBLIC_OIKO_ROOT_ACCOUNT),
      usdc: env(process.env.NEXT_PUBLIC_OIKO_USDC),
      usdt: env(process.env.NEXT_PUBLIC_OIKO_USDT),
      lending: env(process.env.NEXT_PUBLIC_OIKO_LENDING),
      ajo: env(process.env.NEXT_PUBLIC_OIKO_AJO),
      mpcSigner: env(process.env.NEXT_PUBLIC_OIKO_MPC_SIGNER),
    },
    vaultCodeHash: env(process.env.NEXT_PUBLIC_OIKO_VAULT_CODE_HASH),
    explorer: env(process.env.NEXT_PUBLIC_OIKO_EXPLORER),
    features: {},
    source: "env",
  };
}

const cache = new Map<string, Promise<unknown>>();
export function getJson<T>(url: string, timeoutMs = 6000): Promise<T | null> {
  if (!cache.has(url)) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    cache.set(
      url,
      fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .finally(() => clearTimeout(t)),
    );
  }
  return cache.get(url) as Promise<T | null>;
}

type ApiConfig = { network?: string; root?: string; contracts?: Partial<SiteConfig["contracts"]>; vaultCodeHash?: string | null; explorer?: string | null; features?: SiteConfig["features"] };

export function useSiteConfig(): { config: SiteConfig; loaded: boolean } {
  const [state, set] = useState<{ config: SiteConfig; loaded: boolean }>(() => ({ config: envConfig(), loaded: false }));
  useEffect(() => {
    let live = true;
    getJson<ApiConfig>("/api/config").then((c) => {
      if (!live) return;
      if (!c || !c.root) return set((s) => ({ ...s, loaded: true }));
      const base = envConfig();
      set({
        loaded: true,
        config: {
          network: c.network ?? base.network,
          root: c.root,
          contracts: { ...base.contracts, ...(c.contracts ?? {}) },
          vaultCodeHash: c.vaultCodeHash ?? base.vaultCodeHash,
          explorer: c.explorer ?? base.explorer,
          features: c.features ?? {},
          source: "api",
        },
      });
    });
    return () => { live = false; };
  }, []);
  return state;
}

export function explorerAccountUrl(explorer: string | null, id: string): string | null {
  if (!explorer) return null;
  return `${explorer.replace(/\/$/, "")}/address/${id}`;
}

export function useJson<T>(url: string): { data: T | null; loaded: boolean } {
  const [s, set] = useState<{ data: T | null; loaded: boolean }>({ data: null, loaded: false });
  useEffect(() => {
    let live = true;
    getJson<T>(url).then((d) => live && set({ data: d, loaded: true }));
    return () => { live = false; };
  }, [url]);
  return s;
}
