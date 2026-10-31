"use client";
import { SegmentedControl } from "@oiko/ui";
import { useState } from "react";
import { ActivityList } from "@/components/app/ActivityList";
import { PageHeader } from "@/components/app/PageHeader";
import { LoadError, PageSkeleton } from "@/components/app/States";
import { describeActivity } from "@/components/app/describe";
import { useActivity, useOverview } from "@/lib/data";
import { useT } from "@/lib/i18n";

type Filter = "all" | "in" | "out" | "agents";

export function ActivityScreen() {
  const t = useT();
  const ov = useOverview();
  const act = useActivity(200);
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
      <PageHeader title={t("nav.activity")} sub={t("activityPage.sub")} />
      <SegmentedControl label={t("activityPage.filter")} value={f} onChange={setF}
        items={[{ value: "all", label: t("activityPage.all") }, { value: "in", label: t("activityPage.in") }, { value: "out", label: t("activityPage.out") }, { value: "agents", label: t("nav.agents") }]} />
      <ActivityList items={items} pots={o.pots} agents={o.agents} />
    </div>
  );
}
