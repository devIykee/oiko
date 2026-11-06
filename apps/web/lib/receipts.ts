// Shared by the server (recording) and the app (showing "fee 0.20" on incoming payments).
import type { Token } from "@oiko/sdk";

export interface Receipt { depositAddress: string; amountIn: string; originDecimals: number; amountOut: string; fee: string; token: Token; originSymbol: string; createdAt: string }

/** The receipt for an incoming activity row: same amount arrived, quoted before it, within 6 hours; closest wins. */
export function matchReceipt(receipts: Receipt[], row: { amount: string | null; token: string | null; atMs: number }): Receipt | null {
  if (!row.amount) return null;
  let best: Receipt | null = null, gap = Infinity;
  for (const r of receipts) {
    if (r.amountOut !== row.amount || (row.token && r.token !== row.token)) continue;
    const d = row.atMs - Date.parse(r.createdAt);
    if (d >= -60_000 && d <= 6 * 3_600_000 && d < gap) { best = r; gap = d; }
  }
  return best;
}
