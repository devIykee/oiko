// Money and date formatting. Amounts are always number + ticker, never a currency sign.
import { formatAmount, sumBalances, toUnits, type Balances, type Token } from "@oiko/sdk";

export const TICKER: Record<Token, string> = { usdc: "USDC", usdt: "USDT" };
export const fmt = (units: string | bigint, min = 2) => formatAmount(units.toString(), { minFraction: min, maxFraction: Math.max(min, 2) });
export const fmtExact = (units: string | bigint) => formatAmount(units.toString(), { minFraction: 2 });
export const fmtToken = (units: string | bigint, token: Token) => `${fmt(units)} ${TICKER[token]}`;
export const fmtTotal = (b: Balances) => fmt(sumBalances(b));
export const total = (b: Balances) => BigInt(sumBalances(b));
export const isZero = (b: Balances) => total(b) === 0n;

/** Parses a typed amount into base units, or null if invalid/zero. */
export function parseUnits(human: string): string | null {
  if (!human || !/^\d*\.?\d*$/.test(human)) return null;
  try {
    const u = toUnits(human);
    return BigInt(u) > 0n ? u : null;
  } catch {
    return null;
  }
}

export const nsToMs = (ns: string | null | undefined) => (ns ? Number(BigInt(ns) / 1_000_000n) : 0);
export const msToNs = (ms: number) => (BigInt(Math.round(ms)) * 1_000_000n).toString();

export function fmtDate(ms: number, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-GB", opts).format(new Date(ms));
}
export function fmtTime(ms: number) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}
export function fmtDateTime(ms: number) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}
export function fmtMonth(yyyymm: number, long = false) {
  const d = new Date(Date.UTC(Math.floor(yyyymm / 100), (yyyymm % 100) - 1, 1));
  return new Intl.DateTimeFormat("en-GB", { month: long ? "long" : "short", year: long ? "numeric" : undefined, timeZone: "UTC" }).format(d);
}
export const pct = (bps: number | string) => `${(Number(bps) / 100).toLocaleString("en", { maximumFractionDigits: 1 })}%`;
/** Choose which token to move from a pot: the larger balance, unless asked. */
export function bigger(b: Balances): Token {
  return BigInt(b.usdt) >= BigInt(b.usdc) ? "usdt" : "usdc";
}
export const shortKey = (pk: string) => (pk.length > 18 ? `${pk.slice(8, 14)}…${pk.slice(-4)}` : pk);
