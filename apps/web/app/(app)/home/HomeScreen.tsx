"use client";
import { OlderVersionBanner } from "@/components/app/OlderVersionBanner";
import { Avatar, Badge, BalanceHeader, IconButton, ProposalCard, RoundAction, SectionTitle, TokenLogo, WalletStack } from "@oiko/ui";
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
import { useChanges, useDecideChange, type ChangeView } from "@/lib/owner";
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
  const { exec, execOptional } = useMoney();
  const changes = useChanges();
  const decide = useDecideChange();
  const [moveOpen, setMoveOpen] = useState(false);
  const [pending, setPending] = useState<{ p: Proposal; kind: "approve" | "reject" } | null>(null);
  const [pendingChange, setPendingChange] = useState<{ c: ChangeView; kind: "approve" | "reject" } | null>(null);
  const openChanges = (changes.data ?? []).filter((c) => c.status === "pending");

  /** Approve = run the change with the app key (one call per step), then record it with the tx hashes. */
  const runChange = async (c: ChangeView) => {
    const hashes: string[] = [];
    let last;
    for (const call of c.calls) {
      last = await execOptional(call.method, ...call.args);
      hashes.push(last.txHash);
    }
    await decide(c.id, "approve", hashes);
    return last;
  };

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

      <OlderVersionBanner />

      {/* 1. Money block: balance, coin breakdown, actions and the three summary numbers, nested in one card. */}
      <section className="oi-home-hero" aria-label={t("home.balanceLabel")}>
        <BalanceHeader
          testId="balance"
          value={fmtTotal(o.totals)}
          hidden={hidden}
          label={t("home.balanceLabel")}
          breakdown={!hidden && (
            <>
              <Badge className="oi-badge--coin" data-testid="balance-usdc"><TokenLogo token="usdc" size={16} />{fmt(o.totals.usdc)} USDC</Badge>
              <Badge className="oi-badge--coin" data-testid="balance-usdt"><TokenLogo token="usdt" size={16} />{fmt(o.totals.usdt)} USDT</Badge>
            </>
          )}
        />
        <div className="oi-actions" role="group" aria-label={t("home.actions")}>
          <RoundAction icon="receive" label={t("home.receive")} href="/receive" as={Link} primary data-testid="action-receive" />
          <RoundAction icon="withdraw" label={t("home.withdraw")} href="/withdraw" as={Link} data-testid="action-withdraw" />
          <RoundAction icon="move" label={t("home.move")} onClick={() => setMoveOpen(true)} data-testid="action-move" />
          <RoundAction icon="moreAction" label={t("nav.more")} href="/more" as={Link} />
        </div>
        <div className="oi-summary-chips oi-summary-chips--inset" aria-label={t("home.summary")}>
          <div className="oi-summary-chip" data-testid="chip-spend"><span>{t("home.spendNow")}</span><span>{hidden ? "••" : fmtTotal(o.flex)}</span></div>
          <div className="oi-summary-chip" data-testid="chip-locked"><span>{t("common.locked")}</span><span>{hidden ? "••" : fmtTotal(o.locked)}</span></div>
          <div className="oi-summary-chip" data-testid="chip-earning"><span>{t("common.earning")}</span><span>{hidden ? "••" : fmtTotal(o.earning)}</span></div>
        </div>
      </section>

      {/* 2. Things that need you. */}
      {(o.proposals.length > 0 || openChanges.length > 0) && (
        <section aria-labelledby="waiting" className="oi-home-sec">
          <SectionTitle id="waiting">{t("home.waiting")}</SectionTitle>
          <div className="oi-stack-sm">
            {openChanges.map((c) => (
              <ProposalCard key={c.id} testId={`change-${c.id}`} agentName={c.agentName} agentLabel={t("home.changeLabel")}
                sentence={c.problem ? <>{c.summary} <span className="oi-muted">{t("home.changeProblem", { problem: c.problem })}</span></> : c.summary} reason={c.reason}
                approveLabel={t("home.approve")} rejectLabel={t("home.reject")}
                onApprove={() => { if (!c.problem) setPendingChange({ c, kind: "approve" }); }} onReject={() => setPendingChange({ c, kind: "reject" })} />
            ))}
            {o.proposals.map((p) => (
              <ProposalCard key={p.id} testId={`proposal-${p.id}`} agentName={p.agent_name} agentLabel={t("home.proposalLabel")}
                sentence={actionSentence(p.action, o.pots, o.bills, t)} reason={p.reason}
                approveLabel={t("home.approve")} rejectLabel={t("home.reject")}
                onApprove={() => setPending({ p, kind: "approve" })} onReject={() => setPending({ p, kind: "reject" })} />
            ))}
          </div>
        </section>
      )}

      {/* 3. Pots as a wallet stack. */}
      <section aria-labelledby="pots-title" className="oi-home-sec">
        <SectionTitle id="pots-title" action={<Link href="/pots">{t("common.seeAll")}</Link>}>{t("nav.pots")}</SectionTitle>
        <WalletStack testId="pot-stack" linkAs={Link} label={t("nav.pots")} expandLabel={t("home.stackExpand", { n: o.pots.length })} collapseLabel={t("home.stackCollapse")}
          items={o.pots.map((p) => {
            const locked = isLocked(p);
            const target = p.target ? BigInt(p.target) : null;
            const have = total(p.balances) + total(p.earn_supplied);
            return {
              id: p.id, href: `/pots/${p.id}`, testId: `pot-card-${p.id}`,
              name: potName(p, t), icon: potGlyph(p), color: potColor(p),
              amount: hidden ? "••" : fmt(have), ticker: hidden ? undefined : t("common.usdcUsdt"),
              badge: locked ? <Badge icon="lock">{t("common.locked")}</Badge> : p.earn ? <Badge tone="success">{t("common.earning")}</Badge> : undefined,
              progress: target ? { value: Number(have), max: Number(target), label: t("pots.goalProgress") } : undefined,
              meta: locked ? t("common.lockedUntil", { date: fmtDate(nsToMs(p.unlock_at)) }) : target ? t("pots.ofTarget", { target: fmt(target) }) : t(`pot.blurb.${p.kind}`),
            };
          })} />
      </section>

      {/* 4. Money in and out only; /activity keeps every kind. */}
      <section aria-labelledby="recent" className="oi-home-sec">
        <SectionTitle id="recent" action={<Link href="/activity">{t("common.seeAll")}</Link>}>{t("home.recent")}</SectionTitle>
        {act.data ? <ActivityList items={act.data} pots={o.pots} agents={o.agents} limit={5} moneyOnly explorerTx={oiko?.explorerTx}
          emptyTitle={t("home.recentEmptyTitle")} emptyBody={t("home.recentEmptyBody")} /> : <PageSkeleton rows={2} />}
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
      {pendingChange && (
        <ConfirmSheet
          open={!!pendingChange}
          onOpenChange={(v) => { if (!v) setPendingChange(null); }}
          testId="change-confirm"
          title={pendingChange.kind === "approve" ? t("home.approveTitle") : t("home.rejectTitle")}
          sentence={pendingChange.kind === "approve"
            ? t("home.changeApproveSentence", { summary: pendingChange.c.summary, agent: pendingChange.c.agentName })
            : t("home.changeRejectSentence", { agent: pendingChange.c.agentName })}
          confirmLabel={pendingChange.kind === "approve" ? t("home.approve") : t("home.reject")}
          variant={pendingChange.kind === "approve" ? "black" : "danger"}
          successText={pendingChange.kind === "approve" ? t("home.changeDone") : t("home.rejected")}
          onConfirm={async () => { if (pendingChange.kind === "approve") return runChange(pendingChange.c); await decide(pendingChange.c.id, "reject"); }}
        />
      )}
    </div>
  );
}
