// Paying a pay link from a Gloam private balance (docs/PRIVACY.md). Pure: shared by /pay and the server.
// Gloam (gloam.trade) is a shielded pool on EVM chains. The sender cashes out of it straight to the 1Click deposit
// address, so the payment isn't linked on-chain to the wallet that funded their Gloam balance. Oiko never sees
// a Gloam secret; it only says how much to cash out so the deposit address receives the exact quoted amount.

export interface GloamOrigin { chainId: 1 | 8453; token: `0x${string}`; pool: `0x${string}` }

// Pool and token addresses from @gloamtrade/sdk 0.7.0 (MAINNET_POOLS, constants.ts); the tokens are the same
// contracts as the 1Click asset ids below (DECISIONS: "Gloam (gloam.trade)").
const POOL = "0x39E28Cde55CAB798874746ac52cb4B5Cc99a0194";
export const GLOAM_ORIGINS: Readonly<Record<string, GloamOrigin>> = {
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near": { chainId: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", pool: POOL },
  "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near": { chainId: 1, token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", pool: POOL },
  "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near": { chainId: 1, token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", pool: POOL },
};

export function gloamOrigin(assetId: string): GloamOrigin | null {
  return Object.hasOwn(GLOAM_ORIGINS, assetId) ? GLOAM_ORIGINS[assetId] : null;
}

function checkBps(bps: number) {
  if (!Number.isInteger(bps) || bps < 0 || bps >= 10_000) throw new Error("fee must be an integer from 0 to 9999 bps");
}

/** What the pool keeps from a cash out of `amount`, rounded down like the contract (Gloam SDK `cashOutFee`). */
export function cashOutFee(amount: bigint, bps: number): bigint {
  checkBps(bps);
  const b = BigInt(bps);
  return (amount / 10_000n) * b + ((amount % 10_000n) * b) / 10_000n;
}

/** The smallest cash out that leaves at least `receive` after the pool's fee. */
export function cashOutFor(receive: bigint, bps: number): bigint {
  checkBps(bps);
  if (receive <= 0n) return 0n;
  let g = (receive * 10_000n + BigInt(9_999 - bps)) / BigInt(10_000 - bps); // ceil(receive / (1 - fee))
  while (g > 0n && g - 1n - cashOutFee(g - 1n, bps) >= receive) g--;
  while (g - cashOutFee(g, bps) < receive) g++;
  return g;
}
