// Gloam cash-out amounts for /pay (docs/PRIVACY.md). The fee is read live from Gloam's pool, never hardcoded:
// when it can't be read the answer has no amount and the page says "n/a".
import { cashOutFor, gloamOrigin } from "../lib/privatePay";
import { serverConfig } from "./config";
import { ApiError } from "./errors";

/** keccak256("withdrawFeeBps()")[0..4]: the pool's fee getter (Gloam SDK `POOL_FEE_ABI`), checked live on 2026-11-12. */
const WITHDRAW_FEE_BPS = "0x7aca2b59";
const CACHE_MS = 5 * 60_000;

function rpcUrl(chainId: number, env: Record<string, string | undefined> = process.env): string {
  return chainId === 8453 ? env.GLOAM_RPC_BASE?.trim() || "https://mainnet.base.org" : env.GLOAM_RPC_ETHEREUM?.trim() || "https://ethereum-rpc.publicnode.com";
}

const feeCache = new Map<string, { at: number; bps: number }>();

/** Gloam's cash-out fee in basis points on that chain's pool, or null when it can't be read. */
export async function gloamFeeBps(chainId: number, pool: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<number | null> {
  const key = `${chainId}:${pool.toLowerCase()}`;
  const hit = feeCache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.bps;
  try {
    const res = await fetcher(rpcUrl(chainId), {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(5_000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: pool, data: WITHDRAW_FEE_BPS }, "latest"] }),
    });
    const out = (await res.json()) as { result?: string };
    if (!res.ok || typeof out.result !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(out.result)) return null;
    const bps = Number(BigInt(out.result));
    if (!Number.isInteger(bps) || bps < 0 || bps >= 10_000) return null;
    feeCache.set(key, { at: now, bps });
    return bps;
  } catch {
    return null;
  }
}

export function resetPrivatePayCacheForTests() { feeCache.clear(); }

export interface PrivatePayQuote {
  /** What the deposit address must receive (base units, the 1Click quote's amountIn). */
  receive: string;
  /** Gloam's cash-out fee right now, or null if it couldn't be read. */
  feeBps: number | null;
  /** How much to cash out of Gloam so `receive` arrives, or null without a fee. */
  cashOut: string | null;
  chainId: number;
  source: string;
}

export async function privatePayQuote(assetId: string, receive: string, fetcher: typeof fetch = fetch): Promise<PrivatePayQuote> {
  if (!serverConfig().features.privatePay) throw new ApiError("E_DISABLED", 404, "Paying from a Gloam balance is not enabled here.");
  const origin = gloamOrigin(assetId);
  if (!origin) throw new ApiError("E_BAD_REQUEST", 400, "Gloam can't pay from this place.");
  if (!/^[1-9][0-9]{0,30}$/.test(receive)) throw new ApiError("E_BAD_REQUEST", 400, "The amount must be a whole number of base units.");
  const feeBps = await gloamFeeBps(origin.chainId, origin.pool, fetcher);
  return {
    receive, feeBps, chainId: origin.chainId,
    cashOut: feeBps === null ? null : cashOutFor(BigInt(receive), feeBps).toString(),
    source: `gloam:${origin.chainId}:${origin.pool}`,
  };
}
