"use client";
import { AmountInput, Button, Note, SegmentedControl, SelectList, Sheet, SuccessCheck, Tile, useToast } from "@oiko/ui";
import type { Overview, Token } from "@oiko/sdk";
import { useEffect, useMemo, useState } from "react";
import { explain, useMoney } from "@/lib/actions";
import { fmtToken, parseUnits, fmt, TICKER, bigger } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { fromUnits } from "@oiko/sdk";
import { isLocked, potColor, potGlyph, potName } from "./potmeta";

type Step = "from" | "to" | "amount" | "confirm" | "done";

/** Move money between pots: one step per screen, ends with a one-sentence confirmation. */
export function MoveSheet({ open, onOpenChange, overview, fromPot, toPot }: {
  open: boolean; onOpenChange: (o: boolean) => void; overview: Overview; fromPot?: number; toPot?: number;
}) {
  const t = useT();
  const toast = useToast();
  const { exec } = useMoney();
  const [step, setStep] = useState<Step>("from");
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [coin, setCoin] = useState<Token>("usdt");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ title: string; next: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setFrom(fromPot ?? null);
    setTo(toPot ?? null);
    setAmount("");
    setErr(null);
    setStep(fromPot !== undefined ? (toPot !== undefined ? "amount" : "to") : "from");
    const src = overview.pots.find((p) => p.id === fromPot);
    if (src) setCoin(bigger(src.balances));
  }, [open, fromPot, toPot, overview.pots]);

  const pots = overview.pots;
  const src = pots.find((p) => p.id === from);
  const dst = pots.find((p) => p.id === to);
  const avail = src ? src.balances[coin] : "0";
  const units = parseUnits(amount);
  const over = units !== null && BigInt(units) > BigInt(avail);

  const fromOptions = useMemo(() => pots.map((p) => ({
    value: p.id, title: potName(p, t), icon: potGlyph(p), color: potColor(p),
    subtitle: isLocked(p) ? t("common.locked") : `${fmt(p.balances.usdc)} USDC · ${fmt(p.balances.usdt)} USDT`,
    disabled: isLocked(p), testId: `move-from-${p.id}`,
  })), [pots, t]);
  const toOptions = useMemo(() => pots.filter((p) => p.id !== from).map((p) => ({
    value: p.id, title: potName(p, t), icon: potGlyph(p), color: potColor(p), testId: `move-to-${p.id}`,
    subtitle: isLocked(p) ? t("move.toLocked") : undefined,
  })), [pots, from, t]);

  const go = async () => {
    if (from === null || to === null || !units) return;
    setBusy(true);
    setErr(null);
    try {
      await exec("moveFunds", from, to, coin, units);
      setStep("done");
      toast.show({ message: t("toast.moved", { amount: fmtToken(units, coin) }), tone: "success" });
      setTimeout(() => onOpenChange(false), 1200);
    } catch (e) {
      setErr(explain(e));
    } finally {
      setBusy(false);
    }
  };

  const back = step === "to" && fromPot === undefined ? () => setStep("from")
    : step === "amount" && toPot === undefined ? () => setStep("to")
    : step === "confirm" ? () => setStep("amount") : undefined;

  const title = step === "from" ? t("move.fromTitle") : step === "to" ? t("move.toTitle") : step === "amount" ? t("move.amountTitle") : t("confirm.title");

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} dismissible={!busy} closeLabel={t("common.close")} testId="move-sheet"
      back={back ? { label: t("common.back"), onClick: back } : undefined}
      footer={
        step === "amount" ? <Button block size="lg" disabled={!units || over} onClick={() => setStep("confirm")} data-testid="move-continue">{t("common.continue")}</Button>
        : step === "confirm" ? <Button block size="lg" loading={busy} onClick={go} data-testid="move-confirm">{t("move.confirm")}</Button>
        : undefined
      }>
      {step === "from" && <SelectList label={t("move.fromTitle")} options={fromOptions} value={from} onChange={(v) => { setFrom(v); const p = pots.find((x) => x.id === v); if (p) setCoin(bigger(p.balances)); setStep(toPot !== undefined ? "amount" : "to"); }} />}
      {step === "to" && (
        <>
          <SelectList label={t("move.toTitle")} options={toOptions} value={to} onChange={(v) => { setTo(v); setStep("amount"); }} />
          <p className="oi-small oi-muted" style={{ margin: 0 }}>{t("move.lockNote")}</p>
        </>
      )}
      {step === "amount" && src && dst && (
        <>
          <div className="oi-row oi-small oi-muted" style={{ justifyContent: "center" }}>
            <Tile icon={potGlyph(src)} color={potColor(src)} /> {potName(src, t)} → {potName(dst, t)} <Tile icon={potGlyph(dst)} color={potColor(dst)} />
          </div>
          <SegmentedControl label={t("common.token")} value={coin} onChange={(v) => { setCoin(v); setAmount(""); }}
            items={[{ value: "usdt", label: "USDT" }, { value: "usdc", label: "USDC" }]} />
          <AmountInput label={t("common.amount")} value={amount} onChange={setAmount} ticker={TICKER[coin]} autoFocus testId="move-amount"
            sub={t("common.available", { amount: fmtToken(avail, coin) })}
            error={over ? t("move.tooMuch", { amount: fmtToken(avail, coin) }) : undefined}
            chips={BigInt(avail) > 0n ? [{ label: t("common.max"), value: fromUnits(avail) }] : undefined} deleteLabel={t("common.delete_left")} />
        </>
      )}
      {step === "confirm" && src && dst && units && (
        <>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 500, lineHeight: 1.4 }} data-testid="move-sentence">
            {t("move.sentence", { amount: fmtToken(units, coin), from: potName(src, t), to: potName(dst, t) })}
          </p>
          {err && <div role="alert"><Note tone="danger" title={err.title}>{t("error.next", { next: err.next })}</Note></div>}
        </>
      )}
      {step === "done" && (
        <div className="oi-stack" style={{ alignItems: "center", textAlign: "center", padding: "24px 0" }} role="status">
          <SuccessCheck />
          <div style={{ fontWeight: 600, fontSize: 18 }}>{units && t("toast.moved", { amount: fmtToken(units, coin) })}</div>
        </div>
      )}
    </Sheet>
  );
}
