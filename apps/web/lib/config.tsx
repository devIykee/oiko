"use client";
import { NearRpc, configFor, isNetworkId, type NetworkId, type OikoConfig } from "@oiko/sdk";
import { useMemo } from "react";
import { api } from "./api";
import { useQuery } from "./query";
import { useSettings } from "./settings";

export interface ApiConfig {
  network: NetworkId;
  root: string;
  contracts: { registry: string; usdc: string; usdt: string; lending: string | null; ajo: string | null; mpcSigner: string | null };
  vaultCodeHash: string | null;
  explorer: string | null;
  features: { earn: boolean; ajo: boolean; mcp: boolean; rescue: boolean; invest: boolean; ajoDao: boolean };
  /** Optional extras the server may add for vault creation; see lib/signup.ts. */
  nodeUrl?: string;
  vaultFunding?: string;
  vaultConfig?: Record<string, unknown>;
}

export function fetchApiConfig() {
  return api<ApiConfig>("/api/config");
}

export function toOikoConfig(c: ApiConfig): OikoConfig {
  const base = configFor(isNetworkId(c.network) ? c.network : "testnet", {
    OIKO_NODE_URL: c.nodeUrl ?? process.env.NEXT_PUBLIC_OIKO_NODE_URL,
    OIKO_ROOT_ACCOUNT: c.root,
  });
  const explorer = c.explorer;
  return {
    ...base,
    contracts: { ...base.contracts, ...c.contracts },
    explorerTx: explorer ? (h) => `${explorer}/txns/${h}` : base.explorerTx,
    explorerAccount: explorer ? (id) => `${explorer}/address/${id}` : base.explorerAccount,
  };
}

const rpcs = new Map<string, NearRpc>();
export function rpcFor(cfg: OikoConfig): NearRpc {
  let r = rpcs.get(cfg.nodeUrl);
  if (!r) { r = new NearRpc(cfg.nodeUrl); rpcs.set(cfg.nodeUrl, r); }
  return r;
}

/** Server config, with Earn and Invest also switched off when the user hid them in Settings. */
export function useConfig() {
  const q = useQuery("config", fetchApiConfig);
  const { settings } = useSettings();
  const config = useMemo(() => (q.data ? { ...q.data, features: { ...q.data.features, earn: q.data.features.earn && settings.showEarn, invest: q.data.features.invest && settings.showInvest } } : q.data),
    [q.data, settings.showEarn, settings.showInvest]);
  const oiko = useMemo(() => (q.data ? toOikoConfig(q.data) : null), [q.data]);
  const isTestMode = q.data ? q.data.network !== "mainnet" : false;
  return { config, oiko, rpc: oiko ? rpcFor(oiko) : null, isTestMode, loading: q.loading, error: q.error };
}
