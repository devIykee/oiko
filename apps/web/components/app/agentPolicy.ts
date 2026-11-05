import { defaultCaps, plainToUnits, type AgentKind, type AgentPolicyInput, type AgentView, type Bill, type Recipient, type Scope } from "@oiko/sdk";
import type { TFn } from "@/lib/i18n";
import { fmt, msToNs } from "@/lib/format";

export type TemplateId = "coach" | "bills" | "autopilot" | "custom";
export interface Draft {
  template: TemplateId;
  name: string;
  url: string;
  scopes: Scope[];
  actions: AgentKind[];
  allowlist: string[];
  perTx: string; // human units
  daily: string;
  weekly: string;
  days: number;
}

export function templateDraft(id: TemplateId, bills: Bill[], t: TFn): Draft {
  switch (id) {
    case "coach":
      return { template: id, name: t("agents.tpl.coach"), url: "", scopes: ["read", "propose"], actions: ["save", "move_between_pots", "pay"], allowlist: [], perTx: "0", daily: "0", weekly: "0", days: 30 };
    case "bills":
      // Caps come from the one shared source (@oiko/sdk defaultCaps): biggest bill / bills total + 10%, whole amounts.
      return { template: id, name: t("agents.tpl.bills"), url: "", scopes: ["read", "propose", "act"], actions: ["pay"], allowlist: [...new Set(bills.map((b) => b.payee))],
        ...defaultCaps("bills", bills.map((b) => b.amount)), days: 30 };
    case "autopilot":
      return { template: id, name: t("agents.tpl.autopilot"), url: "", scopes: ["read", "propose", "act"], actions: ["move_between_pots", "save"], allowlist: [], ...defaultCaps("autopilot"), days: 30 };
    default:
      // Custom starts read-only; if the owner adds "act", the caps fields are prefilled with the shared defaults.
      return { template: id, name: "", url: "", scopes: ["read"], actions: [], allowlist: [], ...defaultCaps("custom"), days: 30 };
  }
}

const toU = (h: string) => plainToUnits(h);

export function draftToPolicy(d: Draft, nowMs = Date.now()): AgentPolicyInput {
  const act = d.scopes.includes("act");
  return {
    label: d.name.trim() || "Agent",
    agent_name: d.name.trim() || "Agent",
    agent_url: d.url.trim(),
    scopes: d.scopes,
    allowed_actions: d.actions,
    allowlist: d.allowlist.filter(Boolean).map((a): Recipient => ({ type: "near", account_id: a.trim() })),
    per_tx: act ? toU(d.perTx) : "0",
    daily: act ? toU(d.daily) : "0",
    weekly: act ? toU(d.weekly) : "0",
    expires_at: msToNs(nowMs + Math.min(90, d.days) * 86_400_000),
  };
}

/** Plain-words consent: what the agent can and cannot do. */
export function consentItems(p: Pick<AgentPolicyInput, "scopes" | "allowed_actions" | "allowlist" | "per_tx" | "daily" | "weekly">, t: TFn) {
  const can = (s: Scope) => p.scopes.includes(s);
  const acts = p.allowed_actions;
  const items: Array<{ allowed: boolean; text: string }> = [];
  items.push({ allowed: can("read"), text: t("consent.read") });
  items.push({ allowed: can("propose"), text: t("consent.propose") });
  if (can("act")) {
    if (acts.includes("pay")) items.push({ allowed: true, text: p.allowlist.length ? t("consent.payList", { list: p.allowlist.map((r) => (r.type === "near" ? r.account_id : r.address)).join(", ") }) : t("consent.payNone") });
    if (acts.includes("move_between_pots")) items.push({ allowed: true, text: t("consent.move") });
    if (acts.includes("save")) items.push({ allowed: true, text: t("consent.save") });
    items.push({ allowed: true, text: t("consent.caps", { perTx: fmt(p.per_tx), daily: fmt(p.daily), weekly: fmt(p.weekly) }) });
  } else {
    items.push({ allowed: false, text: t("consent.noAct") });
  }
  items.push({ allowed: false, text: t("consent.noLocks") });
  items.push({ allowed: false, text: t("consent.noWithdraw") });
  items.push({ allowed: false, text: t("consent.noKeys") });
  return items;
}

export function capUsage(a: AgentView, nowMs = Date.now()) {
  const day = Math.floor(nowMs / 86_400_000);
  const week = Math.floor(nowMs / 604_800_000);
  const usedDay = a.spent_day[0] === day ? BigInt(a.spent_day[1]) : 0n;
  const usedWeek = a.spent_week[0] === week ? BigInt(a.spent_week[1]) : 0n;
  return { usedDay, usedWeek, daily: BigInt(a.daily), weekly: BigInt(a.weekly) };
}
