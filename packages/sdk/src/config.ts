export type NetworkId = "local" | "testnet" | "mainnet";
export interface OikoConfig {
  network: NetworkId; nodeUrl: string; root: string;
  contracts: { registry: string; usdc: string; usdt: string; lending: string | null; ajo: string | null; mpcSigner: string | null };
  explorerTx: (hash: string) => string; explorerAccount: (id: string) => string;
}

const DEFAULTS: Record<NetworkId, { nodeUrl: string; root: string; explorer: string | null }> = {
  local: { nodeUrl: "http://127.0.0.1:3030", root: "oiko.test.near", explorer: null },
  testnet: { nodeUrl: "https://test.rpc.fastnear.com", root: "oiko.testnet", explorer: "https://testnet.nearblocks.io" },
  mainnet: { nodeUrl: "https://rpc.mainnet.fastnear.com", root: "oiko.near", explorer: "https://nearblocks.io" },
};

/** Verified mainnet contracts (docs/DECISIONS.md §6, §7, §8). */
export const MAINNET_CONTRACTS = {
  usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  usdt: "usdt.tether-token.near",
  lending: "contract.main.burrow.near",
  mpcSigner: "v1.signer",
} as const;

const nonEmpty = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export function isNetworkId(v: unknown): v is NetworkId {
  return v === "local" || v === "testnet" || v === "mainnet";
}

/**
 * Builds the client config. `env` may carry OIKO_* overrides (server env, or NEXT_PUBLIC_OIKO_* mapped by the caller).
 * Local and testnet default to the Oiko mock tokens and mock lending under the root (they are minted by the relayer).
 */
export function configFor(network: NetworkId, env: Record<string, string | undefined> = {}): OikoConfig {
  const d = DEFAULTS[network];
  const root = nonEmpty(env.OIKO_ROOT_ACCOUNT) ?? d.root;
  const main = network === "mainnet";
  const pick = (key: string, fallback: string | null) => {
    const v = env[key];
    if (v === undefined) return fallback;
    const t = v.trim();
    return t === "" || t === "none" ? null : t;
  };
  const explorer = d.explorer;
  return {
    network,
    nodeUrl: nonEmpty(env.OIKO_NODE_URL) ?? d.nodeUrl,
    root,
    contracts: {
      registry: root,
      usdc: pick("OIKO_USDC", main ? MAINNET_CONTRACTS.usdc : `usdc.${root}`) as string,
      usdt: pick("OIKO_USDT", main ? MAINNET_CONTRACTS.usdt : `usdt.${root}`) as string,
      lending: pick("OIKO_LENDING", main ? MAINNET_CONTRACTS.lending : `lending.${root}`),
      ajo: pick("OIKO_AJO", `ajo.${root}`),
      mpcSigner: pick("OIKO_MPC_SIGNER", main ? MAINNET_CONTRACTS.mpcSigner : network === "testnet" ? "v1.signer-prod.testnet" : null),
    },
    explorerTx: (hash) => (explorer ? `${explorer}/txns/${hash}` : `#tx-${hash}`),
    explorerAccount: (id) => (explorer ? `${explorer}/address/${id}` : `#account-${id}`),
  };
}

/** 2-32 chars of a-z, 0-9, `_`, `-`, and a valid NEAR account label: no leading/trailing or doubled `_`/`-`.
 *  (The registry contract accepts `^[a-z0-9_-]{2,32}$`, but names like `a_` or `-ab` cannot be NEAR accounts and fail on create.) */
export const NAME_RE = /^(?=.{2,32}$)[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
export function accountIdFor(name: string, cfg: OikoConfig): string {
  return `${name.toLowerCase()}.${cfg.root}`;
}
export function vaultIdFor(name: string, cfg: OikoConfig): string {
  return `vault.${accountIdFor(name, cfg)}`;
}
/** "vault.ada.oiko.testnet" -> "ada"; "ada.oiko.testnet" -> "ada"; null when not under the root. */
export function nameFromAccount(accountId: string, cfg: OikoConfig): string | null {
  const suffix = `.${cfg.root}`;
  if (!accountId.endsWith(suffix)) return null;
  let head = accountId.slice(0, -suffix.length);
  if (head.startsWith("vault.")) head = head.slice(6);
  return NAME_RE.test(head) ? head : null;
}
export function isVaultId(accountId: string, cfg: OikoConfig): boolean {
  return accountId.startsWith("vault.") && nameFromAccount(accountId, cfg) !== null && accountId.split(".").length === cfg.root.split(".").length + 2;
}
