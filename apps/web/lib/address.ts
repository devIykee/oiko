// Per-place address checks for refund and withdrawal addresses.
export function validAddress(chain: string, a: string): boolean {
  const s = a.trim();
  if (chain === "tron") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s);
  if (chain === "sol" || chain === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
  if (chain === "near") return /^([a-z0-9_-]+\.)*[a-z0-9_-]{2,64}$/.test(s) || /^[0-9a-f]{64}$/.test(s);
  if (chain === "ton") return /^[A-Za-z0-9_-]{48}$/.test(s);
  return /^0x[0-9a-fA-F]{40}$/.test(s); // EVM chains
}
