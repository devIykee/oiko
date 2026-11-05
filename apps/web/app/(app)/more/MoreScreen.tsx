"use client";
import { GroupedList, ListRow } from "@oiko/ui";
import Link from "next/link";
import { PageHeader } from "@/components/app/PageHeader";
import { useConfig } from "@/lib/config";
import { useT } from "@/lib/i18n";

export function MoreScreen() {
  const t = useT();
  const { config } = useConfig();
  return (
    <div className="oi-col oi-page" data-testid="more">
      <PageHeader title={t("nav.more")} />
      <GroupedList label={t("nav.more")}>
        <ListRow as={Link} href="/receive" icon="payLink" color="blue" title={t("receive.title")} subtitle={t("more.receiveSub")} chevron />
        <ListRow as={Link} href="/withdraw" icon="withdraw" color="stone" title={t("home.withdraw")} subtitle={t("more.withdrawSub")} chevron />
        <ListRow as={Link} href="/move" icon="move" color="blue" title={t("home.move")} subtitle={t("more.moveSub")} chevron />
      </GroupedList>
      <GroupedList label={t("nav.more")}>
        <ListRow as={Link} href="/bills" icon="bills" color="sun" title={t("nav.bills")} subtitle={t("more.billsSub")} chevron />
        <ListRow as={Link} href="/insights" icon="insights" color="violet" title={t("nav.insights")} subtitle={t("more.insightsSub")} chevron />
        <ListRow as={Link} href="/activity" icon="activity" color="stone" title={t("nav.activity")} subtitle={t("more.activitySub")} chevron />
        {config?.features.earn !== false && <ListRow as={Link} href="/pots/earn" icon="earn" color="mint" title={t("pot.earnTitle")} subtitle={t("more.earnSub")} chevron />}
        {config?.features.ajo !== false && <ListRow as={Link} href="/rosca" icon="ajo" color="rose" title={t("nav.rosca")} subtitle={t("more.roscaSub")} chevron />}
        {config?.features.invest && <ListRow as={Link} href="/invest" icon="invest" color="sun" title={t("nav.invest")} chevron />}
      </GroupedList>
      <GroupedList label={t("nav.settings")}>
        <ListRow as={Link} href="/settings" icon="settings" color="stone" title={t("nav.settings")} chevron />
        <ListRow as="a" href="/security" icon="security" color="mint" title={t("more.security")} subtitle={t("more.securitySub")} chevron />
      </GroupedList>
    </div>
  );
}
