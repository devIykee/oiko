"use client";
import { AmountInput, AssetLogo, Button, Input, Note, SegmentedControl, SelectList, StatusTimeline, SuccessCheck, Tile } from "@oiko/ui";
import { fromUnits, type Token } from "@oiko/sdk";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { LoadError, PageSkeleton } from "@/components/app/States";
import { isLocked, potColor, potGlyph, potName } from "@/components/app/potmeta";
import { api } from "@/lib/api";
import { explain, useMoney } from "@/lib/actions";
import { fetchName, useIntentTokens, useOverview, type IntentGroup } from "@/lib/data";
import { TICKER, bigger, fmt, fmtToken, parseUnits } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { validAddress } from "@/lib/address";

type Step = "from" | "where" | "dest" | "address" | "amount" | "review" | "sent";
type Quote = { depositAddress: string; depositMemo?: string | null; ticket?: string; amountIn: string; amountOut: string; fee: string; deadline: string; timeEstimate: number };


export function WithdrawScreen() {
  const t = useT();
  const ov = useOverview();
  const groups = useIntentTokens();
  const { exec, execOwner } = useMoney();
  const [step, setStep] = useState<Step>("from");
  const [potId, setPotId] = useState<number | null>(null);
  const [where, setWhere] = useState<"oiko" | "exchange" | null>(null);
  const [dest, setDest] = useState<IntentGroup | null>(null);
  const [address, setAddress] = useState("");
  const [addrErr, setAddrErr] = useState<string | null>(null);
  const [coin, setCoin] = useState<Token>("usdt");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ title: string; next: string } | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [arrived, setArrived] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const o = ov.data;
  const pot = o?.pots.find((p) => p.id === potId);
  const units = parseUnits(amount);
  const avail = pot ? pot.balances[coin] : "0";
  const over = units !== null && BigInt(units) > BigInt(avail);
  const large = !!o && !!units && BigInt(units) > BigInt(o.config.large_withdrawal_threshold);

  useEffect(() => { if (o && potId === null) { const flex = o.pots.find((p) => p.kind === "flex"); if (flex) { setPotId(flex.id); setCoin(bigger(flex.balances)); } } }, [o, potId]);

  // Elapsed timer + delivery status after sending to an exchange.
  useEffect(() => {
    if (step !== "sent" || arrived) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    let poll: ReturnType<typeof setInterval> | undefined;
    if (where === "exchange" && quote) {
      poll = setInterval(async () => {
        try {
          const qs = new URLSearchParams({ ...(quote.depositMemo ? { memo: quote.depositMemo } : {}), ...(quote.ticket ? { ticket: quote.ticket } : {}) }).toString();
          const s = await api<{ status: string }>(`/api/intents/status/${encodeURIComponent(quote.depositAddress)}${qs ? `?${qs}` : ""}`);
          if (s.status === "SUCCESS") setArrived(Date.now());
        } catch { /* keep polling */ }
      }, 3000);
    } else setArrived(sentAt);
    return () => { clearInterval(tick); if (poll) clearInterval(poll); };
  }, [step, where, quote, arrived, sentAt]);

  const potOptions = useMemo(() => (o?.pots ?? []).map((p) => ({
    value: p.id, title: potName(p, t), icon: potGlyph(p), color: potColor(p), disabled: isLocked(p),
    subtitle: isLocked(p) ? t("common.locked") : `${fmt(p.balances.usdc)} USDC · ${fmt(p.balances.usdt)} USDT`,
  })), [o, t]);

  if (ov.error && !o) return <div className="oi-col oi-page"><LoadError error={ov.error} onRetry={ov.refresh} /></div>;
  if (!o) return <div className="oi-col"><PageSkeleton rows={4} /></div>;

  const checkAddress = async () => {
    setAddrErr(null);
    if (where === "oiko") {
      const name = address.trim().toLowerCase().replace(/\..*$/, "");
      try {
        const n = await fetchName(name);
        if (!n.exists) { setAddrErr(t("withdraw.noSuchName")); return; }
        setAddress(n.vaultId); // their savings account: registered on both tokens and credited on sync (a bare name account is not, so a transfer would bounce)
        setStep("amount");
      } catch { setAddrErr(t("withdraw.noSuchName")); }
      return;
    }
    if (!dest || !validAddress(dest.chain, address)) { setAddrErr(t("withdraw.badAddress", { place: dest?.label ?? "" })); return; }
    setStep("amount");
  };

  const getQuote = async () => {
    if (!units || !pot) return;
    setErr(null);
    if (where === "oiko") { setQuote(null); setStep("review"); return; }
    setBusy(true);
    try {
      const q = await api<Quote>("/api/intents/withdraw-quote", { body: { vaultId: o.owner ? `vault.${o.owner}` : "", potId: pot.id, token: coin, amount: units, destinationAsset: dest!.assetId, destinationAddress: address.trim() } });
      setQuote(q);
      setStep("review");
    } catch (e) { setErr(explain(e)); } finally { setBusy(false); }
  };

  const send = async () => {
    if (!units || !pot) return;
    setBusy(true); setErr(null);
    const to = where === "oiko" ? address : quote!.depositAddress;
    const amt = where === "oiko" ? units : quote!.amountIn;
    try {
      const memo = where === "oiko" ? undefined : quote!.depositMemo ?? undefined;
      await (large ? execOwner("withdrawLarge", pot.id, coin, amt, to, memo) : exec("withdraw", pot.id, coin, amt, to, memo));
      // Test mode: tell the built-in payment service the deposit was sent (the real service detects it on its own).
      if (quote?.ticket) {
        const r = await api<{ ticket?: string }>("/api/intents/simulate-deposit", { body: { depositAddress: quote.depositAddress, memo, ticket: quote.ticket } }).catch(() => null);
        if (r?.ticket) setQuote({ ...quote, ticket: r.ticket });
      }
      setSentAt(Date.now());
      setStep("sent");
    } catch (e) { setErr(explain(e)); } finally { setBusy(false); }
  };

  const back: Partial<Record<Step, Step>> = { where: "from", dest: "where", address: where === "exchange" ? "dest" : "where", amount: "address", review: "amount" };
  const placeLabel = where === "oiko" ? address : `${address.slice(0, 6)}…${address.slice(-4)} (${dest?.label})`;
  const sentence = units && pot ? (where === "oiko"
    ? t("withdraw.sentenceOiko", { amount: fmtToken(units, coin), pot: potName(pot, t), to: address })
    : quote ? t("withdraw.sentenceExchange", { amount: fmtToken(quote.amountIn, coin), pot: potName(pot, t), to: placeLabel, fee: fmtToken(quote.fee, coin), out: `${fmt(quote.amountOut)} ${dest?.symbol}`, time: Math.max(1, Math.round(quote.timeEstimate / 60)) }) : "") : "";
  const elapsed = Math.round(((arrived ?? now) - (sentAt ?? now)) / 1000);

  return (
    <div className="oi-col oi-page" data-testid="withdraw">
      <PageHeader title={t("withdraw.title")} back={step === "from" || step === "sent" ? "/home" : undefined} />
      {back[step] && step !== "sent" && (
        <button type="button" className="oi-btn oi-btn--ghost oi-btn--sm" style={{ alignSelf: "flex-start", marginTop: -12 }} onClick={() => setStep(back[step]!)}>← {t("common.back")}</button>
      )}

      {step === "from" && (
        <>
          <h2 className="oi-h2">{t("withdraw.fromQ")}</h2>
          <SelectList label={t("withdraw.fromQ")} options={potOptions} value={potId} onChange={(v) => { setPotId(v); const p = o.pots.find((x) => x.id === v); if (p) setCoin(bigger(p.balances)); setStep("where"); }} />
        </>
      )}
      {step === "where" && (
        <>
          <h2 className="oi-h2">{t("withdraw.whereQ")}</h2>
          <SelectList label={t("withdraw.whereQ")} value={where} onChange={(v) => { setWhere(v); setAddress(""); setStep(v === "oiko" ? "address" : "dest"); }}
            options={[
              { value: "exchange" as const, title: t("withdraw.toExchange"), subtitle: t("withdraw.toExchangeSub"), icon: "bank", color: "stone", testId: "withdraw-exchange" },
              { value: "oiko" as const, title: t("withdraw.toOiko"), subtitle: t("withdraw.toOikoSub"), icon: "payLink", color: "blue", testId: "withdraw-oiko" },
            ]} />
        </>
      )}
      {step === "dest" && (
        <>
          <h2 className="oi-h2">{t("withdraw.destQ")}</h2>
          {groups.error && !groups.data ? <LoadError error={groups.error} onRetry={groups.refresh} /> : !groups.data ? <PageSkeleton rows={4} /> : (
            <SelectList label={t("withdraw.destQ")} value={dest?.id ?? null} onChange={(id) => { const g = groups.data!.groups.find((x) => x.id === id)!; setDest(g); setCoin(g.symbol.toLowerCase() === "usdc" ? "usdc" : "usdt"); setStep("address"); }}
              options={groups.data.groups.map((g) => ({ value: g.id, title: g.label, leading: <AssetLogo chain={g.chain} token={g.symbol} /> }))} />
          )}
        </>
      )}
      {step === "address" && (
        <>
          <h2 className="oi-h2">{where === "oiko" ? t("withdraw.nameQ") : t("withdraw.addressQ", { place: dest?.label ?? "" })}</h2>
          <Input label={where === "oiko" ? t("withdraw.nameLabel") : t("withdraw.addressLabel")} value={address} onChange={(e) => { setAddress(e.target.value); setAddrErr(null); }}
            autoComplete="off" spellCheck={false} placeholder={where === "oiko" ? "kemi" : dest?.chain === "tron" ? "T…" : "0x…"} error={addrErr} data-testid="withdraw-address"
            hint={where === "exchange" ? t("withdraw.addressHint") : undefined} />
          <Button block size="lg" disabled={!address.trim()} onClick={checkAddress}>{t("common.continue")}</Button>
        </>
      )}
      {step === "amount" && pot && (
        <>
          {where === "oiko" && <SegmentedControl label={t("common.token")} value={coin} onChange={(v) => { setCoin(v); setAmount(""); }} items={[{ value: "usdt", label: "USDT" }, { value: "usdc", label: "USDC" }]} />}
          <AmountInput label={t("common.amount")} value={amount} onChange={setAmount} ticker={TICKER[coin]} autoFocus testId="withdraw-amount"
            sub={t("withdraw.fromPot", { amount: fmtToken(avail, coin), pot: potName(pot, t) })} error={over ? t("move.tooMuch", { amount: fmtToken(avail, coin) }) : undefined}
            chips={BigInt(avail) > 0n ? [{ label: t("common.max"), value: fromUnits(avail) }] : undefined} />
          {large && <Note tone="info" title={t("withdraw.largeTitle")}>{t("withdraw.largeBody", { limit: fmt(o.config.large_withdrawal_threshold) })}</Note>}
          {err && <div role="alert"><Note tone="danger" title={err.title}>{t("error.next", { next: err.next })}</Note></div>}
          <Button block size="lg" loading={busy} disabled={!units || over} onClick={getQuote}>{t("common.continue")}</Button>
        </>
      )}
      {step === "review" && pot && units && (
        <>
          <h2 className="oi-h2">{t("confirm.title")}</h2>
          <div className="oi-card oi-stack-sm">
            <p style={{ margin: 0, fontSize: 18, fontWeight: 500, lineHeight: 1.4 }} data-testid="withdraw-sentence">{sentence}</p>
          </div>
          {large && <Note tone="info">{t("withdraw.largeConfirm")}</Note>}
          {err && <div role="alert"><Note tone="danger" title={err.title}>{t("error.next", { next: err.next })}</Note></div>}
          <Button block size="lg" loading={busy} onClick={send} data-testid="withdraw-confirm">{t("withdraw.send")}</Button>
        </>
      )}
      {step === "sent" && (
        <div className="oi-card oi-stack" style={{ alignItems: "center", textAlign: "center" }}>
          {arrived ? <SuccessCheck /> : <Tile icon="pending" color="blue" size="lg" />}
          <div style={{ fontWeight: 700, fontSize: 20 }}>{arrived ? t("withdraw.arrived") : t("withdraw.onTheWay")}</div>
          <div className="oi-muted oi-num" aria-live="polite">{t("withdraw.elapsed", { s: elapsed })}</div>
          {where === "exchange" && (
            <div style={{ alignSelf: "stretch", textAlign: "left" }}>
              <StatusTimeline label={t("withdraw.status")} current={arrived ? 3 : 1}
                steps={[{ key: "sent", title: t("withdraw.stepSent") }, { key: "delivering", title: t("withdraw.stepDelivering") }, { key: "done", title: t("withdraw.stepDone") }]}
                liveText={arrived ? t("withdraw.arrived") : t("withdraw.onTheWay")} testId="withdraw-status" />
            </div>
          )}
          <Link href="/home" className="oi-btn">{t("common.done")}</Link>
        </div>
      )}
    </div>
  );
}
