// Live rates. Never hardcoded: if a source is unavailable the value is null and the UI shows "n/a".
import { RegistryClient, TOKENS, type Token } from "@oiko/sdk";
import { serverConfig } from "./config";
import { rpc } from "./near";

/** Rhea (Burrow) `get_asset` shape (verified on mainnet contract.main.burrow.near, DECISIONS §7); mock-lending mirrors it. */
interface RheaAsset {
  token_id: string; supplied: { shares: string; balance: string }; borrowed: { shares: string; balance: string };
  supply_apr: string; config: { can_deposit: boolean; can_withdraw: boolean };
}
export interface EarnRates {
  source: string; fetchedAt: string;
  /** supplyApr is a percent string with 2 decimals, e.g. "13.92" = 13.92% a year (variable). */
  assets: Array<{ token: Token; supplyApr: string; utilizationBps: number; paused: boolean }>;
}

/** "0.13922541" (fraction) -> "13.92" (percent, truncated). */
export function aprToPercent(fraction: string): string {
  const [w, f = ""] = fraction.trim().split(".");
  const scaled = BigInt(w || "0") * 10_000n + BigInt((f + "0000").slice(0, 4)); // fraction × 10^4 = percent × 100
  return `${scaled / 100n}.${(scaled % 100n).toString().padStart(2, "0")}`;
}
export function utilizationBps(a: Pick<RheaAsset, "supplied" | "borrowed">): number {
  const s = BigInt(a.supplied.balance), b = BigInt(a.borrowed.balance);
  return s === 0n ? 0 : Number((b * 10_000n) / s);
}

let earnCache: { at: number; v: EarnRates } | null = null;
export async function earnRates(): Promise<EarnRates> {
  if (earnCache && Date.now() - earnCache.at < 60_000) return earnCache.v;
  const cfg = serverConfig();
  const lending = cfg.oiko.contracts.lending;
  const source = lending ? (cfg.network === "mainnet" ? `rhea:${lending}` : `mock-lending:${lending}`) : "unavailable";
  const assets: EarnRates["assets"] = [];
  if (lending) {
    for (const token of TOKENS) {
      try {
        const a = await rpc().view<RheaAsset | null>(lending, "get_asset", { token_id: cfg.oiko.contracts[token] });
        if (!a) continue;
        assets.push({ token, supplyApr: aprToPercent(a.supply_apr), utilizationBps: utilizationBps(a), paused: !a.config.can_deposit });
      } catch (e) {
        console.warn(`[oiko] earn rate for ${token} unavailable`, (e as Error).message);
      }
    }
  }
  const v = { source: assets.length ? source : "unavailable", fetchedAt: new Date().toISOString(), assets };
  if (assets.length) earnCache = { at: Date.now(), v };
  return v;
}

export async function stats(): Promise<{ names: number | null; source: "registry" }> {
  try {
    const s = await new RegistryClient(rpc(), serverConfig().oiko.contracts.registry).stats();
    const n = Number(s?.names);
    return { names: Number.isFinite(n) ? n : null, source: "registry" };
  } catch {
    return { names: null, source: "registry" };
  }
}
