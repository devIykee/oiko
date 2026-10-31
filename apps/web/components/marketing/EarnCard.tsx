"use client";
// Earn appears only if the feature is on. The rate is shown only when /api/rates/earn returns one; never hardcoded.
import { useJson, useSiteConfig } from "./live";
import { chartBarAltFill } from "./f7";
import { IconTile } from "./ui";

type Rates = { source?: string; fetchedAt?: string; assets?: Array<{ token: string; supplyApr: string; utilizationBps: number; paused: boolean }> };

export function EarnCard() {
  const { config } = useSiteConfig();
  const { data } = useJson<Rates>("/api/rates/earn");
  if (config.features.earn === false) return null;
  const live = (data && data.source !== "fixture" ? data.assets ?? [] : []).filter((a) => !a.paused && a.supplyApr && Number.isFinite(Number(a.supplyApr)));
  return (
    <li className="flex flex-col rounded-card bg-surface p-6 md:p-8" style={{ ["--i" as string]: 2 }}>
      <IconTile color="mint" size={44} solid d={chartBarAltFill} />
      <h3 className="mt-5 text-[22px] font-bold tracking-[-0.02em] font-display">Earn (variable rate)</h3>
      <p className="mt-2 text-[15px] text-ink-2">Switch on Earn for a pot and it is lent out to earn a variable rate. You can switch it off any time the lending pool has room.</p>
      {live.length ? (
        <dl className="mt-5 flex gap-6">
          {live.map((a) => (
            <div key={a.token}>
              <dt className="text-[12px] text-ink-2">{a.token.toUpperCase()}, today&rsquo;s rate</dt>
              <dd className="text-[22px] font-bold tabular tracking-[-0.02em]">{(Number(a.supplyApr) * 100).toFixed(2)}%</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="mt-auto pt-5 text-[13px] font-medium text-warning-ink">Rates change and can go to zero. Lending carries risk.</p>
    </li>
  );
}
