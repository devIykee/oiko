"use client";
// Data hooks for public pages (/pay, /i): no session, no keys, so those pages don't load signing code.
import { api } from "./api";
import { useQuery } from "./query";

export interface NameInfoResp { name: string; available: boolean; accountId: string; vaultId: string; exists: boolean; suggestions: string[] }
export function fetchName(name: string) { return api<NameInfoResp>(`/api/names/${encodeURIComponent(name)}`); }
export function useNameInfo(name: string | null) {
  return useQuery<NameInfoResp>(name ? `name:${name}` : null, () => fetchName(name!));
}

export interface IntentGroup { id: string; label: string; chain: string; symbol: string; assetId: string; decimals: number }
export function useIntentTokens() {
  return useQuery<{ groups: IntentGroup[] }>("intents:tokens", () => api("/api/intents/tokens"));
}

