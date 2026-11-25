// Veil view key: derived from the owner key, so every device that can sign in as the owner gets the same one.
// It opens private labels (pot and bill names, agent reasons). It stays in this browser and is never sent to Oiko.
import { Veil, deriveViewKey, encodeViewKey } from "@oiko/sdk";

export const viewKeyFor = (ownerSecretKey: string, accountId: string) => encodeViewKey(deriveViewKey(ownerSecretKey, accountId));

const cache = new Map<string, Veil>();
export function veilFor(viewKey: string | undefined, vaultId: string): Veil | null {
  if (!viewKey) return null;
  const k = `${vaultId}|${viewKey}`;
  let v = cache.get(k);
  if (!v) {
    try { v = Veil.fromViewKey(viewKey, vaultId); } catch { return null; }
    cache.set(k, v);
  }
  return v;
}
