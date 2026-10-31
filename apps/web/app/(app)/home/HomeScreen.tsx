"use client";
import { Avatar, Badge, BalanceHeader, IconButton, ProposalCard, RoundAction, SectionTitle, VaultCard } from "@oiko/ui";
import type { Proposal } from "@oiko/sdk";
import Link from "next/link";
import { useState } from "react";
import { ActivityList } from "@/components/app/ActivityList";
import { ConfirmSheet } from "@/components/app/ConfirmSheet";
import { MoveSheet } from "@/components/app/MoveSheet";
import { LoadError, PageSkeleton } from "@/components/app/States";
import { actionSentence } from "@/components/app/describe";
import { isLocked, potColor, potGlyph, potName } from "@/components/app/potmeta";
import { useMoney } from "@/lib/actions";
import { useConfig } from "@/lib/config";
import { useActivity, useOverview } from "@/lib/data";
import { fmt, fmtDate, fmtTotal, nsToMs, total } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useSettings } from "@/lib/settings";

export function HomeScreen() {
  const t = useT();
  const { session } = useSession();
  const { settings, set } = useSettings();
  const { oiko } = useConfig();
  const ov = useOverview();
  const act = useActivity(20);
  const { exec } = useMoney();
  const [moveOpen, setMoveOpen] = useState(false);
  const [pending, setPending] = useState<{ p: Proposal; kind: "approve" | "reject" } | null>(null);

  if (ov.error && !ov.data) return <div className="oi-col oi-page"><LoadError error={ov.error} onRetry={ov.refresh} /></div>;
  if (!ov.data) return <div className="oi-col"><PageSkeleton balance rows={3} /></div>;
  const o = ov.data;
  const hidden = settings.hideBalance;

  return (
    <div className="oi-col oi-page" data-testid="home">
      <div className="oi-row" style={{ paddingTop: 12 }}>
        <Link href="/settings" aria-label={t("nav.settings")} style={{ borderRadius: "50%" }}>
          <Avatar name={session?.displayName ?? session?.name ?? "?"} size={36} />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{t("home.hello", { name: session?.displayName ?? "" })}</div>
          <div className="oi-small oi-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session?.accountId}</div>
        </div>
        <IconButton icon={hidden ? "show" : "hide"} label={hidden ? t("home.showBalance") : t("home.hideBalance")} onClick={() => set({ hideBalance: !hidden })} />
      </div>

      <BalanceHeader
        testId="balance"
        value={fmtTotal(o.totals)}
        hidden={hidden}
        label={t("home.balanceLabel")}
        breakdown={!hidden && (
          <>
            <Badge data-testid="balance-usdc">{fmt(o.totals.usdc)} USDC</Badge>
            <Badge data-testid="balance-usdt">{fmt(o.totals.usdt)} USDT</Badge>
          </>
        )}
      />

      <div className="oi-actions" role="group" aria-label={t("home.actions")}>
        <RoundAction icon="receive" label={t("home.receive")} href="/receive" as={Link} primary data-testid="action-receive" />
        <RoundAction icon="withdraw" label={t("home.withdraw")} href="/withdraw" as={Link} data-testid="action-withdraw" />
        <RoundAction icon="move" label={t("home.move")} onClick={() => setMoveOpen(true)} data-testid="action-move" />
        <RoundAction icon="moreAction" label={t("nav.more")} href="/more" as={Link} />
      </div>

      <div className="oi-summary-chips" aria-label={t("home.summary")}>
        <div className="oi-summary-chip" data-testid="chip-spend"><span>{t("home.spendNow")}</span><span>{hidden ? "••" : fmtTotal(o.flex)}</span></div>
        <div className="oi-summary-chip" data-testid="chip-locked"><span>{t("common.locked")}</span><span>{hidden ? "••" : fmtTotal(o.locked)}</span></div>
        <div className="oi-summary-chip" data-testid="chip-earning"><span>{t("common.earning")}</span><span>{hidden ? "••" : fmtTotal(o.earning)}</span></div>
      </div>

      {o.proposals.length > 0 && (
        <section aria-labelledby="waiting">
          <SectionTitle id="waiting">{t("home.waiting")}</SectionTitle>
          <div className="oi-stack-sm">
            {o.proposals.map((p) => (
              <ProposalCard key={p.id} testId={`proposal-${p.id}`} agentName={p.agent_name} agentLabel={t("home.proposalLabel")}
                sentence={actionSentence(p.action, o.pots, o.bills, t)} reason={p.reason}
                approveLabel={t("home.approve")} rejectLabel={t("home.reject")}
                onApprove={() => setPending({ p, kind: "approve" })} onReject={() => setPending({ p, kind: "reject" })} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="pots-title">
        <SectionTitle id="pots-title" action={<Link href="/pots">{t("common.seeAll")}</Link>}>{t("nav.pots")}</SectionTitle>
        <div className="oi-pots oi-pots--3">
          {o.pots.map((p) => {
            const locked = isLocked(p);
            const target = p.target ? BigInt(p.target) : null;
            const have = total(p.balances) + total(p.earn_supplied);
            return (
              <VaultCard key={p.id} id={p.id} href={`/pots/${p.id}`} as={Link} testId={`pot-card-${p.id}`}
                name={potName(p, t)} icon={potGlyph(p)} color={potColor(p)}
                amount={hidden ? "••" : fmt(have)} ticker={hidden ? undefined : t("common.usdcUsdt")}
                badge={locked ? <Badge icon="lock">{t("common.locked")}</Badge> : p.earn ? <Badge tone="success">{t("common.earning")}</Badge> : undefined}
                progress={target ? { value: Number(have), max: Number(target), label: t("pots.goalProgress") } : undefined}
                meta={locked ? t("common.lockedUntil", { date: fmtDate(nsToMs(p.unlock_at)) }) : target ? t("pots.ofTarget", { target: fmt(target) }) : undefined} />
            );
          })}
        </div>
      </section>

      <section aria-labelledby="recent">
        <SectionTitle id="recent" action={<Link href="/activity">{t("common.seeAll")}</Link>}>{t("home.recent")}</SectionTitle>
        {act.data ? <ActivityList items={act.data} pots={o.pots} agents={o.agents} limit={5} explorerTx={oiko?.explorerTx} /> : <PageSkeleton rows={2} />}
      </section>

      <MoveSheet open={moveOpen} onOpenChange={setMoveOpen} overview={o} />
      {pending && (
        <ConfirmSheet
          open={!!pending}
          onOpenChange={(v) => { if (!v) setPending(null); }}
          testId="proposal-confirm"
          title={pending.kind === "approve" ? t("home.approveTitle") : t("home.rejectTitle")}
          sentence={pending.kind === "approve"
            ? t("home.approveSentence", { action: actionSentence(pending.p.action, o.pots, o.bills, t), agent: pending.p.agent_name })
            : t("home.rejectSentence", { agent: pending.p.agent_name })}
          confirmLabel={pending.kind === "approve" ? t("home.approve") : t("home.reject")}
          variant={pending.kind === "approve" ? "black" : "danger"}
          successText={pending.kind === "approve" ? t("home.approved") : t("home.rejected")}
          onConfirm={() => (pending.kind === "approve" ? exec("approveProposal", pending.p.id) : exec("rejectProposal", pending.p.id))}
        />
      )}
    </div>
  );
}
