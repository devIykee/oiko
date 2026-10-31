"use client";
import { Button, GroupedList, Icon, ListRow, Note, SectionTitle, useToast } from "@oiko/ui";
import { monthOfMs, prevMonth, splitPreview, type Overview, type SplitRule } from "@oiko/sdk";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { LoadError, PageSkeleton } from "@/components/app/States";
import { potColor, potGlyph, potName } from "@/components/app/potmeta";
import { explain, useMoney } from "@/lib/actions";
import { useMonthStats, useOverview } from "@/lib/data";
import { fmt, fmtMonth, fmtTotal, pct, total } from "@/lib/format";
import { useT } from "@/lib/i18n";

const toRules = (o: Overview) => Object.fromEntries(o.splits.filter((r) => r.mode === "percent").map((r) => [r.pot_id, Number(r.value)]));

export function PlanScreen() {
  const t = useT();
  const toast = useToast();
  const ov = useOverview();
  const month = monthOfMs(Date.now());
  const stats = useMonthStats(prevMonth(month), month);
  const { exec } = useMoney();
  const [bps, setBps] = useState<Record<number, number> | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (ov.data && !editing) setBps(toRules(ov.data)); }, [ov.data, editing]);

  const o = ov.data;
  const targets = useMemo(() => (o?.pots ?? []).filter((p) => p.kind !== "flex"), [o]);
  const fixed = (o?.splits ?? []).filter((r) => r.mode === "fixed");
  const sum = Object.values(bps ?? {}).reduce((a, b) => a + b, 0);
  const rules: SplitRule[] = useMemo(() => [
    ...Object.entries(bps ?? {}).filter(([, v]) => v > 0).map(([id, v]) => ({ pot_id: Number(id), mode: "percent" as const, value: String(v) })),
    ...fixed,
  ], [bps, fixed]);

  if (ov.error && !o) return <div className="oi-col oi-page"><LoadError error={ov.error} onRetry={ov.refresh} /></div>;
  if (!o || !bps) return <div className="oi-col"><PageSkeleton rows={4} /></div>;

  const thisM = stats.data?.find((s) => s.month === month);
  const lastM = stats.data?.find((s) => s.month === prevMonth(month));
  const moneyIn = thisM ? total(thisM.in) : 0n;
  const previewBase = 100_000_000n; // 100 USDT
  const preview = splitPreview(rules, previewBase.toString(), o.pots);
  const spendShareBps = BigInt(Math.max(0, 10000 - sum));
  const expected = lastM ? total(lastM.in) : 0n;
  const notYet = expected > moneyIn ? ((expected - moneyIn) * spendShareBps) / 10000n : 0n;
  const leftToSpend = total(o.flex) + notYet;

  const segs = [
    ...targets.filter((p) => (bps[p.id] ?? 0) > 0).map((p) => ({ id: p.id, name: potName(p, t), color: potColor(p), bps: bps[p.id]!, icon: potGlyph(p) })),
    { id: 0, name: t("pot.kind.flex"), color: "blue" as const, bps: Math.max(0, 10000 - sum), icon: "spend" as const },
  ];
  const base = moneyIn > 0n ? moneyIn : previewBase;

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await exec("setSplits", rules);
      toast.show({ message: t("plan.saved"), tone: "success" });
      setEditing(false);
    } catch (e) { const f = explain(e); setErr(`${f.title} ${f.next}`); } finally { setBusy(false); }
  };

  return (
    <div className="oi-col oi-page" data-testid="plan">
      <PageHeader title={t("plan.title")} sub={t("plan.sub")} />

      <section className="oi-card oi-stack" aria-labelledby="month-in">
        <div className="oi-row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <div id="month-in" className="oi-small oi-muted">{t("plan.moneyIn", { month: fmtMonth(month, true) })}</div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }} className="oi-num" data-testid="plan-money-in">{stats.data ? fmt(moneyIn) : "…"} <span className="oi-small oi-muted" style={{ fontWeight: 600 }}>{t("common.usdcUsdt")}</span></div>
          </div>
        </div>
        <div className="oi-stackbar" role="img" aria-label={segs.map((s) => `${s.name} ${pct(s.bps)}`).join(", ")} data-testid="plan-bar">
          {segs.map((s) => <span key={s.id} data-tile={s.color} style={{ flexGrow: s.bps, flexBasis: 0 }} />)}
        </div>
        <ul className="oi-legend" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {segs.map((s) => (
            <li key={s.id} className="oi-row" style={{ padding: "6px 0", fontSize: 14 }}>
              <span className="oi-dot" data-tile={s.color} />
              <span style={{ flex: 1 }}>{s.name}</span>
              <span className="oi-num oi-muted">{pct(s.bps)}</span>
              <span className="oi-num" style={{ fontWeight: 600, minWidth: 84, textAlign: "right" }}>{fmt((base * BigInt(s.bps)) / 10000n)}</span>
            </li>
          ))}
        </ul>
        {moneyIn === 0n && <p className="oi-micro oi-muted" style={{ margin: 0 }}>{t("plan.exampleBase")}</p>}
      </section>

      <section className="oi-card" aria-labelledby="left">
        <div className="oi-row">
          <div style={{ flex: 1 }}>
            <div id="left" className="oi-small oi-muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {t("plan.leftToSpend")}
              <span title={t("plan.leftAssumption")} aria-label={t("plan.leftAssumption")} role="img" style={{ display: "inline-grid", color: "var(--ink-3)" }}><Icon name="infoInline" size={14} /></span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700 }} className="oi-num" data-testid="plan-left">{fmt(leftToSpend)} <span className="oi-small oi-muted" style={{ fontWeight: 600 }}>{t("common.usdcUsdt")}</span></div>
          </div>
        </div>
        <p className="oi-micro oi-muted" style={{ margin: "6px 0 0" }}>{t("plan.leftDetail", { spend: fmtTotal(o.flex), planned: fmt(notYet) })}</p>
      </section>

      <section aria-labelledby="rules">
        <SectionTitle id="rules" action={!editing ? <button type="button" onClick={() => setEditing(true)} data-testid="plan-edit">{t("common.edit")}</button> : undefined}>{t("plan.yourPlan")}</SectionTitle>
        <GroupedList label={t("plan.yourPlan")}>
          {targets.map((p) => (
            <ListRow key={p.id} icon={potGlyph(p)} color={potColor(p)} title={potName(p, t)}
              subtitle={editing ? undefined : t("plan.ruleSub", { pct: pct(bps[p.id] ?? 0) })}
              trailing={editing ? (
                <div className="oi-row" style={{ gap: 8, minWidth: 150 }}>
                  <input type="range" className="oi-range" min={0} max={10000} step={500} value={bps[p.id] ?? 0} aria-label={t("plan.shareFor", { pot: potName(p, t) })}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      const others = sum - (bps[p.id] ?? 0);
                      setBps({ ...bps, [p.id]: Math.min(v, 10000 - others) });
                    }} style={{ width: 100 }} data-testid={`plan-slider-${p.id}`} />
                  <span className="oi-num" style={{ width: 44, textAlign: "right", fontWeight: 600 }}>{pct(bps[p.id] ?? 0)}</span>
                </div>
              ) : <span className="oi-num" style={{ fontWeight: 600 }}>{pct(bps[p.id] ?? 0)}</span>} />
          ))}
          <ListRow icon="spend" color="blue" title={t("pot.kind.flex")} subtitle={t("plan.spendRest")} trailing={<span className="oi-num" style={{ fontWeight: 600 }}>{pct(Math.max(0, 10000 - sum))}</span>} />
        </GroupedList>
        {fixed.length > 0 && <p className="oi-small oi-muted">{t("plan.fixedNote", { n: fixed.length })}</p>}
      </section>

      <Note tone="info" title={t("plan.previewTitle")}>
        <span data-testid="plan-preview">
          {t("plan.preview", { parts: preview.map((x) => t("plan.previewPart", { amount: fmt(x.amount, 0).replace(/\.00$/, ""), pot: x.pot_id === 0 ? t("pot.kind.flex") : x.name })).join(", ") })}
        </span>
      </Note>

      {editing && (
        <div className="oi-stack-sm">
          {err && <p role="alert" className="oi-error-text" style={{ margin: 0 }}>{err}</p>}
          <Button block size="lg" loading={busy} onClick={save} data-testid="plan-save">{t("plan.save")}</Button>
          <Button block variant="ghost" onClick={() => { setEditing(false); setBps(toRules(o)); }}>{t("common.cancel")}</Button>
        </div>
      )}
    </div>
  );
}
