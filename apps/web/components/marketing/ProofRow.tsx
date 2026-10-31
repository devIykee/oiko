"use client";
import { Glyph, arrowUpRight } from "./f7";
import { explorerAccountUrl, useJson, useSiteConfig } from "./live";

/** First place NEAR appears. Real contract accounts and live counts only; nothing invented, nothing shown when unknown. */
export function ProofRow() {
  const { config, loaded } = useSiteConfig();
  const { data: stats } = useJson<{ names: number | null }>("/api/stats");
  const c = config.contracts;
  const accounts = [
    c.registry && { label: "Names", id: c.registry },
    c.ajo && { label: "ROSCA savings", id: c.ajo },
  ].filter(Boolean) as Array<{ label: string; id: string }>;
  const live = accounts.length > 0 && (config.source === "api" || loaded);
  const names = typeof stats?.names === "number" && stats.names > 0 ? stats.names : null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-[14px] text-ink-2">
      {live ? (
        <span className="inline-flex items-center gap-2 font-semibold text-ink">
          <span className="size-2 rounded-full bg-success" aria-hidden />
          {config.network === "local" ? "NEAR, local development network" : `Live on NEAR${config.network && config.network !== "mainnet" ? ` ${config.network}` : ""}`}
        </span>
      ) : null}
      {live
        ? accounts.map((a) => {
            const href = explorerAccountUrl(config.explorer, a.id);
            return href ? (
              <a key={a.id} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[13px] hover:text-ink">
                <span className="font-sans text-ink-3">{a.label}</span> {a.id} <Glyph d={arrowUpRight} size={11} />
              </a>
            ) : (
              <span key={a.id} className="font-mono text-[13px]"><span className="font-sans text-ink-3">{a.label}</span> {a.id}</span>
            );
          })
        : null}
      {names !== null ? (
        <span><b className="tabular font-semibold text-ink">{names.toLocaleString("en")}</b> names claimed</span>
      ) : null}
      <span className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-[13px] font-semibold text-ink">Built at NEAR HACKATHON</span>
    </div>
  );
}
