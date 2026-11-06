"use client";
// Owner-only HTTP calls (agent change proposals, autopilot), signed with NEP-413 by the app key like the access log.
import { gatewayAuthHeader, type ConfigChange } from "@oiko/sdk";
import { useCallback } from "react";
import { ApiError } from "./api";
import { fixtureFetch, isFixtureMode } from "./fixtures/mode";
import { invalidate, useQuery } from "./query";
import { useSession, type Session } from "./session";

export async function ownerFetch<T>(session: Session, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  if (isFixtureMode()) return fixtureFetch<T>(path, method, body);
  const text = body === undefined ? "" : JSON.stringify(body);
  const auth = gatewayAuthHeader(session.appKey, session.accountId, method, path, text);
  let res: Response;
  try {
    res = await fetch(path, { method, headers: { authorization: auth, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : text, cache: "no-store" });
  } catch {
    throw new ApiError("E_RPC", "Oiko couldn't be reached.", 0);
  }
  const j = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) throw new ApiError(j?.error?.code ?? "E_UPSTREAM", j?.error?.message ?? res.statusText, res.status);
  return j as T;
}

export interface ChangeView {
  id: string; publicKey: string; agentName: string; change: ConfigChange; reason: string; summary: string;
  status: "pending" | "approved" | "rejected" | "expired"; createdAt: string; expiresAt: string; decidedAt: string | null;
  txHashes: string[]; invoiceId: string | null; calls: Array<{ method: string; args: unknown[] }>; problem: string | null;
}

export function useChanges() {
  const { session } = useSession();
  return useQuery<ChangeView[]>(session ? `owner:changes:${session.accountId}` : null,
    async () => (await ownerFetch<{ changes: ChangeView[] }>(session!, "GET", "/api/owner/changes")).changes, { refreshMs: 30_000 });
}

export function useDecideChange() {
  const { session } = useSession();
  return useCallback(async (id: string, decision: "approve" | "reject", txHashes: string[] = []) => {
    const r = await ownerFetch<ChangeView>(session!, "POST", `/api/owner/changes/${encodeURIComponent(id)}`, { decision, txHashes });
    invalidate("owner:changes:");
    return r;
  }, [session]);
}

export interface Autopilot {
  top_up_bills: { on: boolean };
  sweep_spend: { on: boolean; above: string; to_pot: number | null; weekday: number };
  pay_bills_on_due_day: { on: boolean };
  spend_floor: string | null;
  updatedAt: string | null;
}
export function useAutopilot() {
  const { session } = useSession();
  return useQuery<Autopilot>(session ? `owner:autopilot:${session.accountId}` : null,
    async () => (await ownerFetch<{ autopilot: Autopilot }>(session!, "GET", "/api/owner/autopilot")).autopilot);
}
export function useSaveAutopilot() {
  const { session } = useSession();
  return useCallback(async (a: Omit<Autopilot, "updatedAt">) => {
    const r = await ownerFetch<{ autopilot: Autopilot }>(session!, "POST", "/api/owner/autopilot", a);
    invalidate("owner:autopilot:");
    return r.autopilot;
  }, [session]);
}
