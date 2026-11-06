"use client";
import { OlderVersionBanner } from "@/components/app/OlderVersionBanner";
import { Avatar, Button, GroupedList, Input, ListRow, SectionTitle, SegmentedControl, Toggle, useToast } from "@oiko/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { MoveDeviceSheet } from "@/components/app/MoveDeviceSheet";
import { activityCsv } from "@/lib/activityCsv";
import { downloadText } from "@/components/app/download";
import { useConfig } from "@/lib/config";
import { useActivity, useOverview, useReceipts } from "@/lib/data";
import { downloadInvoicesCsv } from "@/lib/invoices";
import { explain } from "@/lib/actions";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useSettings, type Theme } from "@/lib/settings";

export function SettingsScreen() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const { session, update, signOut } = useSession();
  const { settings, set } = useSettings();
  const { config } = useConfig();
  const ov = useOverview();
  const act = useActivity(200);
  const receipts = useReceipts().data?.receipts ?? [];
  const [moving, setMoving] = useState(false);
  const [name, setName] = useState(session?.displayName ?? "");
  const loadedName = session?.displayName;
  useEffect(() => { if (loadedName) setName((n) => n || loadedName); }, [loadedName]);
  if (!session) return null;

  const exportCsv = () => {
    if (!act.data || !ov.data) return;
    downloadText(`oiko-${session.name}-activity.csv`, activityCsv(act.data, ov.data.pots, ov.data.agents, receipts, t), "text/csv;charset=utf-8");
  };

  return (
    <div className="oi-col oi-page" data-testid="settings">
      <PageHeader title={t("nav.settings")} />
      <OlderVersionBanner />
      <section className="oi-card oi-stack-sm" aria-labelledby="profile">
        <div className="oi-row">
          <Avatar name={name || session.name} size={56} />
          <div style={{ minWidth: 0 }}>
            <div id="profile" style={{ fontWeight: 700, fontSize: 18 }}>{session.displayName}</div>
            <div className="oi-small oi-muted">{session.accountId}</div>
          </div>
        </div>
        <Input label={t("settings.displayName")} value={name} placeholder={session.displayName} onChange={(e) => setName(e.target.value.slice(0, 40))}
          suffix={name !== session.displayName && name.trim() ? <Button size="sm" onClick={() => { update({ displayName: name.trim() }); toast.show({ message: t("toast.saved") }); }}>{t("common.save")}</Button> : undefined} />
        <p className="oi-micro oi-muted" style={{ margin: 0 }}>{t("settings.displayNameHint")}</p>
      </section>

      <section aria-labelledby="prefs">
        <SectionTitle id="prefs">{t("settings.prefs")}</SectionTitle>
        <GroupedList label={t("settings.prefs")}>
          <ListRow icon="dark" color="violet" title={t("settings.theme")}
            trailing={<div className="oi-seg--compact" style={{ width: 150, flex: "none" }}><SegmentedControl label={t("settings.theme")} value={settings.theme} onChange={(v: Theme) => set({ theme: v })}
              items={[{ value: "auto", label: t("settings.auto") }, { value: "light", label: t("settings.light") }, { value: "dark", label: t("settings.dark") }]} /></div>} />
          <ListRow icon="internet" color="sun" title={t("settings.lowData")} subtitle={t("settings.lowDataSub")}
            trailing={<Toggle checked={settings.lowData} onChange={(v) => set({ lowData: v })} label={t("settings.lowData")} data-testid="toggle-lowdata" />} />
        </GroupedList>
      </section>

      {(config?.features.earn !== undefined) && (
        <section aria-labelledby="features">
          <SectionTitle id="features">{t("settings.features")}</SectionTitle>
          <GroupedList label={t("settings.features")}>
            <ListRow icon="earn" color="mint" title={t("settings.showEarn")} subtitle={t("settings.showEarnSub")}
              trailing={<Toggle checked={settings.showEarn} onChange={(v) => set({ showEarn: v })} label={t("settings.showEarn")} data-testid="toggle-earn" />} />
            <ListRow icon="invest" color="sun" title={t("settings.showInvest")} subtitle={t("settings.showInvestSub")}
              trailing={<Toggle checked={settings.showInvest} onChange={(v) => set({ showInvest: v })} label={t("settings.showInvest")} data-testid="toggle-invest" />} />
          </GroupedList>
        </section>
      )}

      <section aria-labelledby="security">
        <SectionTitle id="security">{t("settings.security")}</SectionTitle>
        <GroupedList label={t("settings.security")}>
          <ListRow icon="shield" color="mint" title={t(`settings.method.${session.method}`)} subtitle={t(`settings.methodSub.${session.method}`)} />
          <ListRow icon="security" color="stone" title={t("settings.recovery")} subtitle={t("settings.recoverySub")} />
          {session.method !== "demo" && <ListRow icon="send" color="violet" title={t("settings.move")} subtitle={t("settings.moveSub")} onClick={() => setMoving(true)} chevron data-testid="settings-move" />}
          <ListRow icon="export" color="blue" title={t("settings.export")} subtitle={t("settings.exportSub")} onClick={exportCsv} chevron />
          <ListRow icon="export" color="blue" title={t("settings.exportInvoices")} subtitle={t("settings.exportInvoicesSub")} chevron data-testid="settings-export-invoices"
            onClick={() => { downloadInvoicesCsv(session).then(() => toast.show({ message: t("inv.exported") }), (e) => { const f = explain(e); toast.show({ message: `${f.title} ${f.next}` }); }); }} />
        </GroupedList>
      </section>

      {config && config.network !== "mainnet" && <p className="oi-small oi-muted" style={{ margin: 0 }}>{t("settings.testNote")}</p>}
      <Button variant="danger-soft" block onClick={() => { signOut(); router.push("/start"); }}>{t("common.signOut")}</Button>
      {session.method !== "passkey" && <p className="oi-micro oi-muted" style={{ margin: 0 }}>{t("settings.signOutWarn")}</p>}
      <MoveDeviceSheet open={moving} onOpenChange={setMoving} />
    </div>
  );
}
