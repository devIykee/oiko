"use client";
import { AgentAccessLog, AgentCard, Badge, Button, CopyField, EmptyState, GroupedList, ListRow, ProposalCard, ScopeList, SectionTitle, useToast } from "@oiko/ui";
import type { AgentView, Overview, Proposal } from "@oiko/sdk";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ConfirmSheet } from "@/components/app/ConfirmSheet";
import { ConnectFlow } from "@/components/app/ConnectFlow";
import { CounterpartyBadge } from "@/components/app/CounterpartyBadge";
import { PageHeader } from "@/components/app/PageHeader";
import { LoadError, PageSkeleton } from "@/components/app/States";
import { capUsage, consentItems, templateDraft, type Draft, type TemplateId } from "@/components/app/agentPolicy";
import { actionSentence } from "@/components/app/describe";
import { explain, useMoney } from "@/lib/actions";
import { useConfig } from "@/lib/config";
import { useAgentLog, useOverview } from "@/lib/data";
import { fmt, fmtDate, fmtDateTime, nsToMs, shortKey } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";


export function AgentsScreen() {
  const t = useT();
  const ov = useOverview();
  const sp = useSearchParams();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);

  // Deep link from Bills: "Let my agent pay this".
  useEffect(() => {
    if (!ov.data || draft) return;
    const tpl = sp.get("template");
    if (tpl === "bill-payer") {
      const billId = Number(sp.get("bill"));
      const bills = ov.data.bills.filter((b) => !sp.get("bill") || b.id === billId);
      setDraft(templateDraft("bills", bills, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ov.data, sp]);

  if (ov.error && !ov.data) return <div className="oi-col oi-page"><LoadError error={ov.error} onRetry={ov.refresh} /></div>;
  if (!ov.data) return <div className="oi-col"><PageSkeleton rows={4} /></div>;
  const o = ov.data;
  const agents = o.agents.filter((a) => !a.revoked);

  const templates: Array<{ id: TemplateId; icon: "insights" | "bills" | "savings" | "settings"; color: "blue" | "sun" | "mint" | "stone" }> = [
    { id: "coach", icon: "insights", color: "blue" },
    { id: "bills", icon: "bills", color: "sun" },
    { id: "autopilot", icon: "savings", color: "mint" },
    { id: "custom", icon: "settings", color: "stone" },
  ];

  return (
    <div className="oi-col oi-page" data-testid="agents">
      <PageHeader title={t("nav.agents")} />
      <div>
        <h2 className="oi-h1" style={{ fontSize: 26 }}>{t("agents.headline")}</h2>
        <p className="oi-muted oi-pretty" style={{ margin: "8px 0 0" }}>{t("agents.intro")}</p>
      </div>

      <section aria-labelledby="connected" className="oi-stack-sm">
        <SectionTitle id="connected">{t("agents.connected")}</SectionTitle>
        {agents.length === 0 ? (
          <div className="oi-card"><EmptyState icon="agents" color="violet" title={t("agents.emptyTitle")} body={t("agents.emptyBody")} /></div>
        ) : agents.map((a) => <ConnectedAgent key={a.public_key} a={a} o={o} />)}
      </section>

      <section aria-labelledby="connect-new">
        <SectionTitle id="connect-new">{t("agents.connectNew")}</SectionTitle>
        <GroupedList label={t("agents.connectNew")}>
          {templates.map((tp) => (
            <ListRow key={tp.id} icon={tp.icon} color={tp.color} chevron onClick={() => setDraft(templateDraft(tp.id, o.bills, t))} data-testid={`agent-template-${tp.id}`}
              title={t(`agents.tpl.${tp.id}`)} subtitle={t(`agents.tpl.${tp.id}Sub`)} />
          ))}
        </GroupedList>
      </section>

      <section aria-labelledby="hosted" className="oi-card oi-stack-sm" data-testid="hosted-section">
        <h2 id="hosted" className="oi-h2" style={{ fontSize: 16 }}>{t("agents.hostedSection")}</h2>
        <ol className="oi-small oi-muted" style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 4 }}>
          <li>{t("agents.hostedSteps1")}</li><li>{t("agents.hostedSteps2")}</li><li>{t("agents.hostedSteps3")}</li>
        </ol>
        <Button variant="secondary" onClick={() => setDraft(templateDraft("coach", o.bills, t))} data-testid="hosted-start">{t("agents.hostedStart")}</Button>
      </section>

      <section aria-labelledby="dev" className="oi-card oi-stack-sm">
        <h2 id="dev" className="oi-h2" style={{ fontSize: 16 }}>{t("agents.devTitle")}</h2>
        <p className="oi-small oi-muted" style={{ margin: 0 }}>{t("agents.devBody")}</p>
        <CopyField label={t("agents.mcpInstall")} value="npx -y oiko-mcp" copyLabel={t("common.copy")} copiedLabel={t("common.copied")} />
        <CopyField label={t("agents.mcpHttp")} value={`${origin}/api/mcp`} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} />
        <CopyField label={t("agents.connectLink")} value={`${origin}/connect?name=My%20agent&pk=ed25519:…&scopes=read,propose`} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} />
        <p className="oi-small" style={{ margin: 0 }}><a className="oi-dark-accent-link" href="/llms.txt">llms.txt</a> · <a className="oi-dark-accent-link" href="/.well-known/oiko-agent.json">oiko-agent.json</a></p>
      </section>

      {draft && <ConnectFlow open={!!draft} onOpenChange={(v) => !v && setDraft(null)} initial={draft} overview={o} />}
    </div>
  );
}

function ConnectedAgent({ a, o }: { a: AgentView; o: Overview }) {
  const t = useT();
  const toast = useToast();
  const { exec } = useMoney();
  const { oiko } = useConfig();
  const [showLog, setShowLog] = useState(false);
  const [pending, setPending] = useState<{ p: Proposal; kind: "approve" | "reject" } | null>(null);
  const log = useAgentLog(showLog ? a.public_key : null);
  const u = capUsage(a);
  const act = a.scopes.includes("act");
  const expired = nsToMs(a.expires_at) < Date.now();
  const proposals = o.proposals.filter((p) => p.public_key === a.public_key);
  const { session } = useSession();
  const items = useMemo(() => consentItems(a, t).filter((i) => i.allowed), [a, t]);

  // Disconnect asks first, then shows a clear success state with the key-deleted transaction.
  const [confirmOff, setConfirmOff] = useState(false);
  const disconnect = () => setConfirmOff(true);

  return (
    <AgentCard
      testId={`agent-card-${shortKey(a.public_key)}`}
      name={a.agent_name}
      subtitle={t("agents.cardSub", { scopes: a.scopes.map((s) => t(`agents.scope.${s}`)).join(" · "), date: fmtDate(nsToMs(a.expires_at)) })}
      status={expired ? <Badge tone="danger">{t("agents.expired")}</Badge> : <Badge tone="success">{t("agents.active")}</Badge>}
      caps={act ? [
        { label: t("agents.today"), used: Number(u.usedDay), cap: Number(u.daily), text: t("agents.capText", { used: fmt(u.usedDay), cap: fmt(u.daily) }) },
        { label: t("agents.thisWeek"), used: Number(u.usedWeek), cap: Number(u.weekly), text: t("agents.capText", { used: fmt(u.usedWeek), cap: fmt(u.weekly) }) },
      ] : []}
      onDisconnect={disconnect}
      disconnecting={confirmOff}
      disconnectLabel={t("agents.disconnect")}
    >
      <ScopeList label={t("agents.permissions")} items={items} />
      {proposals.map((p) => {
        const bill = p.action.type === "pay_bill" ? o.bills.find((b) => p.action.type === "pay_bill" && b.id === p.action.bill_id) : undefined;
        const payee = p.action.type === "pay" ? p.action.to : bill?.payee;
        const amount = p.action.type === "pay" ? p.action.amount : bill?.amount;
        return (
          <div key={p.id} style={{ display: "grid", gap: 6 }}>
            <ProposalCard testId={`proposal-${p.id}`} agentName={a.agent_name} sentence={actionSentence(p.action, o.pots, o.bills, t)} reason={p.reason}
              approveLabel={t("home.approve")} rejectLabel={t("home.reject")} onApprove={() => setPending({ p, kind: "approve" })} onReject={() => setPending({ p, kind: "reject" })} />
            {payee && <CounterpartyBadge accountId={payee} vault={session?.vaultId ?? null} amount={amount} testId={`proposal-${p.id}-counterparty`} />}
          </div>
        );
      })}
      <button type="button" className="oi-btn oi-btn--secondary oi-btn--sm" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog} style={{ alignSelf: "flex-start" }}>
        {showLog ? t("agents.hideLog") : t("agents.showLog")}
      </button>
      {showLog && (
        log.error ? <p className="oi-small oi-muted" style={{ margin: 0 }}>{explain(log.error).title}</p> : (
          <AgentAccessLog label={t("agents.log")} empty={log.data ? t("agents.logEmpty") : t("common.loading")}
            rows={(log.data ?? []).map((r) => ({
              at: r.at, atLabel: fmtDateTime(Date.parse(r.at)),
              text: r.summary ?? `${r.tool ?? r.path}${r.status && r.status >= 400 ? ` · ${t("agents.refused")}` : ""}`,
              detail: r.code ?? undefined,
            }))} />
        )
      )}
      {pending && (
        <ConfirmSheet open onOpenChange={(v) => { if (!v) setPending(null); }}
          title={pending.kind === "approve" ? t("home.approveTitle") : t("home.rejectTitle")}
          sentence={pending.kind === "approve" ? t("home.approveSentence", { action: actionSentence(pending.p.action, o.pots, o.bills, t), agent: a.agent_name }) : t("home.rejectSentence", { agent: a.agent_name })}
          confirmLabel={pending.kind === "approve" ? t("home.approve") : t("home.reject")} variant={pending.kind === "approve" ? "black" : "danger"}
          successText={pending.kind === "approve" ? t("home.approved") : t("home.rejected")}
          onConfirm={() => (pending.kind === "approve" ? exec("approveProposal", pending.p.id) : exec("rejectProposal", pending.p.id))} />
      )}
      {confirmOff && (
        <ConfirmSheet open onOpenChange={(v) => { if (!v) setConfirmOff(false); }} testId="agent-disconnect" variant="danger" stayOpen
          title={t("agents.disconnectTitle", { name: a.agent_name })}
          sentence={t("agents.disconnectSentence", { name: a.agent_name })}
          confirmLabel={t("agents.disconnect")}
          successText={t("agents.disconnectedTitle")}
          onConfirm={() => exec("revokeAgent", a.public_key)}
          doneDetails={(r) => (
            <>
              <p className="oi-small oi-muted" style={{ margin: 0 }}>{t("agents.disconnected", { name: a.agent_name })}</p>
              {r && r.txHash && oiko?.explorerTx && (
                <a className="oi-small" href={oiko.explorerTx(r.txHash)} target="_blank" rel="noreferrer" data-testid="agent-disconnect-tx">{t("agents.keyDeletedTx")}</a>
              )}
            </>
          )} />
      )}
    </AgentCard>
  );
}
