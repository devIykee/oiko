"use client";
import { Avatar, Button, GroupedList, Input, ListRow, SectionTitle, SegmentedControl, Toggle, useToast } from "@oiko/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { describeActivity } from "@/components/app/describe";
import { useConfig } from "@/lib/config";
import { useActivity, useOverview } from "@/lib/data";
import { nsToMs } from "@/lib/format";
import { fromUnits } from "@oiko/sdk";
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
  const [name, setName] = useState(session?.displayName ?? "");
  const loadedName = session?.displayName;
  useEffect(() => { if (loadedName) setName((n) => n || loadedName); }, [loadedName]);
  if (!session) return null;

  const exportCsv = () => {
    if (!act.data || !ov.data) return;
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const rows = [["time", "what", "details", "amount", "ticker", "by"].join(",")];
    for (const a of act.data) {
      const d = describeActivity(a, ov.data.pots, ov.data.agents, t);
      rows.push([new Date(nsToMs(a.at)).toISOString(), esc(d.title), esc(d.subtitle), a.amount ? fromUnits(a.amount) : "", a.token?.toUpperCase() ?? "", esc(a.by)].join(","));
    }
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const el = document.createElement("a");
    el.href = url; el.download = `oiko-${session.name}-activity.csv`; el.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="oi-col oi-page" data-testid="settings">
      <PageHeader title={t("nav.settings")} />
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
            trailing={<div style={{ width: 172, flex: "none" }}><SegmentedControl label={t("settings.theme")} value={settings.theme} onChange={(v: Theme) => set({ theme: v })}
              items={[{ value: "auto", label: t("settings.auto") }, { value: "light", label: t("settings.light") }, { value: "dark", label: t("settings.dark") }]} /></div>} />
          <ListRow icon="internet" color="sun" title={t("settings.lowData")} subtitle={t("settings.lowDataSub")}
            trailing={<Toggle checked={settings.lowData} onChange={(v) => set({ lowData: v })} label={t("settings.lowData")} data-testid="toggle-lowdata" />} />
        </GroupedList>
      </section>

      <section aria-labelledby="security">
        <SectionTitle id="security">{t("settings.security")}</SectionTitle>
        <GroupedList label={t("settings.security")}>
          <ListRow icon="shield" color="mint" title={t(`settings.method.${session.method}`)} subtitle={t(`settings.methodSub.${session.method}`)} />
          <ListRow icon="security" color="stone" title={t("settings.recovery")} subtitle={t("settings.recoverySub")} />
          <ListRow icon="export" color="blue" title={t("settings.export")} subtitle={t("settings.exportSub")} onClick={exportCsv} chevron />
        </GroupedList>
      </section>

      {config && config.network !== "mainnet" && <p className="oi-small oi-muted" style={{ margin: 0 }}>{t("settings.testNote")}</p>}
      <Button variant="danger-soft" block onClick={() => { signOut(); router.push("/start"); }}>{t("common.signOut")}</Button>
      {session.method !== "passkey" && <p className="oi-micro oi-muted" style={{ margin: 0 }}>{t("settings.signOutWarn")}</p>}
    </div>
  );
}
