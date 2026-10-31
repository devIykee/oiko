import type { Balances } from "./types";

export const TOKEN_DECIMALS = 6;
const DIGITS = /^\d+$/;

/** "1.5" -> "1500000". Rejects more fraction digits than `decimals` (never rounds money silently). */
export function toUnits(human: string, decimals = TOKEN_DECIMALS): string {
  const s = human.trim().replace(/[,_\s]/g, "");
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) throw new Error(`Not an amount: "${human}"`);
  const whole = m[1] || "0";
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new Error(`Too many decimal places (max ${decimals}): "${human}"`);
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
  return units.toString();
}

/** "1500000" -> "1.5" (trailing zeros trimmed). */
export function fromUnits(units: string, decimals = TOKEN_DECIMALS): string {
  let v = BigInt(units);
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/** "1240500000" -> "1,240.50". Truncates (never rounds up) beyond the token's decimals. */
export function formatAmount(units: string, opts: { decimals?: number; minFraction?: number; maxFraction?: number } = {}): string {
  const decimals = opts.decimals ?? TOKEN_DECIMALS;
  const minFraction = opts.minFraction ?? 2;
  const maxFraction = Math.max(minFraction, opts.maxFraction ?? decimals);
  let v = BigInt(units);
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 10n ** BigInt(decimals);
  const whole = (v / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  if (frac.length < minFraction) frac = frac.padEnd(minFraction, "0");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/** "120500000", "usdc" -> "120.50 USDC" (number + ticker, never a currency sign). */
export function formatTokenAmount(units: string, token: "usdc" | "usdt"): string {
  return `${formatAmount(units)} ${token.toUpperCase()}`;
}

export function sumBalances(b: Balances): string {
  return (BigInt(b.usdc) + BigInt(b.usdt)).toString();
}
export function addBalances(a: Balances, b: Balances): Balances {
  return { usdc: (BigInt(a.usdc) + BigInt(b.usdc)).toString(), usdt: (BigInt(a.usdt) + BigInt(b.usdt)).toString() };
}
export const ZERO_BALANCES: Balances = Object.freeze({ usdc: "0", usdt: "0" }) as Balances;
export function isUnits(v: string): boolean {
  return DIGITS.test(v);
}
