import type { Activity, AgentAction, AgentView, Bill, Pot, Token } from "@oiko/sdk";
import type { IconConcept, TileColor } from "@oiko/ui";
import type { TFn } from "@/lib/i18n";
import { fmtToken, nsToMs } from "@/lib/format";
import { potById, potName } from "./potmeta";

export function whoDidIt(by: string, agents: AgentView[], t: TFn): string {
  if (by === "owner") return t("common.who.you");
  if (by === "schedule") return t("common.who.schedule");
  if (by === "plan") return t("common.who.plan");
  if (by.startsWith("agent:")) {
    const pk = by.slice(6);
    return t("common.who.agent", { name: agents.find((a) => a.public_key === pk)?.agent_name ?? pk.slice(8, 14) });
  }
  if (by.startsWith("proposal:")) return t("common.who.proposal", { name: t("nav.agents") });
  return "";
}

const amt = (a: Activity) => (a.amount && a.token ? fmtToken(a.amount, a.token) : undefined);

/** Money that actually entered or left the account (Home "Recent transactions"). Moves between pots, locks, plan
 *  runs, Earn changes and agent housekeeping are not transactions; /activity still lists every kind. */
const MONEY_KINDS = new Set(["deposit_received", "withdrawn", "bill_paid", "invoice_paid", "rosca_payout", "rosca_contributed"]);
export function isMoneyActivity(a: Activity): boolean {
  if (!a.amount || BigInt(a.amount) === 0n) return false;
  if (MONEY_KINDS.has(a.kind)) return true;
  // An agent payment to someone outside the account (not a move/save between pots).
  return a.kind === "agent_action" && !!a.counterparty && !a.counterparty.startsWith("pot:") && a.note !== "move" && a.note !== "save";
}

export interface Described { title: string; subtitle: string; icon: IconConcept; color: TileColor; direction: "in" | "out" | "internal"; amount?: string; atMs: number }

export function describeActivity(a: Activity, pots: Pot[], agents: AgentView[], t: TFn): Described {
  const pot = potById(pots, a.pot_id);
  const pn = pot ? potName(pot, t) : "";
  const who = whoDidIt(a.by, agents, t);
  const base = { atMs: nsToMs(a.at), amount: amt(a) };
  const k = a.kind;
  const sub = (s: string) => [s, who].filter(Boolean).join(" · ");
  switch (k) {
    case "deposit_received":
      return { ...base, title: a.counterparty ? t("act.receivedFrom", { who: a.counterparty }) : t("act.received"), subtitle: sub(t("act.splitByPlan")), icon: "receive", color: "mint", direction: "in" };
    case "split_applied":
      return { ...base, title: t("act.planRan"), subtitle: t("act.planRanSub"), icon: "plan", color: "blue", direction: "internal", amount: undefined };
    case "moved": {
      const from = potById(pots, Number(a.counterparty?.replace("pot:", "")));
      return { ...base, title: t("act.moved", { from: from ? potName(from, t) : "", to: pn }), subtitle: sub(""), icon: "move", color: "blue", direction: "internal" };
    }
    case "withdrawn":
      return { ...base, title: t("act.sentTo", { who: a.counterparty ?? "" }), subtitle: sub(pn), icon: "withdraw", color: "stone", direction: "out" };
    case "bill_paid":
      return { ...base, title: t("act.billPaid", { name: a.note ?? a.counterparty ?? "" }), subtitle: sub(pn), icon: "bill", color: "sun", direction: "out" };
    case "agent_action":
      return { ...base, title: a.counterparty ? t("act.sentTo", { who: a.counterparty }) : t("act.agentMoved"), subtitle: sub(pn), icon: "agents", color: "violet", direction: a.counterparty ? "out" : "internal" };
    case "locked":
    case "lock_extended":
      return { ...base, title: t(k === "locked" ? "act.locked" : "act.lockExtended", { pot: pn }), subtitle: sub(""), icon: "lock", color: "violet", direction: "internal" };
    case "earn_supplied":
      return { ...base, title: t("act.earnOn", { pot: pn }), subtitle: sub(""), icon: "earn", color: "mint", direction: "internal" };
    case "earn_withdrawn":
      return { ...base, title: t("act.earnOff", { pot: pn }), subtitle: sub(""), icon: "earn", color: "mint", direction: "internal" };
    case "earn_refused":
      return { ...base, title: t("act.earnRefused"), subtitle: sub(""), icon: "warning", color: "sun", direction: "internal" };
    case "agent_added":
      return { ...base, title: t("act.agentAdded", { name: a.counterparty ?? "" }), subtitle: sub(""), icon: "agents", color: "violet", direction: "internal" };
    case "agent_revoked":
      return { ...base, title: t("act.agentRevoked", { name: a.counterparty ?? "" }), subtitle: sub(""), icon: "disconnect", color: "rose", direction: "internal" };
    case "agent_proposal":
      return { ...base, title: t("act.proposal"), subtitle: sub(a.note ?? ""), icon: "proposal", color: "sun", direction: "internal" };
    case "proposal_approved":
    case "proposal_rejected":
      return { ...base, title: t(k === "proposal_approved" ? "act.approved" : "act.rejected"), subtitle: sub(""), icon: "proposal", color: "sun", direction: "internal" };
    case "schedule_ran":
      return { ...base, title: t("act.scheduleRan", { pot: pn }), subtitle: sub(""), icon: "calendar", color: "blue", direction: "internal" };
    default:
      if (k.startsWith("ajo")) return { ...base, title: t("act.rosca"), subtitle: sub(a.note ?? ""), icon: "ajo", color: "rose", direction: a.kind.includes("payout") ? "in" : "out" };
      if (k.startsWith("pot_")) return { ...base, title: t("act.potChanged", { pot: pn || a.note || "" }), subtitle: sub(""), icon: "pots", color: "stone", direction: "internal" };
      if (k.startsWith("bill_")) return { ...base, title: t("act.billChanged", { name: a.note ?? "" }), subtitle: sub(""), icon: "bill", color: "stone", direction: "internal" };
      return { ...base, title: t("act.other"), subtitle: sub(""), icon: "info", color: "stone", direction: "internal" };
  }
}

/** One plain sentence describing an agent action (for proposals and consent). */
export function actionSentence(action: AgentAction, pots: Pot[], bills: Bill[], t: TFn): string {
  const pn = (id: number) => { const p = potById(pots, id); return p ? potName(p, t) : `#${id}`; };
  switch (action.type) {
    case "pay": return t("action.pay", { amount: fmtToken(action.amount, action.token), to: action.to });
    case "pay_bill": {
      const b = bills.find((x) => x.id === action.bill_id);
      return b ? t("action.payBill", { name: b.name, amount: fmtToken(b.amount, b.token), pot: pn(b.pot_id) }) : t("action.payBillUnknown");
    }
    case "move": return t("action.move", { amount: fmtToken(action.amount, action.token), from: pn(action.from_pot), to: pn(action.to_pot) });
    case "save": return t("action.save", { amount: fmtToken(action.amount, action.token), to: pn(action.to_pot) });
  }
}

export const tokenOf = (a: AgentAction): Token | null => ("token" in a ? a.token : null);
