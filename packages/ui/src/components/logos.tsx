// Coin and chain logos. Marks come verbatim from @web3icons/core (MIT); see logoData.ts.
// ChainLogo: the chain's mark on a neutral tile. TokenLogo: USDC/USDT round coin.
// AssetLogo: chain tile with a small coin badge (bottom right), e.g. "USDT on TRON".
import { useId } from "react";
import { LOGO_SVG } from "./logoData";

type ChainKey = "tron" | "base" | "bsc" | "eth" | "sol" | "arb" | "pol" | "near";
const CHAIN_ALIAS: Record<string, ChainKey> = {
  tron: "tron", trx: "tron",
  base: "base",
  bsc: "bsc", bnb: "bsc", "bnb chain": "bsc", "binance-smart-chain": "bsc",
  eth: "eth", ethereum: "eth",
  sol: "sol", solana: "sol",
  arb: "arb", arbitrum: "arb", "arbitrum-one": "arb",
  pol: "pol", polygon: "pol", matic: "pol",
  near: "near",
};

export function chainKey(chain: string | null | undefined): ChainKey | null {
  return chain ? CHAIN_ALIAS[chain.trim().toLowerCase()] ?? null : null;
}

function tokenKey(token: string | null | undefined): "usdc" | "usdt" | null {
  const t = token?.trim().toLowerCase();
  return t === "usdc" ? "usdc" : t === "usdt" || t === "usdt0" ? "usdt" : null;
}

const COIN = { display: "inline-grid", placeItems: "center", flex: "none", borderRadius: "50%", overflow: "hidden", verticalAlign: "middle" } as const;

function Mark({ svg, size, round }: { svg: string; size: number; round?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable={false}
      style={{ display: "block", flex: "none", borderRadius: round ? "50%" : undefined }}
      dangerouslySetInnerHTML={{ __html: svg.replaceAll("{{id}}", `oi${id}`) }} />
  );
}

/** Round USDC/USDT coin. Unknown tickers fall back to a neutral round monogram. */
export function TokenLogo({ token, size = 20, className }: { token: string; size?: number; className?: string }) {
  const k = tokenKey(token);
  const box = { ...COIN, width: size, height: size };
  if (!k) return <span aria-hidden className={className} style={{ ...box, background: "var(--surface-2)", color: "var(--ink-2)", fontWeight: 700, fontSize: Math.round(size * 0.42) }}>{token.slice(0, 1).toUpperCase()}</span>;
  return <span aria-hidden className={className} style={box}><Mark svg={LOGO_SVG[k]} size={size} round /></span>;
}

/** Chain mark on a neutral tile. Unknown chains fall back to a short monogram. */
export function ChainLogo({ chain, size = 36 }: { chain: string; size?: number }) {
  const k = chainKey(chain);
  return (
    <span aria-hidden style={{ display: "inline-grid", placeItems: "center", flex: "none", background: "var(--surface-2)", color: "var(--ink)", width: size, height: size, borderRadius: Math.round(size * 0.28) }}>
      {k ? <Mark svg={LOGO_SVG[k]} size={Math.round(size * 0.72)} /> : <span style={{ fontWeight: 700, letterSpacing: "-0.02em", fontSize: Math.round(size * 0.34) }}>{chain.slice(0, 3).toUpperCase()}</span>}
    </span>
  );
}

/** Chain tile with a coin badge, for "USDT on TRON" style rows. */
export function AssetLogo({ chain, token, size = 36 }: { chain: string; token?: string | null; size?: number }) {
  const badge = Math.round(size * 0.48);
  return (
    <span aria-hidden style={{ position: "relative", display: "inline-block", flex: "none", width: size, height: size }}>
      <ChainLogo chain={chain} size={size} />
      {token && <span style={{ position: "absolute", right: -Math.round(size * 0.1), bottom: -Math.round(size * 0.1), display: "grid", borderRadius: "50%", boxShadow: `0 0 0 ${size >= 28 ? 2 : 1.5}px var(--surface)` }}><TokenLogo token={token} size={badge} /></span>}
    </span>
  );
}
