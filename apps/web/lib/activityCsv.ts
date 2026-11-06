// One activity CSV for Activity and Settings. Accountant-friendly: one row per event, ISO date and UTC time in their own
// columns, money in positive and money out negative, the payer's route fee in its own column, plain-English description.
import type { Activity, AgentView, Pot } from "@oiko/sdk";
import { fromUnits } from "@oiko/sdk";
import { describeActivity } from "@/components/app/describe";
import { potName } from "@/components/app/potmeta";
import type { TFn } from "./i18n";
import { nsToMs } from "./format";
import { matchReceipt, type Receipt } from "./receipts";

const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function activityCsv(items: Activity[], pots: Pot[], agents: AgentView[], receipts: Receipt[], t: TFn): string {
  const rows = [["date", "time_utc", "type", "description", "details", "amount", "fee", "ticker", "pot", "counterparty", "by"].join(",")];
  for (const a of items) {
    if (a.kind === "split_applied") continue;
    const d = describeActivity(a, pots, agents, t);
    const iso = new Date(nsToMs(a.at)).toISOString();
    const amount = a.amount ? fromUnits(a.amount) : "";
    const signed = amount && d.direction === "out" ? `-${amount}` : amount;
    const rc = a.kind === "deposit_received" ? matchReceipt(receipts, { amount: a.amount, token: a.token, atMs: d.atMs }) : null;
    const pot = pots.find((p) => p.id === a.pot_id);
    rows.push([iso.slice(0, 10), iso.slice(11, 19), d.direction === "internal" ? "transfer" : d.direction, esc(d.title), esc(d.subtitle), signed,
      rc && BigInt(rc.fee) > 0n ? fromUnits(rc.fee) : "", a.token?.toUpperCase() ?? "", esc(pot ? potName(pot, t) : ""), esc(a.counterparty ?? ""), esc(a.by)].join(","));
  }
  return rows.join("\n") + "\n";
}

