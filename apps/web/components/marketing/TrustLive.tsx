"use client";
// Contract ids and the vault code hash, read at runtime from /api/config (fallback NEXT_PUBLIC_OIKO_*). "n/a" when unknown.
import { explorerAccountUrl, useSiteConfig } from "./live";
import { Glyph, arrowUpRight } from "./f7";

export function TrustLive() {
  const { config, loaded } = useSiteConfig();
  const c = config.contracts;
  const rows: Array<[string, string | null, string]> = [
    ["Name registry", c.registry, "Creates names and each person’s account. Holds no money."],
    ["USDC", c.usdc, "The USDC stablecoin contract (issued by Circle)."],
    ["USDT", c.usdt, "The USDT stablecoin contract (issued by Tether)."],
    ["Lending (Earn)", c.lending, "Rhea lending market used only by pots with Earn switched on."],
    ["Ajo circles", c.ajo, "Holds circle contributions and bonds under fixed rules."],
  ];
  return (
    <div className="space-y-4">
      <div className="rounded-card bg-surface p-6">
        <p className="text-[13px] font-semibold text-ink-2">Account code fingerprint (sha256 code hash)</p>
        <p className="mt-2 break-all font-mono text-[15px]">{config.vaultCodeHash ?? (loaded ? "n/a" : "…")}</p>
        <p className="mt-3 text-[14px] text-ink-2">Every Oiko account runs this exact code. You can compare it with the hash of the code built from the open-source repository.</p>
      </div>
      <div className="overflow-hidden rounded-card bg-surface">
        <div className="flex items-center justify-between border-b border-line px-6 py-4 text-[13px] font-semibold text-ink-2">
          <span>Contract accounts</span>
          <span>{config.network ?? "n/a"}</span>
        </div>
        <ul className="divide-y divide-line">
          {rows.map(([label, id, note]) => {
            const href = id ? explorerAccountUrl(config.explorer, id) : null;
            return (
              <li key={label} className="grid gap-1 px-6 py-4 md:grid-cols-[180px_1fr] md:gap-6">
                <span className="text-[15px] font-semibold">{label}</span>
                <span className="min-w-0">
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 break-all font-mono text-[14px] text-accent hover:underline">{id} <Glyph d={arrowUpRight} size={11} className="shrink-0" /></a>
                  ) : (
                    <span className="break-all font-mono text-[14px]">{id ?? "n/a"}</span>
                  )}
                  <span className="mt-1 block text-[14px] text-ink-2">{note}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
