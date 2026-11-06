// Non-money changes an agent can propose (plan, pots, goals, locks, Earn, bills, schedules, draft invoices).
// They are stored off-chain and carried out by the owner's app key when the owner approves, so no contract change
// is needed. Pure helpers: callers pass `now`. The server validates with these; the app executes `changeCalls`.
import { formatAmount } from "./amounts";
import type { Overview, Pot, SplitRule, Token } from "./types";

export type ChangeType =
  | "set_splits" | "create_pot" | "update_pot" | "lock" | "earn" | "add_bill" | "remove_bill" | "add_schedule" | "remove_schedule" | "draft_invoice";

export type ConfigChange =
  | { type: "set_splits"; rules: SplitRule[] }
  | { type: "create_pot"; name: string; kind: "autosave" | "goal" | "bills"; target: string | null; target_date: string | null }
  | { type: "update_pot"; pot_id: number; name?: string; target?: string | null; target_date?: string | null }
  /** Locks a pot until the date, or extends its lock. A lock can never be shortened. */
  | { type: "lock"; pot_id: number; unlock_at: string }
  /** Turns Earn on (supplies the pot's whole balance) or off (withdraws what is earning). */
  | { type: "earn"; pot_id: number; on: boolean }
  | { type: "add_bill"; name: string; amount: string; token: Token; due_day: number; payee: string; pot_id: number }
  | { type: "remove_bill"; bill_id: number }
  | { type: "add_schedule"; to_pot: number; token: Token; amount: string; every_days: number; first_run: string }
  | { type: "remove_schedule"; schedule_id: number }
  | {
      type: "draft_invoice"; client: { name: string; email?: string | null };
      items: Array<{ description: string; quantity: string; unitPrice: string }>; token: Token; due_date: string; note?: string | null;
    };

export const CHANGE_TYPES: readonly ChangeType[] = [
  "set_splits", "create_pot", "update_pot", "lock", "earn", "add_bill", "remove_bill", "add_schedule", "remove_schedule", "draft_invoice",
];

const DAY_MS = 86_400_000;
const FLEX_ID = 0;
const MAX_POTS = 20, MAX_SPLITS = 20, MAX_BILLS = 30, MAX_SCHEDULES = 20;
const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNITS_RE = /^\d{1,39}$/;

/** yyyy-mm-dd (UTC midnight) → nanoseconds string. */
export function dateToNs(date: string): string {
  return (BigInt(Date.parse(`${date}T00:00:00Z`)) * 1_000_000n).toString();
}
const nsToMs = (ns: string) => Number(BigInt(ns) / 1_000_000n);
const isDate = (d: string) => DATE_RE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const potOf = (ov: Overview, id: number) => ov.pots.find((p) => p.id === id);
const potLabel = (p: Pot | undefined, id: number) => (p ? (p.kind === "flex" ? "Spend" : p.name) : `pot ${id}`);
const show = (units: string, token?: Token) => `${formatAmount(units)}${token ? ` ${token.toUpperCase()}` : ""}`;
const pct = (bps: string) => `${Number(bps) / 100}%`;
const isLockedNow = (p: Pot, nowMs: number) => !!p.unlock_at && nsToMs(p.unlock_at) > nowMs;

/** Plain-English problem with the change against the current account, or null when it can be carried out. */
export function validateChange(c: ConfigChange, ov: Overview, nowMs: number): string | null {
  switch (c.type) {
    case "set_splits": {
      if (c.rules.length > MAX_SPLITS) return `A plan can have at most ${MAX_SPLITS} rules.`;
      let bps = 0n;
      const seen = new Set<number>();
      for (const r of c.rules) {
        const p = potOf(ov, r.pot_id);
        if (!p) return `There is no pot with id ${r.pot_id}.`;
        if (p.id === FLEX_ID || p.kind === "flex") return "Spend gets whatever is left; leave it out of the plan rules.";
        if (seen.has(r.pot_id)) return `${potLabel(p, r.pot_id)} appears twice in the plan.`;
        seen.add(r.pot_id);
        if (!UNITS_RE.test(r.value) || BigInt(r.value) === 0n) return "Every rule needs a value above zero.";
        if (r.mode === "percent") bps += BigInt(r.value);
        else if (r.mode !== "fixed") return "A rule's mode must be percent or fixed.";
      }
      if (bps > 10_000n) return `The plan adds up to ${pct(bps.toString())}; it must be 100% or less.`;
      return null;
    }
    case "create_pot": {
      if (!c.name.trim() || c.name.trim().length > 32) return "A pot name must be 1 to 32 characters.";
      if (ov.pots.length >= MAX_POTS) return `The account already has ${MAX_POTS} pots, the most allowed.`;
      if (!["autosave", "goal", "bills"].includes(c.kind)) return "A new pot must be a Savings, Goal or Bills pot.";
      if (c.target !== null && (!UNITS_RE.test(c.target) || BigInt(c.target) === 0n)) return "A goal target must be an amount above zero.";
      if (c.target_date !== null && (!isDate(c.target_date) || Date.parse(c.target_date) <= nowMs)) return "A goal date must be a future date (yyyy-mm-dd).";
      return null;
    }
    case "update_pot": {
      const p = potOf(ov, c.pot_id);
      if (!p) return `There is no pot with id ${c.pot_id}.`;
      if (c.name === undefined && c.target === undefined && c.target_date === undefined) return "Say what to change: name, target or target_date.";
      if (c.name !== undefined && (!c.name.trim() || c.name.trim().length > 32)) return "A pot name must be 1 to 32 characters.";
      if (p.kind === "flex" && c.name !== undefined) return "Spend can't be renamed.";
      if (c.target != null && (!UNITS_RE.test(c.target) || BigInt(c.target) === 0n)) return "A goal target must be an amount above zero.";
      if (c.target_date != null && (!isDate(c.target_date) || Date.parse(c.target_date) <= nowMs)) return "A goal date must be a future date (yyyy-mm-dd).";
      return null;
    }
    case "lock": {
      const p = potOf(ov, c.pot_id);
      if (!p) return `There is no pot with id ${c.pot_id}.`;
      if (p.kind === "flex") return "Spend can't be locked.";
      if (!isDate(c.unlock_at)) return "unlock_at must be a date (yyyy-mm-dd).";
      const at = Date.parse(`${c.unlock_at}T00:00:00Z`);
      if (at <= nowMs) return "The unlock date must be in the future.";
      if (at - nowMs > 10 * 365 * DAY_MS) return "The unlock date must be within 10 years.";
      if (p.unlock_at && isLockedNow(p, nowMs) && BigInt(dateToNs(c.unlock_at)) < BigInt(p.unlock_at)) {
        return `${p.name} is locked until ${new Date(nsToMs(p.unlock_at)).toISOString().slice(0, 10)}; a lock can only be extended, never shortened.`;
      }
      return null;
    }
    case "earn": {
      const p = potOf(ov, c.pot_id);
      if (!p) return `There is no pot with id ${c.pot_id}.`;
      if (p.kind === "flex") return "Spend can't earn. Propose moving money to another pot first.";
      if (!ov.config.lending) return "Earn isn't available on this account.";
      if (c.on && BigInt(p.balances.usdc) + BigInt(p.balances.usdt) === 0n) return `${p.name} is empty, so there is nothing to put into Earn.`;
      if (!c.on && BigInt(p.earn_supplied.usdc) + BigInt(p.earn_supplied.usdt) === 0n) return `Nothing in ${p.name} is earning.`;
      return null;
    }
    case "add_bill": {
      if (ov.bills.length >= MAX_BILLS) return `The account already has ${MAX_BILLS} bills, the most allowed.`;
      if (!c.name.trim() || c.name.trim().length > 40) return "A bill name must be 1 to 40 characters.";
      if (!UNITS_RE.test(c.amount) || BigInt(c.amount) === 0n) return "A bill amount must be above zero.";
      if (!Number.isInteger(c.due_day) || c.due_day < 1 || c.due_day > 28) return "due_day must be 1 to 28.";
      if (!ACCOUNT_RE.test(c.payee) || c.payee.length < 2 || c.payee.length > 64) return "payee must be a NEAR account id.";
      if (!potOf(ov, c.pot_id)) return `There is no pot with id ${c.pot_id}.`;
      return null;
    }
    case "remove_bill":
      return ov.bills.some((b) => b.id === c.bill_id) ? null : `There is no bill with id ${c.bill_id}.`;
    case "add_schedule": {
      if (ov.schedules.length >= MAX_SCHEDULES) return `The account already has ${MAX_SCHEDULES} schedules, the most allowed.`;
      const p = potOf(ov, c.to_pot);
      if (!p) return `There is no pot with id ${c.to_pot}.`;
      if (p.kind === "flex") return "A schedule saves from Spend into another pot; pick a pot other than Spend.";
      if (!UNITS_RE.test(c.amount) || BigInt(c.amount) === 0n) return "The amount must be above zero.";
      if (![1, 7, 14, 30].includes(c.every_days)) return "every_days must be 1, 7, 14 or 30.";
      if (!isDate(c.first_run) || Date.parse(`${c.first_run}T00:00:00Z`) + DAY_MS <= nowMs) return "first_run must be today or a future date (yyyy-mm-dd).";
      return null;
    }
    case "remove_schedule":
      return ov.schedules.some((s) => s.id === c.schedule_id) ? null : `There is no schedule with id ${c.schedule_id}.`;
    case "draft_invoice": {
      if (!c.client.name.trim()) return "The invoice needs the client's name.";
      if (c.items.length < 1 || c.items.length > 50) return "An invoice needs 1 to 50 lines.";
      for (const i of c.items) {
        if (!i.description.trim()) return "Every invoice line needs a description.";
        if (!/^\d{1,9}(\.\d{1,4})?$/.test(i.quantity) || Number(i.quantity) <= 0) return "Every quantity must be a number above zero.";
        if (!UNITS_RE.test(i.unitPrice) || BigInt(i.unitPrice) === 0n) return "Every price must be an amount above zero.";
      }
      if (!isDate(c.due_date)) return "due_date must be a date (yyyy-mm-dd).";
      return null;
    }
  }
}

export interface ChangeCall { method: string; args: unknown[] }

/** The owner-key vault calls (VaultClient method names) that carry out a change. draft_invoice has none: the server saves it. */
export function changeCalls(c: ConfigChange, ov: Overview, nowMs: number): ChangeCall[] {
  switch (c.type) {
    case "set_splits": return [{ method: "setSplits", args: [c.rules] }];
    case "create_pot": {
      const look = c.kind === "bills" ? { icon: "bill", color: "sun" } : c.kind === "goal" ? { icon: "goal", color: "rose" } : { icon: "savings", color: "mint" };
      return [{ method: "createPot", args: [{ name: c.name.trim(), ...look, kind: c.kind, target: c.target, target_date: c.target_date ? dateToNs(c.target_date) : null }] }];
    }
    case "update_pot": {
      const patch: Record<string, unknown> = {};
      if (c.name !== undefined) patch.name = c.name.trim();
      if (c.target !== undefined) patch.target = c.target;
      if (c.target_date !== undefined) patch.target_date = c.target_date ? dateToNs(c.target_date) : null;
      return [{ method: "updatePot", args: [c.pot_id, patch] }];
    }
    case "lock": {
      const p = potOf(ov, c.pot_id);
      return [{ method: p && isLockedNow(p, nowMs) ? "extendLock" : "lock", args: [c.pot_id, dateToNs(c.unlock_at)] }];
    }
    case "earn": {
      const p = potOf(ov, c.pot_id);
      if (!p) return [];
      const src = c.on ? p.balances : p.earn_supplied;
      return (["usdc", "usdt"] as const).filter((t) => BigInt(src[t]) > 0n).map((t) => ({ method: c.on ? "earnOn" : "earnOff", args: [c.pot_id, t, src[t]] }));
    }
    case "add_bill": return [{ method: "addBill", args: [{ name: c.name.trim(), amount: c.amount, token: c.token, due_day: c.due_day, payee: c.payee, pot_id: c.pot_id }] }];
    case "remove_bill": return [{ method: "removeBill", args: [c.bill_id] }];
    case "add_schedule": {
      const period = (BigInt(c.every_days) * BigInt(DAY_MS) * 1_000_000n).toString();
      const first = BigInt(Math.max(Date.parse(`${c.first_run}T00:00:00Z`), nowMs + 60_000)) * 1_000_000n;
      return [{ method: "addSchedule", args: [c.to_pot, c.token, c.amount, period, first.toString()] }];
    }
    case "remove_schedule": return [{ method: "removeSchedule", args: [c.schedule_id] }];
    case "draft_invoice": return [];
  }
}

/** One plain sentence the owner reads on the approval card. */
export function describeChange(c: ConfigChange, ov: Overview): string {
  const name = (id: number) => potLabel(potOf(ov, id), id);
  switch (c.type) {
    case "set_splits": {
      const parts = c.rules.map((r) => `${name(r.pot_id)} ${r.mode === "percent" ? pct(r.value) : show(r.value)}`);
      const bps = c.rules.filter((r) => r.mode === "percent").reduce((s, r) => s + Number(r.value), 0);
      return `Change your plan to: ${[...parts, `Spend gets the rest${bps < 10_000 && c.rules.every((r) => r.mode === "percent") ? ` (${(10_000 - bps) / 100}%)` : ""}`].join(", ")}.`;
    }
    case "create_pot": {
      const kind = c.kind === "bills" ? "Bills" : c.kind === "goal" ? "Goal" : "Savings";
      return `Create a ${kind} pot "${c.name.trim()}"${c.target ? ` with a target of ${show(c.target)}` : ""}${c.target_date ? ` by ${c.target_date}` : ""}.`;
    }
    case "update_pot": {
      const bits: string[] = [];
      if (c.name !== undefined) bits.push(`rename it to "${c.name.trim()}"`);
      if (c.target !== undefined) bits.push(c.target ? `set its target to ${show(c.target)}` : "remove its target");
      if (c.target_date !== undefined) bits.push(c.target_date ? `set its date to ${c.target_date}` : "remove its date");
      return `${name(c.pot_id)}: ${bits.join(", ")}.`;
    }
    case "lock": {
      const p = potOf(ov, c.pot_id);
      return p && p.unlock_at ? `Keep ${name(c.pot_id)} locked until ${c.unlock_at}.` : `Lock ${name(c.pot_id)} until ${c.unlock_at}. Money can't leave it before then.`;
    }
    case "earn": return c.on ? `Turn on Earn for ${name(c.pot_id)}. Rates vary and can go to zero.` : `Turn off Earn for ${name(c.pot_id)} and bring the money back into the pot.`;
    case "add_bill": return `Add a bill: ${c.name.trim()}, ${show(c.amount, c.token)} to ${c.payee} on day ${c.due_day} of each month, paid from ${name(c.pot_id)}.`;
    case "remove_bill": {
      const b = ov.bills.find((x) => x.id === c.bill_id);
      return `Remove the bill ${b ? `"${b.name}"` : `#${c.bill_id}`}.`;
    }
    case "add_schedule": {
      const every = c.every_days === 1 ? "every day" : c.every_days === 7 ? "every week" : c.every_days === 14 ? "every two weeks" : "every 30 days";
      return `Save ${show(c.amount, c.token)} from Spend into ${name(c.to_pot)} ${every}, starting ${c.first_run}.`;
    }
    case "remove_schedule": return `Stop the savings schedule #${c.schedule_id}.`;
    case "draft_invoice": {
      // Same rounding as the invoice itself: quantity scaled by 10^4, half up to the nearest base unit.
      const total = c.items.reduce((s, i) => {
        const [w, f = ""] = i.quantity.split(".");
        const q = BigInt(w || "0") * 10_000n + BigInt(f.padEnd(4, "0").slice(0, 4));
        return s + (q * BigInt(i.unitPrice) + 5_000n) / 10_000n;
      }, 0n);
      return `Draft an invoice to ${c.client.name.trim()} for ${show(total.toString(), c.token)}, due ${c.due_date}. You review it before sending.`;
    }
  }
}
