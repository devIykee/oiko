// Verified billers: a small, curated directory of payees Oiko has checked by hand. The counterparty check treats a
// verified biller as "allow" (reason VERIFIED_BILLER) instead of warning about account age or low activity, but a
// biller that is reported as a scam is still blocked. Global names only. Every entry says how it was checked.
import type { NetworkId } from "@oiko/sdk";

export type BillerCategory = "internet" | "electricity" | "water" | "phone" | "rent" | "insurance" | "subscriptions";

export interface Biller {
  accountId: string;
  name: string;
  category: BillerCategory;
  networks: NetworkId[];
  /** How the entry was verified (a reader can check it). */
  evidence: string;
}

export const VERIFIED_BILLERS: readonly Biller[] = [
  {
    accountId: "brightline-fibre.testnet",
    name: "Brightline Fibre",
    category: "internet",
    networks: ["testnet"],
    evidence: "Demo biller created by the Oiko team on 2026-11-05; registered on usdc.oiko.testnet and usdt.oiko.testnet. Keys held by the team.",
  },
  {
    accountId: "metro-power-co.testnet",
    name: "Metro Power",
    category: "electricity",
    networks: ["testnet"],
    evidence: "Demo biller created by the Oiko team on 2026-11-05; registered on usdc.oiko.testnet and usdt.oiko.testnet. Keys held by the team.",
  },
];

export function verifiedBiller(accountId: string, network: NetworkId): Biller | null {
  const id = accountId.trim().toLowerCase();
  return VERIFIED_BILLERS.find((b) => b.accountId === id && b.networks.includes(network)) ?? null;
}

export function billersFor(network: NetworkId): Array<Pick<Biller, "accountId" | "name" | "category">> {
  return VERIFIED_BILLERS.filter((b) => b.networks.includes(network)).map(({ accountId, name, category }) => ({ accountId, name, category }));
}
