"use client";
// Private labels (Veil) for the signed-in account:
//   reads  open sealed labels with the view key, or show "Private" on a device that doesn't have it yet
//   writes seal new pot and bill names when the "Private labels" setting is on and the view key is here
import type { Veil, VaultPrivacy } from "@oiko/sdk";
import { useMemo } from "react";
import { useSession } from "./session";
import { useSettings } from "./settings";
import { veilFor } from "./viewKey";

export type PrivacyState = "on" | "off" | "locked";

export function usePrivacy(): { veil: Veil | null; reads: VaultPrivacy; writes: Veil | undefined; state: PrivacyState } {
  const { session } = useSession();
  const { settings } = useSettings();
  return useMemo(() => {
    const veil = session ? veilFor(session.viewKey, session.vaultId) : null;
    const reads: VaultPrivacy = veil ?? "mask";
    const writes = veil && settings.privateLabels ? veil : undefined;
    const state: PrivacyState = !veil ? "locked" : settings.privateLabels ? "on" : "off";
    return { veil, reads, writes, state };
  }, [session, settings.privateLabels]);
}

/** Opens (or masks) sealed labels inside any value read from Oiko's server: change proposals, events, logs. */
export function openWith<T>(veil: Veil | null, v: T, mask: (x: T) => T): T {
  return veil ? veil.openDeep(v) : mask(v);
}
