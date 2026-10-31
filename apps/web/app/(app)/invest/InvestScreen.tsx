"use client";
import { Badge, EmptyState, GroupedList, ListRow, RiskNote } from "@oiko/ui";
import { PageHeader } from "@/components/app/PageHeader";
import { PageSkeleton } from "@/components/app/States";
import { useConfig } from "@/lib/config";
import { useT } from "@/lib/i18n";

/** Behind FEATURE_INVEST (/api/config features.invest). XAUT only; US stocks coming soon. */
export function InvestScreen() {
  const t = useT();
  const { config, loading } = useConfig();
  if (loading) return <div className="oi-col"><PageSkeleton rows={2} /></div>;
  if (!config?.features.invest) return <div className="oi-col oi-page"><PageHeader title={t("nav.invest")} back="/more" /><EmptyState icon="invest" title={t("invest.offTitle")} body={t("invest.offBody")} /></div>;
  return (
    <div className="oi-col oi-page" data-testid="invest">
      <PageHeader title={t("nav.invest")} back="/more" />
      <GroupedList label={t("nav.invest")}>
        <ListRow icon="invest" color="sun" title={t("invest.gold")} subtitle={t("invest.goldSub")} trailing={<Badge tone="warning">{t("invest.soon")}</Badge>} />
        <ListRow icon="insights" color="stone" title={t("invest.stocks")} subtitle={t("invest.stocksSub")} trailing={<Badge>{t("invest.soon")}</Badge>} />
      </GroupedList>
      <RiskNote title={t("earn.riskTitle")} points={[t("invest.risk1"), t("invest.risk2")]} />
    </div>
  );
}
