"use client";
import { EmptyState, GroupedList, ListRow, SectionTitle } from "@oiko/ui";
import { computeInsights, monthOfMs, prevMonth, sumBalances } from "@oiko/sdk";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { LoadError, PageSkeleton } from "@/components/app/States";
import { useActivity, useMonthStats } from "@/lib/data";
import { fmt, fmtMonth, pct } from "@/lib/format";
import { useT } from "@/lib/i18n";

export function InsightsScreen() {
  const t = useT();
  const current = monthOfMs(Date.now());
  let first = current;
  for (let i = 0; i < 5; i++) first = prevMonth(first);
  const stats = useMonthStats(first, current);
  const act = useActivity(200);
  const [month, setMonth] = useState(current);

  if (stats.error && !stats.data) return <div className="oi-col oi-page"><PageHeader title={t("nav.insights")} /><LoadError error={stats.error} onRetry={stats.refresh} /></div>;
  if (!stats.data) return <div className="oi-col"><PageSkeleton rows={4} /></div>;
  const ins = computeInsights(stats.data, act.data ?? [], month);
  const maxBar = ins.trend.reduce((m, s) => { const a = BigInt(sumBalances(s.in)), b = BigInt(sumBalances(s.out)); return a > m ? a : b > m ? b : m; }, 1n);
  const months = ins.trend.map((s) => s.month);

  return (
    <div className="oi-col oi-page" data-testid="insights">
      <PageHeader title={t("nav.insights")} sub={t("insights.sub")} />
      <div className="oi-chips" role="radiogroup" aria-label={t("insights.month")} style={{ justifyContent: "flex-start", flexWrap: "nowrap", overflowX: "auto" }}>
        {[...months].reverse().map((m) => (
          <button key={m} type="button" role="radio" aria-checked={m === month} className="oi-chip" onClick={() => setMonth(m)}>{fmtMonth(m)}</button>
        ))}
      </div>
      <p className="oi-small oi-muted" style={{ margin: 0 }} data-testid="insights-period">{t("insights.period", { month: fmtMonth(month, true) })}</p>
      <div className="oi-pots">
        {[
          { k: "in", label: t("insights.in"), v: fmt(sumBalances(ins.moneyIn)) },
          { k: "out", label: t("insights.out"), v: fmt(sumBalances(ins.moneyOut)) },
          { k: "saved", label: t("insights.saved"), v: fmt(sumBalances(ins.saved)) },
          { k: "rate", label: t("insights.rate"), v: BigInt(sumBalances(ins.moneyIn)) > 0n ? pct(ins.savingsRateBps) : t("common.na") },
        ].map((c) => (
          <div key={c.k} className="oi-card" data-testid={`insight-${c.k}`}>
            <div className="oi-small oi-muted">{c.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }} className="oi-num">{c.v}</div>
          </div>
        ))}
      </div>
      <p className="oi-micro oi-muted" style={{ margin: "-12px 4px 0" }}>{t("insights.unit")}</p>

      <section aria-labelledby="trend" className="oi-card">
        <SectionTitle id="trend">{t("insights.trend")}</SectionTitle>
        <div className="oi-bars" role="img" aria-label={ins.trend.map((s) => t("insights.barLabel", { month: fmtMonth(s.month), in: fmt(sumBalances(s.in)), out: fmt(sumBalances(s.out)) })).join("; ")}>
          {ins.trend.map((s) => (
            <div key={s.month} className="oi-bars__col">
              <div className="oi-bars__pair">
                <span className="oi-bars__bar" style={{ height: `${Number((BigInt(sumBalances(s.in)) * 1000n) / maxBar) / 10}%`, opacity: s.month === month ? 1 : 0.55 }} />
                <span className="oi-bars__bar oi-bars__bar--out" style={{ height: `${Number((BigInt(sumBalances(s.out)) * 1000n) / maxBar) / 10}%`, opacity: s.month === month ? 1 : 0.55 }} />
              </div>
              <span className="oi-bars__label">{fmtMonth(s.month)}</span>
            </div>
          ))}
        </div>
        <div className="oi-row oi-small oi-muted" style={{ gap: 16, marginTop: 8 }}>
          <span className="oi-row" style={{ gap: 6 }}><span className="oi-dot" style={{ background: "var(--accent)" }} />{t("insights.in")}</span>
          <span className="oi-row" style={{ gap: 6 }}><span className="oi-dot" style={{ background: "var(--ink-3)" }} />{t("insights.out")}</span>
        </div>
      </section>

      <section aria-labelledby="payees">
        <SectionTitle id="payees">{t("insights.topPayees")}</SectionTitle>
        {ins.topPayees.length === 0 ? <div className="oi-card"><EmptyState icon="people" title={t("insights.noPayees")} /></div> : (
          <GroupedList label={t("insights.topPayees")}>
            {ins.topPayees.map((p) => <ListRow key={p.to} icon="person" color="stone" title={p.to} amount={fmt(p.amount)} meta={t("common.usdcUsdt")} />)}
          </GroupedList>
        )}
      </section>
      <p className="oi-micro oi-muted" style={{ margin: 0 }}>{t("insights.agentNote")}</p>
    </div>
  );
}
