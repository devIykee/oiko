// Incoming-payment receipts: the contract's activity row only has the amount that arrived, so we keep what the payer
// sent and the fee (from the quote) per recipient account, and the app shows "sent 400.00 · fee 0.20 · arrived 399.80".
// Kept as one small JSON list per account in app_settings (last 100). Amounts are already public on chain.
import { store, type Store } from "./store";

import type { Receipt } from "../lib/receipts";
export type { Receipt };
export { matchReceipt } from "../lib/receipts";
const KEY = (vault: string) => `receipts:${vault}`;
const MAX = 100;

export async function recordReceipt(vault: string, r: Receipt, s: Store = store()): Promise<void> {
  try {
    const list = (await s.getSetting<Receipt[]>(KEY(vault))) ?? [];
    if (list.some((x) => x.depositAddress === r.depositAddress)) return;
    await s.setSetting(KEY(vault), [r, ...list].slice(0, MAX));
  } catch (e) {
    console.warn("[oiko] receipt not recorded", e);
  }
}

export async function listReceipts(vault: string, s: Store = store()): Promise<Receipt[]> {
  return (await s.getSetting<Receipt[]>(KEY(vault))) ?? [];
}
