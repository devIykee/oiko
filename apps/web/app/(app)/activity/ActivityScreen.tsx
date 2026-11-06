"use client";
import { Button, SegmentedControl, useToast } from "@oiko/ui";
import { useState } from "react";
import { ActivityList } from "@/components/app/ActivityList";
import { PageHeader } from "@/components/app/PageHeader";
import { LoadError, PageSkeleton } from "@/components/app/States";
import { describeActivity } from "@/components/app/describe";
import { useActivity, useOverview, useReceipts } from "@/lib/data";
import { activityCsv } from "@/lib/activityCsv";
import { downloadText } from "@/components/app/download";
import { useSession } from "@/lib/session";
import { useT } from "@/lib/i18n";

type Filter = "all" | "in" | "out" | "agents";

export function ActivityScreen() {
  const t = useT();
  const ov = useOverview();
  const act = useActivity(200);
  const toast = useToast();
  const { session } = useSession();
  const receipts = useReceipts().data?.receipts ?? [];
  const [f, setF] = useState<Filter>("all");
  const o = ov.data;
  if ((act.error && !act.data) || (ov.error && !o)) return <div className="oi-col oi-page"><PageHeader title={t("nav.activity")} /><LoadError error={act.error ?? ov.error} onRetry={act.refresh} /></div>;
  if (!act.data || !o) return <div className="oi-col"><PageSkeleton rows={6} /></div>;
  const items = act.data.filter((a) => {
    if (f === "all") return true;
    if (f === "agents") return a.by.startsWith("agent:") || a.by.startsWith("proposal:") || a.kind.startsWith("agent_");
    const d = describeActivity(a, o.pots, o.agents, t);
    return d.direction === f;
  });
  return (
    <div className="oi-col oi-page" data-testid="activity">
      <PageHeader title={t("nav.activity")} sub={t("activityPage.sub")}
        action={<Button size="sm" variant="secondary" icon="export" data-testid="activity-export"
          onClick={() => { downloadText(`oiko-${session?.name ?? "account"}-activity.csv`, activityCsv(act.data ?? [], o.pots, o.agents, receipts, t), "text/csv;charset=utf-8"); toast.show({ message: t("activityPage.exported") }); }}>{t("activityPage.export")}</Button>} />
      <SegmentedControl label={t("activityPage.filter")} value={f} onChange={setF}
        items={[{ value: "all", label: t("activityPage.all") }, { value: "in", label: t("activityPage.in") }, { value: "out", label: t("activityPage.out") }, { value: "agents", label: t("nav.agents") }]} />
      <ActivityList items={items} pots={o.pots} agents={o.agents} />
    </div>
  );
}
