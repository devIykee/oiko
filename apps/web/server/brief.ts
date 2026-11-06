// get_month_brief: a deterministic month summary an agent can explain in its own words. No AI: plain arithmetic.
import { billStatus, computeInsights, formatAmount, monthOfNs, OUTFLOW_KINDS, prevMonth, type Activity, type AgentView, type Balances, type MonthStats, type Overview } from "@oiko/sdk";
import { billShortfalls } from "./events";

const DAY_MS = 86_400_000;
const total = (b: Balances) => BigInt(b.usdc) + BigInt(b.usdt);
const m = (units: bigint | string) => ({ units: units.toString(), token: "USDC+USDT", display: `${formatAmount(units.toString())} USDC + USDT` });
const pctChange = (now: bigint, before: bigint) => (before === 0n ? null : Number(((now - before) * 10_000n) / before) / 100);

export function monthBrief(month: number, stats: MonthStats[], activity: Activity[], ov: Overview, nowMs: number, policy: AgentView | null = null) {
  const cur = computeInsights(stats, activity, month);
  const prev = computeInsights(stats, activity, prevMonth(month));
  const inN = total(cur.moneyIn), outN = total(cur.moneyOut), savedN = total(cur.saved);
  const inP = total(prev.moneyIn), outP = total(prev.moneyOut), savedP = total(prev.saved);

  const outflows = activity
    .filter((a) => OUTFLOW_KINDS.has(a.kind) && a.amount && monthOfNs(a.at) === month)
    .sort((a, b) => (BigInt(b.amount!) > BigInt(a.amount!) ? 1 : BigInt(b.amount!) < BigInt(a.amount!) ? -1 : a.seq - b.seq))
    .slice(0, 3)
    .map((a) => ({ at: new Date(Number(BigInt(a.at) / 1_000_000n)).toISOString(), to: a.counterparty, kind: a.kind, amount: m(a.amount!), by: a.by }));

  const upcoming = ov.bills
    .map((b) => ({ b, s: billStatus(b, nowMs) }))
    .filter(({ s }) => s.status !== "paid" && s.nextDue.getTime() <= nowMs + 30 * DAY_MS)
    .sort((x, y) => x.s.nextDue.getTime() - y.s.nextDue.getTime())
    .map(({ b, s }) => ({ bill_id: b.id, name: b.name, due_date: s.nextDue.toISOString().slice(0, 10), status: s.status, amount: { units: b.amount, token: b.token.toUpperCase(), display: `${formatAmount(b.amount)} ${b.token.toUpperCase()}` } }));
  const shortfalls = billShortfalls(ov, nowMs).map((s) => ({ pot_id: s.pot.id, pot_name: s.pot.name, token: s.token.toUpperCase(), needed: formatAmount(s.need.toString()), has: formatAmount(s.have.toString()), short: formatAmount(s.short.toString()) }));

  const goals = ov.pots.filter((p) => p.target && BigInt(p.target) > 0n).map((p) => {
    const have = total(p.balances) + total(p.earn_supplied);
    return { pot_id: p.id, name: p.name, target: m(p.target!), saved: m(have), percent: Math.min(100, Number((have * 10_000n) / BigInt(p.target!)) / 100) };
  });

  // Plain facts, in a fixed order. The agent rewrites them in its own voice.
  const facts: string[] = [];
  facts.push(`Money in: ${formatAmount(inN.toString())}${inP > 0n ? ` (${signed(pctChange(inN, inP))} vs last month)` : ""}.`);
  facts.push(`Money out: ${formatAmount(outN.toString())}${outP > 0n ? ` (${signed(pctChange(outN, outP))} vs last month)` : ""}.`);
  facts.push(`Saved: ${formatAmount(savedN.toString())}, a savings rate of ${cur.savingsRateBps / 100}%${savedP > 0n ? ` (last month ${formatAmount(savedP.toString())})` : ""}.`);
  if (cur.topPayees[0]) facts.push(`Biggest payee: ${cur.topPayees[0].to} (${formatAmount(cur.topPayees[0].amount)}).`);
  if (upcoming.length) facts.push(`${upcoming.length} bill${upcoming.length === 1 ? "" : "s"} due in the next 30 days.`);
  for (const s of shortfalls) facts.push(`${s.pot_name} is ${s.short} ${s.token} short of this month's bills.`);
  for (const g of goals) facts.push(`${g.name}: ${g.percent}% of target.`);

  return {
    _help: "Deterministic month summary (UTC). Amounts are { units (6 decimals), token, display }. Explain it in your own words; don't invent numbers.",
    month,
    money_in: m(inN), money_out: m(outN), saved: m(savedN), savings_rate_bps: cur.savingsRateBps,
    vs_last_month: { money_in_pct: pctChange(inN, inP), money_out_pct: pctChange(outN, outP), saved_pct: pctChange(savedN, savedP) },
    top_payees: cur.topPayees.map((p) => ({ to: p.to, amount: m(p.amount) })),
    biggest_outflows: outflows,
    upcoming_bills: upcoming, bill_shortfalls: shortfalls, goals,
    spend_now: m(total(ov.flex)),
    ...(policy ? { your_actions_this_month: activity.filter((a) => a.by === `agent:${policy.public_key}` && monthOfNs(a.at) === month).length } : {}),
    facts,
  };
}
const signed = (p: number | null) => (p === null ? "n/a" : `${p >= 0 ? "+" : ""}${p}%`);
