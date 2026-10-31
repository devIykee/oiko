// Server configuration from env. Plain TS (no Next imports) so it can be lifted into a standalone service.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configFor, isNetworkId, type NetworkId, type OikoConfig } from "@oiko/sdk";

export interface Features { earn: boolean; ajo: boolean; mcp: boolean; rescue: boolean; invest: boolean; ajoDao: boolean }

export interface ServerConfig {
  network: NetworkId;
  oiko: OikoConfig;
  vaultCodeHash: string | null;
  relayer: { accountId: string; privateKey: string } | null;
  oneclick: { baseUrl: string; jwt: string | null; isMock: boolean };
  publicUrl: string;
  features: Features;
  cronSecret: string | null;
  databaseUrl: string | null;
  vapid: { publicKey: string; privateKey: string; subject: string } | null;
  limits: {
    /** Max NEAR (yocto) a relayed SignedDelegate may transfer in total (vault funding). */
    relayMaxTransfer: bigint;
    vaultFunding: bigint;
    topupThreshold: bigint;
    topupAmount: bigint;
    /** Global relayer spend per UTC day (yocto, attached deposits + transfers + a gas estimate per tx). */
    dailyBudget: bigint;
    accountFunding: bigint | null;
  };
}

const YOCTO = 10n ** 24n;
/** "0.25" NEAR -> yocto. */
export function nearToYocto(v: string): bigint {
  const [w, f = ""] = v.trim().split(".");
  if (!/^\d+$/.test(w || "0") || !/^\d*$/.test(f) || f.length > 24) throw new Error(`bad NEAR amount ${v}`);
  return BigInt(w || "0") * YOCTO + BigInt((f + "0".repeat(24)).slice(0, 24));
}

function flag(env: Record<string, string | undefined>, name: string, dflt: boolean): boolean {
  const v = env[name];
  if (v === undefined || v === "") return dflt;
  return /^(1|true|yes|on)$/i.test(v);
}

/** Local-mode development defaults (well-known sandbox values, never real funds). */
const LOCAL_ONECLICK_MOCK = "mock";

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const network: NetworkId = isNetworkId(env.OIKO_NETWORK) ? env.OIKO_NETWORK : "local";
  const oiko = configFor(network, env);
  const publicUrl = (env.OIKO_PUBLIC_URL || env.NEXT_PUBLIC_SITE_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "http://localhost:3000")).replace(/\/+$/, "");
  const rawOneClick = env.ONECLICK_BASE_URL?.trim();
  // mainnet defaults to the real 1Click; local/testnet default to the built-in mock (Intents has no testnet).
  const oneclickBase = rawOneClick && rawOneClick !== LOCAL_ONECLICK_MOCK ? rawOneClick.replace(/\/+$/, "") : network === "mainnet" && !rawOneClick ? "https://1click.chaindefuser.com" : `${publicUrl}/api/mock-1click`;
  const isMock = !(rawOneClick && rawOneClick !== LOCAL_ONECLICK_MOCK) && !(network === "mainnet" && !rawOneClick);
  let relayerId = env.RELAYER_ACCOUNT_ID?.trim();
  let relayerKey = env.RELAYER_PRIVATE_KEY?.trim();
  if (!relayerId || !relayerKey) {
    const file = readKeyFile(env.RELAYER_KEY_FILE);
    if (file) {
      relayerId ||= file.account_id;
      relayerKey ||= file.private_key ?? file.secret_key;
    }
  }
  const vapidPub = env.VAPID_PUBLIC_KEY?.trim();
  const vapidPriv = env.VAPID_PRIVATE_KEY?.trim();
  return {
    network,
    oiko,
    vaultCodeHash: env.OIKO_VAULT_CODE_HASH?.trim() || null,
    relayer: relayerId && relayerKey ? { accountId: relayerId, privateKey: relayerKey } : null,
    oneclick: { baseUrl: oneclickBase, jwt: env.ONECLICK_JWT?.trim() || null, isMock },
    publicUrl,
    features: {
      earn: flag(env, "FEATURE_EARN", true),
      ajo: flag(env, "FEATURE_AJO", true),
      mcp: flag(env, "FEATURE_MCP", true),
      rescue: flag(env, "FEATURE_RESCUE", network !== "mainnet"),
      invest: flag(env, "FEATURE_INVEST", false),
      ajoDao: flag(env, "FEATURE_AJO_DAO", false),
    },
    cronSecret: env.CRON_SECRET?.trim() || null,
    databaseUrl: env.DATABASE_URL?.trim() || null,
    vapid: vapidPub && vapidPriv ? { publicKey: vapidPub, privateKey: vapidPriv, subject: env.VAPID_SUBJECT || "mailto:hello@oiko.app" } : null,
    limits: {
      relayMaxTransfer: nearToYocto(env.RELAY_MAX_TRANSFER_NEAR || "1"),
      topupThreshold: nearToYocto(env.TOPUP_THRESHOLD_NEAR || "0.15"),
      topupAmount: nearToYocto(env.TOPUP_AMOUNT_NEAR || "0.15"),
      dailyBudget: nearToYocto(env.RELAYER_DAILY_BUDGET_NEAR || "25"),
      accountFunding: env.OIKO_ACCOUNT_FUNDING_NEAR ? nearToYocto(env.OIKO_ACCOUNT_FUNDING_NEAR) : null,
      vaultFunding: nearToYocto(env.OIKO_VAULT_FUNDING_NEAR || "0.3"),
    },
  };
}

let cached: ServerConfig | null = null;
export function serverConfig(): ServerConfig {
  return (cached ??= loadConfig());
}
/** Test hook. */
export function setServerConfig(c: ServerConfig | null): void {
  cached = c;
}

export function explorerBase(network: NetworkId): string | null {
  return network === "mainnet" ? "https://nearblocks.io" : network === "testnet" ? "https://testnet.nearblocks.io" : null;
}

/**
 * near-cli style credentials JSON {account_id, private_key}. Default locations (local mode, written by scripts/deploy):
 * `$RELAYER_KEY_FILE`, `./.oiko/relayer.json`, `../../.oiko/relayer.json`.
 */
function readKeyFile(explicit?: string): { account_id?: string; private_key?: string; secret_key?: string } | null {
  const candidates = explicit ? [explicit] : [join(process.cwd(), ".oiko", "relayer.json"), join(process.cwd(), "..", "..", ".oiko", "relayer.json")];
  for (const f of candidates) {
    try {
      if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
    } catch {
      /* ignore unreadable file */
    }
  }
  return null;
}
