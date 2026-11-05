"use client";
import { explorerAccountUrl, networkLabel, useSiteConfig } from "./live";

export function FooterContracts() {
  const { config } = useSiteConfig();
  const c = config.contracts;
  const rows = ([["Names", c.registry], ["USDC", c.usdc], ["USDT", c.usdt], ["ROSCA savings", c.ajo]] as const).filter(([, v]) => v) as Array<[string, string]>;
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink">Contract accounts{networkLabel(config) ? ` · ${networkLabel(config)}` : ""}</p>
      {rows.length ? (
        <ul className="mt-3 space-y-1.5 text-[13px]">
          {rows.map(([k, v]) => {
            const href = explorerAccountUrl(config.explorer, v);
            return (
              <li key={k} className="flex gap-2 text-ink-2">
                <span className="w-12 shrink-0">{k}</span>
                {href ? <a href={href} target="_blank" rel="noreferrer" className="truncate font-mono hover:text-ink">{v}</a> : <span className="truncate font-mono">{v}</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] text-ink-2">n/a</p>
      )}
    </div>
  );
}
