"use client";
import { Button, EmptyState, Note, SuccessCheck } from "@oiko/ui";
import type { AgentKind, Scope } from "@oiko/sdk";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { ConnectFlow } from "@/components/app/ConnectFlow";
import type { Draft } from "@/components/app/agentPolicy";
import { useOverview } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";

/**
 * Agent-initiated consent. The agent generates its own key and opens:
 *   /connect?name=<agent name>&url=<agent site>&pk=ed25519:<public key>&scopes=read,propose,act&actions=pay,save,move_between_pots
 *            &allow=a.near,b.near&per_tx=20&daily=50&weekly=200&days=30&callback=<https url>
 * The owner reviews in plain words and approves; Oiko adds the key with these limits. No secret is shown.
 */
function withAccount(url: string, id: string) {
  const u = new URL(url);
  u.searchParams.set("vault", id);
  return u.toString();
}

export function ConnectScreen() {
  const t = useT();
  const sp = useSearchParams();
  const router = useRouter();
  const { status, session } = useSession();
  const ov = useOverview();
  const [open, setOpen] = useState(true);
  const [done, setDone] = useState(false);
  const pk = sp.get("pk") ?? "";
  const validPk = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(pk);
  const callback = sp.get("callback");
  const safeCallback = callback && /^https:\/\//.test(callback) ? callback : null;

  const draft = useMemo<Draft>(() => {
    const list = (k: string) => (sp.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const scopes = list("scopes").filter((s): s is Scope => ["read", "propose", "act"].includes(s));
    const actions = list("actions").filter((s): s is AgentKind => ["pay", "move_between_pots", "save"].includes(s));
    return {
      template: "custom", name: (sp.get("name") ?? "").slice(0, 40) || t("connect.unnamed"), url: sp.get("url") ?? "",
      scopes: scopes.length ? scopes : ["read"], actions, allowlist: list("allow"),
      perTx: sp.get("per_tx") ?? "0", daily: sp.get("daily") ?? "0", weekly: sp.get("weekly") ?? "0",
      days: Math.min(90, Math.max(1, Number(sp.get("days")) || 30)),
    };
  }, [sp, t]);

  return (
    <div className="oi-public__col" data-testid="connect">
      <header className="oi-row" style={{ minHeight: 44 }}><Link href="/" aria-label="Oiko" style={{ color: "var(--ink)" }}><Logo variant="wordmark" height={22} /></Link></header>
      {validPk && <h1 className="oi-h1">{t("connect.title", { name: draft.name })}</h1>}
      {validPk && <Note tone="warning" title={t("agents.verifyTitle")}>{t("connect.warn", { url: draft.url || t("connect.noUrl") })}</Note>}
      {!validPk ? <div className="oi-card"><EmptyState icon="warning" title={t("connect.badLink")} body={t("connect.badLinkBody")} /></div>
        : status === "signed-out" ? (
          <EmptyState icon="person" title={t("common.signedOutTitle")} body={t("connect.signIn")} action={<Button onClick={() => router.push("/start")}>{t("common.signIn")}</Button>} />
        ) : done ? (
          <div className="oi-card oi-stack" style={{ alignItems: "center", textAlign: "center" }}>
            <SuccessCheck />
            <p style={{ margin: 0, fontWeight: 600 }}>{t("connect.done", { name: draft.name })}</p>
            {safeCallback && session && <a className="oi-btn" href={withAccount(safeCallback, session.vaultId)}>{t("connect.return")}</a>}
            <Link className="oi-btn oi-btn--secondary" href="/agents">{t("connect.manage")}</Link>
          </div>
        ) : ov.data ? (
          <>
            <Button block size="lg" onClick={() => setOpen(true)}>{t("connect.review")}</Button>
            <ConnectFlow open={open} onOpenChange={setOpen} initial={draft} overview={ov.data} agentPublicKey={pk} onDone={() => setDone(true)} />
          </>
        ) : null}
    </div>
  );
}
