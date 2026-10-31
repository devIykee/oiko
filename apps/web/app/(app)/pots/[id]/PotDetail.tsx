"use client";
import {
  AmountInput, Badge, Button, EmptyState, GroupedList, HoldToConfirm, Input, ListRow, Note, ProgressBar, RiskNote, SectionTitle,
  SegmentedControl, Sheet, Tile, Toggle, useToast, type IconConcept, type TileColor,
} from "@oiko/ui";
import { fromUnits, goalEta, type Overview, type Pot, type Token } from "@oiko/sdk";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState, type CSSProperties } from "react";
import { ActivityList } from "@/components/app/ActivityList";
import { ConfirmSheet } from "@/components/app/ConfirmSheet";
import { MoveSheet } from "@/components/app/MoveSheet";
import { PageHeader } from "@/components/app/PageHeader";
import { LoadError, PageSkeleton } from "@/components/app/States";
import { isLocked, potColor, potGlyph, potName } from "@/components/app/potmeta";
import { IconColorPicker } from "../PotsScreen";
import { explain, useMoney } from "@/lib/actions";
import { useConfig } from "@/lib/config";
import { useActivity, useEarnRates, useOverview } from "@/lib/data";
import { TICKER, bigger, fmt, fmtDate, fmtToken, msToNs, nsToMs, parseUnits, pct, total } from "@/lib/format";
import { useT } from "@/lib/i18n";

export function PotDetail() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const ov = useOverview();
  const act = useActivity(100);
  const { config } = useConfig();
  const [sheet, setSheet] = useState<null | "in" | "out" | "lock" | "earn" | "edit" | "delete">(null);

  if (ov.error && !ov.data) return <div className="oi-col oi-page"><LoadError error={ov.error} onRetry={ov.refresh} /></div>;
  if (!ov.data) return <div className="oi-col"><PageSkeleton balance rows={3} /></div>;
  const o = ov.data;
  const pot = o.pots.find((p) => p.id === id);
  if (!pot) return <div className="oi-col oi-page"><PageHeader title={t("nav.pots")} back="/pots" /><EmptyState icon="pots" title={t("pots.notFound")} /></div>;

  const locked = isLocked(pot);
  const have = total(pot.balances) + total(pot.earn_supplied);
  const eta = pot.target ? goalEta(pot, act.data ?? [], Date.now()) : null;
  const history = (act.data ?? []).filter((a) => a.pot_id === pot.id);
  const flex = pot.kind === "flex";
  const empty = have === 0n;

  return (
    <div className="oi-col oi-page" data-testid="pot-detail">
      <PageHeader title={potName(pot, t)} back="/pots" action={!flex && <Button size="sm" variant="secondary" icon="edit" onClick={() => setSheet("edit")}>{t("common.edit")}</Button>} />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
        <span style={{ viewTransitionName: `pot-tile-${pot.id}` } as CSSProperties}><Tile icon={potGlyph(pot)} color={potColor(pot)} size="lg" /></span>
        <div className="oi-balance__value" style={{ fontSize: 40 }} data-testid="pot-balance">
          {fmt(have).split(".")[0]}<span className="oi-balance__dec">.{fmt(have).split(".")[1]}</span>
        </div>
        <div className="oi-row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
          <Badge>{fmt(pot.balances.usdc)} USDC</Badge>
          <Badge>{fmt(pot.balances.usdt)} USDT</Badge>
          {total(pot.earn_supplied) > 0n && <Badge tone="success">{t("pot.earningAmount", { amount: fmt(total(pot.earn_supplied)) })}</Badge>}
        </div>
        {locked && <Badge tone="accent" icon="lock" data-testid="pot-locked">{t("common.lockedUntil", { date: fmtDate(nsToMs(pot.unlock_at)) })}</Badge>}
      </div>

      <div className="oi-actions" role="group" aria-label={t("home.actions")} style={{ gridTemplateColumns: `repeat(${flex ? 2 : 3}, 1fr)` }}>
        <button type="button" className="oi-ra" onClick={() => setSheet("in")} data-testid="pot-move-in"><span className="oi-ra__circle"><Tile icon="add" color="stone" /></span>{t("pot.moveIn")}</button>
        <button type="button" className="oi-ra" onClick={() => setSheet("out")} disabled={locked} aria-disabled={locked} style={locked ? { opacity: 0.45 } : undefined} data-testid="pot-move-out">
          <span className="oi-ra__circle"><Tile icon="move" color="stone" /></span>{t("pot.moveOut")}
        </button>
        {!flex && (
          <button type="button" className="oi-ra" onClick={() => setSheet("lock")} data-testid="pot-lock"><span className="oi-ra__circle"><Tile icon="lock" color="stone" /></span>{locked ? t("pot.extend") : t("pot.lock")}</button>
        )}
      </div>

      {pot.target && eta && (
        <section className="oi-card oi-stack-sm" aria-label={t("pots.goalProgress")}>
          <div className="oi-cap__row" style={{ fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>{t("pot.goal", { target: fmt(pot.target) })}</span>
            <span>{pct(Number((have * 10000n) / (BigInt(pot.target) || 1n)))}</span>
          </div>
          <ProgressBar value={Number(have)} max={Number(pot.target)} label={t("pots.goalProgress")} tone="accent" />
          <p className="oi-small" style={{ margin: 0 }}>
            {eta.etaMs === 0 ? t("pot.goalReached") : eta.etaMs ? t("pot.eta", { date: fmtDate(eta.etaMs) }) : t("pot.noEta")}
          </p>
          <p className="oi-micro oi-muted" style={{ margin: 0 }}>{eta.assumption}</p>
        </section>
      )}

      {!flex && config?.features.earn !== false && o.config.lending && (
        <GroupedList label={t("nav.earn")}>
          <ListRow icon="earn" color="mint" title={t("pot.earnTitle")} subtitle={pot.earn ? t("pot.earnOnSub", { amount: fmt(total(pot.earn_supplied)) }) : t("pot.earnOffSub")}
            trailing={<Toggle checked={pot.earn && total(pot.earn_supplied) > 0n} label={t("pot.earnTitle")} onChange={() => setSheet("earn")} data-testid="pot-earn-toggle" />} />
        </GroupedList>
      )}

      <section aria-labelledby="pot-history">
        <SectionTitle id="pot-history">{t("pot.history")}</SectionTitle>
        {act.data ? <ActivityList items={history} pots={o.pots} agents={o.agents} /> : <PageSkeleton rows={2} />}
      </section>

      {!flex && (
        <Button variant="danger-soft" block disabled={!empty} onClick={() => setSheet("delete")}>{empty ? t("pot.delete") : t("pot.deleteNotEmpty")}</Button>
      )}

      <MoveSheet open={sheet === "in"} onOpenChange={(v) => !v && setSheet(null)} overview={o} toPot={pot.id} />
      <MoveSheet open={sheet === "out"} onOpenChange={(v) => !v && setSheet(null)} overview={o} fromPot={pot.id} />
      {sheet === "lock" && <LockSheet pot={pot} onClose={() => setSheet(null)} />}
      {sheet === "earn" && <EarnSheet pot={pot} overview={o} onClose={() => setSheet(null)} />}
      {sheet === "edit" && <EditPotSheet pot={pot} onClose={() => setSheet(null)} />}
      {sheet === "delete" && <DeletePotSheet pot={pot} onClose={() => setSheet(null)} />}
    </div>
  );
}

/* ---------------- Lock: full-screen, hold to confirm ---------------- */
function LockSheet({ pot, onClose }: { pot: Pot; onClose: () => void }) {
  const t = useT();
  const { exec } = useMoney();
  const current = pot.unlock_at ? nsToMs(pot.unlock_at) : 0;
  const now = new Date();
  const options = useMemo(() => {
    const addMonths = (m: number) => { const d = new Date(now); d.setMonth(d.getMonth() + m); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const jan1 = new Date(now.getFullYear() + 1, 0, 1).getTime();
    return [
      { key: "3m", label: t("lock.months", { n: 3 }), at: addMonths(3) },
      { key: "6m", label: t("lock.months", { n: 6 }), at: addMonths(6) },
      { key: "1y", label: t("lock.year"), at: addMonths(12) },
      { key: "jan", label: fmtDate(jan1), at: jan1 },
    ].filter((o) => o.at > Math.max(current, Date.now()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  const [pick, setPick] = useState(options[options.length > 1 ? 1 : 0]?.key);
  const chosen = options.find((o) => o.key === pick);
  const date = chosen ? fmtDate(chosen.at) : "";
  return (
    <ConfirmSheet
      open
      full
      onOpenChange={(v) => !v && onClose()}
      testId="lock-sheet"
      title={current ? t("lock.extendTitle", { pot: pot.name }) : t("lock.title", { pot: pot.name })}
      sentence={<span data-testid="lock-copy">{t("lock.copy", { date })}</span>}
      details={
        <>
          <div role="radiogroup" aria-label={t("lock.until")} className="oi-chips" style={{ justifyContent: "flex-start" }}>
            {options.map((o) => <button key={o.key} type="button" role="radio" aria-checked={o.key === pick} className="oi-chip" onClick={() => setPick(o.key)}>{o.label}</button>)}
          </div>
          <Note tone="info">{t("lock.addAnytime")}</Note>
        </>
      }
      confirmLabel={t("lock.confirm")}
      successText={t("lock.done", { date })}
      onConfirm={() => (current ? exec("extendLock", pot.id, msToNs(chosen!.at)) : exec("lock", pot.id, msToNs(chosen!.at)))}
      control={(go, busy) => (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <HoldToConfirm label={busy ? t("common.holding") : t("lock.hold")} doneLabel={t("common.locked")} onConfirm={go} disabled={!chosen || busy} testId="lock-hold" />
        </div>
      )}
    />
  );
}

/* ---------------- Earn (variable rate) ---------------- */
function EarnSheet({ pot, overview, onClose }: { pot: Pot; overview: Overview; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const { exec } = useMoney();
  const rates = useEarnRates();
  const supplied = total(pot.earn_supplied) > 0n;
  const [coin, setCoin] = useState<Token>(supplied ? bigger(pot.earn_supplied) : bigger(pot.balances));
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ title: string; next: string } | null>(null);
  const [mode, setMode] = useState<"on" | "off">(supplied ? "off" : "on");
  const asset = rates.data?.assets.find((a) => a.token === coin);
  const maxBps = overview.config.max_utilization_bps;
  const paused = !!asset && (asset.paused || asset.utilizationBps > maxBps);
  const avail = mode === "on" ? pot.balances[coin] : pot.earn_supplied[coin];
  const units = parseUnits(amount);
  const over = units !== null && BigInt(units) > BigInt(avail);
  const locked = isLocked(pot);

  const go = async () => {
    if (!units) return;
    setBusy(true); setErr(null);
    try {
      await (mode === "on" ? exec("earnOn", pot.id, coin, units) : exec("earnOff", pot.id, coin, units));
      toast.show({ message: mode === "on" ? t("earn.startedToast") : t("earn.stoppedToast"), tone: "success" });
      onClose();
    } catch (e) { setErr(explain(e)); } finally { setBusy(false); }
  };

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={t("pot.earnTitle")} closeLabel={t("common.close")} dismissible={!busy} testId="earn-sheet"
      footer={<Button block size="lg" loading={busy} disabled={!units || over || (mode === "on" && paused)} onClick={go}>
        {units ? t(mode === "on" ? "earn.confirmOn" : "earn.confirmOff", { amount: fmtToken(units, coin), pot: pot.name }) : t("common.continue")}
      </Button>}>
      {supplied && (
        <SegmentedControl label={t("pot.earnTitle")} value={mode} onChange={(m) => { setMode(m); setAmount(""); }}
          items={[{ value: "on", label: t("earn.addMore") }, { value: "off", label: t("earn.takeOut") }]} />
      )}
      <SegmentedControl label={t("common.token")} value={coin} onChange={(v) => { setCoin(v); setAmount(""); }} items={[{ value: "usdt", label: "USDT" }, { value: "usdc", label: "USDC" }]} />
      <div className="oi-card" style={{ background: "var(--surface-2)" }}>
        <div className="oi-cap__row"><span>{t("earn.todayRate")}</span><span data-testid="earn-rate">{asset ? pct(Math.round(Number(asset.supplyApr) * 10000)) : t("common.na")}</span></div>
        <div className="oi-cap__row" style={{ marginTop: 8 }}><span>{t("earn.utilization")}</span><span>{asset ? pct(asset.utilizationBps) : t("common.na")}</span></div>
        {asset && <div style={{ marginTop: 6 }}><ProgressBar value={asset.utilizationBps} max={10000} warnAt={maxBps / 10000 - 0.05} label={t("earn.utilization")} /></div>}
        {rates.data && <p className="oi-micro oi-muted" style={{ margin: "8px 0 0" }}>{t("earn.source", { source: rates.data.source, time: new Date(rates.data.fetchedAt).toLocaleTimeString() })}</p>}
      </div>
      {mode === "on" && paused && <Note tone="warning" title={t("earn.pausedTitle")}>{t("earn.pausedBody", { max: pct(maxBps) })}</Note>}
      {mode === "on" && <RiskNote title={t("earn.riskTitle")} points={[t("earn.risk1"), t("earn.risk2"), t("earn.risk3")]} />}
      {mode === "on" && locked && <Note tone="info">{t("earn.lockedNote")}</Note>}
      <AmountInput label={t("common.amount")} value={amount} onChange={setAmount} ticker={TICKER[coin]} keypad="never"
        sub={t("common.available", { amount: fmtToken(avail, coin) })} error={over ? t("move.tooMuch", { amount: fmtToken(avail, coin) }) : undefined}
        chips={BigInt(avail) > 0n ? [{ label: t("common.max"), value: fromUnits(avail) }] : undefined} />
      {err && <div role="alert"><Note tone="danger" title={err.title}>{t("error.next", { next: err.next })}</Note></div>}
    </Sheet>
  );
}

/* ---------------- Edit / delete ---------------- */
function EditPotSheet({ pot, onClose }: { pot: Pot; onClose: () => void }) {
  const t = useT();
  const { exec } = useMoney();
  const [name, setName] = useState(pot.name);
  const [icon, setIcon] = useState<IconConcept>(potGlyph(pot));
  const [color, setColor] = useState<TileColor>(potColor(pot));
  const [target, setTarget] = useState(pot.target ? fromUnits(pot.target) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await exec("updatePot", pot.id, { name: name.trim(), icon, color, target: pot.kind === "goal" ? parseUnits(target) : undefined });
      onClose();
    } catch (e) { const f = explain(e); setErr(`${f.title} ${f.next}`); } finally { setBusy(false); }
  };
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={t("pot.editTitle")} closeLabel={t("common.close")} dismissible={!busy}
      footer={<Button block size="lg" loading={busy} disabled={!name.trim()} onClick={save}>{t("common.save")}</Button>}>
      <Input label={t("common.name")} value={name} onChange={(e) => setName(e.target.value.slice(0, 32))} />
      {pot.kind === "goal" && <Input label={t("pots.target")} value={target} onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" suffix="USDC + USDT" />}
      <IconColorPicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} />
      {err && <p role="alert" className="oi-error-text" style={{ margin: 0 }}>{err}</p>}
    </Sheet>
  );
}

function DeletePotSheet({ pot, onClose }: { pot: Pot; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const { exec } = useMoney();
  return (
    <ConfirmSheet open onOpenChange={(v) => !v && onClose()} title={t("pot.deleteTitle", { pot: pot.name })} sentence={t("pot.deleteSentence", { pot: pot.name })}
      confirmLabel={t("pot.delete")} variant="danger" successText={t("pot.deleted")}
      onConfirm={async () => { const r = await exec("deletePot", pot.id); setTimeout(() => router.push("/pots"), 600); return r; }} />
  );
}

