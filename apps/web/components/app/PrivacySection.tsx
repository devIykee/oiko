"use client";
// Settings → Privacy: private labels (Veil). Names are encrypted in this browser with the view key derived from the
// owner key; the account's public record and Oiko's server only ever see the sealed form.
import { GroupedList, ListRow, SectionTitle, Toggle, useToast } from "@oiko/ui";
import { VaultClient, isSealed, viewKeyFingerprint, decodeViewKey } from "@oiko/sdk";
import { useState } from "react";
import { explain, useMoney } from "@/lib/actions";
import { useOverview } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { usePrivacy } from "@/lib/privacy";
import { useSession } from "@/lib/session";
import { useSettings } from "@/lib/settings";
import { invalidate } from "@/lib/query";
import { useConfig } from "@/lib/config";

export function PrivacySection() {
  const t = useT();
  const toast = useToast();
  const { session, unlockPrivacy } = useSession();
  const { settings, set } = useSettings();
  const { state, veil } = usePrivacy();
  const { exec } = useMoney();
  const ov = useOverview();
  const { rpc } = useConfig();
  const [busy, setBusy] = useState(false);
  if (!session) return null;

  const fail = (e: unknown) => { const f = explain(e); toast.show({ message: `${f.title} ${f.next}` }); };

  const unlock = async () => {
    setBusy(true);
    try { await unlockPrivacy(); invalidate(`vault:${session.vaultId}`); toast.show({ message: t("privacy.unlocked"), tone: "success" }); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };

  // Pots made before private labels (or while they were off) still have plain names on the record:
  // read the raw (unopened) names and re-save each plain one; the app's VaultClient seals it on the way out.
  const sealAll = async () => {
    if (!veil || !ov.data || !rpc) return;
    setBusy(true);
    try {
      const raw = await fetchRawPots();
      const plain = raw.filter((p) => p.kind !== "flex" && !isSealed(p.name));
      if (plain.length === 0) { toast.show({ message: t("privacy.sealAllNone") }); return; }
      for (const p of plain) await exec("updatePot", p.id, { name: p.name, icon: p.icon });
      toast.show({ message: t("privacy.sealAllDone", { n: plain.length }), tone: "success" });
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const fetchRawPots = async () => (await new VaultClient(rpc!, session.vaultId).overview()).pots;

  const copyKey = async () => {
    if (!session.viewKey) return;
    try { await navigator.clipboard.writeText(session.viewKey); toast.show({ message: t("common.copied"), tone: "success" }); } catch (e) { fail(e); }
  };
  const fp = session.viewKey ? viewKeyFingerprint(decodeViewKey(session.viewKey)) : "";

  return (
    <section aria-labelledby="privacy" data-testid="privacy-section">
      <SectionTitle id="privacy">{t("privacy.title")}</SectionTitle>
      <GroupedList label={t("privacy.title")}>
        {state === "locked" ? (
          <ListRow icon="unlock" color="sun" title={t("privacy.locked")} subtitle={t("privacy.lockedSub")} onClick={busy ? undefined : unlock} chevron data-testid="privacy-unlock" />
        ) : (
          <ListRow icon="lock" color="mint" title={t("privacy.labels")} subtitle={settings.privateLabels ? t("privacy.labelsSub") : t("privacy.labelsOff")}
            trailing={<Toggle checked={settings.privateLabels} onChange={(v) => set({ privateLabels: v })} label={t("privacy.labels")} data-testid="toggle-private-labels" />} />
        )}
        {state === "on" && (
          <ListRow icon="shield" color="violet" title={t("privacy.sealAll")} subtitle={t("privacy.sealAllSub")} onClick={busy ? undefined : sealAll} chevron data-testid="privacy-seal-all" />
        )}
        {session.viewKey && (
          <ListRow icon="copy" color="stone" title={t("privacy.key")} subtitle={t("privacy.keySub", { fp })} onClick={copyKey} chevron data-testid="privacy-copy-key" />
        )}
        <ListRow icon="show" color="blue" title={t("privacy.public")} subtitle={t("privacy.publicSub")} />
      </GroupedList>
    </section>
  );
}
