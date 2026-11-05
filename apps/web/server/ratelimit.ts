// In-memory rate limits and the relayer's global daily budget. Per-instance on serverless (documented in DECISIONS.md).
type Bucket = { tokens: number; updated: number };
const g = globalThis as unknown as { __oikoBuckets?: Map<string, Bucket>; __oikoBudget?: { day: number; spent: bigint } };
const buckets = (g.__oikoBuckets ??= new Map());

/** Token bucket: `limit` requests per `windowMs`, refilled continuously. Returns true if allowed. */
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key) ?? { tokens: limit, updated: now };
  b.tokens = Math.min(limit, b.tokens + ((now - b.updated) / windowMs) * limit);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 50_000) for (const k of [...buckets.keys()].slice(0, 10_000)) buckets.delete(k);
  return true;
}

export const LIMITS = {
  register: { perIp: [5, 3_600_000], perAccount: [2, 3_600_000] },
  relay: { perIp: [20, 3_600_000], perAccount: [5, 3_600_000] },
  topup: { perIp: [10, 3_600_000], perAccount: [3, 86_400_000] },
  sync: { perIp: [60, 60_000], perAccount: [6, 60_000] },
  gateway: { perIp: [120, 60_000], perAccount: [60, 60_000] },
  intents: { perIp: [30, 60_000], perAccount: [30, 60_000] },
  simulate: { perIp: [10, 60_000], perAccount: [10, 60_000] },
  counterparty: { perIp: [30, 60_000], perAccount: [30, 60_000] },
  report: { perIp: [10, 3_600_000], perAccount: [5, 86_400_000] },
  invoice: { perIp: [90, 60_000], perAccount: [40, 60_000] },
} as const satisfies Record<string, { perIp: readonly [number, number]; perAccount: readonly [number, number] }>;

export function checkLimits(kind: keyof typeof LIMITS, ip: string, account: string | null, now = Date.now()): boolean {
  const l = LIMITS[kind];
  if (!allow(`${kind}:ip:${ip}`, l.perIp[0], l.perIp[1], now)) return false;
  if (account && !allow(`${kind}:acct:${account}`, l.perAccount[0], l.perAccount[1], now)) return false;
  return true;
}

/** Rough NEAR cost of one relayer transaction's gas (0.003 NEAR at 300 Tgas × 0.1 Ggas price; conservative). */
export const GAS_COST_ESTIMATE = 3n * 10n ** 21n;

export function budgetRemaining(limit: bigint, now = Date.now()): bigint {
  const day = Math.floor(now / 86_400_000);
  const b = (g.__oikoBudget ??= { day, spent: 0n });
  if (b.day !== day) Object.assign(b, { day, spent: 0n });
  return limit - b.spent;
}
/** Reserves `amount` from today's budget; false if it would exceed it. */
export function spendBudget(limit: bigint, amount: bigint, now = Date.now()): boolean {
  if (budgetRemaining(limit, now) < amount) return false;
  g.__oikoBudget!.spent += amount;
  return true;
}
export function resetLimitsForTests(): void {
  buckets.clear();
  g.__oikoBudget = undefined;
}
