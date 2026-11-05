// Counterparty check: before an agent pays someone, look at the receiver and return allow / warn / block with reasons.
// This is a pre-flight layer. The hard guarantee is the vault contract (allowlist, caps, expiry, revoke): an agent
// that skips the gateway is still bound by it. Signals, sources and rules: docs/COUNTERPARTY.md.
import type { Activity, NetworkId, Token } from "@oiko/sdk";
import { serverConfig } from "./config";
import { seedReportsFor } from "./counterpartySeed";
import { rpc } from "./near";
import { store, type Store } from "./store";

export type Verdict = "allow" | "warn" | "block";
export type Severity = "info" | "warn" | "block";
export interface CounterpartyReason { code: string; severity: Severity; message: string; evidence?: string }
export interface CounterpartyResult {
  receiver: string;
  verdict: Verdict;
  /** Risk score 0 (nothing found) to 100. Each block reason adds 60, each warn 20. */
  score: number;
  reasons: CounterpartyReason[];
  checkedAt: string;
  /** Where each fact came from (RPC method, NearBlocks endpoint, vault view, table, seed list). */
  sources: string[];
}
export interface CheckInput {
  /** The agent's vault; enables the prior-interaction signal and the self-payment check. */
  agentVault?: string | null;
  agentPublicKey?: string | null;
  receiver: string;
  /** Base units (6 decimals). */
  amount?: string | null;
  token?: Token | null;
}

export interface AccountFacts { amount: string; code_hash: string; storage_usage: number; global_contract_hash?: string | null }
export interface NearBlocksApi {
  /** Account creation time (ms) or null when NearBlocks has no creation record. Throws when the API is unavailable. */
  createdAtMs(accountId: string): Promise<number | null>;
  /** Number of transactions signed by the account (`txns-only/count`). */
  txCount(accountId: string): Promise<number | null>;
  /** Time (ms) of the newest contract deployment, or null if none. */
  lastDeployMs(accountId: string): Promise<number | null>;
}
export interface CounterpartyDeps {
  network: NetworkId;
  now: () => number;
  /** RPC `query` view_account; null when the account does not exist; throws when RPC is unavailable. */
  viewAccount: (accountId: string) => Promise<AccountFacts | null>;
  /** null = no NearBlocks for this network (local sandbox) or disabled. */
  nearblocks: NearBlocksApi | null;
  /** Vault view `get_activity` (newest first, last 200 rows). */
  vaultActivity: (vaultId: string) => Promise<Activity[]>;
  store: Pick<Store, "kind" | "listReports" | "getCodeHash" | "setCodeHash" | "countPaymentsTo">;
  isOikoAccount: (accountId: string) => boolean;
  /** Paying a first-time receiver more than this (base units) is a warn. */
  firstTimeThreshold: bigint;
  /** Distinct reporting accounts needed to block (seed entries always block). */
  blockReports: number;
}

export const EMPTY_CODE_HASH = "11111111111111111111111111111111";
const DAY_MS = 86_400_000;
export const NEW_ACCOUNT_DAYS = 7;
export const YOUNG_ACCOUNT_DAYS = 30;
export const CODE_CHANGE_DAYS = 7;
export const LOW_ACTIVITY_TXNS = 5;
/** Warn reasons the gateway lets an agent `act` past when the receiver is on its on-chain allowlist. Nothing else. */
export const ALLOWLIST_EXEMPT_WARNINGS: ReadonlySet<string> = new Set(["LOW_ACTIVITY", "FIRST_TIME_RECEIVER"]);

const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export function isValidAccountId(id: string): boolean {
  return id.length >= 2 && id.length <= 64 && ACCOUNT_RE.test(id);
}
/** NEAR implicit (64 hex) and ETH-implicit (0x + 40 hex) accounts. */
export function isImplicitAccount(id: string): boolean {
  return /^[0-9a-f]{64}$/.test(id) || /^0x[0-9a-f]{40}$/.test(id);
}
const fmtUnits = (u: bigint) => `${u / 1_000_000n}.${(u % 1_000_000n).toString().padStart(6, "0").slice(0, 2)}`;
const days = (ms: number) => Math.floor(ms / DAY_MS);

export async function checkCounterparty(input: CheckInput, deps: CounterpartyDeps = defaultCounterpartyDeps()): Promise<CounterpartyResult> {
  const receiver = input.receiver.trim();
  const reasons: CounterpartyReason[] = [];
  const sources = new Set<string>();
  const add = (code: string, severity: Severity, message: string, evidence?: string) => reasons.push({ code, severity, message, ...(evidence ? { evidence } : {}) });
  const done = () => finish(receiver, reasons, [...sources], deps.now());

  // 1. Is it even an account id?
  if (!isValidAccountId(receiver)) {
    add("INVALID_ACCOUNT_ID", "warn", `"${receiver.slice(0, 80)}" is not a valid NEAR account name. Check the spelling before paying.`);
    return done();
  }
  // 2. Paying your own account is never what the owner meant.
  if (input.agentVault && receiver === input.agentVault) {
    add("SELF_PAYMENT", "warn", "This is the savings account itself. Paying it from itself does nothing useful; ask the owner what they meant.");
  }
  // 3. Oiko's own contracts.
  if (deps.isOikoAccount(receiver)) {
    sources.add("config:oiko-contracts");
    add("OIKO_CONTRACT", "info", "This is one of Oiko's own contracts.");
    return done();
  }

  // 4. Shared blocklist: built-in seed list + reports filed by agents.
  sources.add("seed-list:counterpartySeed.ts");
  for (const s of seedReportsFor(receiver, deps.network)) {
    add("REPORTED", "block", `Reported as a scam: ${s.reason}${s.demo ? " (demo entry)" : ""}`, s.evidence);
  }
  try {
    sources.add(`${deps.store.kind}:counterparty_reports`);
    const reports = (await deps.store.listReports(receiver)).filter((r) => r.verified);
    const vaults = new Set(reports.map((r) => r.reporterVault));
    if (reports.length && vaults.size >= deps.blockReports) {
      const r = reports[0]!;
      add("REPORTED", "block", `Reported by ${vaults.size} Oiko account${vaults.size === 1 ? "" : "s"}: ${r.reason}`, r.evidence);
    } else if (reports.length) {
      add("REPORTED_ONCE", "warn", `Reported by ${vaults.size} Oiko account${vaults.size === 1 ? "" : "s"} (not enough to block yet): ${reports[0]!.reason}`, reports[0]!.evidence);
    }
  } catch {
    add("REPORTS_UNAVAILABLE", "warn", "Couldn't read the shared report list right now.");
  }

  // 5. Does the account exist, and is it a contract?
  let facts: AccountFacts | null = null;
  let rpcOk = true;
  sources.add("rpc:query view_account");
  try {
    facts = await deps.viewAccount(receiver);
  } catch {
    rpcOk = false;
    add("RPC_UNAVAILABLE", "warn", "Couldn't reach the NEAR network to look at this account. Try again shortly.");
  }
  if (rpcOk && !facts) {
    if (isImplicitAccount(receiver)) add("IMPLICIT_UNUSED", "warn", "This is a raw key-style address that has never been used on NEAR. Payments to a mistyped address can't be reversed.");
    else add("ACCOUNT_NOT_FOUND", "block", `${receiver} doesn't exist on NEAR. A payment there would fail or be lost.`);
  }

  if (facts) {
    const isContract = facts.code_hash !== EMPTY_CODE_HASH || !!facts.global_contract_hash;
    if (isContract) {
      add("IS_CONTRACT", "info", "This account runs a contract (it is a program, not a person's wallet).", `code_hash ${facts.code_hash}`);
      await codeChange(receiver, facts.code_hash, deps, add, sources);
    }
    await history(receiver, deps, add, sources);
  }

  // 6. Has this account paid them before?
  if (input.agentVault && receiver !== input.agentVault) await priorInteractions(input, receiver, deps, add, sources);

  return done();
}

async function codeChange(receiver: string, codeHash: string, deps: CounterpartyDeps, add: (c: string, s: Severity, m: string, e?: string) => void, sources: Set<string>) {
  const now = deps.now();
  let flagged = false;
  if (deps.nearblocks) {
    sources.add("nearblocks:/v1/account/{id}/contract/deployments");
    try {
      const last = await deps.nearblocks.lastDeployMs(receiver);
      if (last !== null && now - last < CODE_CHANGE_DAYS * DAY_MS) {
        add("CODE_CHANGED_RECENTLY", "warn", `This contract's code was replaced ${days(now - last) || "less than 1"} day(s) ago. New code hasn't earned trust yet.`, `last deployment ${new Date(last).toISOString()}`);
        flagged = true;
      }
    } catch { /* fall back to the cached hash below */ }
  }
  sources.add(`${deps.store.kind}:counterparty_code_hashes`);
  try {
    const prev = await deps.store.getCodeHash(receiver);
    if (prev && prev.codeHash !== codeHash) {
      await deps.store.setCodeHash(receiver, { codeHash, changedAt: new Date(now).toISOString() });
      if (!flagged) add("CODE_CHANGED_RECENTLY", "warn", "This contract's code changed since Oiko last looked at it.", `was ${prev.codeHash}, now ${codeHash}`);
    } else if (prev?.changedAt && now - Date.parse(prev.changedAt) < CODE_CHANGE_DAYS * DAY_MS) {
      if (!flagged) add("CODE_CHANGED_RECENTLY", "warn", `This contract's code changed on ${prev.changedAt.slice(0, 10)}.`, `code_hash ${codeHash}`);
    } else if (!prev) {
      await deps.store.setCodeHash(receiver, { codeHash, changedAt: null });
    }
  } catch { /* cache is best effort */ }
}

async function history(receiver: string, deps: CounterpartyDeps, add: (c: string, s: Severity, m: string, e?: string) => void, sources: Set<string>) {
  if (!deps.nearblocks) {
    add("HISTORY_NOT_AVAILABLE", "info", "Account age and activity aren't available on this network.");
    return;
  }
  sources.add("nearblocks:/v1/account/{id}");
  sources.add("nearblocks:/v1/account/{id}/txns-only/count");
  let created: number | null, txns: number | null;
  try {
    [created, txns] = await Promise.all([deps.nearblocks.createdAtMs(receiver), deps.nearblocks.txCount(receiver)]);
  } catch {
    add("HISTORY_UNKNOWN", "warn", "Couldn't look up how old or how active this account is (the explorer API is unavailable). Treat it as unknown.");
    return;
  }
  const now = deps.now();
  if (created === null) add("AGE_UNKNOWN", "warn", "The explorer has no creation record for this account, so its age is unknown.");
  else {
    const age = now - created;
    const when = new Date(created).toISOString().slice(0, 10);
    if (age < NEW_ACCOUNT_DAYS * DAY_MS) add("NEW_ACCOUNT", "warn", `This account was created ${days(age) || "less than 1"} day(s) ago. Scammers often use brand-new accounts.`, `created ${when}`);
    else if (age < YOUNG_ACCOUNT_DAYS * DAY_MS) add("YOUNG_ACCOUNT", "info", `This account is ${days(age)} days old.`, `created ${when}`);
    else add("ACCOUNT_AGE", "info", `This account has existed since ${when}.`);
  }
  if (txns !== null && txns < LOW_ACTIVITY_TXNS) add("LOW_ACTIVITY", "warn", `This account has sent only ${txns} transaction${txns === 1 ? "" : "s"}. Little history means little to go on.`, `txns-only count ${txns}`);
  else if (txns !== null) add("ACTIVE_ACCOUNT", "info", `This account has sent ${txns} transactions.`);
}

async function priorInteractions(input: CheckInput, receiver: string, deps: CounterpartyDeps, add: (c: string, s: Severity, m: string, e?: string) => void, sources: Set<string>) {
  const vault = input.agentVault!;
  const amount = input.amount && /^\d+$/.test(input.amount) ? BigInt(input.amount) : null;
  const big = amount !== null && amount > deps.firstTimeThreshold;
  let paid = 0, isBillPayee = false, known = true;
  sources.add("vault:get_activity");
  try {
    const rows = await deps.vaultActivity(vault);
    for (const a of rows) {
      if (a.counterparty !== receiver) continue;
      if (a.kind === "withdrawn" || a.kind === "bill_paid") paid++;
      if (a.kind === "bill_added") isBillPayee = true;
    }
  } catch { known = false; }
  sources.add(`${deps.store.kind}:agent_access_log`);
  try {
    paid += await deps.store.countPaymentsTo(vault, receiver);
  } catch { /* the on-chain activity is the main source */ }
  if (isBillPayee) add("OWNER_BILL_PAYEE", "info", "The owner set this account up as a bill payee.");
  if (paid > 0) add("PRIOR_PAYMENTS", "info", `This account has paid ${receiver} before (${paid} time${paid === 1 ? "" : "s"} in recent history).`);
  else if (!known && big) add("PRIOR_UNKNOWN", "warn", "Couldn't read this account's recent activity to see if it has paid them before.");
  else if (big && !isBillPayee) {
    add("FIRST_TIME_RECEIVER", "warn", `This account has never paid ${receiver}, and ${fmtUnits(amount!)} is more than the ${fmtUnits(deps.firstTimeThreshold)} first-payment limit for agents.`);
  } else if (!isBillPayee) add("FIRST_TIME_RECEIVER_SMALL", "info", "First payment to this account (small amount).");
}

function finish(receiver: string, reasons: CounterpartyReason[], sources: string[], now: number): CounterpartyResult {
  const has = (s: Severity) => reasons.some((r) => r.severity === s);
  const verdict: Verdict = has("block") ? "block" : has("warn") ? "warn" : "allow";
  const score = Math.min(100, reasons.reduce((n, r) => n + (r.severity === "block" ? 60 : r.severity === "warn" ? 20 : 0), 0));
  const order: Record<Severity, number> = { block: 0, warn: 1, info: 2 };
  reasons.sort((a, b) => order[a.severity] - order[b.severity]);
  return { receiver, verdict, score, reasons, checkedAt: new Date(now).toISOString(), sources };
}

// ---------- gateway / wrapper decision ----------

export type AgentDecision =
  | { ok: true; note?: string }
  | { ok: false; code: "E_COUNTERPARTY_BLOCKED" | "E_COUNTERPARTY_WARN"; message: string };

/**
 * What an agent may do with a check result. block: nothing (no act, no propose). warn: no act, propose instead, unless
 * the receiver is on the agent's on-chain allowlist AND every warning is in ALLOWLIST_EXEMPT_WARNINGS (low activity only).
 */
export function agentDecision(r: CounterpartyResult, kind: "act" | "propose", onAllowlist: boolean): AgentDecision {
  const list = (sev: Severity) => r.reasons.filter((x) => x.severity === sev).map((x) => x.message).join(" ");
  if (r.verdict === "block") {
    return { ok: false, code: "E_COUNTERPARTY_BLOCKED", message: `Oiko won't help pay ${r.receiver}: ${list("block")} Don't retry or work around this; tell the owner what you were asked to do.` };
  }
  if (r.verdict === "warn" && kind === "act") {
    const warns = r.reasons.filter((x) => x.severity === "warn");
    if (onAllowlist && warns.every((w) => ALLOWLIST_EXEMPT_WARNINGS.has(w.code))) {
      return { ok: true, note: `Allowed: ${r.receiver} is on your allowlist and the only concern is low activity.` };
    }
    return { ok: false, code: "E_COUNTERPARTY_WARN", message: `Check before paying ${r.receiver}: ${list("warn")} Don't pay it directly. Use propose instead so the owner can look and approve.` };
  }
  return { ok: true };
}

// ---------- defaults (RPC, NearBlocks with cache, store) ----------

type CacheEntry = { at: number; value: unknown };
const g = globalThis as unknown as { __oikoNbCache?: Map<string, CacheEntry> };
const nbCache = (g.__oikoNbCache ??= new Map());

export function nearblocksBase(network: NetworkId, env: Record<string, string | undefined> = process.env): string | null {
  if (/^(0|off|false|no)$/i.test(env.COUNTERPARTY_NEARBLOCKS ?? "")) return null;
  const explicit = env.NEARBLOCKS_API_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return network === "mainnet" ? "https://api.nearblocks.io" : network === "testnet" ? "https://api-testnet.nearblocks.io" : null;
}

/**
 * NearBlocks REST client (verified endpoints: /v1/account/{id}, /v1/account/{id}/txns-only/count,
 * /v1/account/{id}/contract/deployments). Free tier is ~6 calls/minute, so results are cached per instance.
 * Optional NEARBLOCKS_API_KEY is sent as `Authorization: Bearer <key>`.
 */
export function nearBlocksClient(base: string, opts: { apiKey?: string | null; fetchImpl?: typeof fetch; now?: () => number } = {}): NearBlocksApi {
  const f = opts.fetchImpl ?? ((...a) => globalThis.fetch(...a));
  const now = opts.now ?? Date.now;
  const get = async <T>(path: string, ttlMs: number): Promise<T> => {
    const key = base + path;
    const hit = nbCache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value as T;
    const res = await f(key, { headers: { accept: "application/json", ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`NearBlocks HTTP ${res.status}`);
    const value = (await res.json()) as T;
    nbCache.set(key, { at: now(), value });
    if (nbCache.size > 5000) for (const k of [...nbCache.keys()].slice(0, 1000)) nbCache.delete(k);
    return value;
  };
  const tsMs = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(BigInt(String(v)) / 1_000_000n));
  const enc = encodeURIComponent;
  return {
    async createdAtMs(id) {
      const j = await get<{ account?: Array<{ created?: { block_timestamp?: number | string | null } }> }>(`/v1/account/${enc(id)}`, DAY_MS);
      return tsMs(j.account?.[0]?.created?.block_timestamp);
    },
    async txCount(id) {
      const j = await get<{ txns?: Array<{ count?: string | number }> }>(`/v1/account/${enc(id)}/txns-only/count`, 10 * 60_000);
      const c = j.txns?.[0]?.count;
      return c === undefined ? null : Number(c);
    },
    async lastDeployMs(id) {
      const j = await get<{ deployments?: Array<{ block_timestamp?: string | number }> }>(`/v1/account/${enc(id)}/contract/deployments`, 10 * 60_000);
      const ts = (j.deployments ?? []).map((d) => tsMs(d.block_timestamp)).filter((x): x is number => x !== null);
      return ts.length ? Math.max(...ts) : null;
    },
  };
}

/** Decimal amount ("10") → base units. */
function decimalToUnits(v: string): bigint {
  const [w, f = ""] = v.trim().split(".");
  return BigInt(w || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6));
}

export function oikoAccounts(): Set<string> {
  const cfg = serverConfig();
  const c = cfg.oiko.contracts;
  return new Set([cfg.oiko.root, c.registry, c.usdc, c.usdt, c.lending, c.ajo, c.mpcSigner, cfg.relayer?.accountId].filter((x): x is string => !!x));
}

export function defaultCounterpartyDeps(env: Record<string, string | undefined> = process.env): CounterpartyDeps {
  const cfg = serverConfig();
  const r = rpc();
  const base = nearblocksBase(cfg.network, env);
  const ours = oikoAccounts();
  return {
    network: cfg.network,
    now: () => Date.now(),
    viewAccount: (id) => r.viewAccount(id),
    nearblocks: base ? nearBlocksClient(base, { apiKey: env.NEARBLOCKS_API_KEY?.trim() || null }) : null,
    vaultActivity: (v) => r.view<Activity[]>(v, "get_activity", { from_seq: null, limit: 200 }),
    store: store(),
    isOikoAccount: (id) => ours.has(id),
    firstTimeThreshold: decimalToUnits(env.COUNTERPARTY_FIRST_TIME_THRESHOLD || "10"),
    blockReports: Math.max(1, Number(env.COUNTERPARTY_BLOCK_REPORTS || 1) || 1),
  };
}
