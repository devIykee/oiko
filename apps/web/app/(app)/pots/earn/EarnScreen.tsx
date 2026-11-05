"use client";
import { Badge, EmptyState, GroupedList, ListRow, Note, ProgressBar, RiskNote, SectionTitle, TokenLogo } from "@oiko/ui";
import Link from "next/link";
import { PageHeader } from "@/components/app/PageHeader";
import { LoadError, PageSkeleton } from "@/components/app/States";
import { potColor, potGlyph, potName } from "@/components/app/potmeta";
import { useConfig } from "@/lib/config";
import { useEarnRates, useOverview } from "@/lib/data";
import { fmt, fmtDateTime, fmtTotal, pct, total } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { PotsTabs } from "../PotsScreen";

export function EarnScreen() {
  const t = useT();
  const { config } = useConfig();
  const ov = useOverview();
  const rates = useEarnRates();
  const maxBps = ov.data?.config.max_utilization_bps ?? 9200;

  return (
    <div className="oi-col oi-page" data-testid="earn">
      <PageHeader title={t("nav.pots")} />
      <PotsTabs current="earn" />
      {config && !config.features.earn ? <EmptyState icon="earn" title={t("earn.offTitle")} body={t("earn.offBody")} /> : (
        <>
          <section aria-labelledby="rates" className="oi-stack-sm">
            <SectionTitle id="rates">{t("earn.ratesTitle")}</SectionTitle>
            {rates.error && !rates.data ? <LoadError error={rates.error} onRetry={rates.refresh} /> : !rates.data ? <PageSkeleton rows={2} /> : (
              <div className="oi-stack-sm">
                {rates.data.assets.map((a) => {
                  const paused = a.paused || a.utilizationBps > maxBps;
                  return (
                    <div key={a.token} className="oi-card oi-stack-sm" data-testid={`earn-rate-${a.token}`}>
                      <div className="oi-row">
                        <TokenLogo token={a.token} size={28} />
                        <span style={{ fontWeight: 600, flex: 1 }}>{a.token.toUpperCase()}</span>
                        {paused ? <Badge tone="warning" icon="warning">{t("earn.paused")}</Badge> : <Badge tone="success">{t("earn.open")}</Badge>}
                      </div>
                      <div className="oi-cap__row"><span>{t("earn.todayRate")}</span><span style={{ fontWeight: 600, color: "var(--ink)" }}>{pct(Math.round(Number(a.supplyApr) * 10000))}</span></div>
                      <div className="oi-cap__row"><span>{t("earn.utilization")}</span><span>{pct(a.utilizationBps)}</span></div>
                      <ProgressBar value={a.utilizationBps} max={10000} warnAt={maxBps / 10000 - 0.05} label={t("earn.utilization")} />
                      {paused && <Note tone="warning">{t("earn.pausedBody", { max: pct(maxBps) })}</Note>}
                    </div>
                  );
                })}
                <p className="oi-micro oi-muted" style={{ margin: 0 }}>{t("earn.source", { source: rates.data.source, time: fmtDateTime(Date.parse(rates.data.fetchedAt)) })}</p>
              </div>
            )}
          </section>
          <section aria-labelledby="earn-pots">
            <SectionTitle id="earn-pots">{t("earn.yourPots")}</SectionTitle>
            {!ov.data ? <PageSkeleton rows={3} /> : (
              <GroupedList label={t("earn.yourPots")}>
                {ov.data.pots.filter((p) => p.kind !== "flex").map((p) => (
                  <ListRow key={p.id} href={`/pots/${p.id}`} as={Link} icon={potGlyph(p)} color={potColor(p)} title={potName(p, t)} chevron
                    subtitle={total(p.earn_supplied) > 0n ? t("pot.earnOnSub", { amount: fmt(total(p.earn_supplied)) }) : t("earn.notEarning")}
                    amount={fmtTotal(p.balances)} />
                ))}
              </GroupedList>
            )}
          </section>
          <RiskNote title={t("earn.riskTitle")} points={[t("earn.risk1"), t("earn.risk2"), t("earn.risk3")]} />
        </>
      )}
    </div>
  );
}
