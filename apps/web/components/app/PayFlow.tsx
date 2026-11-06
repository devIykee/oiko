"use client";
// The 4-step "pay this name" flow shared by /pay/[name] and invoices (/i/[id]):
// 1 where is your money → 2 how much (skipped when the amount is fixed) → 3 refund address → 4 deposit address + live status.
import { AmountInput, AssetLogo, Badge, Button, CopyField, Input, Note, QRCodeCard, SelectList, StatusTimeline, SuccessCheck, Skeleton, Loading } from "@oiko/ui";
import { fromUnits, toUnits, type Token } from "@oiko/sdk";
import { useEffect, useRef, useState } from "react";
import { validAddress } from "@/lib/address";
import { api } from "@/lib/api";
import { explain } from "@/lib/explain";
import { useConfig } from "@/lib/config";
import { useIntentTokens, type IntentGroup } from "@/lib/publicData";
import { useT } from "@/lib/i18n";

type Step = 1 | 2 | 3 | 4;
interface Deposit { ticket?: string; depositAddress: string; depositMemo?: string | null; amountIn: string; amountOut: string; fee: string; deadline: string; quoteId: string; destinationToken: string }
export type PayStatus = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "PROCESSING" | "SUCCESS" | "INCOMPLETE_DEPOSIT" | "REFUNDED" | "FAILED";
const DIRECT = "__direct__";

export interface PayFlowProps {
  /** Oiko name being paid ("steve"). */
  name: string;
  /** Display name ("Steve"). */
  display: string;
  /** Their account id, for "Already on NEAR". */
  recipient: string;
  /** Fixed amount (6 decimals) in one stablecoin: the amount step is skipped and only that stablecoin is offered. */
  fixed?: { units: string; token: Token };
  /** Ties the deposit to an invoice (the server fixes the amount and records the deposit). */
  invoiceId?: string;
  /** Called whenever the deposit status changes. */
  onStatus?: (s: PayStatus) => void;
  /** Override the success sentence. */
  doneTitle?: string;
}

export function PayFlow({ name, display, recipient, fixed, invoiceId, onStatus, doneTitle }: PayFlowProps) {
  const t = useT();
  const groups = useIntentTokens();
  const { isTestMode } = useConfig();
  const [step, setStep] = useState<Step>(1);
  const [group, setGroup] = useState<IntentGroup | null>(null);
  const [direct, setDirect] = useState(false);
  const [amount, setAmount] = useState("");
  const [refund, setRefund] = useState("");
  const [refundErr, setRefundErr] = useState<string | null>(null);
  const [dep, setDep] = useState<Deposit | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ title: string; next: string } | null>(null);
  const [status, setStatus] = useState<PayStatus>("PENDING_DEPOSIT");
  const [now, setNow] = useState(Date.now());
  const [simulating, setSimulating] = useState(false);

  const symbol = fixed ? fixed.token.toUpperCase() : direct ? "USDT" : group?.symbol ?? "USDT";

  // Poll the deposit status and run the countdown.
  useEffect(() => {
    if (step !== 4 || !dep) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    let stop = false;
    const poll = async () => {
      if (stop) return;
      try {
        const qs = new URLSearchParams({ ...(dep.depositMemo ? { memo: dep.depositMemo } : {}), ...(dep.ticket ? { ticket: dep.ticket } : {}) }).toString();
        const s = await api<{ status: PayStatus }>(`/api/intents/status/${encodeURIComponent(dep.depositAddress)}${qs ? `?${qs}` : ""}`);
        setStatus(s.status);
        if (["SUCCESS", "REFUNDED", "FAILED"].includes(s.status)) { stop = true; return; }
      } catch { /* keep polling */ }
      setTimeout(poll, 3000);
    };
    void poll();
    return () => { stop = true; clearInterval(tick); };
  }, [step, dep]);

  useEffect(() => { if (dep) onStatus?.(status); }, [status, dep, onStatus]);

  const decimals = group?.decimals ?? 6;
  let units: string | null = null;
  try {
    units = fixed ? toUnits(fromUnits(fixed.units), decimals) : amount && Number(amount) > 0 ? toUnits(amount, decimals) : null;
  } catch { units = null; }

  const options = groups.data?.groups.filter((g) => !fixed || g.symbol === symbol) ?? [];
  const dots: Step[] = fixed ? [1, 3] : [1, 2, 3];

  const getAddress = async () => {
    if (!group || !units) return;
    if (!validAddress(group.chain, refund)) { setRefundErr(t("pay.badRefund", { place: group.label })); return; }
    setBusy(true); setErr(null);
    try {
      const d = await api<Deposit>("/api/intents/deposit-address", { body: { name, originAsset: group.assetId, amount: units, refundTo: refund.trim(), ...(invoiceId ? { invoiceId } : {}) } });
      setDep(d); setStatus("PENDING_DEPOSIT"); setStep(4);
    } catch (e) { setErr(explain(e)); } finally { setBusy(false); }
  };

  // One simulated deposit per address: the ref blocks double clicks before React re-renders; the server is idempotent too.
  const simRef = useRef(false);
  const [simulated, setSimulated] = useState(false);
  const simulate = async () => {
    if (!dep || simRef.current) return;
    simRef.current = true;
    setSimulating(true);
    try {
      const r = await api<{ ticket?: string }>("/api/intents/simulate-deposit", { body: { depositAddress: dep.depositAddress, memo: dep.depositMemo ?? undefined, ticket: dep.ticket, ...(invoiceId ? { invoiceId } : {}) } });
      if (r.ticket) setDep({ ...dep, ticket: r.ticket });
      setSimulated(true);
    } catch (e) { simRef.current = false; setErr(explain(e)); } finally { setSimulating(false); }
  };

  const current = status === "PENDING_DEPOSIT" ? 0 : status === "KNOWN_DEPOSIT_TX" ? 1 : status === "PROCESSING" ? 2 : status === "SUCCESS" ? 4 : status === "INCOMPLETE_DEPOSIT" ? 1 : 2;
  const failed = status === "REFUNDED" || status === "FAILED" || status === "INCOMPLETE_DEPOSIT";
  const left = dep ? Math.max(0, Date.parse(dep.deadline) - now) : 0;
  const mm = String(Math.floor(left / 60000)).padStart(2, "0"), ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  const statusText = status === "SUCCESS" ? t("pay.st.done") : status === "PROCESSING" ? t("pay.st.delivering") : status === "KNOWN_DEPOSIT_TX" ? t("pay.st.received") : status === "REFUNDED" ? t("pay.st.refunded") : status === "FAILED" ? t("pay.st.failed") : status === "INCOMPLETE_DEPOSIT" ? t("pay.st.incomplete") : t("pay.st.waiting");

  return (
    <>
      {step < 4 && <div className="oi-steps" aria-hidden>{dots.map((n) => <span key={n} data-on={n <= step} />)}</div>}

      {step === 1 && (
        <section className="oi-stack-sm" data-testid="pay-step-1">
          <h2 className="oi-h2">{t("pay.where")}</h2>
          {fixed && <p className="oi-small oi-muted" style={{ margin: 0 }}>{t("pay.fixedOnly", { amount: `${fromUnits(fixed.units)} ${symbol}`, symbol })}</p>}
          {groups.error && !groups.data ? <Note tone="danger" title={t("pay.loadError")}>{explain(groups.error).next}</Note> : !groups.data ? (
            <Loading label={t("common.loading")}><div className="oi-stack-sm">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={60} radius={16} />)}</div></Loading>
          ) : (
            <SelectList label={t("pay.where")} value={direct ? DIRECT : group?.id ?? null}
              onChange={(id) => {
                if (id === DIRECT) { setDirect(true); setGroup(null); setStep(2); return; }
                setDirect(false); setGroup(groups.data!.groups.find((g) => g.id === id) ?? null); setStep(fixed ? 3 : 2);
              }}
              options={[
                ...options.map((g) => ({ value: g.id, title: g.label, testId: `pay-origin-${g.id}`, leading: <AssetLogo chain={g.chain} token={g.symbol} /> })),
                // A direct payment can't be matched to an invoice, so it's only offered on the plain pay page.
                ...(fixed ? [] : [{ value: DIRECT, title: t("pay.direct"), subtitle: t("pay.directSub"), testId: "pay-origin-direct", leading: <AssetLogo chain="near" /> }]),
              ]} />
          )}
        </section>
      )}

      {step === 2 && !fixed && (
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
          {fixed && (
            <div className="oi-row oi-small" data-testid="pay-fixed-amount"><span className="oi-muted" style={{ flex: 1 }}>{t("pay.youPay")}</span><span className="oi-num" style={{ fontWeight: 700 }}>{fromUnits(fixed.units)} {symbol}</span></div>
          )}
          <h2 className="oi-h2">{t("pay.refundQ")}</h2>
          <p className="oi-small oi-muted" style={{ margin: 0 }}>{t("pay.refundSub", { place: group.label })}</p>
          <Input label={t("pay.refundLabel", { place: group.label })} value={refund} onChange={(e) => { setRefund(e.target.value); setRefundErr(null); }}
            autoComplete="off" spellCheck={false} placeholder={group.chain === "tron" ? "T…" : "0x…"} error={refundErr} data-testid="pay-refund" />
          {err && <div role="alert"><Note tone="danger" title={err.title}>{err.next}</Note></div>}
          <Button block size="lg" loading={busy} disabled={!refund.trim()} onClick={getAddress} data-testid="pay-continue-3">{t("pay.getAddress")}</Button>
          <Button block variant="ghost" onClick={() => setStep(fixed ? 1 : 2)}>{t("common.back")}</Button>
        </section>
      )}

      {step === 4 && dep && group && (
        <section className="oi-stack" data-testid="pay-step-4">
          {status === "SUCCESS" ? (
            <div className="oi-card oi-stack" style={{ alignItems: "center", textAlign: "center" }} data-testid="pay-done">
              <SuccessCheck />
              <h2 className="oi-h2">{doneTitle ?? t("pay.doneTitle", { name: display })}</h2>
              <p className="oi-muted" style={{ margin: 0 }}>{t("pay.doneBody", { amount: `${fromUnits(dep.amountOut)} ${dep.destinationToken.toUpperCase()}` })}</p>
              <p className="oi-small oi-num" style={{ margin: 0 }} data-testid="pay-receipt-line">{t("pay.receiptLine", {
                sent: `${fromUnits(dep.amountIn, decimals)} ${group?.symbol ?? dep.destinationToken.toUpperCase()}`,
                fee: fromUnits(dep.fee), arrived: `${fromUnits(dep.amountOut)} ${dep.destinationToken.toUpperCase()}`,
              })}</p>
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
              <Button variant="secondary" loading={simulating} disabled={simulated || status !== "PENDING_DEPOSIT"} onClick={simulate} data-testid="pay-simulate">{simulated ? t("pay.simulated") : t("pay.simulate")}</Button>
            </div>
          )}
          {err && <div role="alert"><Note tone="danger" title={err.title}>{err.next}</Note></div>}
        </section>
      )}
    </>
  );
}
