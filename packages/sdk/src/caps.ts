// The one source of default agent caps (plain amounts, USDC + USDT added together). Used by the web app templates,
// /connect links that leave caps out, the hosted-agent flow, the MCP docs and docs/AGENTS.md.
// Caps are always whole amounts so the consent screen and the contract show the exact same numbers.

export const DEFAULT_CAPS = { perTx: 40, daily: 50, weekly: 100 } as const;

export interface PlainCaps { perTx: string; daily: string; weekly: string }

/** Round base units (6 decimals) up to a whole plain amount. */
const ceilWhole = (units: bigint) => (units <= 0n ? 0n : (units + 999_999n) / 1_000_000n);

/** Default caps for a template. "bills": per payment covers the biggest bill + 10%, day/week cover all bills + 10%,
 *  never below the defaults and always whole amounts with perTx <= daily <= weekly. */
export function defaultCaps(template: "bills" | "autopilot" | "custom" | "coach", billAmounts: Array<string | bigint> = []): PlainCaps {
  if (template === "coach") return { perTx: "0", daily: "0", weekly: "0" }; // read + propose only: no spending caps
  if (template === "autopilot") return { perTx: String(DEFAULT_CAPS.perTx), daily: String(DEFAULT_CAPS.daily * 2), weekly: String(DEFAULT_CAPS.weekly * 3) };
  if (template === "bills" && billAmounts.length) {
    const units = billAmounts.map((a) => BigInt(a));
    const max = units.reduce((m, a) => (a > m ? a : m), 0n), total = units.reduce((s, a) => s + a, 0n);
    const perTx = maxBig(BigInt(DEFAULT_CAPS.perTx), ceilWhole((max * 110n) / 100n));
    const daily = maxBig(BigInt(DEFAULT_CAPS.daily), perTx, ceilWhole((total * 110n) / 100n));
    const weekly = maxBig(BigInt(DEFAULT_CAPS.weekly), daily);
    return { perTx: perTx.toString(), daily: daily.toString(), weekly: weekly.toString() };
  }
  return { perTx: String(DEFAULT_CAPS.perTx), daily: String(DEFAULT_CAPS.daily), weekly: String(DEFAULT_CAPS.weekly) };
}

function maxBig(...v: bigint[]): bigint {
  return v.reduce((m, a) => (a > m ? a : m));
}

/** Plain amount ("40", "12.5") -> base units string; "0" for anything invalid or <= 0. */
export function plainToUnits(plain: string | number): string {
  const s = String(plain).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return "0";
  const [i, f = ""] = s.split(".");
  const u = BigInt(i!) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
  return u > 0n ? u.toString() : "0";
}
