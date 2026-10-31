// Deterministic, pure helpers. No clocks or randomness inside: callers pass `now`.
import { formatAmount } from "./amounts";
import type { Activity, Balances, Bill, MonthStats, Pot, SplitRule } from "./types";

const ZERO: Balances = { usdc: "0", usdt: "0" };
const add = (a: string, b: string) => (BigInt(a) + BigInt(b)).toString();
const sum = (b: Balances) => BigInt(b.usdc) + BigInt(b.usdt);

/** yyyymm (UTC) of a nanosecond timestamp string. */
export function monthOfNs(ns: string): number {
  const d = new Date(Number(BigInt(ns) / 1_000_000n));
  return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1;
}
export function monthOfMs(ms: number): number {
  const d = new Date(ms);
  return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1;
}
export function prevMonth(m: number): number {
  const y = Math.floor(m / 100), mo = m % 100;
  return mo === 1 ? (y - 1) * 100 + 12 : y * 100 + mo - 1;
}
export function nextMonth(m: number): number {
  const y = Math.floor(m / 100), mo = m % 100;
  return mo === 12 ? (y + 1) * 100 + 1 : y * 100 + mo + 1;
}

/** Activity kinds that send money out of the account to a counterparty. */
export const OUTFLOW_KINDS = new Set(["withdrawn", "bill_paid", "agent_action", "paid"]);

export function computeInsights(stats: MonthStats[], activity: Activity[], month: number): {
  moneyIn: Balances; moneyOut: Balances; saved: Balances; savingsRateBps: number;
  topPayees: Array<{ to: string; amount: string }>; trend: MonthStats[];
} {
  const byMonth = new Map(stats.map((s) => [s.month, s]));
  const cur = byMonth.get(month) ?? { month, in: ZERO, out: ZERO, saved: ZERO };
  const inTotal = sum(cur.in);
  const savingsRateBps = inTotal === 0n ? 0 : Number((sum(cur.saved) * 10_000n) / inTotal);

  const payees = new Map<string, bigint>();
  for (const a of activity) {
    if (!OUTFLOW_KINDS.has(a.kind) || !a.counterparty || !a.amount) continue;
    if (monthOfNs(a.at) !== month) continue;
    payees.set(a.counterparty, (payees.get(a.counterparty) ?? 0n) + BigInt(a.amount));
  }
  const topPayees = [...payees.entries()]
    .sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : x[0].localeCompare(y[0])))
    .slice(0, 5)
    .map(([to, amount]) => ({ to, amount: amount.toString() }));

  const months: number[] = [month];
  while (months.length < 6) months.unshift(prevMonth(months[0]!));
  const trend = months.map((m) => byMonth.get(m) ?? { month: m, in: { ...ZERO }, out: { ...ZERO }, saved: { ...ZERO } });

  return { moneyIn: { ...cur.in }, moneyOut: { ...cur.out }, saved: { ...cur.saved }, savingsRateBps, topPayees, trend };
}

/**
 * Preview of how an incoming amount is split. Rules apply in order; a percent rule takes floor(amount × bps / 10000)
 * of the incoming amount, a fixed rule takes its value; each is capped by what is left. Spend (pot 0, flex) gets the rest.
 */
export function splitPreview(rules: SplitRule[], amount: string, pots: Pot[]): Array<{ pot_id: number; name: string; amount: string }> {
  const total = BigInt(amount);
  let left = total;
  const nameOf = (id: number) => pots.find((p) => p.id === id)?.name ?? `Pot ${id}`;
  const out: Array<{ pot_id: number; name: string; amount: string }> = [];
  for (const r of rules) {
    let want = r.mode === "percent" ? (total * BigInt(r.value)) / 10_000n : BigInt(r.value);
    if (want > left) want = left;
    left -= want;
    const existing = out.find((o) => o.pot_id === r.pot_id);
    if (existing) existing.amount = add(existing.amount, want.toString());
    else out.push({ pot_id: r.pot_id, name: nameOf(r.pot_id), amount: want.toString() });
  }
  const flex = pots.find((p) => p.kind === "flex");
  out.push({ pot_id: flex?.id ?? 0, name: flex?.name ?? "Spend", amount: left.toString() });
  return out;
}

const DAY_MS = 86_400_000;
export const GOAL_WINDOW_DAYS = 30;
const INFLOW_KINDS = new Set(["split_applied", "schedule_ran", "deposit_received", "saved"]);

/**
 * Inflows into a pot. The vault records moves as kind "moved" with pot_id = source and note "to pot <id>";
 * per-pot split/schedule rows (kind split_applied / schedule_ran / deposit_received with pot_id = this pot) count too.
 */
function isInflow(a: Activity, potId: number): boolean {
  if (!a.amount) return false;
  if (a.kind === "moved") return a.note === `to pot ${potId}`;
  return a.pot_id === potId && INFLOW_KINDS.has(a.kind);
}

/** ETA from the last 30 days' inflow rate into this pot. */
export function goalEta(pot: Pot, activity: Activity[], now: number): { etaMs: number | null; assumption: string } {
  if (!pot.target) return { etaMs: null, assumption: "This pot has no target." };
  const have = sum(pot.balances) + sum(pot.earn_supplied);
  const target = BigInt(pot.target);
  if (have >= target) return { etaMs: 0, assumption: "The target is already reached." };
  const createdMs = Number(BigInt(pot.created_at) / 1_000_000n);
  const windowMs = Math.max(DAY_MS, Math.min(GOAL_WINDOW_DAYS * DAY_MS, now - createdMs));
  const from = now - windowMs;
  let inflow = 0n;
  for (const a of activity) {
    const at = Number(BigInt(a.at) / 1_000_000n);
    if (at >= from && at <= now && isInflow(a, pot.id)) inflow += BigInt(a.amount!);
  }
  const days = Math.round(windowMs / DAY_MS);
  if (inflow === 0n) return { etaMs: null, assumption: `No money came into this pot in the last ${days} day${days === 1 ? "" : "s"}, so there's no estimate yet.` };
  const remaining = target - have;
  // etaMs = remaining / (inflow / windowMs), computed in bigint to stay exact.
  const etaMs = Number((remaining * BigInt(windowMs) + inflow - 1n) / inflow);
  const perWeek = (inflow * BigInt(7 * DAY_MS)) / BigInt(windowMs);
  return {
    etaMs: now + etaMs,
    assumption: `Assumes money keeps coming in at the pace of the last ${days} day${days === 1 ? "" : "s"}: about ${formatAmount(perWeek.toString())} USDC + USDT a week.`,
  };
}

/**
 * Bill status for the current UTC month: "paid" if paid this month; "due" from 3 days before the due day through the due day;
 * "upcoming" before that; "missed" after the due day while unpaid. Bills created after this month's due day start next month.
 */
export function billStatus(bill: Bill, nowMs: number): { status: "upcoming" | "due" | "paid" | "missed"; nextDue: Date } {
  const now = new Date(nowMs);
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const thisMonth = y * 100 + m + 1;
  const dueThis = Date.UTC(y, m, bill.due_day);
  const dueNext = Date.UTC(y, m + 1, bill.due_day);
  const endOfDue = dueThis + DAY_MS;
  if (bill.last_paid_month !== null && bill.last_paid_month >= thisMonth) return { status: "paid", nextDue: new Date(dueNext) };
  const createdMs = Number(BigInt(bill.created_at) / 1_000_000n);
  if (createdMs >= endOfDue) {
    return { status: nowMs >= dueNext - 3 * DAY_MS ? "due" : "upcoming", nextDue: new Date(dueNext) };
  }
  if (nowMs >= endOfDue) return { status: "missed", nextDue: new Date(dueThis) };
  if (nowMs >= dueThis - 3 * DAY_MS) return { status: "due", nextDue: new Date(dueThis) };
  return { status: "upcoming", nextDue: new Date(dueThis) };
}
