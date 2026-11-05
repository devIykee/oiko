"use client";
import { ActivityRow, EmptyState, GroupedList } from "@oiko/ui";
import type { Activity, AgentView, Pot } from "@oiko/sdk";
import { useEffect, useState } from "react";
import { fmtDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { describeActivity, isMoneyActivity } from "./describe";

/** Plain-English activity rows with who did it. New incoming rows flash once (1.2 s). */
export function ActivityList({ items, pots, agents, explorerTx, limit, moneyOnly, emptyTitle, emptyBody }: { items: Activity[]; pots: Pot[]; agents: AgentView[]; explorerTx?: (h: string) => string; limit?: number; moneyOnly?: boolean; emptyTitle?: string; emptyBody?: string }) {
  const t = useT();
  // Highest seq seen on first load; anything newer that arrives while the screen is open flashes once.
  const [firstSeen, setFirstSeen] = useState<number | null>(null);
  const maxSeq = items.reduce((m, a) => Math.max(m, a.seq), 0);
  useEffect(() => { if (firstSeen === null && items.length) setFirstSeen(maxSeq); }, [firstSeen, items.length, maxSeq]);
  const rows = items.filter((a) => a.kind !== "split_applied" && (!moneyOnly || isMoneyActivity(a))).slice(0, limit ?? items.length);
  if (!rows.length) return <div className="oi-card"><EmptyState icon="activity" title={emptyTitle ?? t("activity.emptyTitle")} body={emptyBody ?? t("activity.emptyBody")} /></div>;
  void explorerTx;
  return (
    <GroupedList label={t("nav.activity")} data-testid="activity-list">
      {rows.map((a) => {
        const d = describeActivity(a, pots, agents, t);
        return (
          <ActivityRow key={a.seq} token={d.amount ? a.token : null} icon={d.icon} color={d.color} title={d.title} direction={d.direction} amount={d.amount}
            subtitle={[d.subtitle, fmtDateTime(d.atMs)].filter(Boolean).join(" · ")}
            flash={firstSeen !== null && a.seq > firstSeen && d.direction === "in"} testId={`activity-${a.seq}`} />
        );
      })}
    </GroupedList>
  );
}
