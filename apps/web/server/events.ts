// Events for agents ("personal intelligence"): derived from the account's current state on every request, so they
// need no background job and are the same on every server instance. Each event has a stable id, a fixed `at` (when it
// happened or became true) and deterministic `suggested_actions` computed by code from the state right now.
// Agents poll GET /api/agent/events?since=<cursor> (or the MCP tool get_events); webhooks deliver the same events.
import {
  billStatus, formatAmount, type Activity, type AgentAction, type AgentKind, type AgentView, type Balances, type Circle, type ConfigChange,
  type Overview, type Pot, type Token,
} from "@oiko/sdk";
import { deriveStatus, type Invoice } from "./invoices";

export const EVENT_TYPES = [
  "payment_received", "plan_applied", "bill_due_soon", "bill_due_today", "bill_missed", "goal_reached", "spend_low", "lock_released",
  "invoice_paid", "invoice_overdue", "rosca_round_due", "rosca_default", "cap_80", "weekly_summary", "autopilot_due",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface SuggestedAction {
  /** act: do it now within your caps. propose: send it for the owner to approve (money). propose_change: a non-money
   *  change for the owner to approve. tell_owner: nothing to sign, just let the owner know. */
  kind: "act" | "propose" | "propose_change" | "tell_owner";
  action?: AgentAction;
  change?: ConfigChange;
  reason: string;
  /** Set when an autopilot rule the owner turned on asks for this; the owner has agreed to it in advance. */
  autopilot?: AutopilotRuleId;
}

export interface OikoEvent {
  id: string;
  type: EventType;
  /** ISO time the event happened or became true. Cursors compare against this. */
  at: string;
  title: string;
  data: Record<string, unknown>;
  suggested_actions: SuggestedAction[];
}

// ---------- autopilot (owner opt-in rules, stored off-chain) ----------

export type AutopilotRuleId = "top_up_bills" | "sweep_spend" | "pay_bills_on_due_day";
export interface AutopilotSettings {
  /** On every payment in, move from Spend into each Bills pot what this month's unpaid bills still need. */
  top_up_bills: { on: boolean };
  /** Once a week, move what Spend holds above `above` (per stablecoin, units) into `to_pot`. weekday: 0 = Sunday (UTC). */
  sweep_spend: { on: boolean; above: string; to_pot: number | null; weekday: number };
  /** Pay each bill on its due day when its pot has enough. */
  pay_bills_on_due_day: { on: boolean };
  /** Spend low alert: an event when Spend (USDC + USDT) drops below this many units. null = off. */
  spend_floor: string | null;
  updatedAt: string | null;
}
export const DEFAULT_AUTOPILOT: AutopilotSettings = {
  top_up_bills: { on: false }, sweep_spend: { on: false, above: "300000000", to_pot: null, weekday: 5 }, pay_bills_on_due_day: { on: false },
  spend_floor: null, updatedAt: null,
};
export const autopilotKey = (vaultId: string) => `autopilot:${vaultId}`;

// ---------- helpers ----------

const DAY_MS = 86_400_000;
const WEEK_NS = 7n * 86_400_000_000_000n;
const DAY_NS = 86_400_000_000_000n;
const WINDOW_MS = 30 * DAY_MS;
const TOKENS: Token[] = ["usdc", "usdt"];
const nsMs = (ns: string) => Number(BigInt(ns) / 1_000_000n);
const iso = (ms: number) => new Date(ms).toISOString();
const dayStart = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const money = (units: string | bigint, token: Token | "usdc+usdt") => {
  const u = units.toString();
  const t = token === "usdc+usdt" ? "USDC+USDT" : token.toUpperCase();
  return { units: u, token: t, display: `${formatAmount(u)} ${token === "usdc+usdt" ? "USDC + USDT" : t}` };
};
const total = (b: Balances) => BigInt(b.usdc) + BigInt(b.usdt);
const potName = (p: Pot | undefined) => (p ? (p.kind === "flex" ? "Spend" : p.name) : "a pot");
const min = (a: bigint, b: bigint) => (a < b ? a : b);

const KIND_OF: Record<AgentAction["type"], AgentKind> = { pay: "pay", pay_bill: "pay", move: "move_between_pots", save: "save" };

/** act when this agent may do it now within its caps; otherwise propose (or tell_owner without the propose scope). */
export function chooseKind(policy: AgentView | null, action: AgentAction, amount: bigint, nowMs: number): "act" | "propose" | "tell_owner" {
  if (!policy) return "propose";
  const canAct = policy.scopes.includes("act") && policy.allowed_actions.includes(KIND_OF[action.type]) && withinCaps(policy, amount, nowMs)
    && (action.type !== "pay" || policy.allowlist.some((r) => r.type === "near" && r.account_id === action.to));
  if (canAct) return "act";
  return policy.scopes.includes("propose") ? "propose" : "tell_owner";
}
function capUse(p: AgentView, nowMs: number) {
  const ns = BigInt(nowMs) * 1_000_000n;
  const day = Number(ns / DAY_NS), week = Number(ns / WEEK_NS);
  return {
    day: p.spent_day[0] === day ? BigInt(p.spent_day[1]) : 0n,
    week: p.spent_week[0] === week ? BigInt(p.spent_week[1]) : 0n,
    weekStartMs: Number((ns / WEEK_NS) * WEEK_NS / 1_000_000n),
  };
}
function withinCaps(p: AgentView, amount: bigint, nowMs: number): boolean {
  const u = capUse(p, nowMs);
  return amount <= BigInt(p.per_tx) && u.day + amount <= BigInt(p.daily) && u.week + amount <= BigInt(p.weekly);
}

/** What each Bills pot still needs this month: unpaid bills (due, upcoming this month or missed) minus its balance, per token. */
export function billShortfalls(ov: Overview, nowMs: number): Array<{ pot: Pot; token: Token; need: bigint; have: bigint; short: bigint }> {
  const now = new Date(nowMs);
  const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const need = new Map<string, bigint>();
  for (const b of ov.bills) {
    const s = billStatus(b, nowMs);
    if (s.status === "paid" || s.nextDue.getTime() >= monthEnd) continue;
    const k = `${b.pot_id}:${b.token}`;
    need.set(k, (need.get(k) ?? 0n) + BigInt(b.amount));
  }
  const out: Array<{ pot: Pot; token: Token; need: bigint; have: bigint; short: bigint }> = [];
  for (const [k, n] of need) {
    const [potId, token] = k.split(":") as [string, Token];
    const pot = ov.pots.find((p) => p.id === Number(potId));
    if (!pot) continue;
    const have = BigInt(pot.balances[token]);
    if (have < n) out.push({ pot, token, need: n, have, short: n - have });
  }
  return out;
}

function moveFromSpend(ov: Overview, policy: AgentView | null, toPot: Pot, token: Token, want: bigint, reason: string, nowMs: number, autopilot?: AutopilotRuleId): SuggestedAction | null {
  const spend = ov.pots.find((p) => p.kind === "flex");
  const avail = spend ? BigInt(spend.balances[token]) : 0n;
  const amount = min(want, avail);
  if (amount <= 0n) return { kind: "tell_owner", reason: `${reason} Spend has no ${token.toUpperCase()} to move, so the owner needs to add money.` };
  const action: AgentAction = { type: "move", from_pot: spend!.id, to_pot: toPot.id, token, amount: amount.toString() };
  return { kind: chooseKind(policy, action, amount, nowMs), action, reason: amount < want ? `${reason} Spend only has ${formatAmount(amount.toString())} ${token.toUpperCase()}.` : reason, ...(autopilot ? { autopilot } : {}) };
}

export interface EventInputs {
  vaultId: string;
  overview: Overview;
  /** Newest first, as get_activity returns it. */
  activity: Activity[];
  invoices: Invoice[];
  circles: Circle[];
  /** The asking agent's policy (for cap_80 and act vs propose). null for owner-side views. */
  policy: AgentView | null;
  autopilot: AutopilotSettings;
  nowMs: number;
}

export function deriveEvents(x: EventInputs): OikoEvent[] {
  const { overview: ov, activity, policy, autopilot: ap, nowMs } = x;
  const out: OikoEvent[] = [];
  const pot = (id: number | null | undefined) => ov.pots.find((p) => p.id === id);
  const push = (e: OikoEvent) => { const t = Date.parse(e.at); if (t <= nowMs && t > nowMs - WINDOW_MS) out.push(e); };
  const acts = [...activity].sort((a, b) => a.seq - b.seq);

  // Money in, and how the plan split it (split rows share the deposit's timestamp).
  let latestDeposit: Activity | null = null;
  for (const a of acts) {
    if (a.kind === "deposit_received" && a.amount && a.token) {
      latestDeposit = a;
      push({
        id: `payment_received:${a.seq}`, type: "payment_received", at: iso(nsMs(a.at)),
        title: `${formatAmount(a.amount)} ${a.token.toUpperCase()} arrived${a.counterparty ? ` from ${a.counterparty}` : ""}`,
        data: { amount: money(a.amount, a.token), from: a.counterparty, seq: a.seq }, suggested_actions: [],
      });
      const splits = acts.filter((s) => s.kind === "split_applied" && s.at === a.at && s.seq > a.seq && s.amount);
      if (splits.length) {
        push({
          id: `plan_applied:${a.seq}`, type: "plan_applied", at: iso(nsMs(a.at)), title: "Your plan split the payment",
          data: { allocations: splits.map((s) => ({ pot_id: s.pot_id, pot_name: potName(pot(s.pot_id)), amount: money(s.amount!, s.token ?? a.token!) })) },
          suggested_actions: [],
        });
      }
    }
  }

  // Bills: due in 3 days, due today, missed. Suggest topping up the pot when it's short, else paying.
  for (const b of ov.bills) {
    const s = billStatus(b, nowMs);
    const due = s.nextDue.getTime();
    const dueDay = iso(due).slice(0, 10);
    const bp = pot(b.pot_id);
    const have = bp ? BigInt(bp.balances[b.token]) : 0n;
    const amt = BigInt(b.amount);
    const base = { bill_id: b.id, name: b.name, amount: money(b.amount, b.token), payee: b.payee, due_date: dueDay, pot_id: b.pot_id, pot_name: potName(bp), pot_balance: money(have, b.token) };
    const topUp = () => have < amt && bp
      ? moveFromSpend(ov, policy, bp, b.token, amt - have, `${potName(bp)} has ${formatAmount(have.toString())} ${b.token.toUpperCase()} but ${b.name} needs ${formatAmount(b.amount)}.`, nowMs)
      : null;
    const pay = (autopilotOn: boolean): SuggestedAction | null => {
      if (have < amt) return null;
      const action: AgentAction = { type: "pay_bill", bill_id: b.id };
      return { kind: chooseKind(policy, action, amt, nowMs), action, reason: `${b.name} is due ${dueDay} and ${potName(bp)} has enough.`, ...(autopilotOn ? { autopilot: "pay_bills_on_due_day" as const } : {}) };
    };
    if (s.status === "due" && dayStart(nowMs) === due) {
      const acts2 = [topUp(), pay(ap.pay_bills_on_due_day.on)].filter(Boolean) as SuggestedAction[];
      push({ id: `bill_due_today:${b.id}:${dueDay}`, type: "bill_due_today", at: iso(due), title: `${b.name} is due today`, data: base, suggested_actions: acts2 });
    } else if (s.status === "due") {
      push({ id: `bill_due_soon:${b.id}:${dueDay}`, type: "bill_due_soon", at: iso(due - 3 * DAY_MS), title: `${b.name} is due on ${dueDay}`, data: base, suggested_actions: [topUp()].filter(Boolean) as SuggestedAction[] });
    } else if (s.status === "missed") {
      push({ id: `bill_missed:${b.id}:${dueDay}`, type: "bill_missed", at: iso(due + DAY_MS), title: `${b.name} wasn't paid on ${dueDay}`, data: base, suggested_actions: [topUp(), pay(false)].filter(Boolean) as SuggestedAction[] });
    }
  }

  // Goals reached (balance including what is earning), lock dates passed.
  for (const p of ov.pots) {
    const lastTouch = acts.filter((a) => a.pot_id === p.id).at(-1);
    if (p.target && BigInt(p.target) > 0n && total(p.balances) + total(p.earn_supplied) >= BigInt(p.target)) {
      push({
        id: `goal_reached:${p.id}:${p.target}`, type: "goal_reached", at: iso(nsMs(lastTouch?.at ?? p.created_at)), title: `${p.name} reached its target`,
        data: { pot_id: p.id, pot_name: p.name, target: money(p.target, "usdc+usdt"), balance: money(total(p.balances) + total(p.earn_supplied), "usdc+usdt") },
        suggested_actions: [{ kind: "tell_owner", reason: `Congratulate the owner and ask what's next: lock it, raise the target, or start a new goal.` }],
      });
    }
    if (p.unlock_at && nsMs(p.unlock_at) <= nowMs) {
      push({
        id: `lock_released:${p.id}:${p.unlock_at}`, type: "lock_released", at: iso(nsMs(p.unlock_at)), title: `${p.name} is unlocked`,
        data: { pot_id: p.id, pot_name: p.name, balance: money(total(p.balances), "usdc+usdt") },
        suggested_actions: [{ kind: "tell_owner", reason: `${p.name} can be spent from now. Ask whether to keep it, lock it again or move it.` }],
      });
    }
  }

  // Spend low (owner-set floor).
  const spend = ov.pots.find((p) => p.kind === "flex");
  if (ap.spend_floor && spend && total(spend.balances) < BigInt(ap.spend_floor)) {
    const lastSpend = acts.filter((a) => a.pot_id === spend.id || (a.pot_id === null && a.kind !== "deposit_received")).at(-1);
    const savings = [...ov.pots].filter((p) => p.kind === "autosave" && !(p.unlock_at && nsMs(p.unlock_at) > nowMs)).sort((a, b) => (total(b.balances) > total(a.balances) ? 1 : -1))[0];
    const gap = BigInt(ap.spend_floor) - total(spend.balances);
    const sa: SuggestedAction[] = [];
    if (savings) {
      const token: Token = BigInt(savings.balances.usdt) >= BigInt(savings.balances.usdc) ? "usdt" : "usdc";
      const amount = min(gap, BigInt(savings.balances[token]));
      if (amount > 0n) {
        const action: AgentAction = { type: "move", from_pot: savings.id, to_pot: spend.id, token, amount: amount.toString() };
        sa.push({ kind: policy?.scopes.includes("propose") ? "propose" : "tell_owner", action, reason: `Spend is below the ${formatAmount(ap.spend_floor)} floor the owner set. Moving savings back is the owner's call.` });
      }
    }
    if (!sa.length) sa.push({ kind: "tell_owner", reason: `Spend is below the ${formatAmount(ap.spend_floor)} floor the owner set.` });
    push({
      id: `spend_low:${lastSpend?.seq ?? 0}`, type: "spend_low", at: iso(nsMs(lastSpend?.at ?? spend.created_at)), title: "Spend is running low",
      data: { spend: money(total(spend.balances), "usdc+usdt"), floor: money(ap.spend_floor, "usdc+usdt") }, suggested_actions: sa,
    });
  }

  // Invoices.
  for (const inv of x.invoices) {
    const d = deriveStatus(inv, nowMs);
    const base = { invoice_id: inv.id, number: inv.number, client: inv.client.name, total: money(d.total, inv.token) };
    if (d.status === "paid" && d.paidAt) {
      push({ id: `invoice_paid:${inv.id}`, type: "invoice_paid", at: d.paidAt, title: `${inv.number} was paid`, data: { ...base, received: money(d.received, inv.token) }, suggested_actions: [] });
    } else if (d.status === "overdue") {
      push({
        id: `invoice_overdue:${inv.id}`, type: "invoice_overdue", at: iso(Date.parse(`${inv.dueDate}T00:00:00Z`) + DAY_MS), title: `${inv.number} is overdue`,
        data: { ...base, due_date: inv.dueDate }, suggested_actions: [{ kind: "tell_owner", reason: `${inv.client.name} hasn't paid ${inv.number}. Offer to draft a friendly reminder for the owner to send.` }],
      });
    }
  }

  // ROSCA savings groups.
  for (const c of x.circles) {
    if (c.status !== "active" || c.start_at === null) continue;
    const start = nsMs(c.start_at), period = nsMs(c.period_ns);
    const roundStart = start + c.round * period;
    const paid = c.paid.some(([r, m]) => r === c.round && m === x.vaultId);
    if (!paid) {
      push({
        id: `rosca_round_due:${c.id}:${c.round}`, type: "rosca_round_due", at: iso(roundStart), title: `${c.name}: round ${c.round + 1} contribution is due`,
        data: { group_id: c.id, name: c.name, round: c.round + 1, amount: money(c.amount_per_round, c.token), due_by: iso(roundStart + period) },
        suggested_actions: [{ kind: "tell_owner", reason: `Remind the owner to contribute ${formatAmount(c.amount_per_round)} ${c.token.toUpperCase()} to ${c.name} before ${iso(roundStart + period).slice(0, 16).replace("T", " ")} UTC.` }],
      });
    }
    for (const [r, m] of c.defaults) {
      if (m !== x.vaultId) continue;
      push({
        id: `rosca_default:${c.id}:${r}`, type: "rosca_default", at: iso(start + (r + 1) * period), title: `${c.name}: round ${r + 1} was missed`,
        data: { group_id: c.id, name: c.name, round: r + 1 }, suggested_actions: [{ kind: "tell_owner", reason: "A missed round can cost the bond. Tell the owner and the group organiser." }],
      });
    }
  }

  // This agent's weekly cap at 80% or more.
  if (policy) {
    const u = capUse(policy, nowMs);
    const cap = BigInt(policy.weekly);
    if (cap > 0n && u.week * 10n >= cap * 8n) {
      const mine = acts.filter((a) => a.by === `agent:${policy.public_key}`).at(-1);
      const at = Math.max(u.weekStartMs, mine ? nsMs(mine.at) : 0);
      push({
        id: `cap_80:${Math.floor(u.weekStartMs / DAY_MS)}`, type: "cap_80", at: iso(at), title: "You've used 80% of your weekly limit",
        data: { used: money(u.week, "usdc+usdt"), cap: money(cap, "usdc+usdt"), resets_at: iso(u.weekStartMs + 7 * DAY_MS) },
        suggested_actions: [{ kind: "tell_owner", reason: "Use propose for anything else this week, or ask the owner whether to raise the weekly limit." }],
      });
    }
  }

  // Weekly summary for the last 7 days, every Monday 00:00 UTC.
  {
    const today = dayStart(nowMs);
    const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS;
    const from = monday - 7 * DAY_MS;
    const inWeek = acts.filter((a) => { const t = nsMs(a.at); return t >= from && t < monday; });
    const sum = (kinds: string[]) => {
      const b = { usdc: 0n, usdt: 0n };
      for (const a of inWeek) if (kinds.includes(a.kind) && a.amount && a.token) b[a.token] += BigInt(a.amount);
      return b;
    };
    const inn = sum(["deposit_received"]), outt = sum(["withdrawn", "bill_paid", "agent_action", "paid"]);
    if (inWeek.length) {
      push({
        id: `weekly_summary:${iso(monday).slice(0, 10)}`, type: "weekly_summary", at: iso(monday), title: "Last week in brief",
        data: {
          from: iso(from).slice(0, 10), to: iso(monday - DAY_MS).slice(0, 10),
          money_in: money(inn.usdc + inn.usdt, "usdc+usdt"), money_out: money(outt.usdc + outt.usdt, "usdc+usdt"),
          payments_in: inWeek.filter((a) => a.kind === "deposit_received").length, spend_now: spend ? money(total(spend.balances), "usdc+usdt") : null,
        },
        suggested_actions: [],
      });
    }
  }

  // Autopilot rules the owner turned on.
  if (ap.top_up_bills.on && latestDeposit) {
    const sa = billShortfalls(ov, nowMs).map((s) => moveFromSpend(ov, policy, s.pot, s.token, s.short,
      `Autopilot: top ${potName(s.pot)} up to this month's bills (${formatAmount(s.need.toString())} ${s.token.toUpperCase()}).`, nowMs, "top_up_bills")).filter(Boolean) as SuggestedAction[];
    if (sa.length) push({ id: `autopilot_due:top_up_bills:${latestDeposit.seq}`, type: "autopilot_due", at: iso(nsMs(latestDeposit.at)), title: "Autopilot: top up Bills", data: { rule: "top_up_bills" }, suggested_actions: sa });
  }
  if (ap.sweep_spend.on && ap.sweep_spend.to_pot !== null && spend) {
    const to = pot(ap.sweep_spend.to_pot);
    const today = dayStart(nowMs);
    const back = (new Date(today).getUTCDay() - ap.sweep_spend.weekday + 7) % 7;
    const day = today - back * DAY_MS;
    if (to && to.kind !== "flex") {
      const sa: SuggestedAction[] = [];
      for (const t of TOKENS) {
        const extra = BigInt(spend.balances[t]) - BigInt(ap.sweep_spend.above);
        if (extra <= 0n) continue;
        const action: AgentAction = { type: "save", to_pot: to.id, token: t, amount: extra.toString() };
        sa.push({ kind: chooseKind(policy, action, extra, nowMs), action, autopilot: "sweep_spend", reason: `Autopilot: move what Spend holds above ${formatAmount(ap.sweep_spend.above)} ${t.toUpperCase()} into ${to.name}.` });
      }
      if (sa.length) push({ id: `autopilot_due:sweep_spend:${iso(day).slice(0, 10)}`, type: "autopilot_due", at: iso(day), title: `Autopilot: sweep Spend into ${to.name}`, data: { rule: "sweep_spend" }, suggested_actions: sa });
    }
  }

  return out.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/** `since` is a cursor from a previous response (ISO time or unix ms). Events strictly after it, oldest first. */
export function eventsSince(events: OikoEvent[], since: string | undefined): { events: OikoEvent[]; cursor: string } {
  let t = -Infinity;
  if (since) t = /^\d+$/.test(since) ? Number(since) : Date.parse(since);
  if (Number.isNaN(t)) t = -Infinity;
  const evs = events.filter((e) => Date.parse(e.at) > t);
  const last = evs.at(-1)?.at ?? (Number.isFinite(t) ? iso(t) : events.at(-1)?.at ?? iso(0));
  return { events: evs, cursor: last };
}

/** Plain-English problem with autopilot settings, or null. */
export function validateAutopilot(a: AutopilotSettings, ov: Overview): string | null {
  if (a.sweep_spend.on) {
    const p = a.sweep_spend.to_pot === null ? undefined : ov.pots.find((x) => x.id === a.sweep_spend.to_pot);
    if (!p || p.kind === "flex") return "Pick the pot that Spend should sweep into.";
    if (!/^\d{1,39}$/.test(a.sweep_spend.above)) return "The amount to keep in Spend must be a number.";
    if (!Number.isInteger(a.sweep_spend.weekday) || a.sweep_spend.weekday < 0 || a.sweep_spend.weekday > 6) return "Pick a day of the week.";
  }
  if (a.spend_floor !== null && !/^\d{1,39}$/.test(a.spend_floor)) return "The Spend floor must be a number.";
  return null;
}
