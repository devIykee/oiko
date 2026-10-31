"use client";
import { AmountInput, Avatar, Badge, Button, CopyField, EmptyState, Input, Note, QRCodeCard, SelectList, StatusTimeline, SuccessCheck, Skeleton, Loading } from "@oiko/ui";
import { fromUnits, toUnits } from "@oiko/sdk";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { validAddress } from "@/lib/address";
import { api } from "@/lib/api";
import { explain } from "@/lib/actions";
import { useConfig } from "@/lib/config";
import { useIntentTokens, useNameInfo, type IntentGroup } from "@/lib/data";
import { useT } from "@/lib/i18n";

type Step = 1 | 2 | 3 | 4;
interface Deposit { ticket?: string; depositAddress: string; depositMemo?: string | null; amountIn: string; amountOut: string; fee: string; deadline: string; quoteId: string; destinationToken: string }
type Status = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "PROCESSING" | "SUCCESS" | "INCOMPLETE_DEPOSIT" | "REFUNDED" | "FAILED";
const DIRECT = "__direct__";

export function PayScreen() {
  const t = useT();
  const { name: raw } = useParams<{ name: string }>();
  const name = decodeURIComponent(raw).toLowerCase();
  const info = useNameInfo(name);
  const groups = useIntentTokens();
  const { config, isTestMode } = useConfig();
  const [step, setStep] = useState<Step>(1);
  const [group, setGroup] = useState<IntentGroup | null>(null);
  const [direct, setDirect] = useState(false);
  const [amount, setAmount] = useState("");
  const [refund, setRefund] = useState("");
  const [refundErr, setRefundErr] = useState<string | null>(null);
  const [dep, setDep] = useState<Deposit | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ title: string; next: string } | null>(null);
  const [status, setStatus] = useState<Status>("PENDING_DEPOSIT");
  const [now, setNow] = useState(Date.now());
  const [simulating, setSimulating] = useState(false);

  const symbol = direct ? "USDT" : group?.symbol ?? "USDT";
  const display = name.charAt(0).toUpperCase() + name.slice(1);

  // Poll the deposit status and run the countdown.
  useEffect(() => {
    if (step !== 4 || !dep) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    let stop = false;
    const poll = async () => {
      if (stop) return;
      try {
        const qs = new URLSearchParams({ ...(dep.depositMemo ? { memo: dep.depositMemo } : {}), ...(dep.ticket ? { ticket: dep.ticket } : {}) }).toString();
        const s = await api<{ status: Status }>(`/api/intents/status/${encodeURIComponent(dep.depositAddress)}${qs ? `?${qs}` : ""}`);
        setStatus(s.status);
        if (["SUCCESS", "REFUNDED", "FAILED"].includes(s.status)) { stop = true; return; }
      } catch { /* keep polling */ }
      setTimeout(poll, 3000);
    };
    void poll();
    return () => { stop = true; clearInterval(tick); };
  }, [step, dep]);

  if (info.error && !info.data) return <Frame><EmptyState icon="warning" title={t("pay.loadError")} body={explain(info.error).next} /></Frame>;
  if (!info.data) return <Frame><Loading label={t("common.loading")}><div className="oi-stack" style={{ alignItems: "center" }}><Skeleton width={72} height={72} radius={36} /><Skeleton width={180} height={24} /><Skeleton height={64} radius={20} /><Skeleton height={64} radius={20} /></div></Loading></Frame>;
  if (!info.data.exists) return <Frame><EmptyState icon="person" title={t("pay.noName", { name })} body={t("pay.noNameBody")} action={<Link className="oi-btn" href={`/start?name=${encodeURIComponent(name)}`}>{t("pay.claim", { name })}</Link>} /></Frame>;

  const recipient = info.data.accountId;
  const decimals = group?.decimals ?? 6;
  let units: string | null = null;
  try { units = amount && Number(amount) > 0 ? toUnits(amount, decimals) : null; } catch { units = null; }

  const getAddress = async () => {
    if (!group || !units) return;
    if (!validAddress(group.chain, refund)) { setRefundErr(t("pay.badRefund", { place: group.label })); return; }
    setBusy(true); setErr(null);
    try {
      const d = await api<Deposit>("/api/intents/deposit-address", { body: { name, originAsset: group.assetId, amount: units, refundTo: refund.trim() } });
      setDep(d); setStatus("PENDING_DEPOSIT"); setStep(4);
    } catch (e) { setErr(explain(e)); } finally { setBusy(false); }
  };

  const simulate = async () => {
    if (!dep) return;
    setSimulating(true);
    try {
      const r = await api<{ ticket?: string }>("/api/intents/simulate-deposit", { body: { depositAddress: dep.depositAddress, memo: dep.depositMemo ?? undefined, ticket: dep.ticket } });
      if (r.ticket) setDep({ ...dep, ticket: r.ticket });
    } catch (e) { setErr(explain(e)); } finally { setSimulating(false); }
  };

  const current = status === "PENDING_DEPOSIT" ? 0 : status === "KNOWN_DEPOSIT_TX" ? 1 : status === "PROCESSING" ? 2 : status === "SUCCESS" ? 4 : status === "INCOMPLETE_DEPOSIT" ? 1 : 2;
  const failed = status === "REFUNDED" || status === "FAILED" || status === "INCOMPLETE_DEPOSIT";
  const left = dep ? Math.max(0, Date.parse(dep.deadline) - now) : 0;
  const mm = String(Math.floor(left / 60000)).padStart(2, "0"), ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  const statusText = status === "SUCCESS" ? t("pay.st.done") : status === "PROCESSING" ? t("pay.st.delivering") : status === "KNOWN_DEPOSIT_TX" ? t("pay.st.received") : status === "REFUNDED" ? t("pay.st.refunded") : status === "FAILED" ? t("pay.st.failed") : status === "INCOMPLETE_DEPOSIT" ? t("pay.st.incomplete") : t("pay.st.waiting");

  return (
    <Frame>
      <section className="oi-stack-sm" style={{ alignItems: "center", textAlign: "center" }} data-testid="pay-recipient">
        <Avatar name={display} size={72} />
        <h1 className="oi-h1" style={{ fontSize: 26 }}>{t("pay.title", { name: display })}</h1>
        <div className="oi-small oi-muted">{recipient}</div>
        <Badge tone="success" icon="shield" data-testid="pay-verified">{t("pay.verified")}</Badge>
      </section>

      {step < 4 && <div className="oi-steps" aria-hidden>{[1, 2, 3].map((n) => <span key={n} data-on={n <= step} />)}</div>}

      {step === 1 && (
        <section className="oi-stack-sm" data-testid="pay-step-1">
          <h2 className="oi-h2">{t("pay.where")}</h2>
          {groups.error && !groups.data ? <Note tone="danger" title={t("pay.loadError")}>{explain(groups.error).next}</Note> : !groups.data ? (
            <Loading label={t("common.loading")}><div className="oi-stack-sm">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={60} radius={16} />)}</div></Loading>
          ) : (
            <SelectList label={t("pay.where")} value={direct ? DIRECT : group?.id ?? null}
              onChange={(id) => {
                if (id === DIRECT) { setDirect(true); setGroup(null); setStep(2); return; }
                setDirect(false); setGroup(groups.data!.groups.find((g) => g.id === id) ?? null); setStep(2);
              }}
              options={[
                ...groups.data.groups.map((g) => ({ value: g.id, title: g.label, testId: `pay-origin-${g.id}`, leading: <span className="oi-monogram" aria-hidden>{g.chain.slice(0, 3).toUpperCase()}</span> })),
                { value: DIRECT, title: t("pay.direct"), subtitle: t("pay.directSub"), testId: "pay-origin-direct", leading: <span className="oi-monogram" aria-hidden>N</span> },
              ]} />
          )}
        </section>
      )}

      {step === 2 && (
        <section className="oi-stack" data-testid="pay-step-2">
          <h2 className="oi-h2">{t("pay.howMuch", { symbol })}</h2>
          <p className="oi-small oi-muted" style={{ margin: 0 }}>{direct ? t("pay.directSub") : group?.label}</p>
          <AmountInput label={t("pay.howMuch", { symbol })} value={amount} onChange={setAmount} ticker={symbol} autoFocus testId="pay-amount" />
          <Button block size="lg" disabled={!units} onClick={() => setStep(3)} data-testid="pay-continue-2">{t("common.continue")}</Button>
          <Button block variant="ghost" onClick={() => setStep(1)}>{t("common.back")}</Button>
        </section>
      )}

      {step === 3 && direct && (
        <section className="oi-stack" data-testid="pay-step-3">
          <h2 className="oi-h2">{t("pay.directTitle")}</h2>
          <CopyField label={t("pay.sendTo")} value={recipient} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} testId="pay-direct-recipient" />
          <CopyField label={t("pay.exactAmount")} value={amount} display={`${amount} USDC/USDT`} mono={false} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} />
          <Note tone="info">{t("pay.directNote")}</Note>
          <Button block variant="ghost" onClick={() => setStep(2)}>{t("common.back")}</Button>
        </section>
      )}

      {step === 3 && !direct && group && (
        <section className="oi-stack" data-testid="pay-step-3">
          <h2 className="oi-h2">{t("pay.refundQ")}</h2>
          <p className="oi-small oi-muted" style={{ margin: 0 }}>{t("pay.refundSub", { place: group.label })}</p>
          <Input label={t("pay.refundLabel", { place: group.label })} value={refund} onChange={(e) => { setRefund(e.target.value); setRefundErr(null); }}
            autoComplete="off" spellCheck={false} placeholder={group.chain === "tron" ? "T…" : "0x…"} error={refundErr} data-testid="pay-refund" />
          {err && <div role="alert"><Note tone="danger" title={err.title}>{err.next}</Note></div>}
          <Button block size="lg" loading={busy} disabled={!refund.trim()} onClick={getAddress} data-testid="pay-continue-3">{t("pay.getAddress")}</Button>
          <Button block variant="ghost" onClick={() => setStep(2)}>{t("common.back")}</Button>
        </section>
      )}

      {step === 4 && dep && group && (
        <section className="oi-stack" data-testid="pay-step-4">
          {status === "SUCCESS" ? (
            <div className="oi-card oi-stack" style={{ alignItems: "center", textAlign: "center" }} data-testid="pay-done">
              <SuccessCheck />
              <h2 className="oi-h2">{t("pay.doneTitle", { name: display })}</h2>
              <p className="oi-muted" style={{ margin: 0 }}>{t("pay.doneBody", { amount: `${fromUnits(dep.amountOut)} ${dep.destinationToken.toUpperCase()}` })}</p>
            </div>
          ) : (
            <div className="oi-card oi-stack" data-testid="pay-deposit">
              <h2 className="oi-h2">{t("pay.sendExactly", { amount: `${fromUnits(dep.amountIn, decimals)} ${group.symbol}` })}</h2>
              <p className="oi-small oi-muted" style={{ margin: 0 }}>{t("pay.fromOnly", { place: group.label })}</p>
              <div style={{ display: "flex", justifyContent: "center" }}><QRCodeCard value={dep.depositAddress} label={t("pay.qr")} size={200} /></div>
              <CopyField label={t("pay.address", { place: group.label })} value={dep.depositAddress} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} testId="pay-address" />
              <CopyField label={t("pay.exactAmount")} value={fromUnits(dep.amountIn, decimals)} display={`${fromUnits(dep.amountIn, decimals)} ${group.symbol}`} mono={false} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} testId="pay-exact" />
              {dep.depositMemo && <CopyField label={t("pay.memo")} value={dep.depositMemo} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} />}
              {dep.depositMemo && <Note tone="warning">{t("pay.memoWarn")}</Note>}
              <div className="oi-row oi-small"><span className="oi-muted" style={{ flex: 1 }}>{t("pay.theyGet", { name: display })}</span><span className="oi-num" style={{ fontWeight: 600 }}>{fromUnits(dep.amountOut)} {dep.destinationToken.toUpperCase()}</span></div>
              <div className="oi-row oi-small"><span className="oi-muted" style={{ flex: 1 }}>{t("common.fee")}</span><span className="oi-num">{fromUnits(dep.fee)} {dep.destinationToken.toUpperCase()}</span></div>
              <div className="oi-row oi-small" aria-live="off"><span className="oi-muted" style={{ flex: 1 }}>{t("pay.expires")}</span><span className="oi-num" style={{ fontWeight: 600 }} data-testid="pay-countdown">{left > 0 ? `${mm}:${ss}` : t("pay.expired")}</span></div>
            </div>
          )}
          <div className="oi-card">
            <StatusTimeline label={t("pay.statusLabel")} current={current} error={failed} liveText={statusText} testId="status-timeline"
              steps={[
                { key: "waiting", title: t("pay.st.waiting") },
                { key: "received", title: t("pay.st.received") },
                { key: "delivering", title: t("pay.st.delivering") },
                { key: "done", title: t("pay.st.done") },
              ]} />
            {failed && <div style={{ marginTop: 12 }}><Note tone="danger" title={statusText}>{status === "REFUNDED" ? t("pay.refundedNext") : t("pay.failedNext")}</Note></div>}
          </div>
          {isTestMode && status === "PENDING_DEPOSIT" && (
            <div className="oi-testmode" data-testid="pay-testmode">
              <Badge tone="warning" icon="warning">{t("common.testMode")}</Badge>
              <p className="oi-small" style={{ margin: 0 }}>{t("pay.simulateNote")}</p>
              <Button variant="secondary" loading={simulating} onClick={simulate} data-testid="pay-simulate">{t("pay.simulate")}</Button>
            </div>
          )}
          {err && <div role="alert"><Note tone="danger" title={err.title}>{err.next}</Note></div>}
        </section>
      )}
      {config && <p className="oi-micro oi-muted" style={{ textAlign: "center", margin: 0 }}>{t("pay.footer")}</p>}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="oi-public__col" data-testid="pay">
      <header className="oi-row" style={{ minHeight: 44 }}>
        <Link href="/" aria-label="Oiko" style={{ color: "var(--ink)" }}><Logo variant="wordmark" height={22} /></Link>
      </header>
      {children}
    </div>
  );
}
