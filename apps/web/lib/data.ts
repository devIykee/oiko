"use client";
// Data hooks. Vault reads go straight to the contract views (via @oiko/sdk); HTTP reads go to /api.
import type { Receipt } from "./receipts";
import { AjoClient, VaultClient, gatewayAuthHeader, type Activity, type Circle, type MonthStats, type Overview, type Proposal } from "@oiko/sdk";
import { useEffect } from "react";
import { api } from "./api";
import { useConfig } from "./config";
import { fixtureFetch, isFixtureMode } from "./fixtures/mode";
import { useQuery } from "./query";
import { useSession } from "./session";

export const vaultKey = (vaultId: string, what: string) => `vault:${vaultId}:${what}`;

const synced = new Set<string>();
/** Permissionless sync() when the app opens, so deposits that skipped ft_on_transfer are credited. */
function useSyncOnOpen(vaultId: string | undefined) {
  useEffect(() => {
    if (!vaultId || synced.has(vaultId) || isFixtureMode()) return;
    synced.add(vaultId);
    api("/api/sync", { body: { vaultId } }).catch(() => synced.delete(vaultId));
  }, [vaultId]);
}

export function useOverview() {
  const { session } = useSession();
  const { rpc } = useConfig();
  const vaultId = session?.vaultId;
  useSyncOnOpen(vaultId);
  return useQuery<Overview>(
    vaultId && (rpc || isFixtureMode()) ? vaultKey(vaultId, "overview") : null,
    () => (isFixtureMode() ? fixtureFetch<Overview>("vault:overview", "GET") : new VaultClient(rpc!, vaultId!).overview()),
    { refreshMs: 15_000 },
  );
}

/** Every money proposal, including approved / rejected / expired ones (for each agent's record). */
export function useAllProposals() {
  const { session } = useSession();
  const { rpc } = useConfig();
  const vaultId = session?.vaultId;
  return useQuery<Proposal[]>(
    vaultId && (rpc || isFixtureMode()) ? vaultKey(vaultId, "proposals:all") : null,
    () => (isFixtureMode() ? fixtureFetch<Proposal[]>("vault:proposals:all", "GET") : new VaultClient(rpc!, vaultId!).proposals(true)),
    { refreshMs: 60_000 },
  );
}

export function useActivity(limit = 50) {
  const { session } = useSession();
  const { rpc } = useConfig();
  const vaultId = session?.vaultId;
  return useQuery<Activity[]>(
    vaultId && (rpc || isFixtureMode()) ? vaultKey(vaultId, `activity:${limit}`) : null,
    () => (isFixtureMode() ? fixtureFetch<Activity[]>("vault:activity", "GET") : new VaultClient(rpc!, vaultId!).activity(undefined, limit)),
    { refreshMs: 15_000 },
  );
}

export function useMonthStats(from: number, to: number) {
  const { session } = useSession();
  const { rpc } = useConfig();
  const vaultId = session?.vaultId;
  return useQuery<MonthStats[]>(
    vaultId && (rpc || isFixtureMode()) ? vaultKey(vaultId, `stats:${from}-${to}`) : null,
    () => (isFixtureMode() ? fixtureFetch<MonthStats[]>("vault:stats", "GET") : new VaultClient(rpc!, vaultId!).monthStats(from, to)),
    { refreshMs: 60_000 },
  );
}

export interface EarnRates { source: string; fetchedAt: string; assets: Array<{ token: "usdc" | "usdt"; supplyApr: string; utilizationBps: number; paused: boolean }> }
export function useEarnRates(enabled = true) {
  return useQuery<EarnRates>(enabled ? "rates:earn" : null, () => api("/api/rates/earn"), { refreshMs: 60_000 });
}

export { fetchName, useNameInfo, useIntentTokens, type IntentGroup, type NameInfoResp } from "./publicData";

export function useReceipts() {
  const { session } = useSession();
  const v = session?.vaultId;
  return useQuery<{ receipts: Receipt[] }>(v ? `receipts:${v}` : null, () => api(`/api/receipts?vault=${encodeURIComponent(v!)}`), { refreshMs: 60_000 });
}

export interface VerifiedBiller { accountId: string; name: string; category: string }
export function useBillers() {
  return useQuery<{ billers: VerifiedBiller[] }>("billers", () => api("/api/billers"));
}

export function useCircles() {
  const { session } = useSession();
  const { rpc, oiko } = useConfig();
  const vaultId = session?.vaultId;
  const ajoId = oiko?.contracts.ajo;
  return useQuery<Circle[]>(
    vaultId && ((rpc && ajoId) || isFixtureMode()) ? `ajo:${vaultId}:circles` : null,
    () => (isFixtureMode() ? fixtureFetch<Circle[]>("ajo:circles", "GET") : new AjoClient(rpc!, ajoId!).circlesFor(vaultId!)),
    { refreshMs: 30_000 },
  );
}
export function useCircle(id: number | null) {
  const { rpc, oiko } = useConfig();
  const ajoId = oiko?.contracts.ajo;
  return useQuery<Circle | null>(
    id !== null && ((rpc && ajoId) || isFixtureMode()) ? `ajo:circle:${id}` : null,
    () => (isFixtureMode() ? fixtureFetch<Circle | null>(`ajo:circle:${id}`, "GET") : new AjoClient(rpc!, ajoId!).circle(id!)),
    { refreshMs: 30_000 },
  );
}

export interface AccessLogRow { at: string; method: string; path: string; status?: number; code?: string | null; tool?: string | null; txHash?: string | null; ok?: boolean; summary?: string; outcome?: "Read" | "Approved" | "Proposed" | "Blocked" | "Refused"; reason?: string | null }
/** Agent access log (GET /api/agent/log), authenticated with NEP-413 by the owner's app key. */
export function useAgentLog(publicKey: string | null) {
  const { session } = useSession();
  const vaultId = session?.vaultId;
  return useQuery<AccessLogRow[]>(
    publicKey && vaultId ? `agentlog:${vaultId}:${publicKey}` : null,
    async () => {
      const path = `/api/agent/log?vaultId=${encodeURIComponent(vaultId!)}&publicKey=${encodeURIComponent(publicKey!)}`;
      if (isFixtureMode()) return (await fixtureFetch<{ rows: AccessLogRow[] }>(path, "GET")).rows;
      const auth = gatewayAuthHeader(session!.appKey, session!.accountId, "GET", path, "");
      const res = await fetch(path, { headers: { authorization: auth }, cache: "no-store" });
      if (!res.ok) throw new Error(`E_UPSTREAM: ${res.status}`);
      const j = (await res.json()) as { rows?: AccessLogRow[] } | AccessLogRow[];
      return Array.isArray(j) ? j : j.rows ?? [];
    },
    { refreshMs: 30_000 },
  );
}

/** True when this account runs an older version of the account code than the one Oiko publishes today (see
 *  HANDOFF G7: accounts made before 2026-11-05 lack newer ROSCA methods and safety fixes). */
export function useOlderVersion(): boolean {
  const { session } = useSession();
  const { config, rpc } = useConfig();
  const vaultId = session?.vaultId;
  const want = config?.vaultCodeHash ?? null;
  const q = useQuery<string | null>(
    vaultId && rpc && want && !isFixtureMode() ? `vault:${vaultId}:codehash` : null,
    async () => (await rpc!.viewAccount(vaultId!))?.global_contract_hash ?? null,
  );
  return !!(want && q.data && q.data !== want);
}
