// Relayer: sponsors sign-up, vault creation (NEP-366), gas top-ups and permissionless sync. Every path is allow-listed,
// rate limited (per IP and per account) and counted against a global daily budget.
import { sha256 } from "@noble/hashes/sha2.js";
import {
  act, b58encode, decodeSignedDelegate, fromUtf8, isVaultId, NAME_RE, normalizePublicKey, RegistryClient, TGAS, verifySignedDelegate,
  vaultIdFor, accountIdFor, type DecodedDelegate, type TxResult,
} from "@oiko/sdk";
import { serverConfig, type ServerConfig } from "./config";
import { ApiError } from "./errors";
import { relayer, rpc } from "./near";
import { checkLimits, GAS_COST_ESTIMATE, spendBudget } from "./ratelimit";

export interface DelegatePolicy {
  root: string; usdc: string; usdt: string; trustedHashes: Set<string>; maxTransfer: bigint; currentHeight?: number;
}

const ORDER = { createAccount: 0, transfer: 1, useGlobalContract: 2, deployContract: 2, functionCall: 3 } as const;
const MAX_GAS = 300n * TGAS;

function deny(reason: string): never {
  throw new ApiError("E_RELAY_DENIED", 403, `That request isn't allowed: ${reason}`);
}

/**
 * Allow-list for /api/relay. Only the vault-creation batch is accepted:
 * sender `<name>.<root>`, receiver `vault.<name>.<root>`, actions in order
 * CreateAccount → Transfer(≤ cap) → UseGlobalContract(trusted hash) | DeployContract(trusted code) → FunctionCall `new`.
 */
export function checkDelegate(d: DecodedDelegate, p: DelegatePolicy): void {
  const suffix = `.${p.root}`;
  if (!d.senderId.endsWith(suffix) || !NAME_RE.test(d.senderId.slice(0, -suffix.length))) deny("sender must be an Oiko name");
  if (d.receiverId !== `vault.${d.senderId}`) deny("receiver must be the sender's own vault");
  if (d.actions.length < 1 || d.actions.length > 4) deny("unexpected number of actions");
  if (!verifySignedDelegate(d)) deny("bad signature");
  if (p.currentHeight !== undefined && d.maxBlockHeight <= BigInt(p.currentHeight)) deny("the request has expired");
  let last = -1;
  let transferred = 0n;
  let codeSet = false;
  const seen = new Set<string>();
  for (const a of d.actions) {
    if (!(a.kind in ORDER)) deny(`action ${a.kind} is not allowed`);
    const rank = ORDER[a.kind as keyof typeof ORDER];
    if (rank < last || seen.has(a.kind)) deny("actions are out of order or repeated");
    last = rank;
    seen.add(a.kind);
    switch (a.kind) {
      case "createAccount":
        break;
      case "transfer":
        transferred += a.deposit;
        if (transferred > p.maxTransfer) deny("transfer is above the cap");
        break;
      case "useGlobalContract":
        if (!a.codeHash || !p.trustedHashes.has(a.codeHash)) deny("contract code is not the trusted vault");
        if (codeSet) deny("code set twice");
        codeSet = true;
        break;
      case "deployContract": {
        const h = b58encode(sha256(a.code));
        if (!p.trustedHashes.has(h)) deny("contract code is not the trusted vault");
        if (codeSet) deny("code set twice");
        codeSet = true;
        break;
      }
      case "functionCall": {
        if (a.methodName !== "new") deny("only the vault's `new` call is allowed");
        if (a.deposit !== 0n) deny("no deposit allowed on `new`");
        if (a.gas > MAX_GAS) deny("too much gas");
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(fromUtf8(a.args));
        } catch {
          deny("`new` arguments are not JSON");
        }
        if (args.owner !== d.senderId) deny("vault owner must be the sender");
        if (args.usdc !== p.usdc || args.usdt !== p.usdt) deny("vault tokens must be Oiko's USDC and USDT");
        break;
      }
      default:
        deny(`action ${(a as { kind: string }).kind} is not allowed`);
    }
  }
  if (seen.has("createAccount") && !codeSet) deny("a new vault must get the trusted code");
}

export async function trustedHashes(cfg: ServerConfig): Promise<Set<string>> {
  const s = new Set<string>();
  if (cfg.vaultCodeHash) s.add(cfg.vaultCodeHash);
  try {
    const reg = new RegistryClient(rpc(), cfg.oiko.contracts.registry);
    const [one, many] = await Promise.allSettled([reg.vaultCodeHash(), reg.trustedCodeHashes()]);
    if (one.status === "fulfilled" && one.value) s.add(one.value);
    if (many.status === "fulfilled" && Array.isArray(many.value)) many.value.forEach((h) => s.add(h));
  } catch {
    /* registry unreachable: env hash only */
  }
  return s;
}

function txFail(r: TxResult): never {
  throw new ApiError(r.errorCode ?? "E_TX_FAILED", r.errorCode === "E_RPC" ? 502 : 422);
}
function budget(cfg: ServerConfig, amount: bigint) {
  if (!spendBudget(cfg.limits.dailyBudget, amount + GAS_COST_ESTIMATE)) throw new ApiError("E_BUDGET", 503);
}

export async function relaySignedDelegate(signedDelegate: string, ip: string): Promise<{ txHash: string; outcome: { ok: boolean; logs: string[]; errorCode?: string } }> {
  const cfg = serverConfig();
  let d: DecodedDelegate;
  try {
    d = decodeSignedDelegate(signedDelegate);
  } catch {
    throw new ApiError("E_BAD_REQUEST", 400, "signedDelegate is not a valid base64 NEP-366 SignedDelegate.");
  }
  if (!checkLimits("relay", ip, d.senderId)) throw new ApiError("E_RATE_LIMIT", 429);
  const head = await rpc().block("final");
  checkDelegate(d, {
    root: cfg.oiko.root, usdc: cfg.oiko.contracts.usdc, usdt: cfg.oiko.contracts.usdt,
    trustedHashes: await trustedHashes(cfg), maxTransfer: cfg.limits.relayMaxTransfer, currentHeight: head.height,
  });
  budget(cfg, 0n);
  const r = await relayer().relayDelegate(d);
  return { txHash: r.txHash, outcome: { ok: r.ok, logs: r.logs, ...(r.ok ? {} : { errorCode: r.errorCode }) } };
}

async function accountFunding(cfg: ServerConfig): Promise<bigint> {
  try {
    const c = await new RegistryClient(rpc(), cfg.oiko.contracts.registry).config();
    const v = c.account_funding;
    if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  } catch {
    /* fall through to env */
  }
  if (cfg.limits.accountFunding !== null) return cfg.limits.accountFunding;
  throw new ApiError("E_CONFIG", 503, "Account funding is unknown. Set OIKO_ACCOUNT_FUNDING_NEAR or deploy the registry.");
}

export async function registerName(input: { name: string; ownerPublicKey: string; appPublicKey: string }, ip: string): Promise<{ accountId: string; vaultId: string; txHash: string }> {
  const cfg = serverConfig();
  const name = input.name.toLowerCase();
  if (!NAME_RE.test(name)) throw new ApiError("E_NAME_INVALID", 400);
  let owner: string, app: string;
  try {
    owner = normalizePublicKey(input.ownerPublicKey);
    app = normalizePublicKey(input.appPublicKey);
  } catch {
    throw new ApiError("E_BAD_REQUEST", 400, "Keys must be ed25519 public keys like ed25519:… .");
  }
  if (owner === app) throw new ApiError("E_BAD_REQUEST", 400, "The sign-in key and the app key must be different.");
  if (!checkLimits("register", ip, name)) throw new ApiError("E_RATE_LIMIT", 429);
  const reg = new RegistryClient(rpc(), cfg.oiko.contracts.registry);
  if (!(await reg.isAvailable(name))) throw new ApiError("E_NAME_TAKEN", 409);
  const funding = await accountFunding(cfg);
  budget(cfg, funding);
  const r = await relayer().call(cfg.oiko.contracts.registry, "register_name", { name, owner_public_key: owner, app_public_key: app }, { deposit: funding.toString(), gas: (150n * TGAS).toString() });
  if (!r.ok) txFail(r);
  return { accountId: accountIdFor(name, cfg.oiko), vaultId: vaultIdFor(name, cfg.oiko), txHash: r.txHash };
}

const STORAGE_PRICE_PER_BYTE = 10n ** 19n;

export async function topup(accountId: string, ip: string): Promise<{ txHash?: string }> {
  const cfg = serverConfig();
  const suffix = `.${cfg.oiko.root}`;
  const underRoot = accountId.endsWith(suffix) && (isVaultId(accountId, cfg.oiko) || NAME_RE.test(accountId.slice(0, -suffix.length)));
  if (!underRoot) throw new ApiError("E_BAD_REQUEST", 400, "Only Oiko accounts can be topped up.");
  if (!checkLimits("topup", ip, accountId)) throw new ApiError("E_RATE_LIMIT", 429);
  const acc = await rpc().viewAccount(accountId);
  if (!acc) throw new ApiError("E_NOT_FOUND", 404);
  const available = BigInt(acc.amount) - BigInt(acc.storage_usage) * STORAGE_PRICE_PER_BYTE;
  if (available >= cfg.limits.topupThreshold) return {};
  budget(cfg, cfg.limits.topupAmount);
  const r = await relayer().signAndSend(accountId, [act.transfer(cfg.limits.topupAmount)]);
  if (!r.ok) txFail(r);
  return { txHash: r.txHash };
}

export async function syncVault(vaultId: string, ip: string): Promise<{ txHash: string }> {
  const cfg = serverConfig();
  if (!isVaultId(vaultId, cfg.oiko)) throw new ApiError("E_BAD_REQUEST", 400, "vaultId must look like vault.<name>." + cfg.oiko.root);
  if (!checkLimits("sync", ip, vaultId)) throw new ApiError("E_RATE_LIMIT", 429);
  return syncVaultUnchecked(vaultId);
}
/** Internal (cron, intents status, mock deposits): no per-IP limit, still budgeted. */
export async function syncVaultUnchecked(vaultId: string): Promise<{ txHash: string }> {
  const cfg = serverConfig();
  budget(cfg, 0n);
  const r = await relayer().call(vaultId, "sync", {}, { gas: (200n * TGAS).toString() });
  if (!r.ok) txFail(r);
  return { txHash: r.txHash };
}
